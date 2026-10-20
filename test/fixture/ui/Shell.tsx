import Anon from './Anon';
import Memo from './Memo';
import { dynamic } from './wrap';

const LazyMemo = dynamic(() => import('./Memo'));

export function Shell() {
  return (
    <div>
      <LazyMemo />
      <Memo />
      <Anon />
    </div>
  );
}
