---
name: code-atlas
description: Draw an interactive map of one or more TypeScript/JavaScript repos — files, functions, call relations, and the HTTP/Socket.io interfaces between frontend and backend. Use when the user asks to visualize, map, diagram or understand the structure, architecture, call flow or FE↔BE interfaces of a codebase, or to find unmatched API calls or socket events.
---

# code-atlas

`code-atlas` is a CLI that runs locally and writes one self-contained HTML file. Run it straight from GitHub (no install needed):

```bash
npx -y github:frankzoey-lab/code-atlas --help
```

Every run checks GitHub for the latest commit, so it needs a network connection; the first run (and the first after a new commit) also downloads and builds it, which takes longer. If it fails with `command not found`, npm install scripts are probably disabled (`ignore-scripts`) — tell the user.

## Workflow

1. **Collect the repos.** Ask which repos to include if the user did not say. Each can be a local path or a git URL (`gh:owner/repo`, `https://…`, `git@…`, optional `#branch`). Never put tokens in URLs. The current directory is a good default for a single repo.

2. **Draft a workspace.**

   ```bash
   npx -y github:frankzoey-lab/code-atlas init --yes --lang en --dir atlas --repo <repo1> --repo <repo2>
   ```

   Read the printed summary: each repo's role (frontend / backend / library), the detected HTTP links (`from → to`, the env base and how many calls matched), Socket.io links, and per repo its file count, its config file and the drafted feature names (`web (316 files) → web.atlas.json: 3 draft feature rules (…)`). Always pass `--lang en` so the output matches the formats quoted here.

3. **Refine the feature rules — required.** init marks **every** `atlas/<repo>.atlas.json` with `"draft": true`, and the build refuses to run while any of them still has it — refine all repos before building. The draft only groups files by folder name; it often puts nested folders under the wrong rule and lumps most files into one feature. Rewrite it so the features match how the team talks about the product.

   **Where to look**
   - `docs/`: a doc's front matter often lists the paths it covers (for example `paths:`); these are the best feature boundaries when present. Topic folders under `docs/` usually name the features. When two docs list the same file, decide which feature owns it and put that rule first.
   - `README`, `CLAUDE.md` / `AGENTS.md`, and the folder tree.
   - Without path hints in the docs:
     - Backend: one module (for NestJS, a folder under `src/modules/` with its `*.module.ts` and `@Controller` route prefix) is the unit. Group modules by the product or domain they serve; `CLAUDE.md` / `AGENTS.md` usually name the products.
     - Frontend: route folders under `app/` or `pages/` and the matching `components/<area>/` folders are the units.
   - Very broad paths such as `app/**`, `store/**`, `components/**` or `src/common/**` belong in a catch-all feature (for example "App shell" or "Core") placed **last**, so narrower rules claim their files first.
   - The repo is read-only input: never edit files in it (git URLs are cloned under `~/.cache/code-atlas/repos/`).

   **Config format** (`atlas/<repo>.atlas.json`)
   ```json
   {
     "exclude": ["…the defaults init wrote…", "test/**", "scripts/**"],
     "groups": [{ "name": "Assistant", "color": "#7a4bc2", "description": "One line" }],
     "features": [
       { "name": "Chat", "group": "Assistant", "include": ["src/chat/**"], "description": "One line" },
       { "name": "Billing", "color": "#d9480f", "include": ["src/billing/**"], "description": "One line" }
     ]
   }
   ```
   - `include` / `exclude` are [picomatch](https://github.com/micromatch/picomatch) globs relative to the repo root, matched against the TS/JS source files the repo's tsconfig includes. Special characters in Next.js folder names:
     - `app/(marketing)/**` does **not** match the folder `(marketing)` — parentheses are glob groups. Write `app/[(]marketing[)]/**`.
     - `app/[id]/**` happens to match `[id]` but also one-letter folders `i` and `d`. Write `app/[[]id]/**` (and `[[][[]...slug]]` for `[[...slug]]`).
   - **The first matching rule wins** — put narrower folders before broader ones (`components/universe/genie/**` before `components/universe/**`).
   - `exclude` already holds init's defaults (tests, stories, mocks, build output) — keep them and append non-product paths (scripts, archives, seeds, deploy config) instead of giving those a feature. Check this first when the repo's tsconfig has no `include` (or there is no tsconfig): then every TS/JS file in the repo is read, archives and seed scripts included. init's file count includes them; the build's count drops once they are excluded.
   - Several rules may share a `name` (to split long include lists); they count as one feature.
   - Colors: a feature in a group may omit `color` and gets a shade of the group color; giving one overrides it. A feature with neither a group nor a valid `color` is drawn in the grey of **Other**, so give it a color.
   - Folders are colored by most of their files; only files are matched.

   **Targets** (the build prints the numbers, see step 4)
   - 5–12 features per repo; no feature above about a third of the files; **Other** under about 10%.
   - A feature with fewer than about 5 files is fine only if the team treats it as its own product area (it has its own doc, module or route); otherwise merge it into its neighbour.
   - When targets conflict, in this order: match how the team names things (docs, modules) → no feature above a third → Other under 10% → group under half → 5–12 features. Going a little over 12 is better than merging unrelated product areas.
   - With six or more features, use 2–5 `groups`, and keep any one group under about half of the files — split a group that grows larger.

   Then delete `"draft": true`. Only pass `--allow-draft` if the user explicitly wants the raw draft.

   If a frontend calls a backend through something other than `process.env.X` (for example `this.baseUrl` in an API client class), add it to `http` in `atlas/atlas.workspace.json` with `files` to scope it.

4. **Build, check, repeat.**

   ```bash
   npx -y github:frankzoey-lab/code-atlas atlas/atlas.workspace.json --lang en
   ```

   This writes `atlas/atlas.html` (next to the workspace file; `--out` changes it). Read the output:
   - `Features of <repo> (N files): [Group total (%): Feature n, …], …, Other n (%); largest feature <name> <%>` — one line per repo; compare with the targets above.
   - Lines containing `Warning:` — fix all of them. The usual ones: `feature "…" matches 0 files` (a rule order or glob problem), `no source files found` (wrong tsconfig or exclude), and `cannot statically resolve the @Controller path` (that controller's routes are skipped; mention it to the user).
   - A refusal starting `These configs are still init drafts` lists the configs that still have `"draft": true`.
   - With `--classify`, the counts are from the path rules before Jev runs, so the map can show fewer Other files.

   Fix the rules and rebuild until the numbers meet the targets and there are no warnings. Then build once more with `--open` to show the user.

   For a single repo without init: `npx -y github:frankzoey-lab/code-atlas <path> --out atlas.html --open` (it has no feature rules unless you pass `--config`).

5. **Report back.** Tell the user where the HTML is, how to use it (Focus tab: pick a file or function in the tree; Full map tab: turn features on), and summarize the `Unmatched:` lines — calls with no matching route and socket events that are only emitted or only listened to are often real bugs or dead code.

## Options worth knowing

- `--scope sub/dir`: only that folder plus what connects to it (for very large repos).
- `--no-editor-links`: omit local absolute paths — use it when the HTML will be shared.
- `--classify`: classify files that match no feature rule with TypeSafe Jev. Only use it when the user asks for it and `TYPESAFE_API_KEY` is already set; it sends file paths and symbol names (and source only with `classify.includeSource`) to an external API. Never ask the user to paste the key into the chat.
- `--lang ko` for Korean messages.

## Limits to mention when relevant

- TypeScript / JavaScript only; HTTP routes come from NestJS decorators.
- Calls through untyped values are not drawn; injected interfaces link to the interface file.
