import { title } from './totals';
import type { Shape } from './shapes';

export const label = (key: string) => `${key}:${typeof title}`;
export const area = (s: Shape) => s.w * s.h;
