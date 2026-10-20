import { Node, SourceFile, Symbol as TsSymbol, SyntaxKind, ts } from 'ts-morph';
import { EdgeKind } from '../graph.js';
import { packageOf } from './project.js';
import { fileId, ownerOfSymbol, SymbolIndex } from './symbols.js';

export interface EdgeSink {
  add(source: string, target: string, kind: EdgeKind): void;
}

export interface CallContext {
  index: SymbolIndex;
  /** --externals 일 때만 주어진다. 패키지 이름 → 외부 노드 id */
  external?: (pkg: string) => string;
}

/** 파일 하나의 call · render · import 간선을 모은다 */
export function collectEdges(file: SourceFile, rel: string, ctx: CallContext, sink: EdgeSink): void {
  const self = fileId(rel);

  file.forEachDescendant((node, traversal) => {
    switch (node.getKind()) {
      case SyntaxKind.ImportDeclaration: {
        collectImport(node.asKindOrThrow(SyntaxKind.ImportDeclaration), rel, ctx, sink);
        traversal.skip();
        return;
      }
      case SyntaxKind.CallExpression:
      case SyntaxKind.NewExpression: {
        const expr = (node as Node & { getExpression(): Node }).getExpression();
        link(node, expr, 'call');
        return;
      }
      case SyntaxKind.JsxOpeningElement:
      case SyntaxKind.JsxSelfClosingElement: {
        const tag = (node as Node & { getTagNameNode(): Node }).getTagNameNode();
        // <div> 같은 기본 태그는 건너뛴다
        if (!/^[a-z]/.test(tag.getText())) link(node, tag, 'render');
        return;
      }
    }
  });

  function link(site: Node, callee: Node, kind: EdgeKind) {
    const target = resolveTarget(callee, rel, ctx);
    if (!target) return;
    const source = ownerAt(site.compilerNode, ctx.index) ?? self;
    if (source !== target) sink.add(source, target, kind);
  }
}

function collectImport(
  decl: import('ts-morph').ImportDeclaration,
  rel: string,
  ctx: CallContext,
  sink: EdgeSink,
) {
  const self = fileId(rel);
  if (decl.isTypeOnly()) return;
  const names: Node[] = decl
    .getNamedImports()
    .filter((n) => !n.isTypeOnly())
    .map((n) => n.getAliasNode() ?? n.getNameNode());
  const def = decl.getDefaultImport();
  if (def) names.push(def);
  for (const name of names) {
    const target = resolveTarget(name, rel, ctx, false);
    if (target) sink.add(self, target, 'import');
  }
}

/** 호출 지점에서 가장 가까운 등록된 선언(함수 · 메서드 · 클래스)을 찾는다 */
export function ownerAt(node: ts.Node, index: SymbolIndex): string | undefined {
  for (let cur = node.parent; cur; cur = cur.parent) {
    const id = index.ownerOf.get(cur);
    if (id) return id;
  }
  return undefined;
}

/**
 * 이름 노드를 원래 선언(import · barrel re-export 를 따라감)의 심볼 id 로 바꾼다.
 * 심볼로 등록되지 않은 선언(객체 리터럴 메서드, 주입 토큰의 인터페이스 메서드 등)이
 * 다른 파일에 있으면 그 파일 노드로 잇는다.
 */
function resolveTarget(node: Node, rel: string, ctx: CallContext, allowExternal = true): string | undefined {
  let symbol: TsSymbol | undefined = node.getSymbol();
  if (!symbol) return undefined;
  if (symbol.isAlias()) symbol = symbol.getAliasedSymbol() ?? symbol;
  const id = ownerOfSymbol(symbol, ctx.index);
  if (id) return id;
  const decl = symbol.getDeclarations()[0];
  if (!decl) return undefined;
  const path = decl.getSourceFile().getFilePath();
  const declRel = ctx.index.files.get(path);
  if (declRel) {
    if (declRel === rel) return undefined;
    // 타입만 있는 것(interface · type)은 실행 의존이 아니다. types.ts 가 허브가 되지 않게 뺀다
    if (!(symbol.getFlags() & ts.SymbolFlags.Value)) return undefined;
    // 인터페이스 · 타입의 시그니처는 실제 구현이 아니다. this.repo.save() 처럼 주입받은 필드를 통한 호출만
    // 선언 파일로 잇고, props.onSelect() 같은 매개변수 · 지역 값을 통한 호출은 넘겨준 쪽이 대상이라 잇지 않는다
    if ((Node.isPropertySignature(decl) || Node.isMethodSignature(decl)) && !viaThisField(node)) return undefined;
    return fileId(declRel);
  }
  if (allowExternal && ctx.external && !path.includes('/node_modules/typescript/lib/')) {
    const pkg = packageOf(path);
    if (pkg) return ctx.external(pkg.replace(/^@types\//, ''));
  }
  return undefined;
}

/** `this.repo.save` 처럼 클래스 필드를 거친 접근인지 */
function viaThisField(node: Node): boolean {
  return Node.isPropertyAccessExpression(node) && /^this\.[\w$]+$/.test(node.getExpression().getText());
}
