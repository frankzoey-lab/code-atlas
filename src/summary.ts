import { ResolvedConfig } from './config.js';
import { AtlasGraph, OTHER_FEATURE } from './graph.js';

export interface FeatureSummary {
  /** cli.features 메시지 자리표시자 */
  params: { files: number; list: string; other: number; otherPct: string; largest: string };
  /** 규칙에 맞는 파일이 하나도 없는 기능 */
  empty: string[];
}

/**
 * 기능별 파일 수 요약. 그룹은 처음 나온 자리에 '[Universe 211 (66%): Genie 52, …]' 로 묶는다.
 * 기능 규칙이 없으면 undefined.
 */
export function featureSummary(graph: AtlasGraph, config: ResolvedConfig): FeatureSummary | undefined {
  // 설정에 'Other' 라는 기능을 적어도 기타와 겹쳐 세지 않는다
  const rules = config.featureRules.filter((r) => r.name !== OTHER_FEATURE.name);
  if (!rules.length) return undefined;
  const files = graph.nodes.filter((n) => n.kind === 'file' && !n.boundary);
  const count = new Map<string, number>();
  for (const n of files) count.set(n.feature, (count.get(n.feature) ?? 0) + 1);
  const n = (name: string) => count.get(name) ?? 0;
  const pct = (k: number) => `${files.length ? Math.round((k / files.length) * 100) : 0}%`;

  const parts: string[] = [];
  const done = new Set<string>();
  for (const rule of rules) {
    if (!rule.group) { parts.push(`${rule.name} ${n(rule.name)}`); continue; }
    if (done.has(rule.group)) continue;
    done.add(rule.group);
    const members = rules.filter((r) => r.group === rule.group);
    const total = members.reduce((a, r) => a + n(r.name), 0);
    parts.push(`[${rule.group} ${total} (${pct(total)}): ${members.map((r) => `${r.name} ${n(r.name)}`).join(', ')}]`);
  }
  const top = rules.reduce((a, r) => (n(r.name) > n(a.name) ? r : a));
  const other = n(OTHER_FEATURE.name);
  return {
    params: { files: files.length, list: parts.join(', '), other, otherPct: pct(other), largest: n(top.name) ? `${top.name} ${pct(n(top.name))}` : '-' },
    empty: rules.filter((r) => !n(r.name)).map((r) => r.name),
  };
}
