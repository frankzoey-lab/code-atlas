/** CLI · 라이브러리 메시지 (영어 기본, 한국어). 뷰어는 viewer/index.html 의 I18N 을 쓴다 */

export type Lang = 'en' | 'ko';
export type Params = Record<string, string | number>;
/** 그래프에 남겨 뷰어가 언어에 맞게 번역하는 메시지 */
export interface Msg {
  code: string;
  params?: Params;
}

const en = {
  'cli.usage': `code-atlas — draw files, functions and their call relations of TypeScript repos

Usage:
  code-atlas init [--repo <path|gh:owner/repo|git-url[#branch]>]... [--yes] [--dir atlas]
      Import one or more repos (local paths or git URLs) and draft a workspace.
  code-atlas <workspace.json | repo-path> [--out atlas.html] [--open] [--classify]
      Build the HTML atlas. A .json path is a workspace, a folder is a single repo.

  code-atlas extract <repo> [--config c.json] [--scope sub/dir] [--externals] [--classify] --out graph.json
  code-atlas render <graph.json> --out atlas.html
  code-atlas build <repo> [--config c.json] [--scope ...] [--externals] [--classify] --out atlas.html
  code-atlas workspace <workspace.json> [--classify] --out atlas.html

Options:
  --open        Open the result in your browser
  --classify    Classify files that match no feature rule with TypeSafe Jev (needs TYPESAFE_API_KEY)
  --lang en|ko  Message language (default: from LANG)
  --help, --version`,
  'cli.extracted': 'Extracted: {files} files, {symbols} symbols, {edges} edges ({secs}s)',
  'cli.scopeEmpty': 'Warning: no files under --scope {scope}. Use a path relative to the repo root.',
  'cli.workspaceExtracted':
    'Extracted {repos}: {files} files, {symbols} symbols, {edges} edges, {ifaces} interfaces ({unmatched} unmatched) ({secs}s)',
  'cli.warning': '  Warning: {text}',
  'cli.unmatched': '  Unmatched: {name} — {note}',
  'cli.wrote': '→ {path} ({mb} MB)',
  'cli.opening': 'Opening {path}',
  'cli.jevFailed': 'Cannot classify with Jev: {message}',
  'cli.jevSummary':
    'Jev{label}: classified {classified} of {candidates} unmatched files{by}, low confidence {low}, failed {failed}, cached {cached}, input tokens {tokens} ({secs}s)',
  'cli.unknownCommand': 'Unknown command or path: {arg}',
  'jev.noKey': 'TYPESAFE_API_KEY is not set. Create a key at console.typesafe.ai, export it and run again.',
  'jev.tooManyOptions': 'A Jev Choice allows at most {max} options, but there are {n} features.',
  'jev.badAnswer': 'Unknown answer (choice: {choice})',
  'jev.fileFailed': '  Jev failed for {path} — {message}',
  'jev.badCache': '  Cannot read the Jev cache, starting fresh: {path}',
  'jev.bodyUnreadable': 'Could not read the response body: {message}',
  'jev.badShape': 'Unexpected response shape (no answers.feature)',
  'jev.rejected': 'The TypeSafe API rejected the request ({status}){detail}',
  'jev.http': 'HTTP {status}',
  'jev.connectionFailed': 'connection failed',
  'warn.controllerPath': '{rel}: cannot statically resolve the @Controller path of {cls}; skipping its routes',
  'warn.routePath': '{rel}: cannot statically resolve the @{decorator} path of {cls}.{method}; skipping it',
  'warn.aliasNotConverged': 'Alias resolution (default export · dynamic import) did not settle in {passes} passes; some stay as file nodes.',
  'ws.dupRepo': 'Duplicate repo name: {name}',
  'ws.badRepoName': 'Repo names may only use letters, digits, _ and -: {name}',
  'ws.unknownHttpRepo': 'Unknown repo in an http link: {name}',
  'ws.unknownSocketRepo': 'Unknown repo in a socket link: {name}',
  'note.noRoute': 'No matching route in {repo}',
  'note.unresolvedPath': 'The path cannot be resolved statically (the whole path is a variable)',
  'note.ambiguous': 'Several routes match: {routes}',
  'note.noListener': 'Nothing in {repo} listens to it',
  'note.noEmitter': 'Nothing in {repo} emits it',
  'init.welcome': 'code-atlas init — import repos and draft a workspace.',
  'init.askRepo': 'Repo path or git URL (gh:owner/repo, https://…, git@…; add #branch). Empty line to finish: ',
  'init.cloning': '  Cloning {url}{branch} …',
  'init.updating': '  Updating {url}{branch} …',
  'init.notFound': '  Not found: {path}',
  'init.noTsconfig': '  {name}: no tsconfig.json found, using defaults',
  'init.added': '  Added {name} ({role}) — {path}',
  'init.askName': '  Name for this repo [{name}]: ',
  'init.needRepo': 'Add at least one repo.',
  'init.detecting': 'Detecting interfaces and drafting feature rules …',
  'init.httpLink': '  HTTP: {from} → {to} (base {base}, {hits} calls matched)',
  'init.httpExternal': '  HTTP: {from} calls {base} ({count} calls) — no repo matched, shown as external',
  'init.socketLink': '  Socket.io: {client} ↔ {server}',
  'init.features': '  {name}: {count} feature rules drafted',
  'init.confirm': 'Write the workspace to {dir}? [Y/n] ',
  'init.done':
    'Wrote {files}.\nEdit the feature rules in {dir}/*.atlas.json if you like, then run:\n  npx code-atlas {workspace} --open',
  'init.aborted': 'Nothing written.',
  'git.failed': 'git {args} failed: {message}',
  'git.unsafe': 'Refusing an unsafe git {what}: {value}',
  'git.credentials': 'Do not put a password or token in the git URL. Use ssh or a git credential helper instead.',
  'cli.error': 'Error: {message}',
  'cli.openFailed': 'Could not open a browser ({message}). Open the file yourself: {path}',
  'warn.noFiles': '{repo}: no source files found (tsconfig {tsconfig}). Check the tsconfig or the exclude rules.',
  'role.frontend': 'frontend',
  'role.backend': 'backend',
  'role.library': 'library',
} as const;

export type MessageCode = keyof typeof en;

const ko: Record<MessageCode, string> = {
  'cli.usage': `code-atlas — TypeScript 저장소의 파일 · 함수와 호출 관계를 그립니다

사용법:
  code-atlas init [--repo <경로|gh:owner/repo|git 주소[#브랜치]>]... [--yes] [--dir atlas]
      로컬 경로나 git 주소로 repo 를 하나 이상 가져와 workspace 초안을 만듭니다.
  code-atlas <workspace.json | repo 경로> [--out atlas.html] [--open] [--classify]
      HTML 지도를 만듭니다. .json 이면 workspace, 폴더면 repo 하나입니다.

  code-atlas extract <repo> [--config c.json] [--scope 하위경로] [--externals] [--classify] --out graph.json
  code-atlas render <graph.json> --out atlas.html
  code-atlas build <repo> [--config c.json] [--scope ...] [--externals] [--classify] --out atlas.html
  code-atlas workspace <workspace.json> [--classify] --out atlas.html

옵션:
  --open        만든 뒤 브라우저로 엽니다
  --classify    기능 규칙에 안 맞는 파일을 TypeSafe Jev 로 분류합니다 (TYPESAFE_API_KEY 필요)
  --lang en|ko  메시지 언어 (기본: LANG 환경 변수)
  --help, --version`,
  'cli.extracted': '추출: 파일 {files}, 심볼 {symbols}, 간선 {edges} ({secs}s)',
  'cli.scopeEmpty': '경고: --scope {scope} 에 해당하는 파일이 없습니다. 저장소 기준 경로인지 확인하세요.',
  'cli.workspaceExtracted':
    '추출: {repos} — 파일 {files}, 심볼 {symbols}, 간선 {edges}, 인터페이스 {ifaces}개 (짝 없음 {unmatched}) ({secs}s)',
  'cli.warning': '  경고: {text}',
  'cli.unmatched': '  짝 없음: {name} — {note}',
  'cli.wrote': '→ {path} ({mb} MB)',
  'cli.opening': '{path} 를 엽니다',
  'cli.jevFailed': 'Jev 분류를 할 수 없습니다: {message}',
  'cli.jevSummary':
    'Jev 분류{label}: 기타 {candidates}개 중 {classified}개 분류{by}, 신뢰도 낮음 {low}, 실패 {failed}, 캐시 {cached}, 입력 토큰 {tokens} ({secs}s)',
  'cli.unknownCommand': '알 수 없는 명령이나 경로입니다: {arg}',
  'jev.noKey': 'TYPESAFE_API_KEY 환경 변수가 없습니다. console.typesafe.ai 에서 키를 만들어 환경 변수로 설정한 뒤 다시 실행하세요.',
  'jev.tooManyOptions': 'Jev Choice 옵션은 최대 {max}개입니다. 기능이 {n}개입니다.',
  'jev.badAnswer': '알 수 없는 응답 (choice: {choice})',
  'jev.fileFailed': '  Jev 분류 실패: {path} — {message}',
  'jev.badCache': '  Jev 캐시를 읽을 수 없어 새로 시작합니다: {path}',
  'jev.bodyUnreadable': '응답 본문을 읽지 못했습니다: {message}',
  'jev.badShape': '응답 형식이 예상과 다릅니다 (answers.feature 없음)',
  'jev.rejected': 'TypeSafe API 가 요청을 거절했습니다 ({status}){detail}',
  'jev.http': 'HTTP {status}',
  'jev.connectionFailed': '연결 실패',
  'warn.controllerPath': '{rel}: {cls} 의 @Controller 경로를 정적으로 풀 수 없어 라우트를 건너뜁니다',
  'warn.routePath': '{rel}: {cls}.{method} 의 @{decorator} 경로를 정적으로 풀 수 없어 건너뜁니다',
  'warn.aliasNotConverged': '별칭(default export · dynamic import) 연결이 {passes}번 반복 안에 끝나지 않았습니다. 일부는 파일 노드로 남습니다.',
  'ws.dupRepo': 'repo 이름이 겹칩니다: {name}',
  'ws.badRepoName': 'repo 이름은 영문 · 숫자 · _ · - 만 씁니다: {name}',
  'ws.unknownHttpRepo': 'http 링크의 repo 이름을 찾을 수 없습니다: {name}',
  'ws.unknownSocketRepo': 'socket 링크의 repo 이름을 찾을 수 없습니다: {name}',
  'note.noRoute': '{repo} 에 맞는 라우트가 없습니다',
  'note.unresolvedPath': '경로를 정적으로 풀 수 없습니다 (경로 전체가 변수)',
  'note.ambiguous': '맞는 라우트가 여러 개입니다: {routes}',
  'note.noListener': '{repo} 에서 받는 곳이 없습니다',
  'note.noEmitter': '{repo} 에서 보내는 곳이 없습니다',
  'init.welcome': 'code-atlas init — repo 를 가져와 workspace 초안을 만듭니다.',
  'init.askRepo': 'repo 경로나 git 주소 (gh:owner/repo, https://…, git@…, 뒤에 #브랜치). 빈 줄이면 끝: ',
  'init.cloning': '  {url}{branch} 받는 중 …',
  'init.updating': '  {url}{branch} 갱신 중 …',
  'init.notFound': '  찾을 수 없습니다: {path}',
  'init.noTsconfig': '  {name}: tsconfig.json 이 없어 기본 설정으로 엽니다',
  'init.added': '  {name} 추가 ({role}) — {path}',
  'init.askName': '  이 repo 의 이름 [{name}]: ',
  'init.needRepo': 'repo 를 하나 이상 넣으세요.',
  'init.detecting': '인터페이스를 찾고 기능 규칙 초안을 만드는 중 …',
  'init.httpLink': '  HTTP: {from} → {to} (base {base}, 호출 {hits}개 매칭)',
  'init.httpExternal': '  HTTP: {from} 이 {base} 를 부릅니다 (호출 {count}개) — 맞는 repo 가 없어 바깥 서비스로 둡니다',
  'init.socketLink': '  Socket.io: {client} ↔ {server}',
  'init.features': '  {name}: 기능 규칙 {count}개 초안',
  'init.confirm': '{dir} 에 workspace 를 쓸까요? [Y/n] ',
  'init.done':
    '{files} 를 만들었습니다.\n필요하면 {dir}/*.atlas.json 의 기능 규칙을 고친 뒤 실행하세요:\n  npx code-atlas {workspace} --open',
  'init.aborted': '아무것도 쓰지 않았습니다.',
  'git.failed': 'git {args} 실패: {message}',
  'git.unsafe': '안전하지 않은 git {what} 이라 쓰지 않습니다: {value}',
  'git.credentials': 'git 주소에 비밀번호나 토큰을 넣지 마세요. ssh 나 git credential helper 를 쓰세요.',
  'cli.error': '오류: {message}',
  'cli.openFailed': '브라우저를 열 수 없습니다 ({message}). 직접 여세요: {path}',
  'warn.noFiles': '{repo}: 소스 파일을 하나도 찾지 못했습니다 (tsconfig {tsconfig}). tsconfig 나 exclude 규칙을 확인하세요.',
  'role.frontend': '프론트엔드',
  'role.backend': '백엔드',
  'role.library': '라이브러리',
};

const DICT: Record<Lang, Record<MessageCode, string>> = { en, ko };

let current: Lang = detectLang();

export function detectLang(env: NodeJS.ProcessEnv = process.env): Lang {
  const raw = env.CODE_ATLAS_LANG ?? env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG ?? '';
  return raw.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

export function t(code: MessageCode, params: Params = {}, lang: Lang = current): string {
  return DICT[lang][code].replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

/** 그래프에 담긴 메시지를 지금 언어로 */
export function tm(msg: Msg, lang: Lang = current): string {
  return msg.code in en ? t(msg.code as MessageCode, msg.params, lang) : msg.code;
}

export const MESSAGE_CODES = Object.keys(en) as MessageCode[];
export const KO_CODES = Object.keys(ko) as MessageCode[];
