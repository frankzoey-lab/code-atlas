#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { classifyGraph, ClassifyStats } from './classify/jev.js';
import { loadConfig, ResolvedConfig } from './config.js';
import { extract } from './extract/index.js';
import { ensureRepo } from './fetch-repo.js';
import { findTsconfig } from './extract/project.js';
import { AtlasGraph } from './graph.js';
import { Lang, setLang, t, tm } from './i18n.js';
import { runInit } from './init.js';
import { renderHtml } from './render.js';
import { assembleWorkspace, extractWorkspace, loadWorkspace } from './workspace.js';

const ARG_OPTIONS = {
  config: { type: 'string' },
    scope: { type: 'string' },
    externals: { type: 'boolean', default: false },
    classify: { type: 'boolean', default: false },
    out: { type: 'string' },
    open: { type: 'boolean', default: false },
    lang: { type: 'string' },
    repo: { type: 'string', multiple: true },
    dir: { type: 'string' },
    yes: { type: 'boolean', short: 'y', default: false },
    'no-fetch': { type: 'boolean', default: false },
    'no-editor-links': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
} as const;

let parsed: ReturnType<typeof parseArgs<{ allowPositionals: true; options: typeof ARG_OPTIONS }>>;
try {
  parsed = parseArgs({ allowPositionals: true, options: ARG_OPTIONS });
} catch (e) {
  // 모르는 옵션 등: 오류 한 줄과 사용법만 보여 준다
  console.error(t('cli.error', { message: (e as Error).message }));
  console.error(t('cli.usage'));
  process.exit(1);
}
const { positionals, values } = parsed;

if (values.lang === 'en' || values.lang === 'ko') setLang(values.lang as Lang);
const secs = (started: number) => ((Date.now() - started) / 1000).toFixed(1);

if (values.version) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}
if (values.help || !positionals.length) {
  console.log(t('cli.usage'));
  process.exit(values.help ? 0 : 1);
}

/** --classify 일 때 경로 규칙에 안 맞은 파일을 Jev 로 분류한다 */
async function classify(graph: AtlasGraph, config: ResolvedConfig, repo: string, out: string, label = '') {
  if (!values.classify) return;
  const started = Date.now();
  let stats: ClassifyStats;
  try {
    stats = await classifyGraph(graph, config, {
      repo,
      cacheDir: join(dirname(out), '.atlas-cache'),
      log: (line) => console.error(line),
    });
  } catch (e) {
    console.error(t('cli.jevFailed', { message: (e as Error).message }));
    process.exit(1);
  }
  const by = Object.entries(stats.byFeature).map(([f, n]) => `${f} ${n}`).join(', ');
  console.error(
    t('cli.jevSummary', {
      label, classified: stats.classified, candidates: stats.candidates, by: by ? ` (${by})` : '',
      low: stats.lowConfidence, failed: stats.failed, cached: stats.cacheHits, tokens: stats.inputTokens, secs: secs(started),
    }),
  );
}

/** `./src/x/`, `src\\x` → `src/x` */
function normalizeScope(scope?: string): string | undefined {
  const s = scope?.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return s || undefined;
}

async function buildRepo(repo: string, out: string): Promise<AtlasGraph> {
  const started = Date.now();
  const config = loadConfig(values.config);
  const graph = extract({ repo, config, scope: normalizeScope(values.scope), externals: values.externals });
  await classify(graph, config, repo, out);
  const { files, symbols, edges } = graph.meta;
  if (graph.meta.scope && files === 0) console.error(t('cli.scopeEmpty', { scope: graph.meta.scope }));
  else if (files === 0) console.error(t('cli.warning', { text: t('warn.noFiles', { repo, tsconfig: config.explicitTsconfig ? config.tsconfig : findTsconfig(repo) ?? '-' }) }));
  console.error(t('cli.extracted', { files, symbols, edges, secs: secs(started) }));
  return graph;
}

async function buildWorkspace(file: string, out: string): Promise<AtlasGraph> {
  const started = Date.now();
  const ws = loadWorkspace(file);
  // git 에서 받는 repo 는 실행할 때마다 최신으로 맞춘다 (--no-fetch 면 캐시 그대로)
  for (const repo of ws.repos) {
    if (repo.source && (!values['no-fetch'] || !existsSync(repo.path))) {
      repo.path = ensureRepo(repo.source.git, repo.source.branch, (line) => console.error(line));
    }
  }
  const repos = extractWorkspace(ws);
  for (const r of repos) {
    if (!r.graph.meta.files) console.error(t('cli.warning', { text: t('warn.noFiles', { repo: r.name, tsconfig: r.config.explicitTsconfig ? r.config.tsconfig : findTsconfig(r.path) ?? '-' }) }));
  }
  for (const repo of repos) await classify(repo.graph, repo.config, repo.path, out, ` (${repo.name})`);
  const { graph, warnings } = assembleWorkspace(ws, repos);
  for (const w of warnings) console.error(t('cli.warning', { text: w }));
  const ifaces = graph.nodes.filter((n) => n.kind === 'endpoint' || n.kind === 'event');
  const unmatched = ifaces.filter((n) => n.unmatched);
  console.error(
    t('cli.workspaceExtracted', {
      repos: graph.meta.repo, files: graph.meta.files, symbols: graph.meta.symbols, edges: graph.meta.edges,
      ifaces: ifaces.length, unmatched: unmatched.length, secs: secs(started),
    }),
  );
  for (const n of unmatched) console.error(t('cli.unmatched', { name: n.name, note: (n.notes ?? []).map((m) => tm(m)).join(' · ') }));
  return graph;
}

function write(out: string, content: string) {
  writeFileSync(out, content);
  console.error(t('cli.wrote', { path: out, mb: (Buffer.byteLength(content) / 1024 / 1024).toFixed(2) }));
}

function html(graph: AtlasGraph): string {
  // 만든 HTML 을 남과 나눌 때 내 로컬 경로를 싣지 않으려면 --no-editor-links
  if (values['no-editor-links']) delete graph.meta.roots;
  return renderHtml(graph);
}

function openInBrowser(path: string) {
  console.error(t('cli.opening', { path }));
  // Windows 는 cmd 를 거치지 않는다 (경로의 & ^ 가 명령으로 해석되지 않게)
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [path]] : process.platform === 'win32' ? ['explorer.exe', [path]] : ['xdg-open', [path]];
  const child = spawn(cmd, args as string[], { stdio: 'ignore', detached: true, windowsHide: true });
  // 브라우저를 여는 프로그램이 없어도(서버 · 컨테이너) 결과 파일은 이미 썼으니 안내만 한다
  child.on('error', (e) => console.error(t('cli.openFailed', { message: e.message, path })));
  child.unref();
}

async function main() {
  const [command, input] = positionals;
  const outOr = (fallback: string) => resolve(values.out ?? fallback);

  switch (command) {
    case 'init': {
      const result = await runInit({ repos: values.repo ?? [], dir: values.dir ?? input ?? 'atlas', yes: values.yes });
      process.exit(result ? 0 : 1);
      break;
    }
    case 'extract':
      write(outOr('graph.json'), JSON.stringify(await buildRepo(input, outOr('graph.json'))));
      break;
    case 'render':
      write(outOr('atlas.html'), html(JSON.parse(readFileSync(input, 'utf8')) as AtlasGraph));
      break;
    case 'build':
      write(outOr('atlas.html'), html(await buildRepo(input, outOr('atlas.html'))));
      break;
    case 'workspace':
      write(outOr('atlas.html'), html(await buildWorkspace(input, outOr('atlas.html'))));
      break;
    default: {
      // code-atlas <workspace.json | repo 경로>
      if (!existsSync(command)) {
        console.error(t('cli.unknownCommand', { arg: command }));
        console.error(t('cli.usage'));
        process.exit(1);
      }
      const isWorkspace = statSync(command).isFile() && command.endsWith('.json');
      const out = outOr(isWorkspace ? join(dirname(command), 'atlas.html') : 'atlas.html');
      write(out, html(isWorkspace ? await buildWorkspace(command, out) : await buildRepo(command, out)));
      if (values.open) openInBrowser(out);
    }
  }
  if (values.open && ['build', 'workspace', 'render'].includes(command)) openInBrowser(outOr('atlas.html'));
}

try {
  await main();
} catch (e) {
  // 설정 · git · JSON 오류는 stack 없이 한 줄로
  console.error(t('cli.error', { message: (e as Error).message }));
  if (process.env.CODE_ATLAS_DEBUG) console.error(e);
  process.exit(1);
}
