import type { Msg } from './i18n.js';

export type NodeKind =
  | 'dir'
  | 'file'
  | 'function'
  | 'component'
  | 'hook'
  | 'class'
  | 'method'
  | 'external'
  | 'repo'
  | 'interface'
  | 'endpoint'
  | 'event';

export type EdgeKind = 'call' | 'render' | 'import' | 'request' | 'handles' | 'emit' | 'listen';

export interface AtlasNode {
  id: string;
  kind: NodeKind;
  name: string;
  /** 계층상 부모(dir → file → symbol → method). 최상위는 없음 */
  parent?: string;
  /** 저장소 기준 상대 경로 */
  path: string;
  line?: number;
  exported?: boolean;
  feature: string;
  /** --scope 밖에 있지만 scope 와 연결돼 함께 실린 노드 */
  boundary?: boolean;
  /** 인터페이스 노드: 반대편 짝(라우트 · 받는 쪽 · 보내는 쪽)을 못 찾음 */
  unmatched?: boolean;
  /** 인터페이스 노드: 짝을 못 찾은 이유 (뷰어가 언어에 맞게 번역한다) */
  notes?: Msg[];
  /** 엔드포인트: 호출 위치 `repo:path:line` */
  refs?: string[];
  /** 경로 규칙이 아니라 Jev 로 기능을 정한 노드 */
  classifiedBy?: 'jev';
  /** Jev 가 고른 기능의 신뢰도 (0~1) */
  confidence?: number;
  /** 선언 위 주석 (JSDoc · //) */
  doc?: string;
}

export interface AtlasEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  count: number;
}

export interface Feature {
  name: string;
  color: string;
  /** 상위 그룹 (설정의 feature.group) */
  group?: string;
  /** workspace 에서 이 기능이 속한 repo */
  repo?: string;
}

export interface AtlasGraph {
  meta: {
    repo: string;
    scope?: string;
    generatedAt: string;
    files: number;
    symbols: number;
    edges: number;
    /**
     * 에디터로 열기 링크용 repo 루트의 절대 경로. 단일 repo 는 '' 키, workspace 는 repo 이름 키.
     * --no-editor-links 로 만들면 비어 있다 (HTML 을 남과 나눌 때 내 경로를 숨기려면)
     */
    roots?: Record<string, string>;
  };
  features: Feature[];
  /** 중복 함수 · 호출 순환 · import 순환 (--no-analysis 면 없다) */
  analysis?: Analysis;
  /** 기능 그룹 (범례 색 · 설명). workspace 는 repo 를 함께 싣는다 */
  groups?: (FeatureGroup & { repo?: string })[];
  nodes: AtlasNode[];
  edges: AtlasEdge[];
}

export interface FeatureGroup {
  name: string;
  color?: string;
  description?: string;
}

/** 어떤 규칙에도 안 맞는 파일의 기능. 뷰어가 언어에 맞게 이름을 바꿔 보여 준다 */
export const OTHER_FEATURE: Feature = { name: 'Other', color: '#9aa3b2' };

/**
 * 같은 일을 하는 것으로 보이는 함수 묶음.
 * similarity 1 이면 이름 · 값만 다르고 구조가 같은 함수들 (2개 이상), 1 보다 작으면 비슷한 두 함수.
 */
export interface DuplicateSet {
  members: string[];
  /** 0~1 */
  similarity: number;
  /** 가장 작은 함수의 정규화 토큰 수 */
  tokens: number;
  /** --verify-duplicates 로 Jev 가 판정한 결과 */
  jev?: { same: boolean; confidence: number };
}

/** 서로 부르는(또는 import 하는) 묶음. path 는 대표 순환 하나 (처음과 끝이 같다) */
export interface Cycle {
  members: string[];
  path: string[];
}

export interface Analysis {
  duplicates: DuplicateSet[];
  /** 함수 사이 호출 순환 (상호 재귀). 노드 id */
  callCycles: Cycle[];
  /** 파일 사이 import 순환. 파일 노드 id */
  importCycles: Cycle[];
}
