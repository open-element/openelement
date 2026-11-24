/**
 * /notes/:id page element — dynamic detail (compiled). The projector maps the
 * loaded note plus the ?created=/?updated= PRG flash params onto the compiled
 * properties; `editHref` is a page-level attribute Part on the edit link.
 *
 * GENERATED lane (F16: class → function). All seven members stay
 * `attribute: false`: the detail route's `props` projector supplies each one
 * in-process from loader data, so an attribute wire would publish note content
 * onto the host where nothing reads it (and would put the body text into the
 * document as a host attribute). The class-lane defaults survive in the typed
 * member's `??` fallback so an unsupplied render still spells the same
 * `id=`/`created=` shape the class did. `root: 'shadow'` reproduces
 * `shadow-open`: the specs read `#note-title` and the flash paragraphs through
 * the page host's open shadow root.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'notes-id',
  root: 'shadow',
  properties: {
    idText: { attribute: false, default: 'id=' },
    titleText: { attribute: false, default: '' },
    bodyText: { attribute: false, default: '' },
    editHref: { attribute: false, default: '' },
    createdText: { attribute: false, default: 'created=' },
    updatedText: { attribute: false, default: 'updated=' },
    // Debug echo of the last submitter intent recorded by the store.
    intentText: { attribute: false, default: 'intent=' },
  },
});

interface NoteDetailPageProps {
  idText: string;
  titleText: string;
  bodyText: string;
  editHref: string;
  createdText: string;
  updatedText: string;
  intentText: string;
}

export default function NoteDetailPage(props: NoteDetailPageProps) {
  const idText = props.idText ?? 'id=';
  const titleText = props.titleText ?? '';
  const bodyText = props.bodyText ?? '';
  const editHref = props.editHref ?? '';
  const createdText = props.createdText ?? 'created=';
  const updatedText = props.updatedText ?? 'updated=';
  const intentText = props.intentText ?? 'intent=';
  return (
    <main>
      <h1 id='note-title'>{titleText}</h1>
      <p id='note-id'>{idText}</p>
      <p id='note-body'>{bodyText}</p>
      <a id='edit-link' href={editHref}>Edit</a>
      <a id='back-to-notes' href='/notes'>All notes</a>
      <p id='flash-created'>{createdText}</p>
      <p id='flash-updated'>{updatedText}</p>
      <p id='last-intent'>{intentText}</p>
    </main>
  );
}
