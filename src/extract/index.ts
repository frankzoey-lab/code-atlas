import { basename, resolve } from 'node:path';
import { ResolvedConfig } from '../config.js';
import { AtlasEdge, AtlasGraph, AtlasNode, EdgeKind, Feature } from '../graph.js';
import { collectInterfaces, RepoInterfaces } from '../interface/collect.js';
import { collectEdges } from './calls.js';
import { findTsconfig, loadProject, relPathOf } from './project.js';
import { collectSymbols, dirId, fileId, newSymbolIndex, resolvePending } from './symbols.js';

export interface ExtractOptions {
  repo: string;
  config: ResolvedConfig;
  /** 저장소 기준 하위 경로. 주면 이 안의 노드와, 이 안과 연결된 바깥 노드만 싣는다 */
  scope?: string;
  externals?: boolean;
  /** 주면 HTTP 호출 · 라우트 · socket 이벤트도 모은다. URL 맨 앞 식이 백엔드 주소인지 판정한다 */
  interfaceBase?: (text: string, rel: string) => boolean;
}

const EXTERNAL_FEATURE: Feature = { name: 'External packages', color: '#c9ced8' };

export function extract(options: ExtractOptions): AtlasGraph {
  return extractRepo(options).graph;
}

export function extractRepo({ repo, config, scope, externals, interfaceBase }: ExtractOptions): {
  graph: AtlasGraph;
  interfaces?: RepoInterfaces;
} {
  // 설정에 적지 않았으면 tsconfig.json → tsconfig.app.json … 순으로 찾는다
  const project = loadProject(repo, config.explicitTsconfig ? config.tsconfig : findTsconfig(repo) ?? config.tsconfig);
  const files = project
    .getSourceFiles()
    .map((sf) => ({ sf, rel: relPathOf(repo, sf) }))
    .filter(({ rel }) => !rel.startsWith('..') && !config.isExcluded(rel));

  const index = newSymbolIndex();
  const all = new Map<string, AtlasNode>();
  for (const { sf, rel } of files) index.files.set(sf.getFilePath(), rel);

  for (const { sf, rel } of files) {
    const feature = config.featureOf(rel);
    all.set(fileId(rel), {
      id: fileId(rel),
      kind: 'file',
      name: basename(rel),
      parent: parentDir(rel),
      path: rel,
      feature,
    });
    collectSymbols(sf, rel, feature, index);
  }
  // 다른 파일 심볼을 가리키는 별칭(default export, dynamic import)은 모든 심볼을 모은 뒤 푼다
  resolvePending(index);
  for (const node of index.nodes.values()) all.set(node.id, node);

  const counts = new Map<string, AtlasEdge>();
  const sink = {
    add(source: string, target: string, kind: EdgeKind) {
      const key = `${source}|${target}|${kind}`;
      const edge = counts.get(key);
      if (edge) edge.count += 1;
      else counts.set(key, { source, target, kind, count: 1 });
    },
  };
  const external = externals
    ? (pkg: string) => {
        const id = `x:${pkg}`;
        if (!all.has(id)) {
          all.set(id, { id, kind: 'external', name: pkg, path: pkg, feature: EXTERNAL_FEATURE.name });
        }
        return id;
      }
    : undefined;

  for (const { sf, rel } of files) collectEdges(sf, rel, { index, external }, sink);

  const interfaces = interfaceBase ? collectInterfaces(files, index, interfaceBase) : undefined;

  let edges = dropImportsCoveredByCalls([...counts.values()], all);

  // 디렉터리 노드
  for (const { rel } of files) {
    for (let dir = parentDirPath(rel); dir; dir = parentDirPath(dir)) {
      const id = dirId(dir);
      if (all.has(id)) break;
      all.set(id, { id, kind: 'dir', name: basename(dir), parent: parentDir(dir), path: dir, feature: '' });
    }
  }
  assignDirFeatures(all);

  let nodes = [...all.values()];
  if (scope) {
    const inScope = (n: AtlasNode | undefined) =>
      !!n && n.kind !== 'external' && (n.path === scope || n.path.startsWith(`${scope}/`));
    edges = edges.filter((e) => inScope(all.get(e.source)) || inScope(all.get(e.target)));
    const keep = new Set(nodes.filter(inScope).map((n) => n.id));
    // scope 를 품은 상위 디렉터리는 경계가 아니다. 경계 표시보다 먼저 넣는다
    for (let dir: string | undefined = scope; dir; dir = parentDirPath(dir)) {
      if (all.has(dirId(dir))) keep.add(dirId(dir));
    }
    for (const e of edges) {
      for (const id of [e.source, e.target]) {
        if (keep.has(id)) continue;
        // 바깥 끝점은 경계 노드로, 조상까지 함께 싣는다
        for (let cur = all.get(id); cur && !keep.has(cur.id); cur = cur.parent ? all.get(cur.parent) : undefined) {
          keep.add(cur.id);
          cur.boundary = true;
        }
      }
    }
    nodes = nodes.filter((n) => keep.has(n.id));
  }

  const features = [...config.features];
  if (externals) features.push(EXTERNAL_FEATURE);

  const graph: AtlasGraph = {
    meta: {
      repo: basename(resolve(repo)),
      scope,
      roots: { '': resolve(repo) },
      generatedAt: new Date().toISOString(),
      files: nodes.filter((n) => n.kind === 'file' && !n.boundary).length,
      symbols: nodes.filter((n) => n.kind !== 'file' && n.kind !== 'dir' && n.kind !== 'external').length,
      edges: edges.length,
    },
    features,
    nodes,
    edges,
  };
  return { graph, interfaces };
}

/** 같은 파일 안 어딘가에서 이미 호출 · 렌더하는 대상이면 import 간선은 중복이라 뺀다 */
function dropImportsCoveredByCalls(edges: AtlasEdge[], nodes: Map<string, AtlasNode>): AtlasEdge[] {
  const used = new Set(
    edges
      .filter((e) => e.kind !== 'import')
      .map((e) => `${nodes.get(e.source)?.path}|${e.target}`),
  );
  return edges.filter((e) => e.kind !== 'import' || !used.has(`${nodes.get(e.source)?.path}|${e.target}`));
}

/** 디렉터리 색은 아래 파일 기능 중 가장 많은 것 */
export function assignDirFeatures(all: Map<string, AtlasNode>) {
  const tally = new Map<string, Map<string, number>>();
  for (const n of all.values()) {
    if (n.kind !== 'file') continue;
    for (let dir = n.parent; dir; dir = all.get(dir)?.parent) {
      const t = tally.get(dir) ?? new Map<string, number>();
      t.set(n.feature, (t.get(n.feature) ?? 0) + 1);
      tally.set(dir, t);
    }
  }
  for (const [id, t] of tally) {
    const node = all.get(id);
    if (node) node.feature = [...t.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
}

function parentDirPath(rel: string): string | undefined {
  const i = rel.lastIndexOf('/');
  return i > 0 ? rel.slice(0, i) : undefined;
}

function parentDir(rel: string): string | undefined {
  const dir = parentDirPath(rel);
  return dir ? dirId(dir) : undefined;
}
