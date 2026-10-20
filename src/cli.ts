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
import { AtlasGraph, OTHER_FEATURE } from './graph.js';
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
    'allow-draft': { type: 'boolean', default: false },
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

/** init 초안("draft": true) 설정이 남아 있으면 그리지 않는다 (스킬로 다듬게 하려고) */
function blockDrafts(configs: [path: string | undefined, config: ResolvedConfig][]) {
  if (values['allow-draft']) return;
  const drafts = configs.filter(([path, c]) => path && c.draft).map(([path]) => path!);
  if (!drafts.length) return;
  console.error(t('cli.draftBlocked', { files: drafts.map((f) => `  ${f}`).join('\n') }));
  process.exit(1);
}

/** 기능별 파일 수를 한 줄로 알리고, 규칙에 맞는 파일이 하나도 없는 기능(순서 실수 · 잘못된 glob)은 경고한다 */
function reportFeatures(graph: AtlasGraph, config: ResolvedConfig, repo: string) {
  if (!config.featureRules.length) return;
  const files = graph.nodes.filter((n) => n.kind === 'file' && !n.boundary);
  const count = new Map<string, number>();
  for (const n of files) count.set(n.feature, (count.get(n.feature) ?? 0) + 1);
  const pct = (n: number) => `${Math.round((n / files.length) * 100)}%`;
  // 그룹은 처음 나온 자리에 묶어 'Universe 211 (66%): Genie 52, …' 로
  // 같은 이름 규칙이 여럿이면 (include 를 나눠 적은 경우) 한 기능으로 센다
  const rules = [...new Map(config.featureRules.map((r) => [r.name, r])).values()];
  const parts: string[] = [];
  const done = new Set<string>();
  for (const rule of rules) {
    if (!rule.group) { parts.push(`${rule.name} ${count.get(rule.name) ?? 0}`); continue; }
    if (done.has(rule.group)) continue;
    done.add(rule.group);
    const members = rules.filter((r) => r.group === rule.group);
    const total = members.reduce((a, r) => a + (count.get(r.name) ?? 0), 0);
    parts.push(`[${rule.group} ${total} (${pct(total)}): ${members.map((r) => `${r.name} ${count.get(r.name) ?? 0}`).join(', ')}]`);
  }
  const other = count.get(OTHER_FEATURE.name) ?? 0;
  const top = rules.reduce((a, r) => ((count.get(r.name) ?? 0) > (count.get(a.name) ?? 0) ? r : a), rules[0]);
  const largest = `${top.name} ${pct(count.get(top.name) ?? 0)}`;
  console.error(t('cli.features', { repo, files: files.length, list: parts.join(', '), other, otherPct: pct(other), largest }));
  for (const rule of rules) {
    if (!count.get(rule.name)) console.error(t('cli.warning', { text: t('warn.emptyFeature', { repo, feature: rule.name }) }));
  }
}

/** `./src/x/`, `src\\x` → `src/x` */
function normalizeScope(scope?: string): string | undefined {
  const s = scope?.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return s || undefined;
}

async function buildRepo(repo: string, out: string): Promise<AtlasGraph> {
  const started = Date.now();
  const config = loadConfig(values.config);
  blockDrafts([[values.config, config]]);
  const graph = extract({ repo, config, scope: normalizeScope(values.scope), externals: values.externals });
  const { files, symbols, edges } = graph.meta;
  if (graph.meta.scope && files === 0) console.error(t('cli.scopeEmpty', { scope: graph.meta.scope }));
  else if (files === 0) console.error(t('cli.warning', { text: t('warn.noFiles', { repo, tsconfig: config.explicitTsconfig ? config.tsconfig : findTsconfig(repo) ?? '-' }) }));
  // 경로 규칙 기준으로 본다 (Jev 분류 전)
  else if (!graph.meta.scope) reportFeatures(graph, config, repo);
  await classify(graph, config, repo, out);
  console.error(t('cli.extracted', { files, symbols, edges, secs: secs(started) }));
  return graph;
}

async function buildWorkspace(file: string, out: string): Promise<AtlasGraph> {
  const started = Date.now();
  const ws = loadWorkspace(file);
  const configs = new Map(ws.repos.map((r) => [r.name, loadConfig(r.config)]));
  blockDrafts(ws.repos.map((r) => [r.config, configs.get(r.name)!]));
  // git 에서 받는 repo 는 실행할 때마다 최신으로 맞춘다 (--no-fetch 면 캐시 그대로)
  for (const repo of ws.repos) {
    if (repo.source && (!values['no-fetch'] || !existsSync(repo.path))) {
      repo.path = ensureRepo(repo.source.git, repo.source.branch, (line) => console.error(line));
    }
  }
  const repos = extractWorkspace(ws, configs);
  for (const r of repos) {
    if (!r.graph.meta.files) console.error(t('cli.warning', { text: t('warn.noFiles', { repo: r.name, tsconfig: r.config.explicitTsconfig ? r.config.tsconfig : findTsconfig(r.path) ?? '-' }) }));
    else reportFeatures(r.graph, r.config, r.name);
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
