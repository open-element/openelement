/**
 * /awaited — M14-3 fixture: a server function page that awaits a
 * deterministic promise in a text child and in a nested server component prop.
 *
 * The component is declared in the route module itself: the route scanner
 * only records a `functionPage` when `definePage` receives a component the
 * module declares. The nested server component is imported separately to
 * exercise composition through the real build module graph.
 *
 * `settled()` is a plain identifier callee returning a real Promise — the
 * awaited operand grammar admits `await <identifier>(...)` but not member
 * callees such as `Promise.resolve(...)`, and a timer would make the build
 * non-deterministic. `renderIntent: 'dynamic'` keeps the page on the
 * request-time channel so the served bytes are produced per request.
 */
import { definePage } from '@openelement/router';
import { AwaitedValue } from '../components/awaited-value.tsx';

function settled(value: string) {
  return Promise.resolve(value);
}

export async function AwaitedPage() {
  return (
    <main>
      <p id="awaited-marker">{await settled('awaited-settled-value')}</p>
      <AwaitedValue value={await settled('awaited-prop-settled-value')} />
    </main>
  );
}

export default definePage(AwaitedPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — awaited' },
});
