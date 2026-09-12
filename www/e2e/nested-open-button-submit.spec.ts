/**
 * E2E (#650): <open-button type=submit> nested inside ANOTHER Web Component's
 * shadow root must complete the real SPA action loop.
 *
 * The gap this closes (audit 2026-07-30 §A4): all request-time fixtures use
 * native <button type=submit>, and the only open-button submit coverage is
 * unit-level dispatch (packages/ui/__tests__/components.test.ts). Nothing
 * proved end-to-end that the REAL OpenButton component — not a probe that
 * mirrors it — submits across multiple shadow boundaries into the SPA root
 * listener (spa.ts handleFormSubmit + composedPath retargeting).
 *
 * Layering under test (three shadow boundaries between the clicked button and
 * the root listener):
 *
 *   #spa-probe-root                      ← rootEl: spa.ts submit listener
 *     probe-page        (shadow root 1)  ← route element
 *       probe-card      (shadow root 2)  ← the "another Web Component"
 *         <form> <input name=title>
 *           open-button (shadow root 3)  ← REAL @openelement/ui component
 *             <button part=control>      ← what the user clicks
 *
 * Honest-path guards:
 *  - `window.__stillHere` must survive: if spa.ts failed to preventDefault,
 *    open-button falls back to form.requestSubmit() → native GET navigation
 *    wipes the JS context and the probe times out / the flag dies.
 *  - The action must receive the real FormData harvested from the form that
 *    lives two shadow roots deep.
 *
 * Both spa.ts and open-button.tsx are bundled from the actual sources in
 * memory (browser-bundle.ts); no www page or test re-implementation is used.
 */

import { expect, type Page, test } from '@playwright/test';
import { bundleModuleForBrowser, type SpaModule } from './browser-bundle.ts';

const SPA_ENTRY = new URL('../../packages/app/src/spa.ts', import.meta.url);
const OPEN_BUTTON_ENTRY = new URL(
  '../../packages/ui/src/open-button.tsx',
  import.meta.url,
);

interface OpenButtonModule {
  OpenButton: CustomElementConstructor;
  tagName: string;
}

interface NestedSubmitOutcome {
  /** open-click (composed) observed on document — proves the event chain crossed all boundaries. */
  openClickReachedDocument: boolean;
  /** target tagName seen by the document-level submit listener (retargeting proof). */
  retargetedSubmitTarget: string | null;
  actionCalls: Array<{ title: unknown }>;
  loaderRunsAfterSuccess: number;
  actionDataAfterSuccess: string | null;
  /** JS context survived — no native form navigation happened. */
  stillHere: boolean;
}

async function runNestedOpenButtonProbe(page: Page): Promise<NestedSubmitOutcome> {
  const [spaCode, buttonCode] = await Promise.all([
    bundleModuleForBrowser(SPA_ENTRY),
    bundleModuleForBrowser(OPEN_BUTTON_ENTRY),
  ]);
  await page.goto('/');
  return await page.evaluate(
    async ([spaSource, buttonSource]) => {
      const importBlob = async (code: string): Promise<unknown> => {
        const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        try {
          return await import(url);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      const spaMod = (await importBlob(spaSource)) as unknown as SpaModule;
      const buttonMod = (await importBlob(buttonSource)) as unknown as OpenButtonModule;

      // Register the REAL OpenButton from @openelement/ui source.
      if (!customElements.get('open-button')) {
        customElements.define('open-button', buttonMod.OpenButton);
      }

      const state = {
        loaderRuns: 0,
        actionCalls: [] as Array<{ title: unknown }>,
        openClickReachedDocument: false,
        retargetedSubmitTarget: null as string | null,
      };
      (window as unknown as { __stillHere?: number }).__stillHere = 1;

      // Composed-event observers at the document level. The submit listener
      // here must NOT preventDefault — it only records that the composed
      // event escaped both shadow roots and got retargeted.
      document.addEventListener('open-click', () => {
        state.openClickReachedDocument = true;
      });
      document.addEventListener('submit', (event) => {
        state.retargetedSubmitTarget = (event.target as Element | null)?.tagName ?? null;
      });

      // The "another Web Component": form + open-button live in ITS shadow
      // root, one level below the route element's own shadow root.
      class ProbeCard extends HTMLElement {
        connectedCallback(): void {
          const root = this.attachShadow({ mode: 'open' });
          root.innerHTML = '<form>' +
            '<input name="title" value="deep-shadow">' +
            '<open-button type="submit">Save</open-button>' +
            '</form>';
        }
      }

      // Route element: outputs + the nested card in its own shadow root.
      class ProbePage extends HTMLElement {
        data?: unknown;
        __openElementActionData?: unknown;
        // v0.44 pages receive loader/action state through their descriptor
        // projector; the probe opts into the same explicit seam.
        static openElementPage = {
          props: ({ data, actionData }: { data: unknown; actionData: unknown }) => ({
            data,
            __openElementActionData: actionData,
          }),
        };
        connectedCallback(): void {
          const root = this.attachShadow({ mode: 'open' });
          root.innerHTML = '<output id="loader-data"></output><output id="action-data"></output>' +
            '<probe-card></probe-card>';
          const loaderOut = root.querySelector('#loader-data');
          const actionOut = root.querySelector('#action-data');
          if (loaderOut) loaderOut.textContent = JSON.stringify(this.data ?? null);
          if (actionOut) {
            actionOut.textContent = JSON.stringify(this.__openElementActionData ?? null);
          }
        }
      }

      if (!customElements.get('probe-card')) customElements.define('probe-card', ProbeCard);
      if (!customElements.get('probe-page')) customElements.define('probe-page', ProbePage);

      const app = spaMod.defineApp({
        mode: 'spa',
        routerMode: 'history',
        routes: [{
          path: '*',
          tagName: 'probe-page',
          loader: () => {
            state.loaderRuns += 1;
            return Promise.resolve({ run: state.loaderRuns });
          },
          action: ({ formData }) => {
            state.actionCalls.push({ title: formData?.get('title') ?? null });
            return Promise.resolve({ saved: formData?.get('title') ?? null });
          },
        }],
      });

      const host = document.createElement('div');
      host.id = 'spa-probe-root';
      document.body.appendChild(host);
      app.mount('#spa-probe-root');

      const waitFor = async (condition: () => boolean): Promise<void> => {
        for (let attempt = 0; attempt < 300; attempt++) {
          if (condition()) return;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error('nested open-button probe condition timed out');
      };
      const currentPage = (): HTMLElement | null =>
        document.querySelector('#spa-probe-root probe-page');
      const outputText = (selector: string): string | null =>
        currentPage()?.shadowRoot?.querySelector(selector)?.textContent ?? null;
      const innerButton = (): HTMLButtonElement | null =>
        currentPage()
          ?.shadowRoot?.querySelector('probe-card')
          ?.shadowRoot?.querySelector('open-button')
          ?.shadowRoot?.querySelector('button') ?? null;

      try {
        // Initial loader render + OpenButton finished rendering its shadow
        // <button> (the component renders asynchronously after upgrade).
        await waitFor(() => outputText('#loader-data') === '{"run":1}');
        await waitFor(() => innerButton() !== null);

        // Click the REAL shadow button three boundaries deep.
        innerButton()?.click();
        await waitFor(() => outputText('#action-data') === '{"saved":"deep-shadow"}');

        return {
          openClickReachedDocument: state.openClickReachedDocument,
          retargetedSubmitTarget: state.retargetedSubmitTarget,
          actionCalls: state.actionCalls,
          loaderRunsAfterSuccess: state.loaderRuns,
          actionDataAfterSuccess: outputText('#action-data'),
          stillHere: (window as unknown as { __stillHere?: number }).__stillHere === 1,
        };
      } finally {
        app.dispose();
        host.remove();
      }
    },
    [spaCode, buttonCode] as [string, string],
  );
}

test.describe('nested open-button submit (#650)', () => {
  test('<open-button type=submit> inside another WC shadow root completes the SPA action loop', async ({ page }) => {
    const outcome = await runNestedOpenButtonProbe(page);

    // The composed events escaped BOTH nested shadow roots.
    expect(outcome.openClickReachedDocument).toBe(true);
    // Retargeting proof: by the document tree the submit target is the route
    // host (probe-page), never the form — exactly why handleFormSubmit must
    // walk composedPath() to find the form.
    expect(outcome.retargetedSubmitTarget).toBe('PROBE-PAGE');

    // The action ran once with the real FormData from the form living two
    // shadow roots deep, the loader re-ran, and actionData rendered.
    expect(outcome.actionCalls).toHaveLength(1);
    expect(outcome.actionCalls[0].title).toBe('deep-shadow');
    expect(outcome.loaderRunsAfterSuccess).toBe(2);
    expect(outcome.actionDataAfterSuccess).toBe('{"saved":"deep-shadow"}');

    // No native navigation: spa.ts preventDefault stopped open-button's
    // requestSubmit() fallback, so the JS context survived intact.
    expect(outcome.stillHere).toBe(true);
  });
});
