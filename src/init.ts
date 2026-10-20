import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { detectLinks, detectRepo, DetectedRepo, repoConfig } from './detect.js';
import { ensureRepo, parseRepoSpec } from './fetch-repo.js';
import { t } from './i18n.js';
import { WorkspaceConfig, WorkspaceRepo } from './workspace.js';

export interface InitOptions {
  /** 묻지 않고 쓸 repo 들 (경로 · git 주소[#브랜치]) */
  repos: string[];
  /** 결과를 쓸 폴더 (기본 atlas) */
  dir: string;
  /** 묻지 않고 기본값으로 진행 */
  yes: boolean;
  log?: (line: string) => void;
  /** 테스트용 입력 */
  ask?: (question: string) => Promise<string>;
}

export interface InitResult {
  workspacePath: string;
  files: string[];
}

/**
 * repo 를 하나 이상 받아(로컬 · git) 역할 · 인터페이스 연결 · 기능 규칙 초안을 만들고
 * `<dir>/atlas.workspace.json` 과 repo 별 `<dir>/<name>.atlas.json` 을 쓴다.
 */
export async function runInit(options: InitOptions): Promise<InitResult | undefined> {
  const log = options.log ?? ((line: string) => console.error(line));
  const rl = options.ask || options.yes ? undefined : createInterface({ input: process.stdin, output: process.stderr });
  const ask = options.ask ?? (rl ? (q: string) => rl.question(q) : async () => '');
  try {
    log(t('init.welcome'));
    const specs = [...options.repos];
    if (!options.yes) {
      for (;;) {
        const answer = (await ask(t('init.askRepo'))).trim();
        if (!answer) break;
        specs.push(answer);
      }
    }
    if (!specs.length) {
      log(t('init.needRepo'));
      return undefined;
    }

    const outDir = resolve(options.dir);
    const repos: (DetectedRepo & { entry: WorkspaceRepo })[] = [];
    const used = new Set<string>();
    for (const raw of specs) {
      const spec = parseRepoSpec(raw);
      if (spec.kind === 'local' && !existsSync(spec.path)) {
        log(t('init.notFound', { path: spec.path }));
        continue;
      }
      const path = spec.kind === 'git' ? ensureRepo(spec.url, spec.branch, log) : spec.path;
      let name = uniqueName(spec.name, used);
      if (!options.yes) {
        const answer = (await ask(t('init.askName', { name }))).trim();
        if (answer) name = uniqueName(answer.replace(/[^\w-]/g, '-'), used);
      }
      used.add(name);
      const detected = detectRepo(name, path);
      if (!detected.tsconfig) log(t('init.noTsconfig', { name }));
      log(t('init.added', { name, role: t(`role.${detected.role}` as const), path: spec.kind === 'git' ? spec.url : path }));
      const entry: WorkspaceRepo =
        spec.kind === 'git'
          ? { name, path: '', source: { git: spec.url, ...(spec.branch ? { branch: spec.branch } : {}) }, config: `${name}.atlas.json` }
          // workspace 파일을 다른 OS 에서도 쓰도록 / 로 저장한다
          : { name, path: relative(outDir, path).split(sep).join('/') || '.', config: `${name}.atlas.json` };
      repos.push({ ...detected, entry });
    }

    if (!repos.length) {
      log(t('init.needRepo'));
      return undefined;
    }
    log(t('init.detecting'));
    const links = detectLinks(repos);
    for (const l of links.http) {
      const hits = links.hits.get(`${l.from}|${l.base[0]}`) ?? 0;
      if (l.to) log(t('init.httpLink', { from: l.from, to: l.to, base: l.base[0], hits }));
      else log(t('init.httpExternal', { from: l.from, base: l.base[0], count: hits }));
    }
    for (const s of links.socket) log(t('init.socketLink', { client: s.client, server: s.server }));
    for (const r of repos) {
      log(t('init.features', { name: r.name, files: r.graph.meta.files, count: r.features.length, names: r.features.map((f) => f.name).join(', ') || '-' }));
    }

    if (!options.yes) {
      const answer = (await ask(t('init.confirm', { dir: relative(process.cwd(), outDir) || '.' }))).trim().toLowerCase();
      if (answer && !answer.startsWith('y')) {
        log(t('init.aborted'));
        return undefined;
      }
    }

    mkdirSync(outDir, { recursive: true });
    const files: string[] = [];
    for (const r of repos) {
      const file = join(outDir, `${r.name}.atlas.json`);
      writeFileSync(file, `${JSON.stringify(repoConfig(r), null, 2)}\n`);
      files.push(file);
    }
    const workspace: WorkspaceConfig = {
      repos: repos.map((r) => {
        const { path, ...rest } = r.entry;
        return r.entry.source ? rest as WorkspaceRepo : { ...rest, path };
      }),
      ...(links.http.length ? { http: links.http } : {}),
      ...(links.socket.length ? { socket: links.socket } : {}),
    };
    const workspacePath = join(outDir, 'atlas.workspace.json');
    writeFileSync(workspacePath, `${JSON.stringify(workspace, null, 2)}\n`);
    files.push(workspacePath);
    // 현재 폴더 밖이면 ../../.. 대신 절대 경로로 보여 준다
    const rel = (p: string) => {
      const r = relative(process.cwd(), p);
      return !r || r.startsWith('..') ? p : r;
    };
    log(t('init.done', { files: files.map(rel).join(', '), dir: rel(outDir), workspace: rel(workspacePath) }));
    return { workspacePath, files };
  } finally {
    rl?.close();
  }
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) return name;
  for (let i = 2; ; i++) if (!used.has(`${name}-${i}`)) return `${name}-${i}`;
}
