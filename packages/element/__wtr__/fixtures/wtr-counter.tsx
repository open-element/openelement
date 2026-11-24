/**
 * Element browser conformance fixture (#1333): the light-root counter the
 * lifecycle and Lit-interop suites drive (tag `oe-program-counter`).
 *
 * WHY IT IS A FUNCTION COMPONENT. The class/decorator author form retired with
 * the Alpha16 closeout, so the browser suite's compiled fixture is authored in
 * the shipped lane: one `defineIslandConfig` sidecar (the element facts the
 * generated class needs) plus one default-exported function component. The
 * property rows deliberately keep the retired fixture's PUBLIC shape — a
 * reflected `count`, a non-reflected `label`, and the `items` array — because
 * the suite asserts platform behavior (attribute/property conversion,
 * reflection, keyed identity), not the author form.
 *
 * WHY `useHost()`. The old `increment()` method wrote the element's own
 * `count` property, and the suite asserts that a click increments
 * `element.count` and reflects it to the attribute. A function component owns
 * no `this`, so the same platform write goes through the host element the
 * generated class owns; the property write is what converts/reflects and what
 * re-runs the text binding (the shell's props channel).
 */
import { defineIslandConfig } from '@openelement/router';
import { useHost } from '@openelement/element/lifecycle';

export const openElement = defineIslandConfig({
  root: 'light',
  properties: {
    count: { reflect: true, default: 0 },
    label: { default: 'ready' },
    // Non-primitive rows have no attribute wire: `attribute: false` is the
    // declared fact, and the literal default keeps the same two rows the
    // retired fixture initialised in place.
    items: {
      attribute: false,
      default: [
        { id: 'a', text: 'alpha' },
        { id: 'b', text: 'beta' },
      ],
    },
  },
});

function ProgramCounter(props: { count: number; label: string; items: { id: string; text: string }[] }) {
  // The host is the owning element; the fixture's own declared rows are what
  // the handler writes, so the cast names exactly those platform facts. The
  // compiler emits one host-record field read for `useHost()` and keeps the
  // write as a normal property access, so no runtime channel is added.
  const host = useHost() as HTMLElement & { count: number };
  return (
    <div class='proof'>
      <h1>Count: {props.count}</h1>
      <input value={props.label} />
      <button type='button' onClick={() => { host.count++; }}>+</button>
      {props.count > 0 ? <p class='parity'>positive</p> : <p class='parity'>zero</p>}
      <ul>{props.items.map((item) => <li key={item.id}>{item.text}</li>)}</ul>
    </div>
  );
}

export default ProgramCounter;
