/**
 * The M06 authored S2 Board, with one qualification-only static focus carrier.
 * The condition is a sibling of the list, the key is `item.id`, and the private
 * draft is the component-local `count` signal (the admitted M06 shape).
 * `contenteditable` is an ordinary static attribute; it is not a property
 * channel and it is not pretending to be the unqualified `<input>` obligation.
 */
export const S2_BOARD = `import { signal } from '@openelement/element';
export default function Board() {
  const items = signal([{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }]);
  const open = signal(true);
  const count = signal(0);
  return <section>
    {open.value ? <p class="on">open</p> : <em class="off">closed</em>}
    <ul>{items.value.map((item) => <li key={item.id}>{item.label}: {count.value}</li>)}</ul>
    <p id="draft" contenteditable="true">note</p>
  </section>;
}
`;
