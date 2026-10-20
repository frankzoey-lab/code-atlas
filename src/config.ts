import { readFileSync } from 'node:fs';
import picomatch from 'picomatch';
import { Feature, OTHER_FEATURE } from './graph.js';

export interface FeatureRule extends Feature {
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
  exclude?: string[];
  features?: FeatureRule[];
  classify?: ClassifyConfig;
}

export interface ResolvedConfig {
  tsconfig: string;
  /** 설정에 tsconfig 를 적었는지. 안 적었으면 저장소에서 찾는다 */
  explicitTsconfig: boolean;
  features: Feature[];
  featureRules: FeatureRule[];
  classify: Required<ClassifyConfig>;
  isExcluded(relPath: string): boolean;
  featureOf(relPath: string): string;
}

const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/*.d.ts', '**/dist/**', '**/.next/**', '**/build/**', '**/coverage/**'];
const COLOR = /^#[0-9a-f]{3,8}$/i;

export function loadConfig(path?: string): ResolvedConfig {
  const raw: AtlasConfig = path ? JSON.parse(readFileSync(path, 'utf8')) : {};
  return resolveConfig(raw);
}

export function resolveConfig(raw: AtlasConfig): ResolvedConfig {
  const excluded = picomatch([...DEFAULT_EXCLUDE, ...(raw.exclude ?? [])], { dot: true });
  const rules = (raw.features ?? []).map((f) => ({
    name: f.name,
    match: picomatch(f.include, { dot: true }),
  }));
  return {
    tsconfig: raw.tsconfig ?? 'tsconfig.json',
    explicitTsconfig: !!raw.tsconfig,
    features: [
      // 색은 뷰어의 style 속성에 들어가므로 #hex 만 받는다
      ...(raw.features ?? []).map(({ name, color }) => ({ name, color: COLOR.test(color) ? color : OTHER_FEATURE.color })),
      OTHER_FEATURE,
    ],
    featureRules: raw.features ?? [],
    classify: {
      provider: 'jev',
      model: raw.classify?.model ?? 'jev-latest',
      minConfidence: raw.classify?.minConfidence ?? 0.6,
      includeSource: raw.classify?.includeSource ?? false,
    },
    isExcluded: (p) => excluded(p),
    // 먼저 적은 규칙이 이긴다
    featureOf: (p) => rules.find((r) => r.match(p))?.name ?? OTHER_FEATURE.name,
  };
}
