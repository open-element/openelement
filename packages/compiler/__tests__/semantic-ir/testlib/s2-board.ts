/**
 * The M06 S2 Board with qualification carriers for selection and native input.
 * The condition is a sibling of the keyed list and the private draft is the
 * Board-local count signal. The input's value belongs to the DOM; its input
 * event gives the packed Custom Element a public way to update the count.
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
    <input id="board-field" type="text" value="server" onInput={() => { count.value = count.value + 1; }} />
  </section>;
}
`;
