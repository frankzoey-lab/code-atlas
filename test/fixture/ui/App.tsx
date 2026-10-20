import { dynamic } from './wrap';

// 파일 순서상 Lazy.tsx · Memo.tsx 보다 먼저 처리되는 파일
const LazyChart = dynamic(() => import('./charts/Chart'));
const LazyNamed = dynamic(() => import('./charts/Named').then((m) => m.Named));

export const OPTIONS = Object.entries({ a: 1 }).map(([k, v]) => ({ k, v }));

export function App(props: { onSelect: () => void }) {
  props.onSelect();
  return (
    <div>
      <LazyChart />
      <LazyNamed />
    </div>
  );
}
