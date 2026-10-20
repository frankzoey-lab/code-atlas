import { add } from '@/lib';
import { Button } from './Button';
import { useCounter } from './useCounter';

const handlers = [add];

export function Panel() {
  const value = useCounter();
  return <Button key={value} />;
}
