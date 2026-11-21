/**
 * /guestbook page element — the ADR-0120-amendment HYBRID page (compiled, v0.44):
 * static prerendered GET + request-time action POST on one path.
 *
 * - `noteText` echoes the submitted value into the input (prop Part on value);
 * - `hasError` (0/1) drives the static-text error Block — the action's failure
 *   message is the constant 'note is required';
 * - `echoText` carries the PRG echo as one dynamic text Part so the raw HTML keeps
 *   the assertion-contiguous 'echo=<value>' string.
 *
 * GENERATED lane (F16: class → function).
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'guestbook-page',
  root: 'shadow',
  properties: {
    noteText: { attribute: false, default: '' },
    echoText: { attribute: false, default: 'echo=' },
    hasError: { attribute: false, default: 0 },
  },
});

interface GuestbookPageProps {
  noteText: string;
  echoText: string;
  hasError: number;
}

export default function GuestbookPage(props: GuestbookPageProps) {
  return (
    <main>
      <h1 id="guestbook-marker">hybrid guestbook</h1>
      <form method="post" data-open-enhance>
        <input id="note" name="note" type="text" value={props.noteText} />
        <button id="submit" type="submit">
          Sign
        </button>
        <button id="ghost" type="submit" formaction="?/ghost">
          Ghost
        </button>
      </form>
      {props.hasError > 0 ? (
        <p id="error">note is required</p>
      ) : (
        <span data-error="none"></span>
      )}
      <p id="echo">{props.echoText}</p>
    </main>
  );
}
