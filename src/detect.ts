import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AtlasConfig, FeatureRule, resolveConfig } from './config.js';
import { extractRepo } from './extract/index.js';
import { findTsconfig } from './extract/project.js';
import { AtlasGraph } from './graph.js';
import { RepoInterfaces } from './interface/collect.js';
import { matchRoute, WorkspaceConfig } from './workspace.js';

export type Role = 'frontend' | 'backend' | 'library';

export interface DetectedRepo {
  name: string;
  path: string;
  /** 찾은 tsconfig (저장소 기준). 없으면 undefined 로 기본 설정을 쓴다 */
  tsconfig?: string;
  role: Role;
  interfaces: RepoInterfaces;
  graph: AtlasGraph;
  features: FeatureRule[];
}

export const DEFAULT_EXCLUDE = [
  '**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx', '**/__tests__/**', '**/__mocks__/**',
  '**/*.stories.tsx', '**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', '**/coverage/**',
];

/** 기능 색 팔레트 (밝은 · 어두운 배경 모두에서 구분되는 색) */
export const PALETTE = [
  '#7a4bc2', '#0f6a8b', '#d9480f', '#2f855a', '#be185d', '#b08900',
  '#475569', '#8b5e34', '#0e7490', '#9333ea', '#c2410c', '#4d7c0f',
];

const MAX_FEATURES = 12;
const MIN_FILES = 3;

export { findTsconfig };

/** repo 하나를 열어 역할 · 인터페이스 · 기능 규칙 초안을 만든다 */
export function detectRepo(name: string, path: string): DetectedRepo {
  const tsconfig = findTsconfig(path);
  const config = resolveConfig({ tsconfig: tsconfig ?? 'tsconfig.json', exclude: DEFAULT_EXCLUDE });
  // process.env.X 로 시작하는 URL 은 항상 base 로 잡히므로, 감지 단계에서는 다른 식을 base 로 보지 않는다
  const { graph, interfaces } = extractRepo({ repo: path, config, interfaceBase: () => false });
  const ifaces = interfaces ?? { calls: [], routes: [], sockets: [], warnings: [] };
  const role: Role = ifaces.routes.length ? 'backend' : ifaces.calls.length ? 'frontend' : 'library';
  return { name, path, tsconfig, role, interfaces: ifaces, graph, features: draftFeatures(path, graph) };
}

/**
 * 기능 규칙 초안. docs/ 아래 폴더 이름이 있으면 그 이름이 들어간 경로를, 없으면 소스 폴더
 * (src 가 있으면 src 아래) 의 하위 폴더를 파일 수 순으로 기능으로 잡는다. 파일이 적은 폴더는 기타로 둔다.
 */
export function draftFeatures(repo: string, graph: AtlasGraph): FeatureRule[] {
  const files = graph.nodes.filter((n) => n.kind === 'file').map((n) => n.path);
  const fromDocs = docTopics(repo)
    .map((topic) => {
      const pattern = `**/*${topic}*/**`;
      const count = files.filter((f) => f.toLowerCase().split('/').some((seg, i, all) => i < all.length - 1 && seg.includes(topic))).length;
      return { topic, pattern, count };
    })
    .filter((x) => x.count >= MIN_FILES);
  if (fromDocs.length >= 2) {
    return fromDocs
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_FEATURES)
      .map((x, i) => ({ name: title(x.topic), color: PALETTE[i % PALETTE.length], include: [x.pattern] }));
  }

  const base = files.some((f) => f.startsWith('src/')) ? 'src/' : '';
  const groups = new Map<string, number>();
  for (const f of files) {
    if (!f.startsWith(base)) continue;
    const rest = f.slice(base.length).split('/');
    if (rest.length < 2) continue;
    // src/modules/x 처럼 묶음 폴더 하나만 있으면 그 아래를 기능으로 본다
    groups.set(rest[0], (groups.get(rest[0]) ?? 0) + 1);
  }
  let entries = [...groups].filter(([, n]) => n >= MIN_FILES);
  if (entries.length === 1) {
    const only = entries[0][0];
    const inner = new Map<string, number>();
    for (const f of files) {
      const rest = f.slice(base.length).split('/');
      if (rest[0] === only && rest.length > 2) inner.set(rest[1], (inner.get(rest[1]) ?? 0) + 1);
    }
    entries = [...inner].filter(([, n]) => n >= MIN_FILES).map(([dir, n]) => [`${only}/${dir}`, n]);
  }
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_FEATURES)
    .map(([dir], i) => ({ name: title(dir.split('/').pop()!), color: PALETTE[i % PALETTE.length], include: [`${base}${dir}/**`] }));
}

function docTopics(repo: string): string[] {
  const docs = join(repo, 'docs');
  if (!existsSync(docs)) return [];
  return readdirSync(docs)
    .filter((d) => !d.startsWith('.') && statSync(join(docs, d)).isDirectory())
    .map((d) => d.toLowerCase());
}

function title(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface DetectedLinks {
  http: NonNullable<WorkspaceConfig['http']>;
  socket: NonNullable<WorkspaceConfig['socket']>;
  /** 출력용: 링크마다 매칭된 호출 수 */
  hits: Map<string, number>;
}

/**
 * frontend 의 `process.env.X` base 마다, 경로가 가장 많이 맞는 backend 를 짝으로 고른다.
 * 맞는 backend 가 없고 호출이 3개 이상이면 바깥 서비스(label)로 둔다.
 */
export function detectLinks(repos: DetectedRepo[]): DetectedLinks {
  const http: DetectedLinks['http'] = [];
  const hits = new Map<string, number>();
  const backends = repos.filter((r) => r.interfaces.routes.length);
  for (const from of repos) {
    const byBase = new Map<string, typeof from.interfaces.calls>();
    for (const c of from.interfaces.calls) byBase.set(c.base, [...(byBase.get(c.base) ?? []), c]);
    for (const [base, calls] of byBase) {
      let best: DetectedRepo | undefined;
      let bestHits = 0;
      for (const be of backends) {
        if (be === from) continue;
        const n = calls.filter((c) => matchRoute(c, be.interfaces.routes).route).length;
        if (n > bestHits) { best = be; bestHits = n; }
      }
      if (best) {
        http.push({ from: from.name, base: [base], to: best.name });
        hits.set(`${from.name}|${base}`, bestHits);
      } else if (calls.length >= 3) {
        http.push({ from: from.name, base: [base], label: base.toLowerCase().replace(/_/g, '-') });
        hits.set(`${from.name}|${base}`, calls.length);
      }
    }
  }
  const socket: DetectedLinks['socket'] = [];
  const servers = repos.filter((r) => r.interfaces.sockets.some((s) => s.dir === 'listen') && r.interfaces.routes.length);
  for (const client of repos) {
    if (servers.includes(client) || !client.interfaces.sockets.length) continue;
    for (const server of servers) {
      const clientEvents = new Set(client.interfaces.sockets.map((s) => s.event));
      if (server.interfaces.sockets.some((s) => clientEvents.has(s.event))) socket.push({ client: client.name, server: server.name });
    }
  }
  return { http, socket, hits };
}

/** repo 별 atlas.config 초안 */
export function repoConfig(repo: DetectedRepo): AtlasConfig {
  return {
    ...(repo.tsconfig && repo.tsconfig !== 'tsconfig.json' ? { tsconfig: repo.tsconfig } : {}),
    exclude: DEFAULT_EXCLUDE,
    features: repo.features,
  };
}
