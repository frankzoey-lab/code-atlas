---
name: code-atlas
description: Draw an interactive map of one or more TypeScript/JavaScript repos — files, functions, call relations, and the HTTP/Socket.io interfaces between frontend and backend. Use when the user asks to visualize, map, diagram or understand the structure, architecture, call flow or FE↔BE interfaces of a codebase, or to find unmatched API calls or socket events.
---

# code-atlas

`code-atlas` is a CLI that runs locally and writes one self-contained HTML file. Run it straight from GitHub (no install needed):

```bash
npx -y github:frankzoey-lab/code-atlas --help
```

Below, `ATLAS` means `npx -y github:frankzoey-lab/code-atlas`. The first run downloads and builds it (about a minute); later runs use the npx cache.

## Workflow

1. **Collect the repos.** Ask which repos to include if the user did not say. Each can be a local path or a git URL (`gh:owner/repo`, `https://…`, `git@…`, optional `#branch`). Never put tokens in URLs. The current directory is a good default for a single repo.

2. **Draft a workspace.**

   ```bash
   ATLAS init --yes --dir atlas --repo <repo1> --repo <repo2>
   ```

   Read the printed summary: each repo's role (frontend / backend / library), the detected HTTP links (`from → to`, the env base and how many calls matched), Socket.io links, and how many feature rules were drafted.

3. **Refine the feature rules.** Open each `atlas/<repo>.atlas.json`. The draft groups files by folder. Improve it so the features match how the team talks about the product:
   - Look at `docs/`, `README`, `CLAUDE.md` / `AGENTS.md` and the top-level folders.
   - Each feature: `name`, `color` (hex), `include` (globs relative to that repo; first match wins), and a one-line `description`.
   - Keep 5–12 features per repo; leave shared utilities to fall into **Other**.
   - If a frontend calls a backend through something other than `process.env.X` (for example `this.baseUrl` in an API client class), add it to `http` in `atlas/atlas.workspace.json` with `files` to scope it.

4. **Build and open.**

   ```bash
   ATLAS atlas/atlas.workspace.json --out atlas/atlas.html --open
   ```

   For a single repo without init: `ATLAS <path> --out atlas.html --open`.

5. **Report back.** Tell the user where the HTML is, how to use it (Focus tab: pick a file or function in the tree; Full map tab: turn features on), and summarize the `Unmatched:` lines — calls with no matching route and socket events that are only emitted or only listened to are often real bugs or dead code.

## Options worth knowing

- `--scope sub/dir`: only that folder plus what connects to it (for very large repos).
- `--no-editor-links`: omit local absolute paths — use it when the HTML will be shared.
- `--classify`: classify files that match no feature rule with TypeSafe Jev. Only use it when the user asks for it and `TYPESAFE_API_KEY` is already set; it sends file paths and symbol names (and source only with `classify.includeSource`) to an external API. Never ask the user to paste the key into the chat.
- `--lang ko` for Korean messages.

## Limits to mention when relevant

- TypeScript / JavaScript only; HTTP routes come from NestJS decorators.
- Calls through untyped values are not drawn; injected interfaces link to the interface file.
