import { connect, createSelector, debounce, lazy } from './hoc';

export function selectA(s: unknown) {
  return s;
}

export const selectX = createSelector(selectA, (a) => a);
export const saveLater = debounce(selectA, 300);

function Card() {
  return <p />;
}

export const Connected = connect(() => ({}))(Card);

const LazyNamed = lazy(() => import('./charts/Named').then((m) => ({ default: m.Named })));
const LazyPicked = lazy(() => import('./charts/Named').then(({ Named }) => Named));

export function Page() {
  selectX({});
  saveLater({});
  return (
    <div>
      <Connected />
      <LazyNamed />
      <LazyPicked />
    </div>
  );
}
