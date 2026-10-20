import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ResolvedConfig } from '../config.js';
import { AtlasGraph, AtlasNode, OTHER_FEATURE } from '../graph.js';
import { t } from '../i18n.js';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MAX_OPTIONS = 255;
const SOURCE_LINES = 80;
const MAX_DEPENDENCIES = 40;
const REQUEST_TIMEOUT_MS = 30_000;
/** 이 만큼 새 응답이 쌓이면 캐시를 중간 저장한다 (도중에 멈춰도 다시 과금하지 않게) */
const CACHE_FLUSH_EVERY = 20;
const SYMBOL_KINDS = new Set(['function', 'component', 'hook', 'class', 'method']);
const OTHER_DESCRIPTION = 'Shared utilities, infrastructure or code that does not clearly belong to any listed feature.';
const INSTRUCTIONS =
  'Which product feature does this source file belong to? Judge from its path, the names of its functions, ' +
  'components, hooks and classes, and the files it depends on (with their features). ' +
  'Pick the other option when no listed feature clearly fits.';

export interface ClassifyOptions {
  /** 대상 저장소 루트 (includeSource 일 때 파일을 읽는다) */
  repo: string;
  /** 응답 캐시를 둘 폴더 */
  cacheDir: string;
  /** 테스트에서 바꿔 끼운다 */
  fetchImpl?: typeof fetch;
  /** 없으면 TYPESAFE_API_KEY */
  apiKey?: string;
  concurrency?: number;
  /** 재시도 대기 시간의 기준 (ms) */
  backoffMs?: number;
  log?: (line: string) => void;
}

export interface ClassifyStats {
  candidates: number;
  classified: number;
  lowConfidence: number;
  cacheHits: number;
  failed: number;
  inputTokens: number;
  byFeature: Record<string, number>;
}

interface JevAnswer {
  choice: string;
  confidence: number;
}

export class JevAuthError extends Error {}

/**
 * 경로 규칙에 맞지 않아 "기타" 가 된 파일만 Jev(TypeSafe System One) Choice 질문으로 다시 분류한다.
 * 기본으로는 경로 · 심볼 이름 · 의존 파일만 보내고, 소스는 `classify.includeSource` 일 때만 보낸다.
 */
export async function classifyGraph(graph: AtlasGraph, config: ResolvedConfig, options: ClassifyOptions): Promise<ClassifyStats> {
  const settings = config.classify;
  const stats: ClassifyStats = { candidates: 0, classified: 0, lowConfidence: 0, cacheHits: 0, failed: 0, inputTokens: 0, byFeature: {} };
  const candidates = graph.nodes.filter((n) => n.kind === 'file' && n.feature === OTHER_FEATURE.name && !n.boundary);
  stats.candidates = candidates.length;
  if (!candidates.length || !config.featureRules.length) return stats;

  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new JevAuthError(t('jev.noKey'));
  }

  const criteria: Record<string, string> = {};
  for (const rule of config.featureRules) {
    criteria[rule.name] = rule.description ?? `${rule.name} (paths: ${rule.include.join(', ')})`;
  }
  criteria[OTHER_FEATURE.name] = OTHER_DESCRIPTION;
  if (Object.keys(criteria).length > MAX_OPTIONS) {
    throw new Error(t('jev.tooManyOptions', { max: MAX_OPTIONS, n: Object.keys(criteria).length - 1 }));
  }

  const byPath = new Map<string, AtlasNode[]>();
  for (const n of graph.nodes) byPath.set(n.path, [...(byPath.get(n.path) ?? []), n]);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  const cachePath = join(options.cacheDir, 'jev.json');
  const cache = readCache(cachePath, options.log);
  let unsaved = 0;
  const flush = () => {
    mkdirSync(dirname(cachePath), { recursive: true });
    // 임시 파일에 쓰고 바꿔 끼워, 쓰는 도중 멈춰도 캐시가 깨지지 않게
    writeFileSync(`${cachePath}.tmp`, JSON.stringify(cache));
    renameSync(`${cachePath}.tmp`, cachePath);
    unsaved = 0;
  };
  const post = makePoster(apiKey, options);

  let results: { file: AtlasNode; answer?: JevAnswer }[];
  // 키 · 권한 오류가 나면 새 요청은 내보내지 않고, 이미 나간 요청이 끝날 때까지 기다린 뒤 저장하고 멈춘다
  let authError: JevAuthError | undefined;
  try {
    results = await mapLimit(candidates, options.concurrency ?? 8, () => !!authError, async (file) => {
      try {
        const state = fileState(file, graph, byPath, nodeById, settings.includeSource ? options.repo : undefined);
        const key = createHash('sha256')
          .update(JSON.stringify({ v: CACHE_VERSION, model: settings.model, instructions: INSTRUCTIONS, criteria, state }))
          .digest('hex');
        if (cache[key]) {
          stats.cacheHits += 1;
          return { file, answer: cache[key].answer };
        }
        const { answer, inputTokens } = await post({
          model: settings.model,
          state,
          questions: { feature: { type: 'choice', instructions: INSTRUCTIONS, criteria } },
        });
        stats.inputTokens += inputTokens;
        if (!validAnswer(answer, criteria)) throw new Error(t('jev.badAnswer', { choice: String(answer.choice).slice(0, 40) }));
        cache[key] = { v: CACHE_VERSION, answer };
        if (++unsaved >= CACHE_FLUSH_EVERY) flush();
        return { file, answer };
      } catch (e) {
        if (e instanceof JevAuthError) {
          authError ??= e;
          return { file, answer: undefined };
        }
        if (authError) return { file, answer: undefined };
        stats.failed += 1;
        options.log?.(t('jev.fileFailed', { path: file.path, message: (e as Error).message }));
        return { file, answer: undefined };
      }
    });
  } finally {
    // 키 오류 등으로 도중에 멈춰도 그때까지 받은 응답은 남긴다
    flush();
  }
  if (authError) throw authError;

  const classifiedPaths: string[] = [];
  for (const { file, answer } of results) {
    if (!answer) continue;
    if (answer.choice === OTHER_FEATURE.name) continue;
    if (answer.confidence < settings.minConfidence) {
      stats.lowConfidence += 1;
      continue;
    }
    // 파일과 그 안의 심볼을 같은 기능으로
    for (const n of byPath.get(file.path) ?? []) {
      if (n.kind !== 'file' && !SYMBOL_KINDS.has(n.kind)) continue;
      n.feature = answer.choice;
      n.classifiedBy = 'jev';
      n.confidence = answer.confidence;
    }
    stats.classified += 1;
    stats.byFeature[answer.choice] = (stats.byFeature[answer.choice] ?? 0) + 1;
    classifiedPaths.push(file.path);
  }
  if (classifiedPaths.length) recomputeDirs(graph, nodeById, classifiedPaths);
  return stats;
}

const CACHE_VERSION = 1;

type CacheEntry = { v: number; answer: JevAnswer };

/** 지금 버전의 항목만 읽는다 (예전 형식 항목은 버려 파일이 계속 커지지 않게) */
function readCache(path: string, log?: (line: string) => void): Record<string, CacheEntry> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return Object.fromEntries(
      Object.entries(parsed as Record<string, CacheEntry>).filter(([, e]) => e?.v === CACHE_VERSION && e.answer),
    );
  } catch {
    log?.(t('jev.badCache', { path }));
    return {};
  }
}

function validAnswer(answer: JevAnswer, criteria: Record<string, string>): boolean {
  return (
    typeof answer?.choice === 'string' &&
    Object.hasOwn(criteria, answer.choice) &&
    typeof answer.confidence === 'number' &&
    Number.isFinite(answer.confidence)
  );
}

/**
 * 분류된 파일의 조상 폴더만 다시 칠한다. --scope 로 걸러진 그래프에서는 scope 를 품은 바깥 폴더가
 * 일부 파일만 갖고 있으므로 그대로 둔다.
 */
function recomputeDirs(graph: AtlasGraph, nodeById: Map<string, AtlasNode>, paths: string[]) {
  const scope = graph.meta.scope;
  const inScope = (p: string) => !scope || p === scope || p.startsWith(`${scope}/`);
  const dirs = new Set<string>();
  for (const p of paths) {
    for (let i = p.lastIndexOf('/'); i > 0; i = p.lastIndexOf('/', i - 1)) {
      const dir = p.slice(0, i);
      if (inScope(dir)) dirs.add(dir);
    }
  }
  const tally = new Map<string, Map<string, number>>();
  for (const n of graph.nodes) {
    if (n.kind !== 'file' || n.boundary) continue;
    for (const dir of dirs) {
      if (!n.path.startsWith(`${dir}/`)) continue;
      const t = tally.get(dir) ?? new Map<string, number>();
      t.set(n.feature, (t.get(n.feature) ?? 0) + 1);
      tally.set(dir, t);
    }
  }
  for (const n of nodeById.values()) {
    const t = n.kind === 'dir' ? tally.get(n.path) : undefined;
    if (t) n.feature = [...t.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
}

/** Jev 에 보내는 파일 설명. 소스는 repo 를 줄 때만 */
export function fileState(
  file: AtlasNode,
  graph: AtlasGraph,
  byPath: Map<string, AtlasNode[]>,
  nodeById: Map<string, AtlasNode>,
  repo?: string,
): Record<string, unknown> {
  const own = byPath.get(file.path) ?? [];
  const ownIds = new Set(own.map((n) => n.id));
  const dependsOn = new Map<string, string>();
  for (const e of graph.edges) {
    if (!ownIds.has(e.source)) continue;
    const target = nodeById.get(e.target);
    if (!target || target.path === file.path || target.kind === 'dir') continue;
    dependsOn.set(target.path, target.feature);
    if (dependsOn.size >= MAX_DEPENDENCIES) break;
  }
  const state: Record<string, unknown> = {
    path: file.path,
    symbols: own.filter((n) => SYMBOL_KINDS.has(n.kind)).map((n) => `${n.kind} ${n.name}`),
    dependsOn: [...dependsOn].map(([path, feature]) => ({ path, feature })),
  };
  if (repo) {
    state.source = readFileSync(resolve(repo, file.path), 'utf8').split('\n').slice(0, SOURCE_LINES).join('\n');
  }
  return state;
}

function makePoster(apiKey: string, options: ClassifyOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const backoff = options.backoffMs ?? 500;
  return async (body: unknown): Promise<{ answer: JevAnswer; inputTokens: number }> => {
    for (let attempt = 0; ; attempt++) {
      let res: Response | undefined;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          // 응답 없이 연결만 잡혀 있으면 멈추지 않도록
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (e) {
        if (attempt >= 4) throw e;
      }
      if (res?.ok) {
        let json: { answers?: { feature?: JevAnswer }; usage?: { input_tokens?: number } };
        try {
          json = await res.json();
        } catch (e) {
          // 본문을 읽다 끊기거나 시간 초과 — 다시 시도
          if (attempt >= 4) throw new Error(t('jev.bodyUnreadable', { message: (e as Error).message }));
          await new Promise((r) => setTimeout(r, backoff * 2 ** attempt));
          continue;
        }
        const feature = json?.answers?.feature;
        if (!feature) throw new Error(t('jev.badShape'));
        return { answer: { choice: feature.choice, confidence: feature.confidence }, inputTokens: json.usage?.input_tokens ?? 0 };
      }
      // 키 · 권한 · 잔액 문제는 파일마다 반복될 뿐이라 바로 멈춘다
      if (res && [401, 402, 403].includes(res.status)) {
        const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
        throw new JevAuthError(t('jev.rejected', { status: res.status, detail: detail ? `: ${detail}` : '' }));
      }
      // 429 · 529 · 5xx · 네트워크 오류만 다시 시도한다
      const retryable = !res || res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= 4) throw new Error(t('jev.http', { status: res?.status ?? t('jev.connectionFailed') }));
      await new Promise((r) => setTimeout(r, backoff * 2 ** attempt));
    }
  };
}

/** 동시에 limit 개씩 돌린다. stop() 이 true 가 되면 새 항목은 꺼내지 않는다 (진행 중인 것은 끝까지) */
async function mapLimit<T, R>(items: T[], limit: number, stop: () => boolean, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && !stop()) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out.filter(Boolean);
}
