import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Project, SourceFile, ts } from 'ts-morph';

/**
 * 대상 저장소의 tsconfig 로 Project 를 연다. paths 별칭은 TypeChecker 가 그대로 해석한다.
 * tsconfig 가 없으면 저장소 안의 .ts · .tsx · .js · .jsx 를 기본 설정으로 연다.
 */
export function loadProject(repo: string, tsconfig: string): Project {
  const path = resolve(repo, tsconfig);
  if (existsSync(path)) {
    const project = new Project({ tsConfigFilePath: path });
    if (project.getSourceFiles().length) return project;
    // `{ "files": [], "references": [...] }` (Vite 템플릿 같은 solution 형태) 면 참조한 tsconfig 들로 연다
    const refs = referencedTsconfigs(path);
    const withFiles = refs.find((r) => new Project({ tsConfigFilePath: r, skipAddingFilesFromTsConfig: false }).getSourceFiles().length);
    if (withFiles) {
      const merged = new Project({ tsConfigFilePath: withFiles });
      for (const r of refs) if (r !== withFiles) merged.addSourceFilesFromTsConfig(r);
      return merged;
    }
    // tsconfig 는 있는데 파일이 하나도 안 잡히면(include 가 틀림 등) 전체 파일로 바꾸지 않고 빈 채로 둔다.
    // 호출하는 쪽이 파일 0개 경고를 띄운다
    return project;
  }
  const project = new Project({
    compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, baseUrl: resolve(repo) },
  });
  project.addSourceFilesAtPaths([
    `${resolve(repo)}/**/*.{ts,tsx,js,jsx,mts,cts}`,
    `!${resolve(repo)}/**/node_modules/**`,
    `!${resolve(repo)}/**/{dist,build,.next,coverage}/**`,
  ]);
  return project;
}

const TSCONFIG_CANDIDATES = ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.build.json', 'jsconfig.json'];

/** 저장소에서 쓸 tsconfig (저장소 기준 경로). 없으면 undefined */
export function findTsconfig(repo: string): string | undefined {
  return TSCONFIG_CANDIDATES.find((f) => existsSync(resolve(repo, f)));
}

function referencedTsconfigs(path: string): string[] {
  const { config } = ts.readConfigFile(path, ts.sys.readFile);
  const refs: { path: string }[] = config?.references ?? [];
  return refs
    .map((r) => resolve(dirname(path), r.path))
    .map((p) => (p.endsWith('.json') ? p : join(p, 'tsconfig.json')))
    .filter((p) => existsSync(p));
}

export function relPathOf(repo: string, file: SourceFile): string {
  return relative(resolve(repo), file.getFilePath()).split(sep).join('/');
}

/** node_modules 안 파일이면 패키지 이름(@scope/name 포함), 아니면 undefined */
export function packageOf(filePath: string): string | undefined {
  const i = filePath.lastIndexOf('/node_modules/');
  if (i < 0) return undefined;
  const parts = filePath.slice(i + '/node_modules/'.length).split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}
