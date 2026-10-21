import { ExportSpecifier, ImportSpecifier, Node, SourceFile } from 'ts-morph';
import { Analysis, AtlasEdge, AtlasNode, Cycle } from '../graph.js';
import { fileId, SymbolIndex } from '../extract/symbols.js';
import { findCycles } from './cycles.js';
import { findDuplicates } from './duplicates.js';
import { fingerprint, FunctionPrint } from './fingerprint.js';

export type { FunctionPrint } from './fingerprint.js';

export interface AnalysisSettings {
  minTokens: number;
  minSimilarity: number;
}

/** 중복 찾기 기준 (지문은 이미 repo 별 minTokens 로 걸렀다) */
export interface FinishSettings {
  minSimilarity: number;
}

/** repo 하나에서 모은 것. 중복은 workspace 전체를 합쳐 비교하므로 지문을 따로 돌려준다 */
export interface RepoAnalysis {
  prints: FunctionPrint[];
  callCycles: Cycle[];
  importCycles: Cycle[];
  /** --scope 일 때 범위 안 노드. 중복 묶음도 순환처럼 이 안에 걸친 것만 남긴다 */
  scope?: Set<string>;
}

const CALLABLE = new Set(['function', 'component', 'hook', 'method']);

/** `type` 표시가 있거나, 가리키는 선언이 모두 interface · type alias 인 이름 (실행할 때 사라진다) */
function isTypeName(spec: ImportSpecifier | ExportSpecifier): boolean {
  if (spec.isTypeOnly()) return true;
  const symbol = spec.getNameNode().getSymbol();
  const decls = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? [];
  return decls.length > 0 && decls.every((d) => Node.isInterfaceDeclaration(d) || Node.isTypeAliasDeclaration(d));
}

/** 실행할 때 남는 파일 → 파일 import · re-export (프로젝트 안 파일끼리). 타입만 가져오는 것은 뺀다 */
function importEdges(files: { sf: SourceFile; rel: string }[], index: SymbolIndex): [string, string][] {
  const out: [string, string][] = [];
  for (const { sf, rel } of files) {
    for (const decl of sf.getImportDeclarations()) {
      if (decl.isTypeOnly()) continue;
      const named = decl.getNamedImports();
      const onlyTypes = !decl.getDefaultImport() && !decl.getNamespaceImport() && named.length > 0 && named.every(isTypeName);
      if (onlyTypes) continue;
      const target = index.files.get(decl.getModuleSpecifierSourceFile()?.getFilePath() ?? '');
      if (target) out.push([fileId(rel), fileId(target)]);
    }
    for (const decl of sf.getExportDeclarations()) {
      if (!decl.hasModuleSpecifier() || decl.isTypeOnly()) continue;
      const named = decl.getNamedExports();
      if (named.length > 0 && named.every(isTypeName)) continue;
      const target = index.files.get(decl.getModuleSpecifierSourceFile()?.getFilePath() ?? '');
      if (target) out.push([fileId(rel), fileId(target)]);
    }
  }
  return out;
}

/** extractRepo 안에서 (ts-morph 프로젝트가 살아 있을 때) 부른다 */
export function analyzeRepo(
  files: { sf: SourceFile; rel: string }[],
  index: SymbolIndex,
  nodes: Map<string, AtlasNode>,
  edges: AtlasEdge[],
  settings: AnalysisSettings,
): RepoAnalysis {
  const prints: FunctionPrint[] = [];
  for (const [id, body] of index.bodies) {
    if (!CALLABLE.has(nodes.get(id)?.kind ?? '')) continue;
    const p = fingerprint(id, body, settings.minTokens);
    if (p) prints.push(p);
  }
  const callable = (id: string) => CALLABLE.has(nodes.get(id)?.kind ?? '');
  const calls = edges
    .filter((e) => (e.kind === 'call' || e.kind === 'render') && callable(e.source) && callable(e.target))
    .map((e): [string, string] => [e.source, e.target]);
  return { prints, callCycles: findCycles(calls), importCycles: findCycles(importEdges(files, index)) };
}

/** 지문을 모두 합쳐 중복 쌍을 찾고 순환과 묶는다. skip: 비교하지 않을 쌍 */
export function finishAnalysis(
  repos: RepoAnalysis[],
  edges: AtlasEdge[],
  nodes: Map<string, AtlasNode>,
  settings: FinishSettings,
): Analysis {
  // 한쪽이 다른 쪽을 부르거나(감싼 위임), 한쪽이 다른 쪽 안에 정의된 쌍은 중복이 아니다
  const linked = new Set(edges.filter((e) => e.kind === 'call' || e.kind === 'render').map((e) => `${e.source}\n${e.target}`));
  const inside = (a: string, b: string) => {
    for (let cur = nodes.get(b)?.parent; cur; cur = nodes.get(cur)?.parent) if (cur === a) return true;
    return false;
  };
  const skip = (a: string, b: string) => linked.has(`${a}\n${b}`) || linked.has(`${b}\n${a}`) || inside(a, b) || inside(b, a);
  const scope = repos.length === 1 ? repos[0].scope : undefined;
  const duplicates = findDuplicates(repos.flatMap((r) => r.prints), { minSimilarity: settings.minSimilarity, skip });
  return {
    duplicates: scope ? duplicates.filter((d) => d.members.some((m) => scope.has(m))) : duplicates,
    callCycles: repos.flatMap((r) => r.callCycles),
    importCycles: repos.flatMap((r) => r.importCycles),
  };
}

/** workspace 병합 때 id 에 repo 접두를 붙인다 */
export function prefixAnalysis(a: RepoAnalysis, p: (id: string) => string): RepoAnalysis {
  const cyc = (c: Cycle): Cycle => ({ members: c.members.map(p), path: c.path.map(p) });
  return {
    prints: a.prints.map((x) => ({ ...x, id: p(x.id) })),
    callCycles: a.callCycles.map(cyc),
    importCycles: a.importCycles.map(cyc),
  };
}
