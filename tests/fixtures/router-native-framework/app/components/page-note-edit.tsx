/**
 * /notes/:id/edit page element — edit form (compiled). The loader still supplies
 * `titleText` and `bodyText`; the pre-fill behaviour changed with the generated
 * lane (see BREAKING below). `hasError` drives the static-text error Block like
 * on /notes/new.
 *
 * GENERATED lane (F16: class → function). The class + decorators are gone; the
 * `defineIslandConfig` sidecar keeps the tag, `root: 'shadow'` (the class's
 * `shadow-open`) and the three property-only members (`attribute: false`).
 *
 * BREAKING (F16, recorded not softened): the class lane pre-filled the textarea
 * with RCDATA TEXT (`<textarea>{body}</textarea>`); the generated lane refuses
 * that shape (`OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT` — RCDATA parses the claim
 * anchor as literal text). The body now travels on the `value` PROPERTY
 * channel. Measured consequence (fixture build + all three engines):
 *   - SSR emits an inert `value="…"` attribute: the HTML parser ignores
 *     `value` on textarea and takes the initial value from child text, so with
 *     JavaScript disabled the textarea renders EMPTY (the input's SSR `value`
 *     attribute still prefills the title).
 *   - If the route is admitted (staged: dropping its call-site type argument),
 *     the page root is client-delivered and claimed. `attribute: false`
 *     primitives have NO SSR→claim wire (ADR-0181 A5: the claim re-reads the
 *     declared default), so the claim seeds
 *     `{ titleText: '', bodyText: '', hasError: 0 }` and writes `.value`: the
 *     textarea stays EMPTY and the SSR-prefilled title is CLEARED on connect.
 * The edit form is therefore pre-filled in NEITHER mode; the pre-fill
 * capability is removed, not deferred to JavaScript. The route's admission is
 * staged behind the page-root property-seed decision, because admitting it
 * without a seed would make that wipe silent.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'notes-id-edit',
  root: 'shadow',
  properties: {
    titleText: { attribute: false, default: '' },
    bodyText: { attribute: false, default: '' },
    hasError: { attribute: false, default: 0 },
  },
});

interface NoteEditPageProps {
  titleText: string;
  bodyText: string;
  hasError: number;
}

export default function NoteEditPage(props: NoteEditPageProps) {
  return (
    <main>
      <h1>edit note</h1>
      <form method='post' data-open-enhance>
        <input id='title' name='title' type='text' required value={props.titleText} />
        <textarea id='body' name='body' value={props.bodyText}></textarea>
        <button id='submit' type='submit' name='intent' value='update'>Update</button>
      </form>
      {props.hasError > 0
        ? <p id='error'>title must be at least 3 characters</p>
        : <span data-error='none'></span>}
    </main>
  );
}
