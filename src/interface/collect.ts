import { CallExpression, ClassDeclaration, MethodDeclaration, Node, ObjectLiteralExpression, SourceFile, SyntaxKind, ts } from 'ts-morph';
import { ownerAt } from '../extract/calls.js';
import { fileId, SymbolIndex } from '../extract/symbols.js';
import { evalUrl, routeSegments, toPath, UrlPart, urlAlternatives } from './url.js';
import { t } from '../i18n.js';

export interface HttpCall {
  owner: string;
  rel: string;
  method: string;
  base: string;
  segments: string[];
  path: string;
  line: number;
}

export interface Route {
  handler: string;
  method: string;
  segments: string[];
  path: string;
}

export interface SocketUse {
  owner: string;
  event: string;
  dir: 'emit' | 'listen';
}

export interface RepoInterfaces {
  calls: HttpCall[];
  routes: Route[];
  sockets: SocketUse[];
  /** 정적으로 풀지 못해 건너뛴 것 (CLI 에 경고로 보여 준다) */
  warnings: string[];
}

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request']);
/** 수신 객체 이름에 이것이 들어 있을 때만 `.get()` 등을 HTTP 호출로 본다 (`map.get(k)` 제외) */
const HTTP_RECEIVER = /(axios|http|client|api|instance|fetcher|request|\bky\b)/i;
const ROUTE_DECORATORS: Record<string, string> = {
  Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', Head: 'HEAD', Options: 'OPTIONS', All: 'ALL',
};
const SOCKET_RECEIVER = /\b(socket|server|client|io|nsp|namespace)\b/i;
/** socket.io 서버 엔진 · 클라이언트 Manager 의 이벤트는 앱 이벤트가 아니다 */
const SOCKET_INTERNAL_RECEIVER = /\.engine$|\b(socket|client)\b\??\.io(\.|$)/;
/** Nest 마이크로서비스 ClientProxy · EventEmitter 는 socket.io 가 아니다 */
const NOT_SOCKET_TYPE = /ClientProxy|EventEmitter/;
const SOCKET_RESERVED = new Set([
  'connect', 'connection', 'connect_error', 'connection_error', 'disconnect', 'disconnecting', 'error',
  'reconnect', 'reconnect_attempt', 'reconnect_error', 'reconnect_failed', 'ping', 'newListener',
  'open', 'close', 'packet', 'initial_headers', 'headers',
]);
/** 이름만으로 알아보는 socket 래퍼 (그 밖의 래퍼는 아래 자동 탐지) */
const KNOWN_WRAPPERS: Record<string, 'emit' | 'listen'> = { sendEvent: 'emit', sendVolatileEvent: 'emit', receiveEvent: 'listen' };

type Wrapper = { index: number; dir: 'emit' | 'listen' };

/**
 * 한 repo 에서 HTTP 호출 지점 · 서버 라우트 · socket.io 이벤트 사용을 모은다.
 * `isBase` 는 URL 앞 식의 텍스트가 백엔드 주소인지 판정한다 (`process.env.X` 는 항상 base).
 */
export function collectInterfaces(
  files: { sf: SourceFile; rel: string }[],
  index: SymbolIndex,
  isBase: (text: string, rel: string) => boolean,
): RepoInterfaces {
  const out: RepoInterfaces = { calls: [], routes: [], sockets: [], warnings: [] };
  const wrappers = findSocketWrappers(files);

  for (const { sf, rel } of files) {
    const owner = (node: Node) => ownerAt(node.compilerNode, index) ?? fileId(rel);
    const base = (text: string) => isBase(text, rel);

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const http = httpCall(call, base);
      if (http) {
        for (const urlNode of urlAlternatives(http.url)) {
          const path = toPath(joinUrl(http.prefix, evalUrl(urlNode, base)));
          if (!path?.base) continue;
          out.calls.push({
            owner: owner(call),
            rel,
            method: http.method,
            base: path.base,
            segments: path.segments,
            path: `/${path.segments.join('/')}`,
            line: call.getStartLineNumber(),
          });
        }
        continue;
      }
      const socket = socketUse(call, wrappers);
      if (socket) out.sockets.push({ owner: owner(call), event: socket.event, dir: socket.dir });
    }

    for (const cls of sf.getClasses()) collectClass(cls, rel, index, out);
  }
  return out;
}

// ---------- 라우트 · @SubscribeMessage ----------

function collectClass(cls: ClassDeclaration, rel: string, index: SymbolIndex, out: RepoInterfaces) {
  const controller = cls.getDecorator('Controller');
  const prefixes = controller ? decoratorPaths(controller.getArguments()[0]) : [''];
  if (controller && !prefixes) {
    out.warnings.push(t('warn.controllerPath', { rel, cls: cls.getName() ?? 'default' }));
  }
  for (const method of methodsWithInherited(cls)) {
    const handler = index.ownerOf.get(method.compilerNode);
    if (!handler) continue;
    for (const dec of method.getDecorators()) {
      const name = dec.getName();
      if (name === 'SubscribeMessage') {
        const event = literal(dec.getArguments()[0]);
        if (event) out.sockets.push({ owner: handler, event, dir: 'listen' });
        continue;
      }
      const verb = ROUTE_DECORATORS[name];
      if (!verb || !controller || !prefixes) continue;
      const subs = decoratorPaths(dec.getArguments()[0]);
      if (!subs) {
        out.warnings.push(t('warn.routePath', { rel, cls: cls.getName() ?? 'default', method: method.getName(), decorator: name }));
        continue;
      }
      // :a?/:b? 처럼 변형이 같은 경로로 겹치면 한 번만 넣는다 (같은 라우트끼리 모호 판정이 나지 않게)
      const seen = new Set<string>();
      for (const prefix of prefixes) {
        for (const sub of subs) {
          for (const variant of optionalVariants(`${prefix}/${sub}`)) {
            const segments = routeSegments(variant);
            const path = `/${segments.join('/')}`;
            if (seen.has(path)) continue;
            seen.add(path);
            out.routes.push({ handler, method: verb, segments, path });
          }
        }
      }
    }
  }
}

/** 부모 클래스(추상 base controller)에 선언된 라우트 메서드도 이 컨트롤러 아래로 */
function methodsWithInherited(cls: ClassDeclaration): MethodDeclaration[] {
  const seen = new Set<string>();
  const out: MethodDeclaration[] = [];
  for (let cur: ClassDeclaration | undefined = cls; cur; cur = cur.getBaseClass()) {
    for (const m of cur.getMethods()) {
      if (seen.has(m.getName())) continue;
      seen.add(m.getName());
      out.push(m);
    }
  }
  return out;
}

/** `:id?` 는 있는 경로와 없는 경로 둘 다 */
function optionalVariants(path: string): string[] {
  const parts = path.split('/');
  const i = parts.findIndex((p) => p.startsWith(':') && p.endsWith('?'));
  if (i < 0) return [path];
  const withIt = [...parts.slice(0, i), parts[i].slice(0, -1), ...parts.slice(i + 1)].join('/');
  const without = [...parts.slice(0, i), ...parts.slice(i + 1)].join('/');
  return [...optionalVariants(withIt), ...optionalVariants(without)];
}

/** 인자 없음 → [''], 문자열 · 배열 · { path } → 경로들, 풀 수 없으면 undefined */
function decoratorPaths(arg: Node | undefined): string[] | undefined {
  if (!arg) return [''];
  if (Node.isObjectLiteralExpression(arg)) {
    const path = prop(arg, 'path');
    return path ? decoratorPaths(path) : [''];
  }
  if (Node.isArrayLiteralExpression(arg)) {
    const paths = arg.getElements().map((e) => literal(e));
    return paths.every((p): p is string => p !== undefined) ? paths : undefined;
  }
  const one = literal(arg);
  return one === undefined ? undefined : [one];
}

// ---------- HTTP ----------

function httpCall(
  call: CallExpression,
  isBase: (text: string) => boolean,
): { url: Node; method: string; prefix: UrlPart[] } | undefined {
  const callee = call.getExpression();
  const args = call.getArguments();
  if (Node.isPropertyAccessExpression(callee)) {
    const verb = callee.getName();
    const receiver = callee.getExpression();
    if (!VERBS.has(verb) || !args[0] || !HTTP_RECEIVER.test(receiver.getText())) return undefined;
    const prefix = instanceBase(receiver, isBase);
    if (verb === 'request') {
      if (!Node.isObjectLiteralExpression(args[0])) return undefined;
      const url = prop(args[0], 'url');
      return url ? { url, method: methodOf(args[0]) ?? 'GET', prefix } : undefined;
    }
    return { url: args[0], method: verb.toUpperCase(), prefix };
  }
  if (!Node.isIdentifier(callee) || !args[0]) return undefined;
  const name = callee.getText();
  if (name === 'axios') {
    if (Node.isObjectLiteralExpression(args[0])) {
      const url = prop(args[0], 'url');
      return url ? { url, method: methodOf(args[0]) ?? 'GET', prefix: [] } : undefined;
    }
    const config = objectOf(args[1]);
    return { url: args[0], method: (config && methodOf(config)) ?? 'GET', prefix: [] };
  }
  if (name === 'fetch') {
    const init = objectOf(args[1]);
    return { url: args[0], method: (init && methodOf(init)) ?? 'GET', prefix: [] };
  }
  return undefined;
}

/**
 * `axios.create({ baseURL })` 로 만든 인스턴스면 그 baseURL. 다른 파일에서 import 한 인스턴스와
 * `export default axios.create(…)` 도 따라간다
 */
function instanceBase(receiver: Node, isBase: (text: string) => boolean): UrlPart[] {
  let symbol = receiver.getSymbol();
  if (symbol?.isAlias()) symbol = symbol.getAliasedSymbol() ?? symbol;
  for (const decl of symbol?.getDeclarations() ?? []) {
    const init =
      Node.isVariableDeclaration(decl) || Node.isPropertyDeclaration(decl)
        ? decl.getInitializer()
        : Node.isExportAssignment(decl)
          ? decl.getExpression()
          : undefined;
    if (!init || !Node.isCallExpression(init) || !/\.create$/.test(init.getExpression().getText())) continue;
    const config = objectOf(init.getArguments()[0]);
    const baseURL = config && prop(config, 'baseURL');
    return baseURL ? evalUrl(baseURL, isBase) : [];
  }
  return [];
}

/** axios 처럼 baseURL 과 url 사이에 `/` 를 넣어 잇는다. url 에 이미 base 가 있으면 baseURL 은 쓰지 않는다 */
function joinUrl(prefix: UrlPart[], url: UrlPart[]): UrlPart[] {
  if (!prefix.length || url.some((p) => p.kind === 'base')) return url;
  return [...prefix, { kind: 'lit', text: '/' }, ...url];
}

// ---------- Socket.io ----------

/**
 * event 이름을 매개변수로 받아 그대로 emit · on 에 넘기는 함수(예: emitAsMaster(event, payload))를 찾는다.
 * 래퍼의 래퍼도 잡도록 두 번 돈다.
 */
function findSocketWrappers(files: { sf: SourceFile }[]): Map<ts.Node, Wrapper> {
  const wrappers = new Map<ts.Node, Wrapper>();
  for (let pass = 0; pass < 2; pass++) {
    for (const { sf } of files) {
      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const dir = socketDirection(call, wrappers);
        const arg = dir && call.getArguments()[dir.index];
        if (!dir || !arg || !Node.isIdentifier(arg)) continue;
        const param = arg.getSymbol()?.getDeclarations()[0];
        if (!param || !Node.isParameterDeclaration(param)) continue;
        const fn = param.getParent();
        const key = wrapperKey(fn);
        if (!key || !('getParameters' in fn)) continue;
        const index = (fn as unknown as { getParameters(): Node[] }).getParameters().indexOf(param);
        if (index >= 0 && !wrappers.has(key.compilerNode)) wrappers.set(key.compilerNode, { index, dir: dir.dir });
      }
    }
  }
  return wrappers;
}

/** 함수 선언 · 메서드는 그 자체, 화살표 · 함수식은 그것을 담은 변수 · 속성 선언이 호출 대상의 선언이다 */
function wrapperKey(fn: Node): Node | undefined {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) return fn;
  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
    const parent = fn.getParent();
    if (parent && (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent) || Node.isPropertyDeclaration(parent))) return parent;
  }
  return undefined;
}

/** 이 호출이 socket 보내기 · 받기라면 방향과 이벤트 인자 위치 */
function socketDirection(call: CallExpression, wrappers: Map<ts.Node, Wrapper>): Wrapper | undefined {
  const callee = call.getExpression();
  const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : Node.isIdentifier(callee) ? callee.getText() : '';
  if (KNOWN_WRAPPERS[name]) return { index: 0, dir: KNOWN_WRAPPERS[name] };
  let symbol = callee.getSymbol();
  // 다른 파일에서 import 한 래퍼는 원래 선언까지 따라간다
  if (symbol?.isAlias()) symbol = symbol.getAliasedSymbol() ?? symbol;
  for (const decl of symbol?.getDeclarations() ?? []) {
    const w = wrappers.get(decl.compilerNode);
    if (w) return w;
  }
  if (!Node.isPropertyAccessExpression(callee) || !['emit', 'on', 'once'].includes(name)) return undefined;
  const receiver = callee.getExpression();
  const text = receiver.getText();
  if (!SOCKET_RECEIVER.test(text) || SOCKET_INTERNAL_RECEIVER.test(text) || NOT_SOCKET_TYPE.test(receiverType(receiver))) return undefined;
  return { index: 0, dir: name === 'emit' ? 'emit' : 'listen' };
}

function receiverType(receiver: Node): string {
  const decl = receiver.getSymbol()?.getDeclarations()[0];
  const declared = decl && 'getTypeNode' in decl ? (decl as unknown as { getTypeNode(): Node | undefined }).getTypeNode()?.getText() : '';
  return `${declared ?? ''} ${receiver.getType().getText()}`;
}

function socketUse(call: CallExpression, wrappers: Map<ts.Node, Wrapper>): { event: string; dir: 'emit' | 'listen' } | undefined {
  const dir = socketDirection(call, wrappers);
  if (!dir) return undefined;
  const event = literal(call.getArguments()[dir.index]);
  return event && !SOCKET_RESERVED.has(event) ? { event, dir: dir.dir } : undefined;
}

// ---------- 공용 ----------

/** 문자열(상수 · enum 따라가기 포함)로 완전히 풀리는 값만 */
function literal(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const parts = evalUrl(node, () => false);
  return parts.every((p) => p.kind === 'lit') ? parts.map((p) => (p as { text: string }).text).join('') : undefined;
}

function prop(obj: ObjectLiteralExpression, name: string): Node | undefined {
  const p = obj.getProperty(name);
  if (p && Node.isPropertyAssignment(p)) return p.getInitializer();
  if (p && Node.isShorthandPropertyAssignment(p)) return p.getNameNode();
  return undefined;
}

/** 객체 리터럴이거나, 객체 리터럴로 초기화한 const 변수 */
function objectOf(node: Node | undefined): ObjectLiteralExpression | undefined {
  if (!node) return undefined;
  if (Node.isObjectLiteralExpression(node)) return node;
  const decl = node.getSymbol()?.getDeclarations()[0];
  const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
  return init && Node.isObjectLiteralExpression(init) ? init : undefined;
}

function methodOf(obj: ObjectLiteralExpression): string | undefined {
  return literal(prop(obj, 'method'))?.toUpperCase();
}
