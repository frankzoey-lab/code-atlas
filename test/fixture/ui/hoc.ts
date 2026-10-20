export function createSelector<A, R>(input: A, combine: (a: unknown) => R) {
  return combine;
}
export function debounce<T>(fn: T, _ms: number): T {
  return fn;
}
export function connect(_map: unknown) {
  return <T>(c: T) => c;
}
export function lazy<T>(loader: () => Promise<T>) {
  return loader as unknown as () => null;
}
