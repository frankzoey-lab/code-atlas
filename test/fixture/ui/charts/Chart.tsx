import { memo } from '../wrap';

function ChartInner() {
  return <svg />;
}

export const Fancy = memo(ChartInner);

export default memo(ChartInner, (a, b) => a === b);
