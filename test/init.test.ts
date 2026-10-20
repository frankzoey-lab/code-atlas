import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectLinks, detectRepo, draftFeatures } from '../src/detect.js';
import { ensureRepo, parseRepoSpec, repoCacheDir } from '../src/fetch-repo.js';
import { KO_CODES, MESSAGE_CODES, t } from '../src/i18n.js';
import { runInit } from '../src/init.js';
import { buildWorkspace, loadWorkspace } from '../src/workspace.js';

const ws = resolve(import.meta.dirname, 'fixture-ws');

describe('parseRepoSpec', () => {
  it('gh:owner/repo#branch · https · ssh 는 git, 접두 없는 a/b 는 (없어도) 로컬로 본다', () => {
    expect(parseRepoSpec('gh:vercel/next.js#canary', '/nowhere')).toEqual({ kind: 'git', url: 'https://github.com/vercel/next.js.git', branch: 'canary', name: 'next-js' });
    expect(parseRepoSpec('apps/web', '/nowhere')).toMatchObject({ kind: 'local', path: resolve('/nowhere', 'apps/web') });
    expect(parseRepoSpec('https://gitlab.com/a/b.git')).toMatchObject({ kind: 'git', url: 'https://gitlab.com/a/b.git', name: 'b' });
    expect(parseRepoSpec('git@github.com:a/b.git#dev')).toMatchObject({ kind: 'git', url: 'git@github.com:a/b.git', branch: 'dev', name: 'b' });
    expect(parseRepoSpec('fixture-ws/fe', resolve(import.meta.dirname))).toMatchObject({ kind: 'local', name: 'fe' });
  });

  it('- 로 시작하는 값 · 이상한 브랜치 · 토큰이 든 주소는 거절한다', () => {
    expect(() => parseRepoSpec('gh:a/b#--upload-pack=x')).toThrow();
    expect(() => parseRepoSpec('https://x/a.git#../evil')).toThrow();
    expect(() => parseRepoSpec('https://user:secret@github.com/a/b.git')).toThrow(/token|토큰/);
    expect(() => parseRepoSpec('https://ghp_abc123@github.com/a/b.git')).toThrow(/token|토큰/);
    expect(parseRepoSpec('git@github.com:a/b.git')).toMatchObject({ kind: 'git' });
    expect(() => ensureRepo('--upload-pack=touch x', undefined)).toThrow();
  });

  it('캐시 폴더는 주소 · 브랜치마다 다르다', () => {
    expect(repoCacheDir('https://x/a.git', 'main')).not.toBe(repoCacheDir('https://x/a.git', 'dev'));
  });
});

describe('detect', () => {
  const fe = detectRepo('fe', join(ws, 'fe'));
  const be = detectRepo('be', join(ws, 'be'));

  it('라우트가 있으면 backend, env base HTTP 호출이 있으면 frontend', () => {
    expect(be.role).toBe('backend');
    expect(fe.role).toBe('frontend');
  });

  it('env base 별로 경로가 가장 많이 맞는 backend 를 짝으로, socket 도 잇는다', () => {
    const links = detectLinks([fe, be]);
    expect(links.http).toContainEqual({ from: 'fe', base: ['NEXT_PUBLIC_API_URL'], to: 'be' });
    expect(links.socket).toEqual([{ client: 'fe', server: 'be' }]);
  });

  it('기능 규칙 초안은 폴더별 파일 수로 잡는다', () => {
    const rules = draftFeatures(join(ws, 'fe'), fe.graph);
    expect(rules.map((r) => r.include[0])).toEqual(expect.arrayContaining(['api/**', 'ui/**']));
    expect(new Set(rules.map((r) => r.color)).size).toBe(rules.length);
  });
});

describe('init --yes', () => {
  it('로컬 repo 들로 workspace 와 repo 별 설정을 쓰고, 그대로 그릴 수 있다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-init-'));
    const lines: string[] = [];
    const result = await runInit({ repos: [join(ws, 'fe'), join(ws, 'be')], dir, yes: true, log: (l) => lines.push(l) });
    expect(result?.files.map((f) => f.slice(dir.length + 1)).sort()).toEqual(['atlas.workspace.json', 'be.atlas.json', 'fe.atlas.json']);
    const written = JSON.parse(readFileSync(join(dir, 'atlas.workspace.json'), 'utf8'));
    expect(written.repos.map((r: { name: string }) => r.name)).toEqual(['fe', 'be']);
    expect(written.http[0]).toMatchObject({ from: 'fe', to: 'be' });
    const g = buildWorkspace(loadWorkspace(join(dir, 'atlas.workspace.json')));
    expect(g.nodes.some((n) => n.kind === 'endpoint' && !n.unmatched)).toBe(true);
    expect(g.meta.roots?.fe).toBe(join(ws, 'fe'));
  });

  it('없는 로컬 경로는 건너뛰고 알린다', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'atlas-init-')), 'out');
    const lines: string[] = [];
    expect(await runInit({ repos: ['./does/not/exist'], dir, yes: true, log: (l) => lines.push(l) })).toBeUndefined();
    expect(lines.some((l) => l.includes(resolve('./does/not/exist')))).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it('repo 가 없으면 아무것도 쓰지 않는다', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'atlas-init-')), 'out');
    expect(await runInit({ repos: [], dir, yes: true, log: () => {} })).toBeUndefined();
    expect(existsSync(dir)).toBe(false);
  });
});

describe('i18n', () => {
  it('영어 · 한국어 메시지 키가 같고 자리표시자를 채운다', () => {
    expect([...KO_CODES].sort()).toEqual([...MESSAGE_CODES].sort());
    expect(t('note.noRoute', { repo: 'api' }, 'en')).toBe('No matching route in api');
    expect(t('note.noRoute', { repo: 'api' }, 'ko')).toBe('api 에 맞는 라우트가 없습니다');
  });
});

describe('tsconfig', () => {
  it('solution 형태(files: [] + references) 면 참조한 tsconfig 로 열고 별칭도 푼다', async () => {
    const { extract } = await import('../src/extract/index.js');
    const { resolveConfig } = await import('../src/config.js');
    const g = extract({ repo: resolve(import.meta.dirname, 'fixture-solution'), config: resolveConfig({}) });
    expect(g.meta.files).toBe(2);
    expect(g.edges.some((e) => e.source === 's:src/a.ts#a' && e.target === 's:src/b.ts#b')).toBe(true);
  });
});

describe('tsconfig 가 파일을 하나도 못 잡을 때', () => {
  it('references 가 없으면 저장소 전체로 바꾸지 않고 0개로 둔다', async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { extract } = await import('../src/extract/index.js');
    const { resolveConfig } = await import('../src/config.js');
    const dir = mkdtempSync(join(tmpdir(), 'atlas-ts-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = () => 1;\n');
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ include: ['wrong/**'] }));
    expect(extract({ repo: dir, config: resolveConfig({}) }).meta.files).toBe(0);
  });
});
