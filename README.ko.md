# code-atlas

[English](README.md)

TypeScript · JavaScript 저장소의 파일, 함수, 호출 관계를 HTML 지도 한 장으로 그립니다. 프론트엔드와 백엔드 사이의 HTTP · Socket.io 인터페이스까지 이어서 보여 줍니다.

- **포커스 보기**: 파일이나 함수 하나를 고르면 그것을 부르는 쪽(왼쪽)과 그것이 부르는 쪽(오른쪽)을 1 · 2단계까지 보여 줍니다. repo 를 건너 이어집니다(`useSendMessage → POST /messages → MessagesController.create`).
- **전체 지도**: 폴더 · 파일 · 함수를 상자로 묶어 기능별 색으로 그립니다.
- **인터페이스**: 프론트엔드의 `axios` · `fetch` 호출을 NestJS 라우트와, Socket.io 보내기를 받는 곳과 잇고, 짝이 없는 것을 따로 모읍니다.
- **에디터로 열기**(VS Code, Cursor, WebStorm, IntelliJ, Zed), 주석 툴팁, 영어 · 한국어, 라이트 · 다크.

모두 로컬에서 돌아가고 코드를 어디에도 올리지 않습니다(직접 켜는 [Jev](#선택-jev-로-기타-파일-분류) 만 예외).

## 빠르게 시작

GitHub 에서 바로 실행합니다. npx 가 실행할 때마다 GitHub 의 최신 커밋을 확인하므로 인터넷이 필요합니다. 처음 실행할 때와 새 커밋이 올라온 뒤 처음 실행할 때는 받아서 빌드하므로 조금 더 걸립니다.

```bash
# repo 를 하나 이상 가져와(로컬 경로 · git 주소) workspace 초안 만들기
npx -y github:frankzoey-lab/code-atlas init

# 지도를 만들고 브라우저로 열기
npx -y github:frankzoey-lab/code-atlas atlas/atlas.workspace.json --open
```

npm 설치 스크립트를 꺼 두었다면(`ignore-scripts`) 빌드가 돌지 않아 `code-atlas` 를 찾지 못합니다. 이 명령에서만 다시 켜 주세요.

```bash
# macOS / Linux
npm_config_ignore_scripts=false npx -y github:frankzoey-lab/code-atlas --version
```

```powershell
# Windows PowerShell
$env:npm_config_ignore_scripts="false"; npx -y github:frankzoey-lab/code-atlas --version
```

repo 하나만 볼 때:

```bash
npx -y github:frankzoey-lab/code-atlas ./my-app --open
```

`init` 은 repo 를 한 줄씩 묻습니다. 옵션으로 줄 수도 있습니다.

```bash
npx -y github:frankzoey-lab/code-atlas init --repo ./web --repo git@github.com:acme/api.git#main --yes
```

- 로컬 경로는 그대로 씁니다. git 주소(`gh:owner/repo`, `https://…`, `git@…`, 뒤에 `#브랜치`)는 `~/.cache/code-atlas` 에 얕게 받아 두고, 지도를 만들 때마다 최신으로 맞춥니다(`--no-fetch` 로 끔). 비공개 repo 는 내 git 인증(ssh 키 · credential helper)을 그대로 씁니다. 비밀번호 · 토큰이 든 주소는 받지 않습니다. ssh 는 호스트 키가 이미 등록돼 있어야 합니다(확인 질문을 띄우지 않습니다).
- 어느 repo 가 프론트엔드 · 백엔드인지 찾고, `process.env.*` API 주소마다 라우트가 가장 많이 맞는 백엔드와 잇고, Socket.io 클라이언트 · 서버를 잇고, `docs/` 폴더나 소스 폴더로 기능 규칙 초안을 만듭니다.
- `atlas/atlas.workspace.json` 과 repo 마다 `atlas/<repo>.atlas.json` 을 씁니다. 기능 규칙은 폴더 이름으로 만든 초안이라 `"draft": true` 가 붙어 있고, 이 줄이 남아 있으면 지도를 만들지 않습니다. [Claude Code 플러그인](#claude-code-플러그인)으로(또는 직접) 다듬은 뒤 지우세요. 초안 그대로 그리려면 `--allow-draft`.

## 설정

### repo 마다 (`<repo>.atlas.json`)

```json
{
  "tsconfig": "tsconfig.json",
  "exclude": ["**/*.spec.ts"],
  "groups": [{ "name": "어시스턴트", "color": "#7a4bc2", "description": "AI 어시스턴트 관련 전부" }],
  "features": [
    { "name": "채팅", "group": "어시스턴트", "include": ["src/chat/**", "src/lib/chat*.ts"], "description": "AI 채팅 화면과 API 클라이언트" },
    { "name": "음성", "group": "어시스턴트", "include": ["src/voice/**"] },
    { "name": "결제", "color": "#d9480f", "include": ["src/billing/**"] }
  ]
}
```

- `include` 는 repo 기준 glob 입니다. 먼저 적은 규칙이 이기고, 어디에도 안 맞으면 **기타** 입니다.
- `group`(선택)을 주면 뷰어 범례에서 그룹 아래로 묶이고, 그룹 체크박스로 한꺼번에 켜고 끕니다. 자기 `color` 가 없는 기능은 그룹 색의 명도 변형을 씁니다.
- 폴더 색은 안에 든 파일 중 가장 많은 기능을 따릅니다.
- `tsconfig.json` 이 없으면 `.ts/.tsx/.js/.jsx` 를 기본 설정으로 엽니다.

### workspace (`atlas.workspace.json`)

```json
{
  "repos": [
    { "name": "web", "path": "../web", "config": "web.atlas.json" },
    { "name": "api", "source": { "git": "git@github.com:acme/api.git", "branch": "main" }, "config": "api.atlas.json" }
  ],
  "http": [
    { "from": "web", "base": ["NEXT_PUBLIC_API_URL"], "to": "api" },
    { "from": "api", "base": ["this.baseUrl"], "files": ["src/clients/payments.ts"], "label": "payments" }
  ],
  "socket": [{ "client": "web", "server": "api" }]
}
```

- `http.base`: URL 이 시작하는 식. 환경 변수 이름이나 `this.baseUrl` 같은 소스 텍스트입니다. `to` 가 없으면 `label` 이름의 바깥 서비스로 보여 줍니다.
- URL 은 템플릿 문자열, `+`, 상수, 객체 상수, enum, import, getter, `axios.create({ baseURL })` 인스턴스, 삼항식 두 갈래를 따라 정적으로 풉니다.
- 라우트는 NestJS `@Controller` + `@Get/@Post/…` 에서 읽습니다(상속, `:id?` 포함). 리터럴 세그먼트가 param 보다 먼저 맞습니다(`/users/me` 가 `/users/:id` 보다 먼저).
- 소켓 이벤트는 `socket.emit/on`, `@SubscribeMessage`, 이벤트 이름을 매개변수로 넘기는 래퍼 함수에서 읽습니다.

## 명령

아래 `code-atlas` 는 `npx -y github:frankzoey-lab/code-atlas` 를 뜻합니다.

```text
code-atlas init [--repo <경로|git 주소[#브랜치]>]... [--yes] [--dir atlas]
code-atlas <workspace.json | repo 경로> [--out atlas.html] [--open] [--classify]
code-atlas extract <repo> [--config c.json] [--scope 하위경로] [--externals] --out graph.json
code-atlas render <graph.json> --out atlas.html
```

- `--scope 하위경로`: 그 폴더와 그 폴더에 닿는 것만.
- `--externals`: npm 패키지 호출을 패키지 노드로 보여 줍니다.
- `--allow-draft`: 설정에 `"draft": true` 가 남아 있어도 그립니다.
- `--no-editor-links`: 내 로컬 경로를 빼고 만듭니다(HTML 파일을 남과 나누기 전에).
- `--lang en|ko`: 메시지 언어(기본 `LANG`). 뷰어는 브라우저 언어를 따르고 전환 버튼이 있습니다.

## Claude Code 플러그인

```text
/plugin marketplace add frankzoey-lab/code-atlas
/plugin install code-atlas@code-atlas
```

그다음 Claude Code 에 "이 repo 들 구조 그려줘" 처럼 말하면, 스킬이 `init` 을 돌리고 docs · 폴더를 읽어 기능 규칙을 다듬은 뒤 지도를 만들고 짝 없는 인터페이스를 요약합니다.

## 선택: Jev 로 기타 파일 분류

`--classify` 를 주면 기능 규칙에 안 맞는 파일만 [TypeSafe Jev](https://docs.typesafe.ai/introduction)(분류 모델)에 보내, 충분히 확신할 때 그 기능 색으로 바꿉니다.

```bash
export TYPESAFE_API_KEY=...
npx -y github:frankzoey-lab/code-atlas atlas/atlas.workspace.json --classify
```

- 파일마다 보내는 것: 경로, 함수 · 컴포넌트 · 클래스 이름, 의존하는 파일의 경로와 기능. 소스는 `"classify": { "includeSource": true }` 일 때만 보냅니다. 켜기 전에 비밀이 들어 있을 수 있는 파일은 exclude 하세요.
- 설정: `"classify": { "model": "jev-latest", "minConfidence": 0.6 }`. 응답은 결과 옆 `.atlas-cache/jev.json` 에 캐시합니다.

## 한계

- TypeScript · JavaScript 만 됩니다. HTTP 라우트는 NestJS 데코레이터에서 읽고, `setGlobalPrefix` · URI 버저닝 · Socket.io namespace 는 반영하지 않습니다.
- 타입으로 풀 수 없는 호출(`any`, 동적 속성 접근)은 그리지 않습니다. 주입받은 필드를 통한 인터페이스 메서드 호출은 구현이 아니라 인터페이스 파일로 잇습니다.
- 뷰어는 jsDelivr 의 Cytoscape.js 와 Google Fonts 를 받으므로 HTML 을 열 때 인터넷이 필요합니다.

## 개발

```bash
npm install
npm test
npm run typecheck
npm run atlas -- examples/next-nest/atlas.workspace.json --open
```

## 라이선스

[MIT](LICENSE)
