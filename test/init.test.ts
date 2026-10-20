import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
    // 스킬(또는 사람)이 다듬을 때까지 초안으로 표시한다
    expect(JSON.parse(readFileSync(join(dir, 'fe.atlas.json'), 'utf8')).draft).toBe(true);
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

describe('기능 그룹', () => {
  it('색 없는 그룹 기능은 그룹 색 계열로 서로 다르게, 적은 색은 그대로', async () => {
    const { resolveConfig } = await import('../src/config.js');
    const c = resolveConfig({
      draft: true,
      groups: [{ name: 'Genie', color: '#7a4bc2' }],
      features: [
        { name: 'Chat', group: 'Genie', include: ['a/**'] },
        { name: 'Context', group: 'Genie', include: ['b/**'] },
        { name: 'Voice', group: 'Genie', include: ['c/**'] },
        { name: 'Pinned', group: 'Genie', color: '#123456', include: ['d/**'] },
        { name: 'Solo', include: ['e/**'] },
      ],
    });
    expect(c.draft).toBe(true);
    const [chat, context, voice, pinned, solo] = c.features;
    expect(chat).toEqual({ name: 'Chat', color: '#7a4bc2', group: 'Genie' });
    expect(new Set([chat.color, context.color, voice.color]).size).toBe(3);
    expect(pinned.color).toBe('#123456');
    expect(solo).toEqual({ name: 'Solo', color: '#9aa3b2' });
    expect(resolveConfig({}).draft).toBe(false);
    // 빨강 계열(색상각이 음수로 계산되는 쪽)도 올바른 hex 가 나온다
    const red = resolveConfig({ groups: [{ name: 'G', color: '#c2255c' }], features: ['a', 'b', 'c'].map((name) => ({ name, group: 'G', include: [`${name}/**`] })) });
    for (const f of red.features.slice(0, 3)) expect(f.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(red.features[1].color).not.toBe('#c2255c');
  });

  it('어둡거나 밝은 색 · 4자리 색에서도 겹치지 않고, 직접 적은 색은 다시 쓰지 않는다', async () => {
    const { resolveConfig } = await import('../src/config.js');
    const make = (color: string, n: number, pinned?: string) =>
      resolveConfig({
        groups: [{ name: 'G', color, description: 'desc' }],
        features: Array.from({ length: n }, (_, i) => ({ name: `f${i}`, group: 'G', include: [`${i}/**`], ...(i === 0 && pinned ? { color: pinned } : {}) })),
      });
    for (const color of ['#123456', '#f0f0f0', '#abcd', '#000000', '#ffffff']) {
      const colors = make(color, 6).features.slice(0, 6).map((f) => f.color);
      for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(new Set(colors).size).toBe(6);
    }
    // 그룹 색과 같은 색을 직접 적은 기능이 있으면, 색 없는 기능은 다른 색을 받는다
    const pinned = make('#7a4bc2', 3, '#7A4BC2').features.slice(0, 3).map((f) => f.color);
    expect(new Set(pinned).size).toBe(3);
    // 5자리처럼 잘못된 색은 받지 않는다
    expect(resolveConfig({ features: [{ name: 'x', color: '#abcde', include: ['**'] }] }).features[0].color).toBe('#9aa3b2');
    expect(make('#123456', 1).groups).toEqual([{ name: 'G', color: '#123456', description: 'desc' }]);
  });

  it('workspace 기능에 group · repo 가 실린다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-group-'));
    writeFileSync(join(dir, 'fe.atlas.json'), JSON.stringify({ features: [{ name: 'API', group: 'Data', color: '#0f6a8b', include: ['api/**'] }] }));
    writeFileSync(join(dir, 'ws.json'), JSON.stringify({ repos: [{ name: 'fe', path: join(ws, 'fe'), config: 'fe.atlas.json' }, { name: 'be', path: join(ws, 'be') }] }));
    const g = buildWorkspace(loadWorkspace(join(dir, 'ws.json')));
    expect(g.features).toContainEqual({ name: 'fe · API', color: '#0f6a8b', group: 'Data', repo: 'fe' });
    expect(g.groups).toEqual([{ name: 'Data', color: '#0f6a8b', repo: 'fe' }]);
    expect(g.nodes.some((n) => n.feature === 'fe · API')).toBe(true);
  });
});
