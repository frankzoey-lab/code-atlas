import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { extract } from '../src/extract/index.js';
import { AtlasGraph } from '../src/graph.js';

const repo = resolve(import.meta.dirname, 'fixture');
const config = loadConfig(resolve(repo, 'atlas.config.json'));

const edge = (g: AtlasGraph, source: string, target: string, kind?: string) =>
  g.edges.find((e) => e.source === source && e.target === target && (!kind || e.kind === kind));

describe('extract', () => {
  let g: AtlasGraph;
  beforeAll(() => {
    g = extract({ repo, config });
  });

  it('barrel re-export 와 별칭 import 를 원래 선언으로 해석한다', () => {
    expect(edge(g, 's:services/store.service.ts#StoreService.save', 's:lib/math.ts#double', 'call')).toBeTruthy();
    expect(edge(g, 's:lib/math.ts#double', 's:lib/math.ts#add', 'call')?.count).toBe(1);
  });

  it('DI 필드의 메서드 호출과 new 를 잇는다', () => {
    expect(edge(g, 's:services/app.service.ts#AppService.run', 's:services/store.service.ts#StoreService.save')).toBeTruthy();
    expect(edge(g, 's:services/app.service.ts#AppService.run', 's:services/app.service.ts#Helper')).toBeTruthy();
    expect(edge(g, 's:services/app.service.ts#AppService.handle', 's:services/app.service.ts#AppService.run')).toBeTruthy();
  });

  it('JSX 는 render, 훅은 hook 으로 분류한다', () => {
    expect(edge(g, 's:ui/Panel.tsx#Panel', 's:ui/Button.tsx#Button', 'render')).toBeTruthy();
    expect(edge(g, 's:ui/Panel.tsx#Panel', 's:ui/useCounter.ts#useCounter', 'call')).toBeTruthy();
    const kinds = Object.fromEntries(g.nodes.map((n) => [n.id, n.kind]));
    expect(kinds['s:ui/useCounter.ts#useCounter']).toBe('hook');
    expect(kinds['s:ui/Panel.tsx#Panel']).toBe('component');
    expect(kinds['s:ui/Button.tsx#Button']).toBe('component');
    expect(kinds['s:services/app.service.ts#AppService.run']).toBe('method');
  });

  it('호출 없이 import 만 한 것은 import 간선, 호출한 것은 import 간선을 빼다', () => {
    expect(edge(g, 'f:ui/Panel.tsx', 's:lib/math.ts#add', 'import')).toBeTruthy();
    expect(edge(g, 'f:ui/Panel.tsx', 's:ui/Button.tsx#Button', 'import')).toBeUndefined();
  });

  it('모듈 최상위 호출은 파일에서 나간다', () => {
    expect(edge(g, 'f:ui/boot.ts', 's:lib/math.ts#add', 'call')).toBeTruthy();
  });

  it('exclude 파일과 외부 패키지는 빠진다', () => {
    expect(g.nodes.some((n) => n.path === 'lib/math.spec.ts')).toBe(false);
    expect(g.nodes.some((n) => n.kind === 'external')).toBe(false);
  });

  it('기능은 먼저 적은 규칙이 이기고, 디렉터리는 다수 기능을 따른다', () => {
    const feature = Object.fromEntries(g.nodes.map((n) => [n.id, n.feature]));
    expect(feature['f:ui/useCounter.ts']).toBe('UI');
    expect(feature['s:ui/useCounter.ts#useCounter']).toBe('UI');
    expect(feature['f:lib/math.ts']).toBe('Other');
    expect(feature['d:services']).toBe('서비스');
  });
});

describe('extract 주석', () => {
  it('JSDoc 과 // 주석을 심볼 설명으로 남긴다', () => {
    const g = extract({ repo, config });
    const doc = (id: string) => g.nodes.find((n) => n.id === id)?.doc;
    expect(doc('s:lib/math.ts#add')).toBe('두 수를 더한다.\n음수도 된다.');
    expect(doc('s:lib/math.ts#double')).toBe('두 배로 만든다');
    expect(doc('s:lib/math.ts#pathOf')).toBeUndefined();
  });

  it('라이선스 · 구역 구분 · 지시 주석은 빼고, 붙어 있는 // 줄과 마지막 JSDoc 만 쓴다', () => {
    const g = extract({ repo, config });
    const doc = (id: string) => g.nodes.find((n) => n.id === id)?.doc;
    expect(doc('s:lib/docs.ts#noDoc')).toBeUndefined();
    expect(doc('s:lib/docs.ts#lineDoc')).toBe('첫 줄 설명\n둘째 줄 설명');
    expect(doc('s:lib/docs.ts#lastJsdoc')).toBe('마지막 JSDoc 이 이긴다.');
    // 본문에 copyright 가 나와도 라이선스가 아니다
    expect(doc('s:lib/docs.ts#copyrightFooter')).toBe('Renders the copyright footer');
    // 블록 주석으로 끊긴 // 는 선언에 가까운 쪽만
    expect(doc('s:lib/docs.ts#splitDoc')).toBe('아래 설명');
  });
});

describe('extract 패턴', () => {
  let g: AtlasGraph;
  beforeAll(() => {
    g = extract({ repo, config });
  });
  const has = (id: string) => g.nodes.some((n) => n.id === id);

  it('export default memo(X) 와 이름 없는 default export 로 render 간선이 이어진다', () => {
    expect(edge(g, 's:ui/Shell.tsx#Shell', 's:ui/Memo.tsx#Inner', 'render')).toBeTruthy();
    expect(edge(g, 's:ui/Shell.tsx#Shell', 's:ui/Anon.tsx#Anon', 'render')).toBeTruthy();
    expect(g.nodes.find((n) => n.id === 's:ui/Anon.tsx#Anon')?.kind).toBe('component');
  });

  it('dynamic(() => import()) 변수는 그 모듈의 default export 로 이어지고 함수로 등록되지 않는다', () => {
    expect(has('s:ui/Shell.tsx#LazyMemo')).toBe(false);
    expect(edge(g, 's:ui/Shell.tsx#Shell', 's:ui/Memo.tsx#Inner', 'render')?.count).toBe(2);
  });

  it('메서드 호출 결과 값은 함수로 등록하지 않는다', () => {
    expect(has('s:lib/api.ts#ids')).toBe(false);
  });

  it('등록되지 않은 다른 파일 선언(객체 메서드, 인터페이스)은 파일 노드로 잇는다', () => {
    expect(edge(g, 's:services/store.service.ts#StoreService.save', 'f:lib/api.ts', 'call')).toBeTruthy();
    expect(edge(g, 's:services/app.service.ts#AppService.run', 'f:services/handler.ts', 'call')).toBeTruthy();
  });

  it('파일 순서와 상관없이 dynamic → memo default export 연쇄를 원래 컴포넌트까지 푼다', () => {
    expect(edge(g, 's:ui/App.tsx#App', 's:ui/charts/Chart.tsx#ChartInner', 'render')).toBeTruthy();
  });

  it('import().then((m) => m.X) 는 default 가 아니라 X 로 잇는다', () => {
    expect(edge(g, 's:ui/App.tsx#App', 's:ui/charts/Named.tsx#Named', 'render')).toBeTruthy();
    expect(edge(g, 's:ui/App.tsx#App', 's:ui/charts/Named.tsx#Other')).toBeUndefined();
  });

  it('memo(X, areEqual) 는 비교 함수가 아니라 X 로, const Fancy = memo(X) 도 X 로 잇는다', () => {
    expect(has('s:ui/charts/Chart.tsx#Chart')).toBe(false);
    expect(edge(g, 's:ui/charts/Use.tsx#Use', 's:ui/charts/Chart.tsx#ChartInner', 'render')).toBeTruthy();
  });

  it('Object.entries(x).map(...) 결과 값은 함수로 등록하지 않는다', () => {
    expect(has('s:ui/App.tsx#OPTIONS')).toBe(false);
  });

  it('타입만 있는 파일과 콜백 속성 호출로는 간선을 만들지 않는다', () => {
    expect(g.edges.some((e) => e.target === 'f:ui/charts/types.ts')).toBe(false);
    expect(g.edges.some((e) => e.source === 's:ui/App.tsx#App' && e.target.startsWith('f:'))).toBe(false);
  });

  it('createSelector · debounce 같은 일반 호출은 첫 인자의 별칭으로 보지 않는다', () => {
    expect(edge(g, 's:ui/Selectors.tsx#Page', 's:ui/Selectors.tsx#selectA')).toBeUndefined();
  });

  it('connect(map)(Comp) 는 Comp 로 잇는다', () => {
    expect(edge(g, 's:ui/Selectors.tsx#Page', 's:ui/Selectors.tsx#Card', 'render')).toBeTruthy();
  });

  it('lazy 의 { default: m.X } 와 ({ X }) => X 형태도 X 로 잇는다', () => {
    expect(edge(g, 's:ui/Selectors.tsx#Page', 's:ui/charts/Named.tsx#Named', 'render')?.count).toBe(2);
    expect(edge(g, 's:ui/Selectors.tsx#Page', 's:ui/charts/Named.tsx#Other')).toBeUndefined();
  });

  it('주입받은 필드의 속성 시그니처 호출은 선언 파일로 잇는다', () => {
    expect(edge(g, 's:services/saver.service.ts#SaverService.run', 'f:services/repo.ts', 'call')).toBeTruthy();
  });

  it('기본 JSX 태그는 간선을 만들지 않는다', () => {
    expect(g.edges.some((e) => e.target.startsWith('x:'))).toBe(false);
  });
});

describe('extract 옵션', () => {
  it('--externals 이면 외부 패키지를 노드 하나로 묶는다', () => {
    const g = extract({ repo, config, externals: true });
    expect(edge(g, 's:lib/math.ts#pathOf', 'x:node', 'call')).toBeTruthy();
    // console.log · JSON.stringify 같은 내장 API 는 typescript 노드로 몰리지 않는다
    expect(g.nodes.some((n) => n.id === 'x:typescript')).toBe(false);
  });

  it('--scope 는 안쪽 노드와 연결된 바깥 노드만 경계로 싣는다', () => {
    const g = extract({ repo, config, scope: 'services' });
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(ids.has('s:services/app.service.ts#AppService.run')).toBe(true);
    expect(ids.has('s:lib/math.ts#double')).toBe(true);
    expect(g.nodes.find((n) => n.id === 's:lib/math.ts#double')?.boundary).toBe(true);
    expect(ids.has('f:lib/math.ts')).toBe(true);
    expect(ids.has('s:ui/Panel.tsx#Panel')).toBe(false);
    expect(g.nodes.find((n) => n.id === 'd:services')?.boundary).toBeUndefined();
    expect(g.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });

  it('scope 를 품은 상위 디렉터리는 경계로 표시하지 않는다', () => {
    const g = extract({ repo, config, scope: 'services/app.service.ts' });
    const dir = g.nodes.find((n) => n.id === 'd:services');
    expect(dir).toBeTruthy();
    expect(dir?.boundary).toBeUndefined();
    expect(g.nodes.find((n) => n.id === 'f:services/store.service.ts')?.boundary).toBe(true);
  });
});
