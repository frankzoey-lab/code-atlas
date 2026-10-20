import { readFileSync } from 'node:fs';
import { AtlasGraph } from './graph.js';

const TEMPLATE = new URL('../viewer/index.html', import.meta.url);
const PLACEHOLDER = '/*__ATLAS_DATA__*/';

/** 뷰어 템플릿에 그래프 JSON 을 심은 HTML 한 장을 만든다 */
export function renderHtml(graph: AtlasGraph): string {
  // <script> 안에 그대로 넣으므로 '<' 를 이스케이프해 </script> 로 끊기지 않게 한다
  const json = JSON.stringify(graph).replace(/</g, '\\u003c');
  return readFileSync(TEMPLATE, 'utf8').replace(PLACEHOLDER, () => json);
}
