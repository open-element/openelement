/**
 * /form page element — the ADR-0120 action protocol page (compiled, v0.44).
 *
 * - `message` echoes the submitted value into the input (prop Part on value);
 * - `hasError` (0/1) drives the static-text error Block — the compiled grammar's
 *   conditional branches are fully static, and the action's failure message is the
 *   constant 'message is required';
 * - `echoText` carries the PRG echo as one dynamic text Part so the raw HTML keeps
 *   the assertion-contiguous 'echo=<value>' string.
 *
 * GENERATED lane (F16: class → function).
 */
import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'form-page',
  root: 'shadow',
  properties: {
    message: { attribute: false, default: '' },
    echoText: { attribute: false, default: 'echo=' },
    hasError: { attribute: false, default: 0 },
  },
});

interface FormPageProps {
  message: string;
  echoText: string;
  hasError: number;
}

export default function FormPage(props: FormPageProps) {
  const count = signal(0);
  return (
    <main>
      <h1>request-time form</h1>
      <form method="post" data-open-enhance>
        <input id="message" name="message" type="text" value={props.message} />
        <button id="submit" type="submit">
          Send
        </button>
        <button id="shout" type="submit" formaction="?/shout">
          Shout
        </button>
      </form>
      {props.hasError > 0 ? (
        <p id="error">message is required</p>
      ) : (
        <span data-error="none"></span>
      )}
      <p id="echo">{props.echoText}</p>
      <button id="page-increment" type="button" onClick={() => (count.value += 1)}>
        {count.value}
      </button>
      <live-counter></live-counter>
    </main>
  );
}
