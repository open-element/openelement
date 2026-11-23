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
 * anchor as literal text) and that refusal is unchanged. The body travels on the
 * `value` PROPERTY channel instead. Measured consequence on the BUILT fixture,
 * chromium / firefox / webkit:
 *   - JavaScript OFF: SSR emits an inert `value="…"` attribute — the HTML parser
 *     ignores `value` on textarea and takes the initial value from child text —
 *     so `#body` renders EMPTY, while `#title` still pre-fills from its SSR
 *     `value` attribute. The no-JS textarea pre-fill is REMOVED.
 *   - JavaScript ON: the route is admitted (the bare `definePage(...)` call
 *     matches the page-component scanner) and the page root is claimed. The
 *     property-only rows now cross SSR→claim on the JSON `data-oe-prop-seed`
 *     channel (ADR-0181 A5 amendment, 2026-11-23), so the claim rehydrates
 *     `titleText`/`bodyText` BEFORE setup instead of re-reading the declared
 *     defaults. Measured on all three engines: `#title` = "Seed note one",
 *     `#body` = "The first seeded note body.". The client-side pre-fill is
 *     DELIVERED through the property channel, not removed.
 * The route's props projector must name the DECLARED rows (`titleText`,
 * `bodyText`); the class lane's `title` / `body` keys are silently ignored by the
 * projection and were renamed when the route was admitted.
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
