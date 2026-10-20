# Changelog

## 0.1.0

First public release.

- Extract files, functions, components, hooks, classes and methods with call · render · import edges (ts-morph type checker, path aliases, barrel re-exports, NestJS DI).
- Multi-repo workspaces with HTTP (axios · fetch ↔ NestJS routes) and Socket.io interfaces, unmatched-interface report.
- `code-atlas init`: import local paths or git URLs, auto-detect frontend/backend links and draft feature rules.
- Viewer: focus view (callers ← item → callees), full map, feature colors, doc-comment tooltips, open in VS Code · Cursor · WebStorm · IntelliJ · Zed, English · Korean, light · dark.
- Optional TypeSafe Jev classification for files that match no feature rule (`--classify`).
- Claude Code plugin with a `code-atlas` skill.
