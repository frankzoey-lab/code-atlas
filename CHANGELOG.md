# Changelog

## Unreleased

- Analysis tab: duplicate functions (structural fingerprints; identical sets and similar pairs, across repos), call cycles (mutual recursion) and import cycles, filterable by kind, similarity, feature and name. `--verify-duplicates` asks Jev whether the top candidates do the same job (sends function bodies). `--no-analysis` turns it off; settings under `analysis`.
- Feature rules with the same name are merged into one feature (first group / color / description wins; matching order is unchanged).
- The build prints each repo's feature distribution (`Features of <repo> (N files): [Group n (%): Feature n, …], Other n (%)`) so the rules can be checked without opening the map.
- SKILL.md: config format, glob syntax (picomatch, `[[]` for brackets), where to find feature boundaries (doc front matter `paths:`), targets for features, groups and Other, and a build → check → repeat loop.
- `init` marks the drafted configs with `"draft": true`; the build refuses to run until the rules are refined and the line is deleted (`--allow-draft` to override). The build also warns about features that match 0 files.
- Feature groups: `"group"` on a feature and optional `"groups"` with color and description. The viewer legend becomes a repo › group › feature tree with group checkboxes, expand / collapse all, and the All on / All off buttons above it.
- Adding groups changes the feature descriptions sent to Jev, so the Jev cache of that repo is rebuilt on the next `--classify` run.
- Run straight from GitHub with `npx -y github:frankzoey-lab/code-atlas` (built by the `prepare` script).
- When publishing to npm, bring back the shorter `npx code-atlas …` in README.md, README.ko.md and skills/code-atlas/SKILL.md.

## 0.1.0

First public release.

- Extract files, functions, components, hooks, classes and methods with call · render · import edges (ts-morph type checker, path aliases, barrel re-exports, NestJS DI).
- Multi-repo workspaces with HTTP (axios · fetch ↔ NestJS routes) and Socket.io interfaces, unmatched-interface report.
- `code-atlas init`: import local paths or git URLs, auto-detect frontend/backend links and draft feature rules.
- Viewer: focus view (callers ← item → callees), full map, feature colors, doc-comment tooltips, open in VS Code · Cursor · WebStorm · IntelliJ · Zed, English · Korean, light · dark.
- Optional TypeSafe Jev classification for files that match no feature rule (`--classify`).
- Claude Code plugin with a `code-atlas` skill.
