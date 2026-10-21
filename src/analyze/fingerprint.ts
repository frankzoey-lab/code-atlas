import { Node, SyntaxKind } from 'ts-morph';

/** 함수 하나의 구조 지문. text 는 Jev 확인용으로 메모리에만 둔다 (그래프에는 넣지 않는다) */
export interface FunctionPrint {
  id: string;
  tokens: number;
  hash: string;
  shingles: Set<number>;
  text: string;
}

const SHINGLE = 5;
const TEXT_LIMIT = 3000;
/** 표기만 다른 것: 주석 · 세미콜론 · 쉼표 · 타입 표기 콜론 */
const PUNCTUATION = new Set([SyntaxKind.SemicolonToken, SyntaxKind.CommaToken, SyntaxKind.ColonToken]);
const LITERAL = new Set([
  SyntaxKind.StringLiteral, SyntaxKind.NumericLiteral, SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.BigIntLiteral, SyntaxKind.RegularExpressionLiteral, SyntaxKind.TemplateHead,
  SyntaxKind.TemplateMiddle, SyntaxKind.TemplateTail, SyntaxKind.JsxText,
]);

/**
 * 본문 AST 를 순서대로 돌며 구문 종류만 남긴다. 지역 이름은 ID, 리터럴은 LIT 로 바꾸고
 * 타입 표기 · 주석 · 구두점은 버린다. 그래서 이름 · 값 · 표기만 바꿔 복사한 함수는 같은 토큰열이 된다.
 */
export function normalizedTokens(body: Node): number[] {
  const out: number[] = [];
  const walk = (node: Node) => {
    const kind = node.getKind();
    if (Node.isJSDoc(node) || Node.isTypeNode(node) || kind === SyntaxKind.TypeParameter || PUNCTUATION.has(kind)) return;
    // <Foo>x · x as Foo · x satisfies Foo → x
    if (Node.isTypeAssertion(node) || Node.isAsExpression(node) || Node.isSatisfiesExpression(node)) {
      walk(node.getExpression());
      return;
    }
    // 제네릭 <T> 괄호 (비교 연산자 < > 는 BinaryExpression 의 연산자라 남는다)
    if ((kind === SyntaxKind.LessThanToken || kind === SyntaxKind.GreaterThanToken) && !Node.isBinaryExpression(node.getParent())) return;
    // 줄바꿈 · 들여쓰기뿐인 JSX 텍스트
    if (Node.isJsxText(node) && !node.getText().trim()) return;
    if (kind === SyntaxKind.Identifier || kind === SyntaxKind.PrivateIdentifier) out.push(identifierToken(node));
    else if (LITERAL.has(kind)) out.push(SyntaxKind.StringLiteral);
    else if (kind !== SyntaxKind.SyntaxList) out.push(kind);
    for (const c of node.getChildren()) walk(c);
  };
  walk(body);
  return out;
}

/** 이름을 남기는 자리: 부르는 함수 · 속성 · new 대상 · JSX 태그 · JSX 속성 · 객체 키 */
function keepsName(node: Node, parent: Node | undefined): boolean {
  if (!parent) return false;
  if (Node.isPropertyAccessExpression(parent)) return parent.getNameNode() === node;
  if (Node.isCallExpression(parent) || Node.isNewExpression(parent)) return parent.getExpression() === node;
  if (Node.isJsxOpeningElement(parent) || Node.isJsxSelfClosingElement(parent) || Node.isJsxClosingElement(parent)) {
    return parent.getTagNameNode() === node;
  }
  if (Node.isJsxAttribute(parent) || Node.isPropertyAssignment(parent) || Node.isShorthandPropertyAssignment(parent)) {
    return parent.getNameNode() === node;
  }
  return false;
}

/**
 * 지역 이름(변수 · 매개변수)은 하나로 뭉개고, 부르는 함수 · 속성 · 그리는 컴포넌트 이름은 남긴다.
 * 이름만 바꿔 복사한 함수는 같게 보고, 모양만 같고 다른 API · 컴포넌트를 쓰는 보일러플레이트는 다르게 본다.
 */
function identifierToken(node: Node): number {
  if (!keepsName(node, node.getParent())) return SyntaxKind.Identifier;
  // 구문 종류 번호와 겹치지 않게 큰 수로
  return 1_000_000 + (fnv(node.getText()) % 1_000_000_000);
}

const fnv = (text: string, seed = 2166136261) => {
  let h = seed;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

const hashNums = (nums: number[], from: number, len: number, seed = 2166136261) => {
  let h = seed;
  for (let i = from; i < from + len; i++) h = Math.imul(h ^ nums[i], 16777619);
  return h >>> 0;
};

/** 본문이 minTokens 보다 작으면 undefined (getter 한 줄 · 단순 위임은 중복으로 보지 않는다) */
export function fingerprint(id: string, body: Node, minTokens: number): FunctionPrint | undefined {
  const tokens = normalizedTokens(body);
  if (tokens.length < minTokens) return undefined;
  const shingles = new Set<number>();
  for (let i = 0; i + SHINGLE <= tokens.length; i++) shingles.add(hashNums(tokens, i, SHINGLE));
  // 길이 + 서로 다른 두 32bit 해시 — 같은 묶음으로 잘못 묶일 확률을 사실상 없앤다
  const full = `${hashNums(tokens, 0, tokens.length).toString(36)}${hashNums(tokens, 0, tokens.length, 0x9747b28c).toString(36)}`;
  return { id, tokens: tokens.length, hash: `${tokens.length}:${full}`, shingles, text: body.getText().slice(0, TEXT_LIMIT) };
}
