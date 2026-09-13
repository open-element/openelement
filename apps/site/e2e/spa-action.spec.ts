/**
 * E2E: SPA form-action chain through real shadow boundaries.
 *
 * The unit suite (spa.test.ts) drives handleFormSubmit with a hand-made
 * event shim (fake composedPath, tagName-only forms). This suite runs the
 * real chain in a browser against the actual defineApp bundle:
 *
 *   1. A submit event composed out of a shadow-DOM button is intercepted by
 *      the SPA root listener, which finds the <form> through composedPath()
 *      (event.target is retargeted to the shadow host) and runs the route
 *      action with the real FormData.
 *   2. After the action resolves, the loader re-runs and both loader data
 *      and actionData render on screen.
 *   3. A throwing action surfaces only the stable { error: 'Action failed' }
 *      shape — the internal error message never reaches the DOM.
 *
 * The probe-submit element mirrors open-button exactly: a shadow button's
 * native submit behavior cannot cross the shadow boundary, so it dispatches
 * a composed submit event on the form and only falls back to requestSubmit
 * when nothing called preventDefault. The SPA bundle is built from the real
 * source in memory (see browser-bundle.ts); no www SPA page is required.
 */

import { expect, type Page, test } from '@playwright/test';
import { bundleModuleForBrowser, type SpaModule } from './browser-bundle.ts';

const SPA_ENTRY = new URL('../../packages/app/src/spa.ts', import.meta.url);

interface SpaProbeOutcome {
  submitDefaultPrevented: boolean;
  actionCalls: Array<{ title: unknown; params: Record<string, string> }>;
  loaderRunsAfterSuccess: number;
  loaderDataAfterSuccess: string | null;
  actionDataAfterSuccess: string | null;
  loaderRunsAfterFailure: number;
  actionDataAfterFailure: string | null;
  leakedInternals: boolean;
}

async function runSpaActionProbe(page: Page): Promise<SpaProbeOutcome> {
  const bundle = await bundleModuleForBrowser(SPA_ENTRY);
  await page.goto('/');
  return await page.evaluate(async (code) => {
    const moduleUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const mod = (await import(moduleUrl)) as unknown as SpaModule;
    URL.revokeObjectURL(moduleUrl);

    const state = {
      loaderRuns: 0,
      actionCalls: [] as Array<{ title: unknown; params: Record<string, string> }>,
      failAction: false,
      submitDefaultPrevented: false,
    };

    // The route page element: renders loader data + actionData and hosts
    // the form inside its own open shadow root.
    class ProbePage extends HTMLElement {
      data?: unknown;
      __openElementActionData?: unknown;
      // v0.44 pages receive loader/action state through their descriptor
      // projector, just like a real compiled page. Keep this probe's DOM
      // contract explicit instead of relying on the removed legacy data bag.
      static openElementPage = {
        props: ({ data, actionData }: { data: unknown; actionData: unknown }) => ({
          data,
          __openElementActionData: actionData,
        }),
      };
      connectedCallback(): void {
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = '<output id="loader-data"></output><output id="action-data"></output>' +
          '<form><input name="title" value="from-shadow"><probe-submit></probe-submit></form>';
        const loaderOut = root.querySelector('#loader-data');
        const actionOut = root.querySelector('#action-data');
        if (loaderOut) loaderOut.textContent = JSON.stringify(this.data ?? null);
        if (actionOut) actionOut.textContent = JSON.stringify(this.__openElementActionData ?? null);
      }
    }

    // Mirrors open-button: the shadow button re-dispatches a composed
    // submit event on the form; requestSubmit only runs when the event was
    // not handled (preventDefault) by the SPA.
    class ProbeSubmit extends HTMLElement {
      connectedCallback(): void {
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = '<button type="button">save</button>';
        root.querySelector('button')?.addEventListener('click', () => {
          const form = this.closest('form');
          if (!form) return;
          const event = new SubmitEvent('submit', {
            bubbles: true,
            cancelable: true,
            composed: true,
          });
          form.dispatchEvent(event);
          state.submitDefaultPrevented = event.defaultPrevented;
          if (!event.defaultPrevented && typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          }
        });
      }
    }

    customElements.define('probe-page', ProbePage);
    customElements.define('probe-submit', ProbeSubmit);

    const app = mod.defineApp({
      mode: 'spa',
      routerMode: 'history',
      routes: [{
        path: '*',
        tagName: 'probe-page',
        loader: () => {
          state.loaderRuns += 1;
          return Promise.resolve({ run: state.loaderRuns });
        },
        action: ({ params, formData }) => {
          state.actionCalls.push({ title: formData?.get('title') ?? null, params: { ...params } });
          if (state.failAction) return Promise.reject(new Error('sensitive internals'));
          return Promise.resolve({ saved: formData?.get('title') ?? null });
        },
      }],
    });

    const host = document.createElement('div');
    host.id = 'spa-probe-root';
    document.body.appendChild(host);
    app.mount('#spa-probe-root');

    const waitFor = async (condition: () => boolean): Promise<void> => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('spa action probe condition timed out');
    };
    const currentPage = (): HTMLElement | null =>
      document.querySelector('#spa-probe-root probe-page');
    const outputText = (selector: string): string | null =>
      currentPage()?.shadowRoot?.querySelector(selector)?.textContent ?? null;
    const clickSave = (): void => {
      currentPage()
        ?.shadowRoot?.querySelector('probe-submit')
        ?.shadowRoot?.querySelector('button')
        ?.click();
    };

    try {
      // Initial loader-driven render.
      await waitFor(() => outputText('#loader-data') === '{"run":1}');

      // ① + ②: shadow submit is intercepted, action gets the FormData, the
      // loader re-runs, and actionData renders on screen.
      clickSave();
      await waitFor(() => outputText('#action-data') === '{"saved":"from-shadow"}');
      const loaderDataAfterSuccess = outputText('#loader-data');
      const actionDataAfterSuccess = outputText('#action-data');
      const loaderRunsAfterSuccess = state.loaderRuns;

      // ③: a throwing action must surface only the stable error shape.
      state.failAction = true;
      clickSave();
      await waitFor(() => outputText('#action-data') === '{"error":"Action failed"}');

      return {
        submitDefaultPrevented: state.submitDefaultPrevented,
        actionCalls: state.actionCalls,
        loaderRunsAfterSuccess,
        loaderDataAfterSuccess,
        actionDataAfterSuccess,
        loaderRunsAfterFailure: state.loaderRuns,
        actionDataAfterFailure: outputText('#action-data'),
        leakedInternals: (host.textContent ?? '').includes('sensitive internals'),
      };
    } finally {
      app.dispose();
      host.remove();
    }
  }, bundle);
}

test.describe('SPA form action chain', () => {
  test('shadow submit runs action with FormData, re-runs loader, renders actionData and the stable error shape', async ({ page }) => {
    const outcome = await runSpaActionProbe(page);

    // ① The composed submit was intercepted by the SPA (preventDefault), and
    // the action received the real FormData from the shadow form.
    expect(outcome.submitDefaultPrevented).toBe(true);
    expect(outcome.actionCalls).toHaveLength(2);
    expect(outcome.actionCalls[0].title).toBe('from-shadow');

    // ② The loader re-ran after the action and both data sets rendered.
    expect(outcome.loaderRunsAfterSuccess).toBe(2);
    expect(outcome.loaderDataAfterSuccess).toBe('{"run":2}');
    expect(outcome.actionDataAfterSuccess).toBe('{"saved":"from-shadow"}');

    // ③ A throwing action exposes only { error: 'Action failed' }; the
    // loader still re-ran and internal details never reached the DOM.
    expect(outcome.loaderRunsAfterFailure).toBe(3);
    expect(outcome.actionDataAfterFailure).toBe('{"error":"Action failed"}');
    expect(outcome.leakedInternals).toBe(false);
  });
});
