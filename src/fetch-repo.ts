import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { t } from './i18n.js';

export type RepoSpec =
  | { kind: 'local'; path: string; name: string }
  | { kind: 'git'; url: string; branch?: string; name: string };

/**
 * `../app` · `/abs/path` · `apps/web` → 로컬, `gh:owner/repo` · `https://…` · `git@…:…` · `ssh://…` → git.
 * GitHub 축약은 `gh:`(또는 `github:`) 를 붙여야 한다 — 경로 오타가 낯선 저장소 clone 이 되지 않게.
 * 끝의 `#브랜치` 는 git 주소에서만 브랜치로 본다.
 */
export function parseRepoSpec(spec: string, cwd = process.cwd()): RepoSpec {
  const trimmed = spec.trim();
  const short = /^(?:gh|github):([\w.-]+\/[\w.-]+)(?:#(.+))?$/.exec(trimmed);
  const isGit = !!short || /^(https?|ssh|git):\/\//.test(trimmed) || /^[\w.-]+@[\w.-]+:/.test(trimmed);
  if (!isGit) {
    const path = resolve(cwd, trimmed);
    return { kind: 'local', path, name: nameOf(path) };
  }
  const [raw, branch] = short ? [`https://github.com/${short[1]}.git`, short[2]] : trimmed.split('#');
  const url = raw;
  assertSafeGitArg(url, 'url');
  if (branch) assertSafeGitArg(branch, 'branch');
  assertNoCredentials(url);
  return { kind: 'git', url, branch: branch || undefined, name: nameOf(url) };
}

/**
 * https://user:TOKEN@host · https://TOKEN@host 처럼 http(s) 주소에 사용자 정보가 있으면 받지 않는다
 * (로그와 설정 파일에 남으므로). ssh 의 git@host 는 키 인증이라 괜찮다.
 */
function assertNoCredentials(url: string) {
  if (/^https?:\/\/[^/]*@/i.test(url)) throw new Error(t('git.credentials'));
}

/** git 이 옵션으로 해석할 수 있는 값(`-` 로 시작)이나 이상한 브랜치 이름은 받지 않는다 */
export function assertSafeGitArg(value: string, what: 'url' | 'branch'): void {
  const ok = what === 'branch'
    ? /^[\w][\w./-]*$/.test(value) && !value.includes('..')
    : !value.startsWith('-') && !/[\s\0]/.test(value);
  if (!ok) throw new Error(t('git.unsafe', { what, value: value.slice(0, 80) }));
}

function nameOf(pathOrUrl: string): string {
  const last = pathOrUrl.replace(/[/\\]+$/, '').split(/[/\\:]/).pop() ?? 'repo';
  return last.replace(/\.git$/, '').replace(/[^\w-]/g, '-') || 'repo';
}

export function cacheRoot(): string {
  return process.env.CODE_ATLAS_CACHE ?? join(homedir(), '.cache', 'code-atlas');
}

export function repoCacheDir(url: string, branch?: string): string {
  const hash = createHash('sha1').update(`${url}#${branch ?? ''}`).digest('hex').slice(0, 8);
  return join(cacheRoot(), 'repos', `${nameOf(url)}-${hash}`);
}

/**
 * git 주소를 캐시 폴더에 얕게 받아 두고 경로를 돌려준다. 이미 있으면 원격의 최신으로 맞춘다.
 * 인증은 사용자의 git 설정(ssh 키 · credential helper)을 그대로 쓴다.
 */
export function ensureRepo(url: string, branch: string | undefined, log: (line: string) => void = () => {}): string {
  const dir = repoCacheDir(url, branch);
  assertSafeGitArg(url, 'url');
  assertNoCredentials(url);
  if (branch) assertSafeGitArg(branch, 'branch');
  const label = { url, branch: branch ? `#${branch}` : '' };
  if (existsSync(join(dir, '.git'))) {
    log(t('init.updating', label));
    git(['-C', dir, 'fetch', '--depth', '1', '--', 'origin', branch ?? 'HEAD']);
    git(['-C', dir, 'reset', '--hard', 'FETCH_HEAD']);
  } else {
    log(t('init.cloning', label));
    mkdirSync(join(cacheRoot(), 'repos'), { recursive: true });
    git(['clone', '--depth', '1', ...(branch ? ['--branch', branch] : []), '--', url, dir]);
  }
  return dir;
}

function git(args: string[]) {
  try {
    // ext:: 전송(임의 명령 실행)은 막는다
    execFileSync('git', ['-c', 'protocol.ext.allow=never', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (e) {
    const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim().split('\n').slice(-2).join(' ');
    throw new Error(t('git.failed', { args: args.filter((a) => !isAbsolute(a)).join(' '), message: stderr || (e as Error).message }));
  }
}
