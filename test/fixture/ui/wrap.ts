export function memo<T>(component: T): T {
  return component;
}

export function dynamic<T>(loader: () => Promise<T>) {
  return loader as unknown as () => null;
}
