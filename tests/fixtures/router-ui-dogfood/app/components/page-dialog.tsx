/**
 * /dialog page — qualifies open-dialog on the compiled framework (#1226):
 * - a trigger-driven modal dialog (focus containment, Escape, focus return);
 * - a second dialog SSR-rendered with the `open` attribute, qualifying the
 *   attribute -> top-layer modal choreography at hydration (#1030).
 *
 * GENERATED lane (2026-11-21 closeout: class → function). The page keeps its
 * `shadow` root so the boundary rows still traverse a shadow tree, and the
 * components inside its template expand through the P-6 nested-host channel.
 */
import '@openelement/ui/open-dialog';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'dialog-page', root: 'shadow' });

export default function DialogPage() {
  return (
    <main>
      <h1>ui dogfood — dialog</h1>
      <open-dialog label="Dogfood dialog">
        <button slot="trigger" id="dialog-trigger" type="button">
          Open dialog
        </button>
        <p id="dialog-text">Dogfood dialog body</p>
        <button id="dialog-inner-action" type="button">
          Inner action
        </button>
        <button slot="footer" id="dialog-footer-action" type="button">
          Footer action
        </button>
      </open-dialog>
      <open-dialog id="ssr-open-dialog" label="SSR open dialog" close-label="关闭" open>
        <p id="ssr-open-text">SSR-opened dialog body</p>
      </open-dialog>
      <button id="after-dialog" type="button">
        After dialog
      </button>
    </main>
  );
}
