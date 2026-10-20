import { join } from 'node:path';

/**
 * 두 수를 더한다.
 * 음수도 된다.
 */
export function add(a: number, b: number) {
  return a + b;
}

// 두 배로 만든다
export const double = (x: number) => add(x, x);

export const pathOf = (name: string) => {
  console.log(JSON.stringify(name));
  return join('/tmp', name);
};
