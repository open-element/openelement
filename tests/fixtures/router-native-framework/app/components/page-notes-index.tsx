/**
 * /notes page element — dynamic list (compiled). The compiled each-Block
 * item template binds two per-item slots: an iattr href ({note.href}) and an
 * ival title ({note.title}) — the alpha.8 multi-field grammar. A note-counter
 * island proves load-time activation on a request-time page.
 *
 * GENERATED lane (F16: class → function). `rows` is the property-only
 * non-primitive family the lane retains: it must spell `attribute: false`
 * (no attribute or JSON wire can carry a row list the projector supplies
 * in-process) and it must carry an explicit literal default, so the sidecar
 * row keeps the class field's `[]` and the body's `?? []` covers the
 * un-supplied render. `root: 'shadow'` reproduces `shadow-open`: app-flow.spec
 * asserts the /notes wire format contains
 * `<notes-index><template shadowrootmode="open">`, which only a shadow root
 * emits, and it reads the rows and `#note-count` through that root.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'notes-index',
  root: 'shadow',
  properties: {
    rows: { attribute: false, default: [] },
    countText: { attribute: false, default: 'note-count=0' },
    // Debug echo of the last submitter intent recorded by the store.
    intentText: { attribute: false, default: 'intent=' },
  },
});

interface NotesPageProps {
  rows: Array<{ id: string; title: string; href: string }>;
  countText: string;
  intentText: string;
}

export default function NotesPage(props: NotesPageProps) {
  const rows = props.rows ?? [];
  const countText = props.countText ?? 'note-count=0';
  const intentText = props.intentText ?? 'intent=';
  return (
    <main>
      <h1>app-flow-native notes</h1>
      <p id='note-count'>{countText}</p>
      <p id='last-intent'>{intentText}</p>
      <a id='new-note' href='/notes/new'>New note</a>
      <ul>
        {rows.map((note) => (
          <li key={note.id}>
            <a href={note.href}>{note.title}</a>
          </li>
        ))}
      </ul>
      <note-counter></note-counter>
    </main>
  );
}
