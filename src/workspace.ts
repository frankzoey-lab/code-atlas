import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import picomatch from 'picomatch';
import { loadConfig, ResolvedConfig } from './config.js';
import { finishAnalysis, FunctionPrint, prefixAnalysis, RepoAnalysis } from './analyze/index.js';
import { extractRepo } from './extract/index.js';
import { AtlasEdge, AtlasGraph, AtlasNode, Feature, OTHER_FEATURE } from './graph.js';
import { HttpCall, RepoInterfaces, Route } from './interface/collect.js';
import { PREFIX_MARK } from './interface/url.js';
import { Msg, t } from './i18n.js';
import { repoCacheDir } from './fetch-repo.js';

export interface WorkspaceRepo {
  name: string;
  /** 로컬 경로 (workspace 파일 기준). source 만 있으면 캐시 폴더 경로로 채운다 */
  path: string;
  /** git 에서 받는 repo. 실행할 때마다 최신으로 갱신한다 */
  source?: { git: string; branch?: string };
  config?: string;
}

export interface WorkspaceConfig {
  repos: WorkspaceRepo[];
  /** from repo 의 HTTP 호출 중 URL 맨 앞이 base 인 것을 to repo 의 라우트와 잇는다. to 가 없으면 바깥 서비스(label) */
  http?: { from: string; base: string[]; files?: string[]; to?: string; label?: string }[];
  socket?: { client: string; server: string }[];
}

const INTERFACE_FEATURE: Feature = { name: 'Interfaces', color: '#e8590c' };
const ROOT = 'i:root';

export function loadWorkspace(file: string): WorkspaceConfig {
  const dir = dirname(resolve(file));
  const raw: WorkspaceConfig = JSON.parse(readFileSync(file, 'utf8'));
  return {
    ...raw,
    repos: raw.repos.map((r) => ({
      ...r,
      path: r.path ? resolve(dir, r.path) : r.source ? repoCacheDir(r.source.git, r.source.branch) : resolve(dir, r.name),
      config: r.config && resolve(dir, r.config),
    })),
  };
}

export function validateWorkspace(ws: WorkspaceConfig): void {
  const names = new Set<string>();
  for (const r of ws.repos) {
    if (names.has(r.name)) throw new Error(t('ws.dupRepo', { name: r.name }));
    if (!/^[\w-]+$/.test(r.name)) throw new Error(t('ws.badRepoName', { name: r.name }));
    names.add(r.name);
  }
  for (const link of ws.http ?? []) {
    for (const n of [link.from, link.to]) if (n && !names.has(n)) throw new Error(t('ws.unknownHttpRepo', { name: n }));
  }
  for (const link of ws.socket ?? []) {
    for (const n of [link.client, link.server]) if (!names.has(n)) throw new Error(t('ws.unknownSocketRepo', { name: n }));
  }
}

export interface WorkspaceResult {
  graph: AtlasGraph;
  /** 정적으로 풀지 못해 건너뛴 것 */
  warnings: string[];
  /** 접두를 붙인 함수 지문 (Jev 중복 확인용) */
  prints: FunctionPrint[];
}

export function buildWorkspace(ws: WorkspaceConfig): AtlasGraph {
  return buildWorkspaceWithWarnings(ws).graph;
}

/** repo 별 추출 결과. 병합 전에 손댈 수 있다 (Jev 분류 등) */
export interface ExtractedRepo {
  name: string;
  path: string;
  config: ResolvedConfig;
  graph: AtlasGraph;
  interfaces?: RepoInterfaces;
  analysis?: RepoAnalysis;
}

export function buildWorkspaceWithWarnings(ws: WorkspaceConfig): WorkspaceResult {
  return assembleWorkspace(ws, extractWorkspace(ws));
}

/** 각 repo 를 추출한다 (인터페이스 포함). 아직 id 접두 · 병합 전이다 */
/** configs: 이미 읽은 repo 별 설정 (이름 → 설정). 없으면 여기서 읽는다 */
export function extractWorkspace(ws: WorkspaceConfig, configs?: Map<string, ResolvedConfig>, analysis = true): ExtractedRepo[] {
  validateWorkspace(ws);
  return ws.repos.map((repo) => {
    const links = (ws.http ?? []).filter((l) => l.from === repo.name);
    const fileMatchers = links.map((l) => (l.files ? picomatch(l.files) : () => true));
    const isBase = (text: string, rel: string) =>
      links.some((l, i) => fileMatchers[i](rel) && l.base.includes(text));
    const config = configs?.get(repo.name) ?? loadConfig(repo.config);
    const { graph, interfaces, analysis: found } = extractRepo({ repo: repo.path, config, interfaceBase: isBase, analysis });
    return { name: repo.name, path: repo.path, config, graph, interfaces, analysis: found };
  });
}

/** repo 들을 하나의 그래프로 합치고 HTTP · socket 인터페이스를 잇는다 */
export function assembleWorkspace(ws: WorkspaceConfig, repos: ExtractedRepo[]): WorkspaceResult {
  const warnings: string[] = [];

  const nodes: AtlasNode[] = [];
  const edges: AtlasEdge[] = [];
  const features: Feature[] = [];
  const groups: NonNullable<AtlasGraph['groups']> = [];
  const ifaces = new Map<string, RepoInterfaces>();
  const analyses: RepoAnalysis[] = [];

  for (const repo of repos) {
    const { graph, interfaces } = repo;
    if (interfaces) {
      ifaces.set(repo.name, interfaces);
      warnings.push(...interfaces.warnings.map((w) => `${repo.name}: ${w}`));
    }

    const p = (id: string) => `${repo.name}:${id}`;
    if (repo.analysis) analyses.push(prefixAnalysis(repo.analysis, p));
    const featureName = (f: string) => `${repo.name} · ${f}`;
    const repoId = `r:${repo.name}`;
    const tally = new Map<string, number>();
    for (const n of graph.nodes) {
      if (n.kind === 'file') tally.set(n.feature, (tally.get(n.feature) ?? 0) + 1);
      nodes.push({ ...n, id: p(n.id), parent: n.parent ? p(n.parent) : repoId, feature: featureName(n.feature) });
    }
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? OTHER_FEATURE.name;
    nodes.push({ id: repoId, kind: 'repo', name: repo.name, path: '', feature: featureName(top) });
    for (const e of graph.edges) edges.push({ ...e, source: p(e.source), target: p(e.target) });
    for (const f of graph.features) features.push({ ...f, name: featureName(f.name), repo: repo.name });
    for (const g of graph.groups ?? []) groups.push({ ...g, repo: repo.name });
  }

  const ifaceNodes = new Map<string, AtlasNode>();
  const ifaceEdges = new Map<string, AtlasEdge>();
  const addNode = (n: AtlasNode) => {
    if (!ifaceNodes.has(n.id)) ifaceNodes.set(n.id, n);
    return ifaceNodes.get(n.id)!;
  };
  const addEdge = (source: string, target: string, kind: AtlasEdge['kind']) => {
    const key = `${source}|${target}|${kind}`;
    const e = ifaceEdges.get(key);
    if (e) e.count += 1;
    else ifaceEdges.set(key, { source, target, kind, count: 1 });
  };
  const ifaceNode = (id: string, kind: AtlasNode['kind'], name: string, parent?: string) =>
    addNode({ id, kind, name, parent, path: name, feature: INTERFACE_FEATURE.name });

  // ---------- HTTP ----------
  for (const link of ws.http ?? []) {
    const target = link.to ?? link.label ?? 'external';
    const group = ifaceNode(`i:http:${link.from}->${target}`, 'interface', `HTTP ${link.from} → ${target}`, ROOT).id;
    // files 를 주면 env 이름 base 도 그 파일들에서 나온 호출만 이 링크로 본다
    const inFiles = link.files ? picomatch(link.files) : () => true;
    const calls = (ifaces.get(link.from)?.calls ?? []).filter((c) => link.base.includes(c.base) && inFiles(c.rel));
    const routes = link.to ? ifaces.get(link.to)?.routes ?? [] : [];
    for (const call of calls) {
      const match = link.to ? matchRoute(call, routes) : undefined;
      const route = match?.route;
      const key = route ? `${route.method} ${route.path}` : `${call.method} ${call.path}`;
      const endpoint = ifaceNode(`${group}:${key}`, 'endpoint', key, group);
      endpoint.refs = [...(endpoint.refs ?? []), `${link.from}:${call.rel}:${call.line}`];
      if (link.to && !route) {
        endpoint.unmatched = true;
        endpoint.notes = [match?.reason ?? { code: 'note.noRoute', params: { repo: link.to } }];
      }
      addEdge(`${link.from}:${call.owner}`, endpoint.id, 'request');
      if (route) addEdge(endpoint.id, `${link.to}:${route.handler}`, 'handles');
    }
  }

  // ---------- Socket.io ----------
  for (const link of ws.socket ?? []) {
    const group = ifaceNode(`i:sock:${link.client}<->${link.server}`, 'interface', `Socket.io ${link.client} ↔ ${link.server}`, ROOT).id;
    const uses = [
      ...(ifaces.get(link.client)?.sockets ?? []).map((u) => ({ ...u, side: 'client' as const, repo: link.client })),
      ...(ifaces.get(link.server)?.sockets ?? []).map((u) => ({ ...u, side: 'server' as const, repo: link.server })),
    ];
    const byEvent = new Map<string, typeof uses>();
    for (const u of uses) byEvent.set(u.event, [...(byEvent.get(u.event) ?? []), u]);
    for (const [event, list] of byEvent) {
      const node = ifaceNode(`${group}:${event}`, 'event', event, group);
      const has = (side: 'client' | 'server', dir: 'emit' | 'listen') => list.some((u) => u.side === side && u.dir === dir);
      const notes: Msg[] = [];
      if (has('client', 'emit') && !has('server', 'listen')) notes.push({ code: 'note.noListener', params: { repo: link.server } });
      if (has('server', 'emit') && !has('client', 'listen')) notes.push({ code: 'note.noListener', params: { repo: link.client } });
      if (has('client', 'listen') && !has('server', 'emit')) notes.push({ code: 'note.noEmitter', params: { repo: link.server } });
      if (has('server', 'listen') && !has('client', 'emit')) notes.push({ code: 'note.noEmitter', params: { repo: link.client } });
      if (notes.length) {
        node.unmatched = true;
        node.notes = notes;
      }
      for (const u of list) {
        const owner = `${u.repo}:${u.owner}`;
        if (u.dir === 'emit') addEdge(owner, node.id, 'emit');
        else addEdge(node.id, owner, 'listen');
      }
    }
  }

  if (ifaceNodes.size) {
    nodes.push({ id: ROOT, kind: 'interface', name: 'Interfaces', path: '', feature: INTERFACE_FEATURE.name });
    nodes.push(...ifaceNodes.values());
    edges.push(...ifaceEdges.values());
    features.unshift(INTERFACE_FEATURE);
  }

  const graph: AtlasGraph = {
    meta: {
      repo: ws.repos.map((r) => r.name).join(' + '),
      roots: Object.fromEntries(repos.map((r) => [r.name, r.path])),
      generatedAt: new Date().toISOString(),
      files: nodes.filter((n) => n.kind === 'file').length,
      symbols: nodes.filter((n) => ['function', 'component', 'hook', 'class', 'method'].includes(n.kind)).length,
      edges: edges.length,
    },
    features,
    ...(groups.length ? { groups } : {}),
    nodes,
    edges,
  };
  if (analyses.length) {
    // 지문은 repo 별 minTokens 로 이미 걸렀다. 유사도는 repo 마다 다르면 가장 느슨한 쪽으로 한 번에 비교한다 (FE · BE 사이 중복도 잡는다)
    const settings = { minSimilarity: Math.min(...repos.map((r) => r.config.analysis.minSimilarity)) };
    graph.analysis = finishAnalysis(analyses, graph.edges, new Map(graph.nodes.map((n) => [n.id, n])), settings);
  }
  return { graph, warnings, prints: analyses.flatMap((a) => a.prints) };
}

/**
 * 같은 HTTP 메서드 · 같은 세그먼트 수의 라우트 중 가장 잘 맞는 것.
 * - 리터럴끼리 같으면 3점, 접두(`items*`)가 라우트 리터럴의 앞과 같으면 2점, 둘 다 param 이면 2점,
 *   호출 리터럴 ↔ 라우트 param 은 1점, 호출 param ↔ 라우트 리터럴은 0점.
 * - 호출 경로에 리터럴이 하나도 없으면(`${BASE}${path}` 같은 래퍼) 맞추지 않는다.
 * - 최고점이 여러 라우트에서 같으면 모호하다고 보고 맞추지 않는다.
 */
export function matchRoute(call: HttpCall, routes: Route[]): { route?: Route; reason?: Msg } {
  const literalSegments = call.segments.filter((s) => s !== ':param');
  if (!literalSegments.length) {
    return { reason: { code: 'note.unresolvedPath' } };
  }
  let best: Route[] = [];
  let bestScore = -1;
  for (const r of routes) {
    if ((r.method !== call.method && r.method !== 'ALL') || r.segments.length !== call.segments.length) continue;
    let score = 0;
    let ok = true;
    for (let i = 0; i < r.segments.length; i++) {
      const a = call.segments[i];
      const b = r.segments[i];
      const prefix = a.endsWith(PREFIX_MARK) ? a.slice(0, -PREFIX_MARK.length) : undefined;
      if (b === ':param') score += a === ':param' ? 2 : 1;
      else if (a === ':param') score += 0;
      else if (prefix !== undefined && b.startsWith(prefix)) score += 2;
      else if (a === b) score += 3;
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (score > bestScore) {
      best = [r];
      bestScore = score;
    } else if (score === bestScore) best.push(r);
  }
  // 같은 메서드가 여러 경로로 선언돼 동점이면 모호한 것이 아니다
  best = best.filter((r, i) => best.findIndex((o) => o.handler === r.handler && o.path === r.path) === i);
  if (best.length > 1) {
    return { reason: { code: 'note.ambiguous', params: { routes: best.map((r) => `${r.method} ${r.path}`).join(', ') } } };
  }
  return best.length ? { route: best[0] } : {};
}
