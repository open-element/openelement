/**
 * /notes/new page element — create form (compiled). `titleText` backs the
 * native `required` control (empty submissions are blocked by the browser before
 * any submit event); the prop is NOT named `title` because that would shadow
 * HTMLElement.title (TS4114 under noImplicitOverride — the packed-consumer
 * typecheck cell catches it). `hasError` drives the static-text error Block — the
 * compiled grammar's conditional branches are fully static, so the constant
 * validation message is the branch text. The named submitter travels in both the
 * enhanced and the native body (#544).
 *
 * GENERATED lane (F16: class → function). It is a generated PAGE ROOT, which needs
 * the compiler-emitted DSD host producer — that is why the property channel had to
 * render as an attribute in SSR before this file could move.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'notes-new',
  root: 'shadow',
  properties: {
    titleText: { attribute: false, default: '' },
    hasError: { attribute: false, default: 0 },
    intentText: { attribute: false, default: 'intent=' },
  },
});

interface NoteNewPageProps {
  titleText: string;
  hasError: number;
  intentText: string;
}

export default function NoteNewPage(props: NoteNewPageProps) {
  return (
    <main>
      <h1>new note</h1>
      <form method="post" data-open-enhance>
        <input id="title" name="title" type="text" required value={props.titleText} />
        <textarea id="body" name="body"></textarea>
        <button id="submit" type="submit" name="intent" value="create">
          Create
        </button>
        {/* #1339: submitter formaction override -> named action (?/feature), on
            both the enhanced and the native POST path. */}
        <button id="feature" type="submit" name="intent" value="feature" formaction="?/feature">
          Feature
        </button>
      </form>
      {props.hasError > 0 ? (
        <p id="error">title must be at least 3 characters</p>
      ) : (
        <span data-error="none"></span>
      )}
      <p id="last-intent">{props.intentText}</p>
    </main>
  );
}
