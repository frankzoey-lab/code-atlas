import { Node, SyntaxKind, VariableDeclarationKind } from 'ts-morph';

export type UrlPart = { kind: 'lit'; text: string } | { kind: 'base'; text: string } | { kind: 'param' };

const MAX_DEPTH = 8;
/** 세그먼트 안에 리터럴과 풀리지 않는 값이 섞인 것(`items${qs}`)의 표시: 리터럴 접두 + `*` */
export const PREFIX_MARK = '*';

/**
 * URL 식을 정적으로 평가한다. 문자열 · 템플릿 · `+` 연결 · const 변수 · enum 멤버 · 객체 리터럴 속성을 따라가고
 * (다른 파일 import 포함), `process.env.X` 나 `isBase` 에 맞는 식은 base 로, 풀리지 않는 조각은 param 으로 둔다.
 */
export function evalUrl(node: Node, isBase: (text: string) => boolean, depth = 0): UrlPart[] {
  if (depth > MAX_DEPTH) return [{ kind: 'param' }];
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return [{ kind: 'lit', text: node.getLiteralValue() }];
  }
  if (Node.isTemplateExpression(node)) {
    const parts: UrlPart[] = [{ kind: 'lit', text: node.getHead().getLiteralText() }];
    for (const span of node.getTemplateSpans()) {
      parts.push(...evalUrl(span.getExpression(), isBase, depth + 1));
      parts.push({ kind: 'lit', text: span.getLiteral().getLiteralText() });
    }
    return parts;
  }
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getText() === '+') {
    return [...evalUrl(node.getLeft(), isBase, depth + 1), ...evalUrl(node.getRight(), isBase, depth + 1)];
  }
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)) {
    return evalUrl(node.getExpression(), isBase, depth + 1);
  }
  if (Node.isBinaryExpression(node) && ['||', '??'].includes(node.getOperatorToken().getText())) {
    return evalUrl(node.getLeft(), isBase, depth + 1);
  }

  const text = node.getText();
  const env = /^process\.env\.([A-Z0-9_]+)$/.exec(text);
  if (env) return [{ kind: 'base', text: env[1] }];
  if (isBase(text)) return [{ kind: 'base', text }];

  if (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) {
    let symbol = node.getSymbol();
    if (symbol?.isAlias()) symbol = symbol.getAliasedSymbol() ?? symbol;
    for (const decl of symbol?.getDeclarations() ?? []) {
      // const { NEXT_PUBLIC_API_URL: base } = process.env
      if (Node.isBindingElement(decl)) {
        const pattern = decl.getParent();
        const owner = pattern.getParent();
        if (Node.isVariableDeclaration(owner) && owner.getInitializer()?.getText() === 'process.env') {
          return [{ kind: 'base', text: decl.getPropertyNameNode()?.getText() ?? decl.getName() }];
        }
        continue;
      }
      if (Node.isVariableDeclaration(decl)) {
        // 다시 대입되는 let · var 는 값을 정할 수 없다
        if (decl.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const && isReassigned(decl)) {
          return [{ kind: 'param' }];
        }
      }
      const init =
        Node.isVariableDeclaration(decl) || Node.isPropertyAssignment(decl) || Node.isPropertyDeclaration(decl) || Node.isEnumMember(decl)
          ? decl.getInitializer()
          : undefined;
      if (init) return evalUrl(init, isBase, depth + 1);
      if (Node.isShorthandPropertyAssignment(decl)) {
        const value = decl.getValueSymbol()?.getDeclarations()[0];
        const valueInit = value && Node.isVariableDeclaration(value) ? value.getInitializer() : undefined;
        if (valueInit) return evalUrl(valueInit, isBase, depth + 1);
      }
      // `get baseUrl() { return … }` — getter 본문 바로 아래의 마지막 return
      if (Node.isGetAccessorDeclaration(decl)) {
        const ret = decl.getBody()?.getChildrenOfKind(SyntaxKind.SyntaxList)[0]?.getChildrenOfKind(SyntaxKind.ReturnStatement).at(-1);
        const expr = ret?.getExpression();
        if (expr) return evalUrl(expr, isBase, depth + 1);
      }
    }
  }
  return [{ kind: 'param' }];
}

function isReassigned(decl: import('ts-morph').VariableDeclaration): boolean {
  const name = decl.getNameNode();
  if (!Node.isIdentifier(name)) return true;
  return name.findReferencesAsNodes().some((ref) => {
    const parent = ref.getParent();
    return (
      !!parent &&
      Node.isBinaryExpression(parent) &&
      parent.getLeft() === ref &&
      /^(=|\+=|-=|\?\?=|\|\|=)$/.test(parent.getOperatorToken().getText())
    );
  });
}

/** 삼항식이면 두 갈래를 모두 후보로 (변수에 담긴 삼항식도 한 번 따라간다) */
export function urlAlternatives(node: Node, depth = 0): Node[] {
  let cur: Node = node;
  while (Node.isParenthesizedExpression(cur) || Node.isAsExpression(cur)) cur = cur.getExpression();
  if (Node.isConditionalExpression(cur)) {
    return [...urlAlternatives(cur.getWhenTrue(), depth + 1), ...urlAlternatives(cur.getWhenFalse(), depth + 1)];
  }
  if (depth === 0 && Node.isIdentifier(cur)) {
    const decl = cur.getSymbol()?.getDeclarations()[0];
    const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
    if (init && Node.isConditionalExpression(init)) return urlAlternatives(init, depth + 1);
  }
  return [node];
}

/**
 * base 뒤 경로를 세그먼트로 만든다. 쿼리스트링과 끝 슬래시는 버린다.
 * 통째로 풀리지 않은 세그먼트는 `:param`, 리터럴 접두가 있는 것은 `접두*`.
 */
export function toPath(parts: UrlPart[]): { base?: string; segments: string[] } | undefined {
  const baseIndex = parts.findIndex((p) => p.kind === 'base');
  if (baseIndex < 0) return undefined;
  const base = (parts[baseIndex] as { text: string }).text;
  let raw = '';
  for (const p of parts.slice(baseIndex + 1)) {
    if (p.kind === 'lit') raw += p.text;
    else raw += '\u0000';
  }
  raw = raw.split('?')[0].split('#')[0];
  const segments = raw
    .split('/')
    .filter(Boolean)
    .map((s) => {
      if (!s.includes('\u0000')) return s;
      const prefix = s.slice(0, s.indexOf('\u0000'));
      return prefix ? `${prefix}${PREFIX_MARK}` : ':param';
    });
  return { base, segments };
}

/** `users/:id` → [`users`, `:param`]. 와일드카드도 param 으로 */
export function routeSegments(...paths: string[]): string[] {
  return paths
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .map((s) => (s.startsWith(':') || s.startsWith('{') || s === '*' || s.endsWith('*') ? ':param' : s));
}
