/**
 * form-probe — island that makes form participation observable (#1226).
 *
 * The /form page shell is not registered client-side, so the submit/reset
 * listeners live here: on activation the probe wires the form (found through
 * its own root node — the page shadow root) and echoes FormData entries into
 * #form-output with default prevented, so the browser never navigates.
 *
 * GENERATED lane (2026-11-21 closeout: class → function). `root: 'shadow'`
 * reproduces the class lane's `shadow-open`: the e2e readiness probe reads
 * `form-probe`'s OWN shadowRoot for `#probe-status`, so a light root would move
 * that node into the page tree and the probe would never be found.
 */
import { onConnect } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  dsd: true,
  root: 'shadow',
  properties: {
    // The class declared `attribute: false`, so `status` never had an attribute
    // wire — only the initializer's value, which becomes the declared default.
    // The e2e readiness probe waits for the SSR text `probe-idle` to become
    // `probe-wired`, so that default is part of the observable contract.
    status: { attribute: false, default: 'probe-idle' },
  },
});

/** The host surface the probe writes: `status` is the one declared row. */
interface FormProbeHost extends HTMLElement {
  status: string;
}

export default function FormProbe(props: { status: string }) {
  // Both class hooks (onDsdHydrated for the claim path, onCsrRendered for the
  // fresh-creation path) collapse into this one connect callback: the generated
  // lane runs it after either activation, which is the same moment the class
  // lane had two spellings for.
  onConnect((env) => {
    const host = env.host as FormProbeHost;
    const root = host.getRootNode() as unknown as ParentNode;
    const form = root.querySelector<HTMLFormElement>('#dogfood-form');
    const output = root.querySelector<HTMLOutputElement>('#form-output');
    if (!form || !output) return;
    // Reconnect-safe: the listeners outlive a move, so wire at most once.
    if (form.dataset.probeWired === 'true') return;
    form.dataset.probeWired = 'true';
    const echo = (): void => {
      // `globalThis.` is the lane's one spelling for a host global: the compiled
      // setup resolves a bare identifier against an ECMAScript-only allowlist,
      // so `new FormData(...)` / `setTimeout(...)` fail closed with
      // OEIR_UNRESOLVED_BINDING while the property read on `globalThis` does not.
      const data = new globalThis.FormData(form);
      output.textContent = JSON.stringify(Object.fromEntries(data.entries()));
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      echo();
    });
    form.addEventListener('reset', () => {
      // formResetCallback runs as a queued custom-element reaction — after a
      // microtask queued from this listener — so the echo waits a macrotask.
      globalThis.setTimeout(echo, 0);
    });
    // A declared row write, the same change channel the class setter used, so
    // the rendered `#probe-status` text follows it.
    host.status = 'probe-wired';
  });

  return <p id="probe-status">{props.status}</p>;
}
