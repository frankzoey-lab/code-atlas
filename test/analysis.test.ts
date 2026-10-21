import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyDuplicates } from '../src/analyze/verify.js';
import { resolveConfig } from '../src/config.js';
import { extract, extractRepo } from '../src/extract/index.js';
import { JevAuthError } from '../src/classify/jev.js';
import { buildWorkspace, loadWorkspace } from '../src/workspace.js';

const repo = resolve(import.meta.dirname, 'fixture-analysis');
const config = resolveConfig({ analysis: { minTokens: 30, minSimilarity: 0.8 } });
const id = (file: string, name: string) => `s:src/${file}.ts#${name}`;

describe('중복 함수', () => {
  const a = extract({ repo, config }).analysis!;

  it('이름 · 값만 바꾼 복사는 똑같음(1), 한 줄 더한 것은 기준 이상으로 비슷함', () => {
    const identical = a.duplicates.find((d) => d.similarity === 1);
    expect(identical?.members.sort()).toEqual([id('copy', 'totalOfItems'), id('totals', 'sumOrders')].sort());
    const similar = a.duplicates.find((d) => d.similarity < 1 && d.members.includes(id('copy', 'totalWithTax')));
    expect(similar?.similarity).toBeGreaterThanOrEqual(0.8);
  });

  it('작은 함수 · 모양이 다른 함수는 나오지 않는다', () => {
    const all = a.duplicates.flatMap((d) => d.members);
    expect(all).not.toContain(id('copy', 'describe'));
    expect(all).not.toContain(id('totals', 'isEven'));
  });

  it('다른 컴포넌트 · prop 을 쓰는 JSX 는 중복이 아니다', () => {
    const all = a.duplicates.flatMap((d) => d.members);
    expect(all).not.toContain('s:src/ui.tsx#SaveBar');
  });

  it('--no-analysis 면 분석이 없다', () => {
    expect(extract({ repo, config, analysis: false }).analysis).toBeUndefined();
  });
});

describe('순환', () => {
  const a = extract({ repo, config }).analysis!;

  it('상호 재귀는 호출 순환, 직접 재귀는 빼고', () => {
    expect(a.callCycles).toEqual([{ members: [id('totals', 'isEven'), id('totals', 'isOdd')], path: [id('totals', 'isEven'), id('totals', 'isOdd'), id('totals', 'isEven')] }]);
  });

  it('import 순환은 잡고, 타입만 가져오는 순환(import type · interface 만 · type re-export)은 빼고', () => {
    expect(a.importCycles.map((c) => c.members)).toEqual([['f:src/labels.ts', 'f:src/totals.ts']]);
  });
});

describe('workspace', () => {
  it('repo 를 건너는 중복도 잡고 id 에 repo 접두를 붙인다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-an-'));
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ analysis: { minTokens: 30 } }));
    writeFileSync(join(dir, 'ws.json'), JSON.stringify({ repos: [{ name: 'one', path: repo, config: 'c.json' }, { name: 'two', path: repo, config: 'c.json' }] }));
    const a = buildWorkspace(loadWorkspace(join(dir, 'ws.json'))).analysis!;
    const set = a.duplicates.find((d) => d.similarity === 1 && d.members.includes(`one:${id('totals', 'sumOrders')}`))!;
    expect(set.members).toHaveLength(4);
    expect(set.members).toContain(`one:${id('totals', 'sumOrders')}`);
    expect(set.members).toContain(`two:${id('totals', 'sumOrders')}`);
    expect(a.callCycles.map((c) => c.members[0])).toEqual([`one:${id('totals', 'isEven')}`, `two:${id('totals', 'isEven')}`]);
  });
});

describe('Jev 중복 확인', () => {
  const run = async (reply: (body: { state: unknown }) => Response, cacheDir = mkdtempSync(join(tmpdir(), 'atlas-jev-'))) => {
    const { graph, analysis } = extractRepo({ repo, config });
    const { finishAnalysis } = await import('../src/analyze/index.js');
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    const a = finishAnalysis([analysis!], graph.edges, nodes, config.analysis);
    const sent: unknown[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      sent.push(body);
      return reply(body);
    }) as unknown as typeof fetch;
    const stats = await verifyDuplicates(a, analysis!.prints, nodes, 'jev-latest', 10, 0.6, { repo, cacheDir, fetchImpl, apiKey: 'k', backoffMs: 1 });
    return { a, stats, sent, cacheDir };
  };
  const answer = (choice: string, confidence = 0.9) => new Response(JSON.stringify({ answers: { same: { choice, confidence } }, usage: { input_tokens: 5 } }));

  it('두 함수의 본문을 보내 결과를 붙이고, 다시 돌리면 캐시를 쓴다', async () => {
    const first = await run(() => answer('same'));
    expect(first.stats.same).toBe(first.stats.asked);
    expect(first.a.duplicates[0].jev).toEqual({ same: true, confidence: 0.9, sure: true });
    expect(JSON.stringify(first.sent[0])).toContain('item.price * item.qty');
    const again = await run(() => answer('different'), first.cacheDir);
    expect(again.sent).toHaveLength(0);
    expect(again.stats.cacheHits).toBe(again.stats.asked);
  });

  it('신뢰도가 기준보다 낮은 답은 애매로 두고 같음으로 세지 않는다', async () => {
    const low = await run(() => answer('same', 0.3));
    expect(low.stats.asked).toBeGreaterThan(0);
    expect(low.stats.same).toBe(0);
    expect(low.stats.unsure).toBe(low.stats.asked);
    expect(low.a.duplicates[0].jev).toEqual({ same: true, confidence: 0.3, sure: false });
    const lowDiff = await run(() => answer('different', 0.2));
    expect(lowDiff.stats.unsure).toBe(lowDiff.stats.asked);
    expect(lowDiff.a.duplicates[0].jev).toEqual({ same: false, confidence: 0.2, sure: false });
    // 기준과 같은 신뢰도는 확실한 답 (분류의 `< minConfidence` 와 같은 경계)
    const edge = await run(() => answer('same', 0.6));
    expect(edge.stats.same).toBe(edge.stats.asked);
    expect(edge.a.duplicates[0].jev?.sure).toBe(true);
  });

  it('401 이면 멈추고 JevAuthError', async () => {
    await expect(run(() => new Response('no', { status: 401 }))).rejects.toBeInstanceOf(JevAuthError);
  });
});

describe('중복 찾기 경계', () => {
  it('흔한 조각이 많아도(보일러플레이트가 많은 repo) 비슷한 쌍을 놓치지 않는다', async () => {
    const { findDuplicates } = await import('../src/analyze/duplicates.js');
    const common = Array.from({ length: 90 }, (_, i) => i);
    const make = (id: string, extra: number[]) => ({ id, tokens: 100, hash: id, shingles: new Set([...common, ...extra]), text: '' });
    // 흔한 shingle 90개는 300개 함수가 모두 갖는다
    const noise = Array.from({ length: 300 }, (_, i) => make(`n${i}`, Array.from({ length: 60 }, (_, k) => 10_000 + i * 100 + k)));
    const a = make('a', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => 500 + x));
    const b = make('b', [1, 2, 3, 4, 5, 6, 7, 8, 9, 11].map((x) => 500 + x));
    const found = findDuplicates([...noise, a, b], { minSimilarity: 0.85 });
    expect(found.some((d) => d.members.join() === 'a,b')).toBe(true);
  });

  it('minSimilarity 를 0.7 아래로 내리면 크기 차이가 큰 쌍도 본다', async () => {
    const { findDuplicates } = await import('../src/analyze/duplicates.js');
    const range = (n: number) => Array.from({ length: n }, (_, i) => i);
    const x = { id: 'x', tokens: 100, hash: 'x', shingles: new Set(range(100)), text: '' };
    const y = { id: 'y', tokens: 65, hash: 'y', shingles: new Set(range(65)), text: '' };
    expect(findDuplicates([x, y], { minSimilarity: 0.6 })).toHaveLength(1);
    expect(findDuplicates([x, y], { minSimilarity: 0.7 })).toHaveLength(0);
  });

  it('--scope 면 범위 안에 걸친 결과만, 범위 밖 함수와도 비교한다', () => {
    const g = extract({ repo, config, scope: 'src/copy.ts' });
    const sets = g.analysis!.duplicates;
    expect(sets.length).toBeGreaterThan(0);
    expect(sets.every((d) => d.members.some((m) => m.startsWith('s:src/copy.ts')))).toBe(true);
    expect(sets.some((d) => d.members.includes(id('totals', 'sumOrders')))).toBe(true);
    expect(g.analysis!.callCycles).toEqual([]);
  });
});
