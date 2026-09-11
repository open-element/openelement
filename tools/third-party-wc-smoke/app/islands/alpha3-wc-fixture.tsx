/**
 * alpha3-wc-fixture — third-party Web Components interop island (v0.44
 * compiled, ADR-0143).
 *
 * The compiler grammar v1 admits custom-element hosts as opaque static shells
 * (literal attributes only — no children, no event handlers, no slots), so the
 * foreign widgets render into SSR HTML as empty static hosts with their
 * literal attributes, and the imperative seam (onDsdHydrated/onCsrRendered)
 * appends the slotted labels/text and attaches the event listeners against
 * the island's own compiled DOM. The interop evidence (slot projection,
 * attribute→property reflection, composed events) is asserted at the browser
 * level by tools/third-party-wc-smoke.ts.
 */
import { defineIslandConfig } from '@openelement/router';
import { element, OpenElement, property } from '@openelement/element';
import { alpha3WcFixtureStyles } from './alpha3-wc-styles.ts';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('alpha3-wc-fixture', { root: 'shadow-open' })
export default class Alpha3WcFixture extends OpenElement {
  static styles = alpha3WcFixtureStyles;

  @property({ reflect: false, attribute: false })
  eventCount = 0;

  /** Shared event sink: bump the compiled counter and log the source. */
  bump(source: string): void {
    this.eventCount++;
    const log = globalThis as unknown as { __alpha3EventLog?: string[] };
    (log.__alpha3EventLog ??= []).push(source);
  }

  onDsdHydrated(): void {
    this.activateForeignWidgets();
  }

  onCsrRendered(): void {
    this.activateForeignWidgets();
  }

  /**
   * Imperative seam: register the third-party element definitions (client
   * bundle side effect), then stamp the slotted content and event listeners
   * the compiler grammar cannot express declaratively. Host-level listeners
   * catch the composed events after each foreign element upgrades, so
   * stamping does not wait on registration.
   */
  activateForeignWidgets(): void {
    if (typeof window !== 'undefined') {
      void import('../client/alpha3-wc-client.ts');
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

    slotLabel('alpha3-lit-counter', 'Lit slot label');
    slotLabel('alpha3-fast-counter', 'FAST slot label');
    text('sl-button', 'Shoelace Button');
    text('sl-switch', 'Shoelace Switch');
    text('sl-dialog', 'Dialog content');
    text('md-filled-button', 'Material Button');
    text('ion-button', 'Ionic Stencil Button');
    text('alpha3-native-badge', 'Native badge light child');

    on('alpha3-lit-counter', 'lit-count', 'lit-count');
    on('sl-button', 'click', 'sl-button');
    on('sl-switch', 'sl-change', 'sl-switch');
    on('md-filled-button', 'click', 'md-button');
    on('md-switch', 'change', 'md-switch');
    on('alpha3-fast-counter', 'fast-count', 'fast-count');
    on('ion-button', 'click', 'ionic-button');
    on('alpha3-native-badge', 'click', 'native-badge');
  }

  render() {
    return (
      <div class='fixture-root'>
        <p id='event-count'>events: {this.eventCount}</p>
        <section id='lit-section'>
          <h2>Lit</h2>
          <alpha3-lit-counter id='lit-counter' label='Lit counter'></alpha3-lit-counter>
        </section>
        <section id='shoelace-section'>
          <h2>Shoelace</h2>
          <div class='row'>
            <sl-button id='sl-button' variant='primary'></sl-button>
            <sl-switch id='sl-switch'></sl-switch>
          </div>
          <sl-dialog id='sl-dialog' label='Shoelace Dialog'></sl-dialog>
        </section>
        <section id='material-section'>
          <h2>Material Web</h2>
          <div class='row'>
            <md-filled-button id='md-button'></md-filled-button>
            <md-outlined-text-field id='md-field' label='Material Field' value='alpha3'>
            </md-outlined-text-field>
            <md-switch id='md-switch'></md-switch>
          </div>
        </section>
        <section id='interop-section'>
          <h2>Bidirectional</h2>
          <alpha3-lit-host></alpha3-lit-host>
        </section>
        <section id='fast-section'>
          <h2>FAST</h2>
          <alpha3-fast-counter id='fast-counter'></alpha3-fast-counter>
        </section>
        <section id='stencil-section'>
          <h2>Stencil compiled output (Ionic)</h2>
          <ion-button id='ionic-button'></ion-button>
        </section>
        <section id='native-section'>
          <h2>Bare native</h2>
          <alpha3-native-badge id='native-badge'></alpha3-native-badge>
        </section>
      </div>
    );
  }
}
