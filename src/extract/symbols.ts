import { CallExpression, Node, SourceFile, SyntaxKind, ts } from 'ts-morph';
import { AtlasNode, NodeKind } from '../graph.js';
import { t } from '../i18n.js';

export interface SymbolIndex {
  nodes: Map<string, AtlasNode>;
  /** 선언(compiler node) → 그 선언을 대표하는 심볼 id. 호출 대상 해석과 호출자 찾기에 함께 쓴다 */
  ownerOf: Map<ts.Node, string>;
  /**
   * 호출 대상으로만 쓰는 별칭. `export default memo(X)` → X, `dynamic(() => import('./Foo'))` → Foo.
   * 호출자 찾기(ownerAt)에는 쓰지 않는다
   */
  aliasOf: Map<ts.Node, string>;
  /** 모든 심볼을 모은 뒤에 풀어야 하는 별칭(다른 파일을 가리킬 수 있는 것). 값이 바뀌면 true */
  pending: Array<() => boolean>;
  /** 대상 파일 절대 경로 → 저장소 상대 경로 */
  files: Map<string, string>;
  /** 함수 · 메서드 심볼 id → 본문을 가진 노드 (분석: 중복 함수 지문) */
  bodies: Map<string, Node>;
}

export const fileId = (rel: string) => `f:${rel}`;
export const dirId = (rel: string) => `d:${rel}`;

export function newSymbolIndex(): SymbolIndex {
  return { nodes: new Map(), ownerOf: new Map(), aliasOf: new Map(), pending: [], files: new Map(), bodies: new Map() };
}

/** 파일 최상위 함수 · 화살표 함수 · 컴포넌트 · 훅 · 클래스 · 메서드 · default export 를 모은다 */
export function collectSymbols(
  file: SourceFile,
  rel: string,
  feature: string,
  index: SymbolIndex,
): void {
  const isJsxFile = rel.endsWith('.tsx') || rel.endsWith('.jsx');

  const add = (
    decl: Node,
    name: string,
    kind: NodeKind,
    exported: boolean,
    parent = fileId(rel),
    docNode: Node = decl,
  ) => {
    const base = parent.startsWith('f:') ? `s:${rel}#${name}` : `${parent}.${name}`;
    const id = index.nodes.has(base) ? `${base}~${decl.getStartLineNumber()}` : base;
    index.nodes.set(id, {
      id,
      kind,
      name,
      parent,
      path: rel,
      line: decl.getStartLineNumber(),
      exported,
      feature,
      doc: docOf(docNode),
    });
    index.ownerOf.set(decl.compilerNode, id);
    return id;
  };

  for (const fn of file.getFunctions()) {
    const name = fn.getName() ?? 'default';
    index.bodies.set(add(fn, name, classify(name, fn, isJsxFile), fn.isExported()), fn);
  }

  for (const statement of file.getVariableStatements()) {
    for (const decl of statement.getDeclarations()) {
      const init = decl.getInitializer();
      const dynamicImport = dynamicImportOf(init);
      if (dynamicImport) {
        index.pending.push(() => aliasToModule(decl, dynamicImport, index));
        continue;
      }
      const body = functionLikeOf(init);
      if (!body) {
        // const Fancy = memo(Inner) · styled(Button) → Inner · Button 의 별칭
        const unwrapped = unwrap(init);
        const target = unwrapped && isWrapperCall(unwrapped) ? innerIdentifier(unwrapped) : undefined;
        if (target) index.pending.push(() => aliasTo(decl, target, index));
        continue;
      }
      const name = decl.getName();
      index.bodies.set(add(decl, name, classify(name, body, isJsxFile), statement.isExported(), undefined, statement), body);
    }
  }

  for (const cls of file.getClasses()) {
    const name = cls.getName() ?? 'default';
    const classId = add(cls, name, 'class', cls.isExported());
    for (const method of cls.getMethods()) {
      index.bodies.set(add(method, method.getName(), 'method', cls.isExported(), classId), method);
    }
    for (const prop of cls.getProperties()) {
      const body = functionLikeOf(prop.getInitializer());
      if (body) index.bodies.set(add(prop, prop.getName(), 'method', cls.isExported(), classId), body);
    }
  }

  // export default memo(X) · export default X · export default () => …
  for (const assignment of file.getExportAssignments()) {
    if (assignment.isExportEquals()) continue;
    const expr = assignment.getExpression();
    const body = functionLikeOf(expr);
    if (body) {
      // export default memo(function Button() {}) 처럼 이름이 있으면 그 이름, 없으면 파일 이름
      const name = (Node.isFunctionExpression(body) && body.getName()) || defaultName(rel);
      index.bodies.set(add(assignment, name, classify(name, body, isJsxFile), true), body);
      continue;
    }
    const target = innerIdentifier(expr);
    if (target) index.pending.push(() => aliasTo(assignment, target, index));
  }
}

/** 이름 없는 default export 의 표시 이름: 파일 이름 (index 면 폴더 이름) */
function defaultName(rel: string): string {
  const parts = rel.replace(/\.[jt]sx?$/, '').split('/');
  const base = parts[parts.length - 1];
  return base === 'index' && parts.length > 1 ? parts[parts.length - 2] : base;
}

/**
 * 감싸는 호출로 인정하는 callee: `memo` · `forwardRef` · `create` 처럼 식별자이거나
 * `React.memo` 처럼 대문자로 시작하는 네임스페이스의 멤버. `[1, 2].map(fn)` 같은 메서드 호출은 제외한다
 */
/** 별칭으로 볼 감싸기: 결과가 감싼 컴포넌트 · 함수와 같은 것으로 쓰이는 HOC 들 */
const ALIAS_WRAPPER = /^(React\.)?(memo|forwardRef|lazy)$|^styled$|^observer$|^connect$|^compose$|^with[A-Z]\w*$/;

function calleeName(call: CallExpression): string {
  const callee = call.getExpression();
  // connect(mapState)(Comp) · withStyles(s)(Comp) 는 바깥 호출의 callee 가 또 호출이다
  if (Node.isCallExpression(callee)) return calleeName(callee);
  return callee.getText();
}

function isWrapperCall(node: Node): node is CallExpression {
  if (!Node.isCallExpression(node)) return false;
  const callee = node.getExpression();
  if (Node.isIdentifier(callee)) return true;
  if (Node.isCallExpression(callee)) return ALIAS_WRAPPER.test(calleeName(callee));
  // React.memo 는 되고, Object.entries(x).map 처럼 호출 결과의 메서드는 안 된다
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const owner = callee.getExpression();
  return Node.isIdentifier(owner) && /^[A-Z]/.test(owner.getText());
}

function unwrap(node: Node | undefined): Node | undefined {
  let cur = node;
  while (cur && (Node.isParenthesizedExpression(cur) || Node.isAsExpression(cur) || Node.isSatisfiesExpression(cur))) {
    cur = cur.getExpression();
  }
  return cur;
}

/** `() => {}`, `function () {}`, `memo(forwardRef(() => …))` 처럼 겹쳐 감싼 것까지 함수 본문을 찾는다 */
function functionLikeOf(init: Node | undefined): Node | undefined {
  const node = unwrap(init);
  if (!node) return undefined;
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    return dynamicImportBody(node) ? undefined : node;
  }
  // 감싼 대상은 첫 인자다. memo(X, areEqual) 의 비교 함수 같은 뒤 인자는 보지 않는다
  if (isWrapperCall(node)) return functionLikeOf(node.getArguments()[0]);
  return undefined;
}

/**
 * `memo(X)` · `connect(m)(X)` · `X` 의 안쪽 식별자 (첫 인자만 따라간다).
 * createSelector(a, fn) · debounce(save) · configureStore(reducer) 같은 일반 호출은 별칭이 아니다
 */
function innerIdentifier(expr: Node | undefined): Node | undefined {
  const node = unwrap(expr);
  if (!node) return undefined;
  if (Node.isIdentifier(node)) return node;
  if (isWrapperCall(node) && ALIAS_WRAPPER.test(calleeName(node))) return innerIdentifier(node.getArguments()[0]);
  return undefined;
}

/** 선언을 식별자가 가리키는 심볼의 별칭으로 둔다. 바뀌면 true */
function aliasTo(decl: Node, target: Node, index: SymbolIndex): boolean {
  const symbol = target.getSymbol();
  const id = symbol && ownerOfSymbol(symbol, index);
  return setAlias(decl, id, index);
}

function setAlias(decl: Node, id: string | undefined, index: SymbolIndex): boolean {
  if (!id || index.aliasOf.get(decl.compilerNode) === id) return false;
  index.aliasOf.set(decl.compilerNode, id);
  return true;
}

interface DynamicImport {
  call: CallExpression;
  /** `.then((m) => m.Foo)` 로 고른 이름. 없으면 default */
  exportName: string;
}

/** `() => import('./Foo')` · `() => import('./Foo').then((m) => m.Foo)` */
function dynamicImportBody(fn: Node): DynamicImport | undefined {
  const body = Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) ? fn.getBody() : undefined;
  let expr: Node | undefined = body;
  if (body && Node.isBlock(body)) {
    const ret = body.getStatements().find(Node.isReturnStatement);
    expr = ret?.getExpression();
  }
  expr = unwrap(expr);
  let exportName = 'default';
  if (expr && Node.isCallExpression(expr)) {
    const callee = expr.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'then') {
      const picked = expr.getArguments()[0];
      if (picked && (Node.isArrowFunction(picked) || Node.isFunctionExpression(picked))) {
        exportName = pickedExport(picked) ?? exportName;
      }
      expr = callee.getExpression();
    }
  }
  return expr && Node.isCallExpression(expr) && expr.getExpression().getKind() === SyntaxKind.ImportKeyword
    ? { call: expr, exportName }
    : undefined;
}

/**
 * `.then` 콜백이 고른 export 이름.
 * `(m) => m.Named` · `(m) => ({ default: m.Named })`(React.lazy 형태) · `({ Named }) => Named`
 */
function pickedExport(fn: Node): string | undefined {
  let result = unwrap(returnedExpression(fn));
  if (result && Node.isObjectLiteralExpression(result)) {
    const def = result.getProperty('default');
    result = def && Node.isPropertyAssignment(def) ? unwrap(def.getInitializer()) : def && Node.isShorthandPropertyAssignment(def) ? def.getNameNode() : undefined;
  }
  if (!result) return undefined;
  if (Node.isPropertyAccessExpression(result)) return result.getName();
  if (Node.isIdentifier(result)) {
    // ({ Named }) => Named · ({ Named: X }) => X
    const decl = result.getSymbol()?.getDeclarations()[0];
    if (decl && Node.isBindingElement(decl)) return decl.getPropertyNameNode()?.getText() ?? decl.getName();
  }
  return undefined;
}

function returnedExpression(fn: Node): Node | undefined {
  const body = Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) ? fn.getBody() : undefined;
  if (body && Node.isBlock(body)) return body.getStatements().find(Node.isReturnStatement)?.getExpression();
  return body;
}

/** `dynamic(() => import('./Foo'))` · `lazy(() => import('./Foo'))` */
function dynamicImportOf(init: Node | undefined): DynamicImport | undefined {
  const node = unwrap(init);
  if (!node || !isWrapperCall(node)) return undefined;
  const arg = node.getArguments()[0];
  return arg && (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg)) ? dynamicImportBody(arg) : undefined;
}

/** dynamic import 변수를 그 모듈의 export(없으면 파일)로 잇는다 */
function aliasToModule(decl: Node, { call, exportName }: DynamicImport, index: SymbolIndex): boolean {
  const module = call.getArguments()[0]?.getSymbol();
  const file = module?.getDeclarations().find(Node.isSourceFile);
  if (!module || !file) return false;
  const exported = module.getExport(exportName);
  const rel = index.files.get(file.getFilePath());
  return setAlias(decl, (exported && ownerOfSymbol(exported, index)) ?? (rel ? fileId(rel) : undefined), index);
}

export function ownerOfSymbol(symbol: import('ts-morph').Symbol, index: SymbolIndex): string | undefined {
  const resolved = symbol.isAlias() ? symbol.getAliasedSymbol() ?? symbol : symbol;
  for (const decl of resolved.getDeclarations()) {
    const id = index.ownerOf.get(decl.compilerNode) ?? index.aliasOf.get(decl.compilerNode);
    if (id) return id;
  }
  return undefined;
}

function classify(name: string, body: Node, isJsxFile: boolean): NodeKind {
  if (/^use[A-Z0-9]/.test(name)) return 'hook';
  if (isJsxFile && /^[A-Z]/.test(name) && containsJsx(body)) return 'component';
  return 'function';
}

function containsJsx(node: Node): boolean {
  return !!node.getFirstDescendant(
    (n) => Node.isJsxElement(n) || Node.isJsxSelfClosingElement(n) || Node.isJsxFragment(n),
  );
}

/**
 * 별칭은 다른 파일의 별칭을 가리킬 수 있다(dynamic → memo default export). 파일 순서와 상관없이
 * 끝까지 풀리도록 더 바뀌지 않을 때까지 반복한다.
 */
export function resolvePending(index: SymbolIndex, maxPasses = 5): void {
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const resolve of index.pending) changed = resolve() || changed;
    if (!changed) return;
  }
  console.error(t('cli.warning', { text: t('warn.aliasNotConverged', { passes: maxPasses }) }));
}

const DOC_MAX = 400;

const DIRECTIVE = /^\/\/\s*(eslint|@ts-|prettier-ignore|istanbul|tslint|#region|#endregion|biome-ignore)|^\/\/\//;
/** 주석이 이런 말로 시작할 때만 라이선스로 본다 (본문에 copyright 가 나오는 정상 설명은 남긴다) */
const LICENSE = /^\s*(\/\*+!?|\/\/)\s*(\*\s*)?(@license|copyright|\(c\)|©|SPDX-License-Identifier)/i;

/**
 * 선언 바로 위의 설명 주석. JSDoc 블록이 있으면 마지막 것을, 없으면 선언에 붙어 있는 연속된 `//` 줄만 쓴다.
 * 빈 줄로 떨어진 주석(파일 머리 · 구역 구분), 라이선스, eslint · ts 지시 주석은 뺀다.
 */
function docOf(node: Node): string | undefined {
  const source = node.getSourceFile().getFullText();
  const ranges = node.getLeadingCommentRanges();
  const attached: typeof ranges = [];
  // 선언에서 위로 올라가며 빈 줄 없이 붙어 있는 주석만 모은다
  let end = node.getStart();
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    if ((source.slice(r.getEnd(), end).match(/\n/g) ?? []).length > 1) break;
    attached.unshift(r);
    end = r.getPos();
  }
  const usable = attached.filter((r) => !DIRECTIVE.test(r.getText()) && !LICENSE.test(r.getText()) && !r.getText().startsWith('/*!'));
  const jsdoc = usable.filter((r) => r.getText().startsWith('/**')).at(-1);
  // JSDoc 이 없으면 선언에 가장 가까운, 끊기지 않은 // 줄 묶음만
  const lineRun: typeof usable = [];
  for (let i = usable.length - 1; i >= 0 && usable[i].getText().startsWith('//'); i--) lineRun.unshift(usable[i]);
  const picked = jsdoc ? [jsdoc] : lineRun;
  if (!picked.length) return undefined;
  const text = picked
    .map((r) => r.getText())
    .join('\n')
    .split('\n')
    .map((line) => line.replace(/^\s*(\/\*\*?|\*\/|\*|\/\/)\s?/, '').replace(/\*\/\s*$/, '').trimEnd())
    .filter((line, i, all) => line || (i > 0 && all[i - 1]))
    .join('\n')
    .trim();
  if (!text) return undefined;
  return text.length > DOC_MAX ? `${text.slice(0, DOC_MAX)}…` : text;
}
