/**
 * stream-lit-client — the Lit module behind <stream-lit-pill> (#1451 T2).
 *
 * Client-only, exactly like the third-party fixture's app/client/wc-client.ts:
 * it is reached solely through a guarded dynamic import from the
 * stream-lit-probe island's activation hooks, so the server never executes a
 * Lit registration. The module defines one deterministic probe element:
 *
 * - shadow DOM contains a labeled button and a named slot;
 * - light-DOM slot children (born on the server inside the streamed shell)
 *   are projected through <slot name='label'>;
 * - clicking the button increments the count property — interaction survives
 *   the stream backfill that lands in a neighboring Part of the same page.
 *
 * The `lit` bare specifier resolves through the workspace import map pin
 * (`lit: npm:lit@3.3.3`, the same pin the third-party and router-lit
 * fixtures use) and the workspace node_modules; the fixture's own deno.json
 * stays untouched because router-native-framework shares its dependency
 * universe (and byte-identical lockfile) with router-request-time.
 */
import { css, html, LitElement } from 'lit';

export class StreamLitPill extends LitElement {
  static override properties = {
    count: { type: Number },
  };

  /**
   * Type-only declaration: Lit builds the reactive `count` accessor from
   * `static properties` at define time. A real class field would install an
   * own value with [[Define]] semantics and shadow that accessor (see the
   * constructor note below), so the type is declared without emitting one.
   */
  declare count: number;

  static override styles = css`
    :host {
      display: inline-flex;
      gap: 0.5rem;
      align-items: center;
    }
    button {
      cursor: pointer;
    }
  `;

  /**
   * Initialize through the constructor, not a class field: a native class
   * field `count = 0` is installed with [[Define]] semantics and shadows the
   * prototype accessor Lit builds from `static properties`, so `this.count++`
   * would mutate the own field without ever scheduling a re-render. The
   * constructor assignment goes through the accessor instead.
   */
  constructor() {
    super();
    this.count = 0;
  }

  #increment(): void {
    this.count++;
  }

  override render() {
    return html`
      <slot name="label"></slot>
      <button id="pill-button" @click="${() => this.#increment()}">pill: ${this.count}</button>
    `;
  }
}

if (!customElements.get('stream-lit-pill')) {
  customElements.define('stream-lit-pill', StreamLitPill);
}
