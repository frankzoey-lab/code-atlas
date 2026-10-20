import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyGraph, JevAuthError } from '../src/classify/jev.js';
import { loadConfig, resolveConfig } from '../src/config.js';
import { extract } from '../src/extract/index.js';

const repo = resolve(import.meta.dirname, 'fixture');
const config = loadConfig(resolve(repo, 'atlas.config.json'));

type Sent = { model: string; state: { path: string; symbols: string[]; source?: string }; questions: { feature: { criteria: Record<string, string> } } };

/** 경로별로 고를 기능 · 신뢰도를 정해 둔 가짜 Jev */
function fakeJev(pick: (path: string) => { choice: string; confidence?: number }, statuses: number[] = []) {
  const sent: Sent[] = [];
  const fetchImpl = (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    const body = JSON.parse(init.body) as Sent;
    sent.push(body);
    const status = statuses.shift();
    if (status) return new Response('{}', { status });
    const { choice, confidence } = pick(body.state.path);
    return Response.json({ model: 'jev-1', answers: { feature: { type: 'choice', choice, confidence, probabilities: {} } }, usage: { input_tokens: 10, output_tokens: 0 } });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

const options = (fetchImpl: typeof fetch, cacheDir = mkdtempSync(join(tmpdir(), 'atlas-jev-'))) => ({
  repo, cacheDir, fetchImpl, apiKey: 'test-key', backoffMs: 1,
});

describe('Jev 분류', () => {
  it('경로 규칙에 안 맞은(기타) 파일만 보내고, 소스는 기본으로 보내지 않는다', async () => {
    const g = extract({ repo, config });
    const { sent, fetchImpl } = fakeJev(() => ({ choice: 'Other', confidence: 0.9 }));
    const stats = await classifyGraph(g, config, options(fetchImpl));
    const paths = sent.map((b) => b.state.path).sort();
    expect(paths.every((p) => p.startsWith('lib/'))).toBe(true);
    expect(stats.candidates).toBe(paths.length);
    expect(sent.every((b) => b.state.source === undefined)).toBe(true);
    expect(Object.keys(sent[0].questions.feature.criteria)).toEqual(['UI', '서비스', 'UI-math', 'Other']);
  });

  it('신뢰도가 기준 이상이면 파일 · 심볼 · 폴더 기능을 바꾸고, 낮으면 기타로 둔다', async () => {
    const g = extract({ repo, config });
    const { fetchImpl } = fakeJev((path) =>
      path === 'lib/math.ts' ? { choice: '서비스', confidence: 0.9 } : { choice: 'UI', confidence: 0.3 },
    );
    const stats = await classifyGraph(g, config, options(fetchImpl));
    const node = (id: string) => g.nodes.find((n) => n.id === id);
    expect(node('f:lib/math.ts')?.feature).toBe('서비스');
    expect(node('f:lib/math.ts')?.classifiedBy).toBe('jev');
    expect(node('s:lib/math.ts#add')?.feature).toBe('서비스');
    expect(node('f:lib/api.ts')?.feature).toBe('Other');
    expect(stats.classified).toBe(1);
    expect(stats.lowConfidence).toBe(stats.candidates - 1);
  });

  it('같은 입력은 캐시에서 읽어 다시 부르지 않는다', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'atlas-jev-'));
    const first = fakeJev(() => ({ choice: '서비스', confidence: 0.9 }));
    await classifyGraph(extract({ repo, config }), config, options(first.fetchImpl, cacheDir));
    const second = fakeJev(() => ({ choice: 'UI', confidence: 0.9 }));
    const stats = await classifyGraph(extract({ repo, config }), config, options(second.fetchImpl, cacheDir));
    expect(second.sent).toHaveLength(0);
    expect(stats.cacheHits).toBe(stats.candidates);
  });

  it('429 는 다시 시도하고, 401 은 바로 멈춘다', async () => {
    const retry = fakeJev(() => ({ choice: '서비스', confidence: 0.9 }), [429, 529]);
    const stats = await classifyGraph(extract({ repo, config }), config, { ...options(retry.fetchImpl), concurrency: 1 });
    expect(stats.failed).toBe(0);
    expect(stats.classified).toBe(stats.candidates);

    const denied = fakeJev(() => ({ choice: '서비스', confidence: 0.9 }), [401]);
    await expect(classifyGraph(extract({ repo, config }), config, { ...options(denied.fetchImpl), concurrency: 1 })).rejects.toBeInstanceOf(JevAuthError);
  });

  it('키가 없으면 설정 방법을 알려 주며 멈춘다', async () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      await expect(classifyGraph(extract({ repo, config }), config, { repo, cacheDir: tmpdir() })).rejects.toThrow(/TYPESAFE_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    }
  });

  it('includeSource 일 때만 파일 앞부분을 보낸다', async () => {
    const withSource = resolveConfig({ ...JSON.parse('{"exclude":["**/*.spec.ts"]}'), features: [{ name: 'UI', color: '#000000', include: ['ui/**'] }], classify: { includeSource: true } });
    const { sent, fetchImpl } = fakeJev(() => ({ choice: 'Other', confidence: 0.9 }));
    await classifyGraph(extract({ repo, config: withSource }), withSource, options(fetchImpl));
    expect(sent.find((b) => b.state.path === 'lib/math.ts')?.state.source).toMatch(/export function add/);
  });

  it('도중에 401 로 멈춰도 그때까지 받은 응답은 캐시에 남는다', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'atlas-jev-'));
    const run = fakeJev(() => ({ choice: '서비스', confidence: 0.9 }), [0, 401]);
    await expect(classifyGraph(extract({ repo, config }), config, { ...options(run.fetchImpl, cacheDir), concurrency: 1 })).rejects.toBeInstanceOf(JevAuthError);
    const cached = JSON.parse(readFileSync(join(cacheDir, 'jev.json'), 'utf8'));
    expect(Object.keys(cached)).toHaveLength(1);
  });

  it('403 · 402 도 바로 멈춘다', async () => {
    for (const status of [403, 402]) {
      const denied = fakeJev(() => ({ choice: '서비스', confidence: 0.9 }), [status]);
      await expect(classifyGraph(extract({ repo, config }), config, { ...options(denied.fetchImpl), concurrency: 1 })).rejects.toBeInstanceOf(JevAuthError);
    }
  });

  it('옵션에 없는 choice · 신뢰도 없는 응답은 실패로 세고 캐시하지 않는다', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'atlas-jev-'));
    const bad = fakeJev((path) => (path === 'lib/math.ts' ? { choice: 'toString', confidence: 0.9 } : { choice: '서비스' }));
    const g = extract({ repo, config });
    const stats = await classifyGraph(g, config, options(bad.fetchImpl, cacheDir));
    expect(stats.classified).toBe(0);
    expect(stats.failed).toBe(stats.candidates);
    expect(g.nodes.find((n) => n.id === 'f:lib/math.ts')?.feature).toBe('Other');
    expect(JSON.parse(readFileSync(join(cacheDir, 'jev.json'), 'utf8'))).toEqual({});
  });

  it('깨진 캐시 파일은 무시하고 새로 시작한다', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'atlas-jev-'));
    writeFileSync(join(cacheDir, 'jev.json'), '{broken');
    const run = fakeJev(() => ({ choice: '서비스', confidence: 0.9 }));
    const stats = await classifyGraph(extract({ repo, config }), config, options(run.fetchImpl, cacheDir));
    expect(stats.classified).toBe(stats.candidates);
  });

  it('--scope 그래프에서는 분류가 없으면 폴더 색을 건드리지 않는다', async () => {
    const g = extract({ repo, config, scope: 'lib' });
    const before = Object.fromEntries(g.nodes.filter((n) => n.kind === 'dir').map((n) => [n.id, n.feature]));
    const run = fakeJev(() => ({ choice: 'Other', confidence: 0.9 }));
    await classifyGraph(g, config, options(run.fetchImpl));
    expect(Object.fromEntries(g.nodes.filter((n) => n.kind === 'dir').map((n) => [n.id, n.feature]))).toEqual(before);
  });

  it('키 오류로 멈출 때 동시에 나가 있던 요청의 응답도 캐시에 남기고, 새 요청은 내보내지 않는다', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'atlas-jev-'));
    // 첫 요청만 401, 나머지(동시에 나간 것)는 성공
    const run = fakeJev(() => ({ choice: '서비스', confidence: 0.9 }), [401]);
    const total = extract({ repo, config }).nodes.filter((n) => n.kind === 'file' && n.feature === 'Other').length;
    await expect(classifyGraph(extract({ repo, config }), config, { ...options(run.fetchImpl, cacheDir), concurrency: 2 })).rejects.toBeInstanceOf(JevAuthError);
    const cached = JSON.parse(readFileSync(join(cacheDir, 'jev.json'), 'utf8'));
    expect(Object.keys(cached).length).toBeGreaterThanOrEqual(1);
    expect(run.sent.length).toBeLessThan(total);
  });

  it('캐시 파일 내용이 객체가 아니면 새로 시작하고, 응답 형식이 다르면 실패로 센다', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'atlas-jev-'));
    writeFileSync(join(cacheDir, 'jev.json'), 'null');
    const weird = (async () => Response.json({ answers: {} })) as unknown as typeof fetch;
    const stats = await classifyGraph(extract({ repo, config }), config, options(weird, cacheDir));
    expect(stats.failed).toBe(stats.candidates);
  });
});
