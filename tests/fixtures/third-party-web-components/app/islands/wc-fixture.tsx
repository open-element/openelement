/**
 * wc-fixture — third-party Web Components interop island (v0.44
 * compiled, ADR-0143).
 *
 * Foreign widgets stay opaque to the Part Program. Three Lit-based probes
 * carry static, server-born light children; other labels and composed-event
 * listeners are attached at activation. The browser qualifier checks the
 * emitted children, upgrade behavior, and event contract separately.
 *
 * GENERATED lane (F16: class → function). `root: 'shadow'` reproduces the class
 * lane's `shadow-open`, and here it is the single most load-bearing fact in the
 * fixture: the qualifier only recognises the SSR form through
 * `<wc-fixture><template shadowrootmode` (a DSD template directly after the
 * host tag) and then reads every probe out of `wc-fixture.shadowRoot`. A light
 * root would fail the form check and move all eleven foreign hosts into the
 * page tree at once.
 *
 * `eventCount` keeps the class lane's `reflect: false, attribute: false` exactly:
 * it was property-only, so a sidecar row would be a new attribute wire the class
 * refused. The default stays on the typed member AND in the body's `??` for the
 * reason that fixture's sibling pages record — the shell applies the row default
 * before any projection, and `??` keeps the render total when nothing supplies
 * it.
 *
 * The counter is a component-local SIGNAL, not a plain local, because the class
 * lane had a reactive field: `#event-count` is the one sink that must re-render
 * when a foreign composed event bumps the count from a listener that fires long
 * after activation. A plain `let` would emit a static text node and every
 * click would be invisible to the probe.
 *
 * The host is read inside the connect callback (`env.host`) rather than through
 * a top-level `useHost()`. This island renders `ssr: true`, and the SSR producer
 * walks the module-level declarations it sees: a top-level `const host =
 * useHost()` captured by a module-level helper makes the PRODUCER require a
 * `host` binding it is never handed (`OEIR_LEAF_MISSING_VALUE`, measured as the
 * /third-party-wc 500 during this migration), whereas a `useHost()` read confined
 * to the connect callback stays out of the producer entirely.
 */
import { onConnect, signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  dsd: true,
  root: 'shadow',
  styles: ['./wc-fixture.css'],
  properties: {
    eventCount: { reflect: false, attribute: false, default: 0 },
  },
});

export default function ThirdPartyWcFixture(props: { eventCount: number }) {
  const eventCount = signal(props.eventCount ?? 0);
  /**
   * Register third-party definitions, fill the remaining client-only labels,
   * and attach host listeners for their composed events.
   *
   * Runs on EVERY connection, which is what the class lane's two hooks
   * (`onDsdHydrated` for the claim path, `onCsrRendered` for the fresh-creation
   * path) collapse into: the generated lane replays this callback after either
   * activation.
   */
  const activateForeignWidgets = (host: HTMLElement): void => {
    // Host globals are spelled `globalThis.` throughout: the compiled setup
    // resolves a bare identifier against an ECMAScript-only allowlist, so
    // `window` / `document` / `setTimeout` fail closed with OEIR_UNRESOLVED_BINDING
    // while the property read on `globalThis` does not (16b-migration-note;
    // www/app/islands/open-page-rail.tsx).
    if (typeof globalThis.window !== 'undefined') {
      void import('../client/wc-client.ts');
      // The late-host corpus rides its OWN dynamically imported module: every
      // host it creates must land after the scheduler's ready-time read, which
      // is the whole shape under qualification.
      void import('../client/wc-late-hosts.ts').then((module) =>
        module.installLateLightHosts(host.shadowRoot),
      );
    }
    const root = host.shadowRoot;
    if (!root) return;

    /**
     * Shared event sink: bump the signal and log the source.
     *
     * The log lives on `globalThis` rather than in a field because the class
     * lane's per-instance field was never read back through the element — the
     * qualifier reads this array off the window.
     */
    const bump = (source: string): void => {
      eventCount.value = eventCount.value + 1;
      const log = globalThis as unknown as { __thirdPartyWcEventLog?: string[] };
      (log.__thirdPartyWcEventLog ??= []).push(source);
    };

    const text = (selector: string, value: string): void => {
      const target = root.querySelector(selector);
      if (target && target.textContent !== value) target.textContent = value;
    };
    const slotLabel = (selector: string, value: string): void => {
      const target = root.querySelector(selector);
      if (!target || target.querySelector("span[slot='label']")) return;
      const label = globalThis.document.createElement('span');
      label.setAttribute('slot', 'label');
      label.textContent = value;
      target.appendChild(label);
    };
    const on = (selector: string, event: string, source: string): void => {
      const target = root.querySelector(selector);
      target?.addEventListener(event, () => bump(source));
    };

    slotLabel('wc-lit-counter', 'Lit slot label');
    slotLabel('wc-fast-counter', 'FAST slot label');
    text('sl-button', 'Shoelace Button');
    text('sl-switch', 'Shoelace Switch');
    text('sl-dialog', 'Dialog content');
    text('md-filled-button', 'Material Button');
    text('ion-button', 'Ionic Stencil Button');
    text('wc-native-badge', 'Native badge light child');

    on('wc-lit-counter', 'lit-count', 'lit-count');
    on('sl-button', 'click', 'sl-button');
    on('sl-switch', 'sl-change', 'sl-switch');
    on('md-filled-button', 'click', 'md-button');
    on('md-switch', 'change', 'md-switch');
    on('wc-fast-counter', 'fast-count', 'fast-count');
    on('ion-button', 'click', 'ionic-button');
    on('wc-native-badge', 'click', 'native-badge');
  };

  // NOT safe to scan at connect: `onConnect` is replayed in the claim/mount
  // PROLOGUE, before the generated region is the rendered tree (16b-migration-
  // note R2), and this callback queries that region for eleven foreign hosts and
  // writes into them. One macrotask lands the scan after the synchronous connect
  // pass — exactly when the class lane's hooks used to run. The clear on the
  // per-connection abort keeps a disconnect from firing a stale scan into the
  // next connection.
  onConnect((env) => {
    const timer = globalThis.setTimeout(() => activateForeignWidgets(env.host), 0);
    env.signal.addEventListener('abort', () => globalThis.clearTimeout(timer));
  });
  return (
    <div class='fixture-root'>
      <p id='event-count'>events: {eventCount.value}</p>
      <section id='lit-section'>
        <h2>Lit</h2>
        <wc-lit-counter id='lit-counter' label='Lit counter'>
          <span slot='label'>Lit slot label</span>
        </wc-lit-counter>
      </section>
      <section id='shoelace-section'>
        <h2>Shoelace</h2>
        <div class='row'>
          <sl-button id='sl-button' variant='primary'>Shoelace Button</sl-button>
          <sl-switch id='sl-switch'></sl-switch>
        </div>
        <sl-dialog id='sl-dialog' label='Shoelace Dialog'></sl-dialog>
      </section>
      <section id='material-section'>
        <h2>Material Web</h2>
        <div class='row'>
          <md-filled-button id='md-button'>Material Button</md-filled-button>
          <md-outlined-text-field id='md-field' label='Material Field' value='interop'>
          </md-outlined-text-field>
          <md-switch id='md-switch'></md-switch>
        </div>
      </section>
      <section id='interop-section'>
        <h2>Bidirectional</h2>
        <wc-lit-host></wc-lit-host>
      </section>
      <section id='fast-section'>
        <h2>FAST</h2>
        <wc-fast-counter id='fast-counter'></wc-fast-counter>
      </section>
      <section id='stencil-section'>
        <h2>Stencil compiled output (Ionic)</h2>
        <ion-button id='ionic-button'></ion-button>
      </section>
      <section id='native-section'>
        <h2>Bare native</h2>
        <wc-native-badge id='native-badge'></wc-native-badge>
      </section>
      {/*
        The late-host corpus. None of these hosts exists in the SSR markup:
        each wc-*-host upgrades only once the dynamically imported module
        defines it, and only then does it attach a shadow root (or append to
        its light DOM) and create the island tag inside. That is the exact
        sequence the ready-time page-scope read cannot see.
      */}
      <section id='late-host-section'>
        <h2>Late hosts (created after activation)</h2>
        <div class='row'>
          <wc-fast-host id='fast-host'></wc-fast-host>
          <wc-native-late-host id='native-host'></wc-native-late-host>
          <wc-nested-outer id='nested-host'></wc-nested-outer>
          <wc-stencil-host id='stencil-host'></wc-stencil-host>
          <wc-closed-host id='closed-host'></wc-closed-host>
        </div>
      </section>
    </div>
  );
}
