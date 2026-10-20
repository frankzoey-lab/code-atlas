# code-atlas

[한국어](README.ko.md)

Draw the files, functions and call relations of TypeScript / JavaScript repos as one interactive HTML map — including the HTTP and Socket.io interfaces between a frontend and a backend.

- **Focus view**: pick a file or function and see who calls it (left) and what it calls (right), one or two hops out, across repos (`useSendMessage → POST /messages → MessagesController.create`).
- **Full map**: every folder, file and function in boxes, colored by feature.
- **Interfaces**: frontend `axios` / `fetch` calls matched to NestJS routes, Socket.io emits matched to listeners, and a list of the ones that match nothing.
- **Open in your editor** (VS Code, Cursor, WebStorm, IntelliJ, Zed), doc-comment tooltips, English / Korean, light / dark.

It runs locally. Your code is never uploaded anywhere (see [Jev](#optional-classify-unmatched-files-with-jev) for the one opt-in exception).

## Quick start

Run it straight from GitHub. npx checks GitHub for the latest commit on every run, so it needs a network connection; the first run, and the first run after a new commit, also downloads and builds it, which takes a little longer:

```bash
# import one or more repos (local paths or git URLs) and draft a workspace
npx -y github:frankzoey-lab/code-atlas init

# build and open the map
npx -y github:frankzoey-lab/code-atlas atlas/atlas.workspace.json --open
```

If npm install scripts are turned off (`ignore-scripts`), the build step does not run and `code-atlas` is not found — turn them back on for this command:

```bash
# macOS / Linux
npm_config_ignore_scripts=false npx -y github:frankzoey-lab/code-atlas --version
```

```powershell
# Windows PowerShell
$env:npm_config_ignore_scripts="false"; npx -y github:frankzoey-lab/code-atlas --version
```

A single repo works too:

```bash
npx -y github:frankzoey-lab/code-atlas ./my-app --open
```

`init` asks for repos one per line, or takes them as flags:

```bash
npx -y github:frankzoey-lab/code-atlas init --repo ./web --repo git@github.com:acme/api.git#main --yes
```

- Local paths are used as they are. Git URLs (`gh:owner/repo`, `https://…`, `git@…`, optional `#branch`) are shallow-cloned into `~/.cache/code-atlas` and refreshed on every build (`--no-fetch` to skip). Private repos use your own git credentials (ssh keys or a credential helper — URLs with a password or token in them are refused). For ssh, make sure the host key is already trusted, since prompts are not shown.
- It detects which repos are frontends and backends, links each `process.env.*` API base to the backend whose routes it matches, links Socket.io client and server, and drafts feature rules from `docs/` folders or your source folders.
- It writes `atlas/atlas.workspace.json` and one `atlas/<repo>.atlas.json` per repo. The feature rules are only a folder-name draft, marked `"draft": true`, and the build refuses to run until that line is gone. Refine them with the [Claude Code plugin](#claude-code-plugin) (or by hand), then delete it. `--allow-draft` builds from the draft anyway.

## Configuration

### Per repo (`<repo>.atlas.json`)

```json
{
  "tsconfig": "tsconfig.json",
  "exclude": ["**/*.spec.ts"],
  "groups": [{ "name": "Assistant", "color": "#7a4bc2", "description": "Everything around the AI assistant" }],
  "features": [
    { "name": "Chat", "group": "Assistant", "include": ["src/chat/**", "src/lib/chat*.ts"], "description": "AI chat UI and its API client" },
    { "name": "Voice", "group": "Assistant", "include": ["src/voice/**"] },
    { "name": "Billing", "color": "#d9480f", "include": ["src/billing/**"] }
  ]
}
```

- `include` globs are relative to the repo. The first matching rule wins; files that match nothing are **Other**.
- `group` (optional) puts features under a group in the viewer's legend, where a group checkbox turns all of them on or off. A feature without its own `color` gets a shade of its group's color.
- Folders take the color of most of their files.
- Without a `tsconfig.json`, every `.ts/.tsx/.js/.jsx` file is opened with default options.

### Workspace (`atlas.workspace.json`)

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

- `http.base`: the expression the URL starts with — an env var name or source text such as `this.baseUrl`. Without `to`, calls are shown as an external service named `label`.
- URLs are resolved statically through template strings, `+`, constants, object constants, enums, imports, getters, `axios.create({ baseURL })` instances and both branches of a ternary.
- Routes come from NestJS `@Controller` + `@Get/@Post/…` (including inherited and optional `:id?` segments). Literal segments win over params (`/users/me` before `/users/:id`).
- Socket events come from `socket.emit/on`, `@SubscribeMessage`, and wrapper functions that pass an event-name parameter through.

## Commands

Below, `code-atlas` stands for `npx -y github:frankzoey-lab/code-atlas`.

```text
code-atlas init [--repo <path|git-url[#branch]>]... [--yes] [--dir atlas]
code-atlas <workspace.json | repo-path> [--out atlas.html] [--open] [--classify]
code-atlas extract <repo> [--config c.json] [--scope sub/dir] [--externals] --out graph.json
code-atlas render <graph.json> --out atlas.html
```

- `--scope sub/dir`: only that folder plus what it connects to.
- `--externals`: show calls into npm packages as package nodes.
- `--allow-draft`: build even if a config still has `"draft": true`.
- `--no-editor-links`: leave out your local paths (use this before sharing the HTML file).
- `--lang en|ko`: message language (defaults to `LANG`). The viewer follows the browser language and has a switch.

## Claude Code plugin

```text
/plugin marketplace add frankzoey-lab/code-atlas
/plugin install code-atlas@code-atlas
```

Then ask Claude Code something like "draw the structure of these repos". The skill runs `init`, reads your docs and folders to refine the feature rules, builds the map and summarizes unmatched interfaces.

## Optional: classify unmatched files with Jev

`--classify` sends files that match no feature rule to [TypeSafe Jev](https://docs.typesafe.ai/introduction) (a classification model) and recolors them when it is confident enough.

```bash
export TYPESAFE_API_KEY=...
npx -y github:frankzoey-lab/code-atlas atlas/atlas.workspace.json --classify
```

- Sent per file: its path, the names of its functions / components / classes, and the paths and features of the files it depends on. Source code is sent only with `"classify": { "includeSource": true }` — exclude files that may contain secrets first.
- Settings: `"classify": { "model": "jev-latest", "minConfidence": 0.6 }`. Answers are cached in `.atlas-cache/jev.json` next to the output.

## Limits

- TypeScript / JavaScript only. HTTP routes are read from NestJS decorators; `setGlobalPrefix`, URI versioning and Socket.io namespaces are not applied.
- Calls through values the type checker cannot resolve (`any`, dynamic property access) are not drawn. Interface methods reached through injected fields link to the interface's file, not to the implementation.
- The viewer loads Cytoscape.js from jsDelivr and fonts from Google Fonts, so opening the HTML needs a network connection.

## Development

```bash
npm install
npm test
npm run typecheck
npm run atlas -- examples/next-nest/atlas.workspace.json --open
```

## License

[MIT](LICENSE)
