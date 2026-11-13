/**
 * /awaited — M14-3 fixture: a server function page that awaits a
 * deterministic promise in a text child.
 *
 * The component is declared in the route module itself: the route scanner
 * only records a `functionPage` when `definePage` receives a component the
 * module declares (the `seams.md:75` admission note), so importing it from
 * `app/components/` would silently fall back to the class lane.
 *
 * `settled()` is a plain identifier callee returning a real Promise — the
 * awaited operand grammar admits `await <identifier>(...)` but not member
 * callees such as `Promise.resolve(...)`, and a timer would make the build
 * non-deterministic. `renderIntent: 'dynamic'` keeps the page on the
 * request-time channel so the served bytes are produced per request.
 */
import { definePage } from '@openelement/router';

/** The deterministic settled value; no timers, no loader data. */
function settled() {
  return Promise.resolve('awaited-settled-value');
}

export async function AwaitedPage() {
  return <p id="awaited-marker">{await settled()}</p>;
}

export default definePage(AwaitedPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — awaited' },
});
