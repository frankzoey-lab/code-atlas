import { DuplicateSet } from '../graph.js';
import { FunctionPrint } from './fingerprint.js';

export interface DuplicateOptions {
  /** 이 이상이면 비슷하다 (0~1, Jaccard) */
  minSimilarity: number;
  /** 결과 상한 */
  limit?: number;
  /** 같은 함수 안에 든 관계 · 한쪽이 다른 쪽을 부르는 쌍처럼 비교하지 않을 쌍 */
  skip?: (a: string, b: string) => boolean;
}

/**
 * 구조가 같은 함수 묶음(정규화 토큰열 해시가 같음)과 비슷한 두 함수(shingle Jaccard ≥ minSimilarity).
 * 같은 묶음은 대표 하나로만 비슷함을 비교해 쌍이 불어나지 않게 한다. 유사도 × 크기 순.
 */
export function findDuplicates(prints: FunctionPrint[], options: DuplicateOptions): DuplicateSet[] {
  const s = options.minSimilarity;
  const out: DuplicateSet[] = [];
  const byHash = new Map<string, FunctionPrint[]>();
  for (const p of prints) {
    const group = byHash.get(p.hash);
    if (group) group.push(p);
    else byHash.set(p.hash, [p]);
  }
  const reps: FunctionPrint[] = [];
  for (const group of byHash.values()) {
    group.sort((x, y) => x.id.localeCompare(y.id));
    reps.push(group[0]);
    // 묶음 안에서 서로 부르거나 품은 함수는 뺀다
    const members = group.filter((p, i) => !group.some((q, j) => j < i && options.skip?.(q.id, p.id)));
    if (members.length > 1) out.push({ members: members.map((p) => p.id), similarity: 1, tokens: members[0].tokens });
  }

  // prefix filtering: shingle 을 드문 순으로 늘어놓고 앞 |S| - ⌈s·|S|⌉ + 1 개만 색인한다.
  // Jaccard ≥ s 인 두 집합은 이 앞부분에서 반드시 하나 이상 겹치므로 빠뜨리는 쌍이 없다
  const freq = new Map<number, number>();
  for (const p of reps) for (const x of p.shingles) freq.set(x, (freq.get(x) ?? 0) + 1);
  const prefixes = reps.map((p) => {
    const sorted = [...p.shingles].sort((a, b) => freq.get(a)! - freq.get(b)! || a - b);
    return sorted.slice(0, sorted.length - Math.ceil(s * sorted.length) + 1);
  });
  const posting = new Map<number, number[]>();
  prefixes.forEach((prefix, i) => {
    for (const x of prefix) {
      const list = posting.get(x);
      if (list) list.push(i);
      else posting.set(x, [i]);
    }
  });
  reps.forEach((p, i) => {
    const seen = new Set<number>();
    for (const x of prefixes[i]) for (const j of posting.get(x)!) if (j > i) seen.add(j);
    for (const j of seen) {
      const q = reps[j];
      const small = Math.min(p.shingles.size, q.shingles.size), big = Math.max(p.shingles.size, q.shingles.size);
      // Jaccard ≤ small / big
      if (small / big < s) continue;
      if (options.skip?.(p.id, q.id)) continue;
      let inter = 0;
      for (const x of p.shingles) if (q.shingles.has(x)) inter++;
      const jaccard = inter / (p.shingles.size + q.shingles.size - inter);
      if (jaccard < s) continue;
      const [a, b] = p.id < q.id ? [p, q] : [q, p];
      out.push({ members: [a.id, b.id], similarity: Math.round(jaccard * 1000) / 1000, tokens: Math.min(a.tokens, b.tokens) });
    }
  });

  return out
    .sort((x, y) => y.similarity * y.tokens - x.similarity * x.tokens || x.members[0].localeCompare(y.members[0]))
    .slice(0, options.limit ?? 500);
}
