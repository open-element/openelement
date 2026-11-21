/**
 * /ping page element — named-only actions route (ADR-0121 protocol edges),
 * compiled v0.44. `movedText` carries the ?moved= echo; `hasError` drives the
 * static-text intent-error Block.
 *
 * GENERATED lane (F16: class → function). Both rows stay `attribute: false`:
 * the route projects request/action data in-process, and the class never had an
 * attribute wire for them. The typed props record still needs a sidecar entry
 * per member (the lane cross-checks the two), so each row keeps the
 * property-only spelling.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'ping-page',
  root: 'shadow',
  properties: {
    movedText: { attribute: false, default: 'moved=' },
    hasError: { attribute: false, default: 0 },
  },
});

interface PingPageProps {
  movedText: string;
  hasError: number;
}

export default function PingPage(props: PingPageProps) {
  return (
    <main>
      <h1>ping page</h1>
      <p id='moved'>{props.movedText}</p>
      {props.hasError > 0
        ? <p id='intent-error'>intent missing</p>
        : <span data-error='none'></span>}
      <form method='post' data-open-enhance>
        <button id='ping' type='submit' name='intent' value='ping' formaction='?/ping'>
          Ping
        </button>
        <button id='mv307' type='submit' formaction='?/mv307'>Move</button>
      </form>
      {
        /* #576: an explicit action attribute with an attribute-less
          submitter — the enhanced POST must hit /form, not this page. */
      }
      <form method='post' action='/form' data-open-enhance>
        <button id='to-form' type='submit'>Send to /form</button>
      </form>
    </main>
  );
}
