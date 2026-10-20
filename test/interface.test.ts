import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { AtlasGraph } from '../src/graph.js';
import { buildWorkspace, loadWorkspace, matchRoute } from '../src/workspace.js';

const ws = loadWorkspace(resolve(import.meta.dirname, 'fixture-ws/ws.json'));
const HTTP = 'i:http:fe->be';
const SOCK = 'i:sock:fe<->be';

const edge = (g: AtlasGraph, source: string, target: string, kind?: string) =>
  g.edges.find((e) => e.source === source && e.target === target && (!kind || e.kind === kind));
const node = (g: AtlasGraph, id: string) => g.nodes.find((n) => n.id === id);

describe('workspace HTTP', () => {
  let g: AtlasGraph;
  beforeAll(() => {
    g = buildWorkspace(ws);
  });

  it('repo 노드 아래로 각 repo 그래프를 싣고 id 에 repo 이름을 붙인다', () => {
    expect(node(g, 'r:fe')?.kind).toBe('repo');
    expect(node(g, 'fe:f:api/clip.ts')?.parent).toBe('fe:d:api');
    expect(node(g, 'fe:d:api')?.parent).toBe('r:fe');
    expect(node(g, 'be:s:clip/clip.controller.ts#ClipController.read')).toBeTruthy();
  });

  it('상수 객체 · 다른 파일 import · 템플릿으로 만든 URL 을 풀고 쿼리스트링은 버린다', () => {
    expect(edge(g, 'fe:s:api/clip.ts#fetchClip', `${HTTP}:GET /clip/:param`, 'request')).toBeTruthy();
    expect(edge(g, `${HTTP}:GET /clip/:param`, 'be:s:clip/clip.controller.ts#ClipController.read', 'handles')).toBeTruthy();
  });

  it('리터럴 라우트가 param 라우트보다 먼저 맞는다', () => {
    expect(edge(g, 'fe:s:api/clip.ts#fetchTop', `${HTTP}:GET /clip/top2`)).toBeTruthy();
    expect(edge(g, `${HTTP}:GET /clip/top2`, 'be:s:clip/clip.controller.ts#ClipController.top')).toBeTruthy();
  });

  it('axios({ method }) · fetch 옵션의 method 와 @Controller({ path }) 를 읽는다', () => {
    expect(edge(g, `${HTTP}:DELETE /clip/:param`, 'be:s:clip/clip.controller.ts#ClipController.remove')).toBeTruthy();
    expect(edge(g, 'fe:s:api/clip.ts#sendChat', `${HTTP}:POST /chat/messages`)).toBeTruthy();
    expect(edge(g, `${HTTP}:POST /chat/messages`, 'be:s:chat/chat.controller.ts#ChatController.create')).toBeTruthy();
  });

  it('라우트가 없는 호출은 짝 없음, 링크에 없는 base 는 무시한다', () => {
    expect(node(g, `${HTTP}:GET /nowhere`)?.unmatched).toBe(true);
    expect(g.nodes.some((n) => n.kind === 'endpoint' && n.name.includes('share'))).toBe(false);
  });
});

describe('workspace Socket.io', () => {
  let g: AtlasGraph;
  beforeAll(() => {
    g = buildWorkspace(ws);
  });

  it('클라이언트 보내기 → @SubscribeMessage, 서버 emit → 클라이언트 receiveEvent 를 잇는다', () => {
    expect(edge(g, 'fe:s:ui/socket.ts#joinRoom', `${SOCK}:join-room`, 'emit')).toBeTruthy();
    expect(edge(g, `${SOCK}:join-room`, 'be:s:chat/chat.controller.ts#RoomGateway.join', 'listen')).toBeTruthy();
    expect(edge(g, 'be:s:chat/chat.controller.ts#RoomGateway.join', `${SOCK}:user-change`, 'emit')).toBeTruthy();
    expect(edge(g, `${SOCK}:user-change`, 'fe:s:ui/socket.ts#joinRoom', 'listen')).toBeTruthy();
    expect(node(g, `${SOCK}:join-room`)?.unmatched).toBeUndefined();
  });

  it('한쪽에만 있는 이벤트는 짝 없음과 이유를 남긴다', () => {
    expect(node(g, `${SOCK}:only-client-listens`)?.notes).toEqual([{ code: 'note.noEmitter', params: { repo: 'be' } }]);
    expect(node(g, `${SOCK}:only-server-emits`)?.notes).toEqual([{ code: 'note.noListener', params: { repo: 'fe' } }]);
  });
});

describe('workspace 정적 분석 경계', () => {
  let g: AtlasGraph;
  const more = (fn: string) => `fe:s:api/more.ts#${fn}`;
  const to = (fn: string) => g.edges.filter((e) => e.source === more(fn) && e.kind === 'request').map((e) => e.target.replace(`${HTTP}:`, ''));
  beforeAll(() => {
    g = buildWorkspace(ws);
  });

  it('axios.create({ baseURL }) 인스턴스 · axios.request · process.env 구조 분해를 base 로 푼다', () => {
    expect(to('viaInstance')).toEqual(['GET /items']);
    expect(to('viaRequest')).toEqual(['GET /items']);
    expect(to('viaDestructured')).toEqual(['GET /items/list']);
  });

  it('배열 prefix · enum 경로 · 상속 라우트를 읽고, 못 푸는 경로는 라우트로 만들지 않는다', () => {
    expect(edge(g, `${HTTP}:GET /items/list`, 'be:s:items.controller.ts#ItemsController.list')).toBeTruthy();
    expect(node(g, `${HTTP}:GET /items`)?.unmatched).toBeUndefined();
    expect(edge(g, `${HTTP}:GET /items`, 'be:s:items.controller.ts#ItemsController.all')).toBeTruthy();
    expect(edge(g, `${HTTP}:GET /inherited/base`, 'be:s:items.controller.ts#BaseController.base')).toBeTruthy();
  });

  it('경로 전체가 변수인 래퍼는 짝 없음으로 두고, 리터럴 접두가 있으면 그 접두로 맞춘다', () => {
    expect(node(g, `${HTTP}:GET /:param`)?.notes?.[0].code).toBe('note.unresolvedPath');
    expect(to('withQuery')).toEqual(['GET /items']);
  });

  it('다시 대입되는 let 은 첫 값으로 잘못 잇지 않고, 삼항식은 두 갈래를 모두 잇는다', () => {
    expect(to('reassigned')).toEqual([]);
    expect(to('ternary').sort()).toEqual(['GET /inherited/base', 'GET /items/list']);
  });

  it('fetch 의 init 이 변수여도 method 를 읽는다', () => {
    expect(to('fetchWithInit')).toEqual(['POST /chat/messages']);
  });

  it('event 를 매개변수로 넘기는 래퍼(emitAsMaster)의 호출부 리터럴을 보내기로 잡는다', () => {
    expect(edge(g, 'fe:s:ui/role.ts#syncLines', `${SOCK}:space-attribute:lines`, 'emit')).toBeTruthy();
    expect(node(g, `${SOCK}:space-attribute:lines`)?.unmatched).toBeUndefined();
    // 다른 파일에서 import 한 래퍼
    expect(edge(g, 'fe:s:ui/lines.ts#syncAngles', `${SOCK}:space-attribute:angles`, 'emit')).toBeTruthy();
  });

  it('socket.io Manager 이벤트와 ClientProxy.emit 은 socket 이벤트로 잡지 않는다', () => {
    expect(node(g, `${SOCK}:close`)).toBeUndefined();
    expect(node(g, `${SOCK}:order.created`)).toBeUndefined();
  });

  it('엔드포인트에 호출 위치를 남긴다', () => {
    expect(node(g, `${HTTP}:POST /chat/messages`)?.refs?.some((r) => r.startsWith('fe:api/clip.ts:'))).toBe(true);
  });
});

describe('workspace axios 인스턴스 · 선택 경로 · 서버 io', () => {
  let g: AtlasGraph;
  const req = (fn: string) => g.edges.filter((e) => e.source === `fe:s:api/users.ts#${fn}` && e.kind === 'request').map((e) => e.target.replace(`${HTTP}:`, ''));
  beforeAll(() => {
    g = buildWorkspace(ws);
  });

  it('다른 파일에서 import 한 인스턴스와 default export 인스턴스의 baseURL 을 붙이고, 사이에 / 를 넣는다', () => {
    expect(req('listUsers')).toEqual(['GET /v1/users']);
    expect(req('readUser')).toEqual(['GET /v1/users/:param']);
    expect(edge(g, `${HTTP}:GET /v1/users`, 'be:s:users.controller.ts#UsersController.list')).toBeTruthy();
  });

  it(':year?/:month? 변형이 겹쳐도 같은 라우트끼리 모호하다고 보지 않는다', () => {
    expect(req('archive')).toEqual(['GET /v1/archive/:param']);
    expect(node(g, `${HTTP}:GET /v1/archive/:param`)?.unmatched).toBeUndefined();
  });

  it('gateway 의 this.io.emit 은 서버 보내기로 잡는다', () => {
    expect(edge(g, 'be:s:users.controller.ts#PingGateway.ping', `${SOCK}:pong-me`, 'emit')).toBeTruthy();
    expect(node(g, `${SOCK}:pong-me`)?.unmatched).toBeUndefined();
  });
});

describe('workspace 설정 검증', () => {
  it('repo 이름 중복과 socket 링크 오타를 거절한다', () => {
    expect(() => buildWorkspace({ repos: [{ name: 'a', path: '.' }, { name: 'a', path: '.' }] })).toThrow(/Duplicate repo name|겹칩니다/);
    expect(() => buildWorkspace({ repos: [{ name: 'a', path: '.' }], socket: [{ client: 'a', server: 'b' }] })).toThrow(/socket/i);
  });
});

describe('matchRoute', () => {
  const route = (method: string, path: string) => ({
    handler: path, method, path, segments: path.split('/').filter(Boolean).map((s) => (s.startsWith(':') ? ':param' : s)),
  });
  const call = (method: string, segments: string[]) => ({ owner: 'x', rel: 'a.ts', method, base: 'B', segments, path: '', line: 1 });

  it('메서드 · 세그먼트 수가 다르면 맞추지 않는다', () => {
    expect(matchRoute(call('POST', ['clip', ':param']), [route('GET', '/clip/:uuid')]).route).toBeUndefined();
    expect(matchRoute(call('GET', ['clip']), [route('GET', '/clip/:uuid')]).route).toBeUndefined();
  });

  it('호출이 param 이면 param 라우트를 리터럴 라우트보다 우선한다', () => {
    const routes = [route('GET', '/clip/top2'), route('GET', '/clip/:uuid')];
    expect(matchRoute(call('GET', ['clip', ':param']), routes).route?.path).toBe('/clip/:uuid');
    expect(matchRoute(call('GET', ['clip', 'top2']), routes).route?.path).toBe('/clip/top2');
  });

  it('경로 전체가 변수면 맞추지 않고 이유를 남긴다', () => {
    const r = matchRoute(call('GET', [':param']), [route('GET', '/items')]);
    expect(r.route).toBeUndefined();
    expect(r.reason?.code).toBe('note.unresolvedPath');
  });

  it('리터럴 접두 세그먼트(items*)는 그 접두로 시작하는 라우트와 맞는다', () => {
    const routes = [route('GET', '/items'), route('GET', '/other')];
    expect(matchRoute(call('GET', ['items*']), routes).route?.path).toBe('/items');
  });

  it('최고점이 같은 라우트가 여럿이면 모호하다고 본다', () => {
    const r = matchRoute(call('GET', ['a', ':param']), [route('GET', '/a/x'), route('GET', '/a/y')]);
    expect(r.route).toBeUndefined();
    expect(r.reason?.code).toBe('note.ambiguous');
  });
});
