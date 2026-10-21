import { readFileSync } from 'node:fs';
import picomatch from 'picomatch';
import { Feature, FeatureGroup, OTHER_FEATURE } from './graph.js';

export type { FeatureGroup };

export interface FeatureRule extends Omit<Feature, 'color' | 'group' | 'repo'> {
  /** 그룹에 속하면 생략할 수 있다 (그룹 색 계열로 만든다) */
  color?: string;
  /** 상위 그룹 이름 (2단계: 그룹 > 기능) */
  group?: string;
  include: string[];
  /** Jev 분류에서 이 기능의 설명으로 쓴다 */
  description?: string;
}

/** --classify 로 켜는 Jev(TypeSafe) 분류 설정 */
export interface ClassifyConfig {
  provider?: 'jev';
  model?: string;
  /** 이보다 낮은 신뢰도면 기타로 둔다 */
  minConfidence?: number;
  /** 파일 앞부분 소스를 함께 보낸다 (기본 false: 경로 · 이름만) */
  includeSource?: boolean;
}

export interface AtlasConfig {
  /** 대상 저장소 안의 tsconfig 경로. 기본 tsconfig.json */
  tsconfig?: string;
  /** init 이 만든 초안. 규칙을 다듬은 뒤 지워야 지도를 만든다 (--allow-draft 로 무시) */
  draft?: boolean;
  exclude?: string[];
  groups?: FeatureGroup[];
  features?: FeatureRule[];
  classify?: ClassifyConfig;
  analysis?: AnalysisConfig;
}

/** 중복 함수 찾기 기준 */
export interface AnalysisConfig {
  /** 정규화 토큰이 이보다 적은 함수는 비교하지 않는다 (기본 50) */
  minTokens?: number;
  /** 이 이상 비슷하면 중복 후보 (0~1, 기본 0.85) */
  minSimilarity?: number;
  /** --verify-duplicates 로 Jev 에 물어볼 최대 쌍 수 (기본 100) */
  verifyLimit?: number;
}

export interface ResolvedConfig {
  tsconfig: string;
  /** 설정에 tsconfig 를 적었는지. 안 적었으면 저장소에서 찾는다 */
  explicitTsconfig: boolean;
  draft: boolean;
  /** 기능이 쓰는 그룹 (색은 계산된 기준색) */
  groups: FeatureGroup[];
  features: Feature[];
  featureRules: FeatureRule[];
  classify: Required<ClassifyConfig>;
  analysis: Required<AnalysisConfig>;
  isExcluded(relPath: string): boolean;
  featureOf(relPath: string): string;
}

const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/*.d.ts', '**/dist/**', '**/.next/**', '**/build/**', '**/coverage/**'];
// #rgb · #rgba · #rrggbb · #rrggbbaa 만 받는다
const COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function loadConfig(path?: string): ResolvedConfig {
  const raw: AtlasConfig = path ? JSON.parse(readFileSync(path, 'utf8')) : {};
  return resolveConfig(raw);
}

/** '#rgb' · '#rgba' · '#rrggbb' · '#rrggbbaa' → [h(0~6), s, l]. alpha 는 버린다 */
function toHsl(hex: string): [number, number, number] {
  const full = hex.length <= 5 ? [...hex.slice(1, 4)].map((c) => c + c).join('') : hex.slice(1, 7);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** 명도를 바꿀 순서 (%): ±8 배수 → ±4 배수 → ±2 · ±1 배수. 너무 어둡거나 밝아지는 값은 건너뛴다 */
const SHADE_STEPS = [8, 4, 2, 1].flatMap((step) =>
  Array.from({ length: Math.floor(76 / step) }, (_, k) => (k + 1) * step).flatMap((d) => [-d, d]),
);

/** 그룹 색 계열에서 아직 안 쓴 색을 차례로 꺼낸다 */
function shadesOf(base: string, used: Set<string>): () => string {
  const [h, s, l] = toHsl(base);
  // 같은 색이 다른 표기로 두 번 나오지 않게 #rrggbb 로 맞춘다 (alpha 는 버린다)
  const own = base.length <= 5 ? `#${[...base.slice(1, 4)].map((c) => c + c).join('')}` : base.slice(0, 7);
  const candidates = [own.toLowerCase(), ...SHADE_STEPS.filter((d) => l + d / 100 >= 0.12 && l + d / 100 <= 0.88).map((d) => fromHsl(h, s, l + d / 100))];
  let i = 0;
  return () => {
    while (i < candidates.length && used.has(candidates[i])) i++;
    const c = candidates[i++] ?? base;
    used.add(c);
    return c;
  };
}

/** 기능 색: 적은 색 > 그룹 색 계열(겹치지 않게) > 기타 색. 그룹 색은 groups[].color > 그룹 안 첫 기능 색 */
function featureColors(raw: AtlasConfig): { colors: string[]; groups: FeatureGroup[] } {
  const valid = (c?: string) => (c && COLOR.test(c) ? c.toLowerCase() : undefined);
  const rules = raw.features ?? [];
  const groupColor = new Map<string, string>();
  for (const g of raw.groups ?? []) if (valid(g.color)) groupColor.set(g.name, valid(g.color)!);
  for (const f of rules) if (f.group && !groupColor.has(f.group) && valid(f.color)) groupColor.set(f.group, valid(f.color)!);
  // 그룹 안에서 직접 적은 색은 계열 색이 다시 쓰지 않는다
  const used = new Map<string, Set<string>>();
  for (const f of rules) if (f.group && valid(f.color)) used.set(f.group, (used.get(f.group) ?? new Set()).add(valid(f.color)!));
  const next = new Map<string, () => string>();
  const colors = rules.map((f) => {
    if (valid(f.color)) return valid(f.color)!;
    const base = f.group ? groupColor.get(f.group) : undefined;
    if (!base) return OTHER_FEATURE.color;
    if (!next.has(f.group!)) next.set(f.group!, shadesOf(base, used.get(f.group!) ?? new Set()));
    return next.get(f.group!)!();
  });
  const described = new Map((raw.groups ?? []).map((g) => [g.name, g.description]));
  const groups = [...new Set(rules.map((f) => f.group).filter((g): g is string => !!g))].map((name) => ({
    name,
    color: groupColor.get(name) ?? OTHER_FEATURE.color,
    ...(described.get(name) ? { description: described.get(name) } : {}),
  }));
  return { colors, groups };
}

/** 같은 이름 규칙(include 를 나눠 적은 경우)을 한 기능으로: 처음 적은 group · color · description 을 쓴다 */
function mergeByName(rules: FeatureRule[]): FeatureRule[] {
  const merged = new Map<string, FeatureRule>();
  for (const r of rules) {
    const m = merged.get(r.name);
    if (!m) { merged.set(r.name, { ...r, include: [...r.include] }); continue; }
    m.include.push(...r.include);
    m.group ??= r.group;
    if (!(m.color && COLOR.test(m.color))) m.color = r.color;
    m.description ??= r.description;
  }
  return [...merged.values()];
}

export function resolveConfig(raw: AtlasConfig): ResolvedConfig {
  const excluded = picomatch([...DEFAULT_EXCLUDE, ...(raw.exclude ?? [])], { dot: true });
  const features = mergeByName(raw.features ?? []);
  const { colors, groups } = featureColors({ ...raw, features });
  const rules = (raw.features ?? []).map((f) => ({
    name: f.name,
    match: picomatch(f.include, { dot: true }),
  }));
  return {
    tsconfig: raw.tsconfig ?? 'tsconfig.json',
    explicitTsconfig: !!raw.tsconfig,
    draft: raw.draft === true,
    groups,
    features: [
      // 색은 뷰어의 style 속성에 들어가므로 #hex 만 받는다
      ...features.map(({ name, group }, i) => ({ name, color: colors[i], ...(group ? { group } : {}) })),
      OTHER_FEATURE,
    ],
    featureRules: features,
    classify: {
      provider: 'jev',
      model: raw.classify?.model ?? 'jev-latest',
      minConfidence: raw.classify?.minConfidence ?? 0.6,
      includeSource: raw.classify?.includeSource ?? false,
    },
    analysis: {
      minTokens: raw.analysis?.minTokens ?? 50,
      minSimilarity: raw.analysis?.minSimilarity ?? 0.85,
      verifyLimit: raw.analysis?.verifyLimit ?? 100,
    },
    isExcluded: (p) => excluded(p),
    // 먼저 적은 규칙이 이긴다 (같은 이름으로 나눠 적은 규칙도 적은 순서대로 본다)
    featureOf: (p) => rules.find((r) => r.match(p))?.name ?? OTHER_FEATURE.name,
  };
}
