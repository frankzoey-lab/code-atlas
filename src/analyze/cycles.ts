import { Cycle } from '../graph.js';

/**
 * 방향 그래프에서 크기 2 이상인 강한 연결 묶음(Tarjan)과, 묶음마다 첫 멤버를 지나는 가장 짧은 순환 하나.
 * 자기 자신만 가리키는 간선(직접 재귀)은 보지 않는다.
 */
export function findCycles(edges: Iterable<[string, string]>): Cycle[] {
  const next = new Map<string, Set<string>>();
  for (const [a, b] of edges) {
    if (a === b) continue;
    if (!next.has(a)) next.set(a, new Set());
    next.get(a)!.add(b);
    if (!next.has(b)) next.set(b, new Set());
  }

  // 큰 저장소에서 재귀 깊이를 넘지 않도록 반복문으로 돈다
  const index = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], onStack = new Set<string>();
  const groups: string[][] = [];
  let counter = 0;
  for (const root of [...next.keys()].sort()) {
    if (index.has(root)) continue;
    const work: Array<{ v: string; it: Iterator<string> }> = [];
    const visit = (v: string) => {
      index.set(v, counter);
      low.set(v, counter++);
      stack.push(v);
      onStack.add(v);
      work.push({ v, it: [...next.get(v)!].sort()[Symbol.iterator]() });
    };
    visit(root);
    while (work.length) {
      const top = work[work.length - 1];
      const step = top.it.next();
      if (!step.done) {
        const w = step.value;
        if (!index.has(w)) visit(w);
        else if (onStack.has(w)) low.set(top.v, Math.min(low.get(top.v)!, index.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].v;
        low.set(parent, Math.min(low.get(parent)!, low.get(top.v)!));
      }
      if (low.get(top.v) === index.get(top.v)) {
        const group: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          group.push(w);
        } while (w !== top.v);
        if (group.length > 1) groups.push(group.sort());
      }
    }
  }

  return groups
    .map((members) => ({ members, path: shortestCycle(members, next) }))
    .sort((x, y) => y.members.length - x.members.length || x.members[0].localeCompare(y.members[0]));
}

/** 묶음의 첫 멤버를 지나는 가장 짧은 순환 (BFS). 묶음 전체에서 가장 짧은 순환은 아닐 수 있다 */
function shortestCycle(members: string[], next: Map<string, Set<string>>): string[] {
  const inside = new Set(members);
  const start = members[0];
  const prev = new Map<string, string>();
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i];
    for (const w of [...next.get(v)!].sort()) {
      if (!inside.has(w)) continue;
      if (w === start) {
        const path = [start];
        for (let cur: string | undefined = v; cur && cur !== start; cur = prev.get(cur)) path.splice(1, 0, cur);
        return [...path, start];
      }
      if (!prev.has(w)) {
        prev.set(w, v);
        queue.push(w);
      }
    }
  }
  return [start, start];
}
