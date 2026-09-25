/**
 * wc-fixture — third-party Web Components interop island (v0.44
 * compiled, ADR-0143).
 *
 * Foreign widgets stay opaque to the Part Program. Three Lit-based probes
 * carry static, server-born light children; other labels and composed-event
 * listeners are attached at activation. The browser qualifier checks the
 * emitted children, upgrade behavior, and event contract separately.
 */
import { defineIslandConfig } from '@openelement/router';
import { element, OpenElement, property } from '@openelement/element';
import { wcFixtureStyles } from './wc-styles.ts';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('wc-fixture', { root: 'shadow-open' })
export default class ThirdPartyWcFixture extends OpenElement {
  static styles = wcFixtureStyles;

  @property({ reflect: false, attribute: false })
  eventCount = 0;

  /** Shared event sink: bump the compiled counter and log the source. */
  bump(source: string): void {
    this.eventCount++;
    const log = globalThis as unknown as { __thirdPartyWcEventLog?: string[] };
    (log.__thirdPartyWcEventLog ??= []).push(source);
  }

  onDsdHydrated(): void {
    this.activateForeignWidgets();
  }

  onCsrRendered(): void {
    this.activateForeignWidgets();
  }

  /**
   * Register third-party definitions, fill the remaining client-only labels,
   * and attach host listeners for their composed events.
   */
  activateForeignWidgets(): void {
    if (typeof window !== 'undefined') {
      void import('../client/wc-client.ts');
    }
    const root = this.shadowRoot;
    if (!root) return;

    const text = (selector: string, value: string): void => {
      const host = root.querySelector(selector);
      if (host && host.textContent !== value) host.textContent = value;
    };
    const slotLabel = (selector: string, value: string): void => {
      const host = root.querySelector(selector);
      if (!host || host.querySelector("span[slot='label']")) return;
      const label = document.createElement('span');
      label.setAttribute('slot', 'label');
      label.textContent = value;
      host.appendChild(label);
    };
    const on = (selector: string, event: string, source: string): void => {
      const host = root.querySelector(selector);
      host?.addEventListener(event, () => this.bump(source));
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
  }

  render() {
    return (
      <div class='fixture-root'>
        <p id='event-count'>events: {this.eventCount}</p>
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
      </div>
    );
  }
}
