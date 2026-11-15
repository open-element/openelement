import { css, html, LitElement } from 'lit';
import { FASTElement, html as fastHtml } from '@microsoft/fast-element';
import { defineCustomElement as defineIonButton } from '@ionic/core/components/ion-button.js';

interface UpgradeEntry {
  phase: 'constructor' | 'connected';
  tag: string;
  id: string;
}

interface InteropState {
  upgradeOrder: UpgradeEntry[];
  events: string[];
  existingIdentity: Record<string, boolean>;
  existingLiveState: Record<string, boolean>;
  ready: boolean;
  /** Hits counted by the generated host's authored `onClick` handler (M09-2c channel). */
  generatedHostHits: number;
  /** Pre-upgrade identity/live-state of the foreign children under the generated host. */
  generatedExistingIdentity: Record<string, boolean>;
  generatedExistingLiveState: Record<string, boolean>;
  /**
   * Registry snapshot taken before this module defines the foreign probes. The
   * fixture client is the app's only definer, so `true` is the consumer-form
   * evidence that neither the page, the islands nor the generated host
   * auto-register a foreign tag.
   */
  foreignTagsRegisteredBeforeFixtureClient: boolean;
}

const state = (): InteropState => {
  const global = globalThis as typeof globalThis & {
    __interopState?: InteropState;
  };
  global.__interopState ??= {
    upgradeOrder: [],
    events: [],
    existingIdentity: {},
    existingLiveState: {},
    ready: false,
    generatedHostHits: 0,
    generatedExistingIdentity: {},
    generatedExistingLiveState: {},
    foreignTagsRegisteredBeforeFixtureClient: false,
  };
  return global.__interopState;
};

const probeTags = [
  'interop-native-probe',
  'interop-lit-probe',
  'interop-fast-probe',
  'interop-stencil-probe',
] as const;

/**
 * The foreign children the page authors as the generated host's light DOM.
 * They are the same probe tags; their ids live in the fixture's corpus and are
 * mirrored here so the pre-upgrade capture can find them before any definition
 * runs.
 */
const generatedHostTag = 'interop-generated-host';
const generatedProbeIds = [
  'generated-native',
  'generated-lit',
  'generated-fast',
  'generated-stencil',
] as const;

type LiveStateElement = Element & { __interopLiveState?: string };

function findTag(root: Document | ShadowRoot, tag: string): HTMLElement | null {
  const direct = root.querySelector(tag);
  if (direct) return direct as HTMLElement;
  for (const element of root.querySelectorAll('*')) {
    const shadow = (element as HTMLElement).shadowRoot;
    if (!shadow) continue;
    const found = findTag(shadow, tag);
    if (found) return found;
  }
  return null;
}

function fixtureShadowRoot(): ShadowRoot | null {
  const fixture = findTag(document, 'interop-fixture');
  return fixture?.shadowRoot ?? null;
}

function findById(root: ParentNode, id: string): Element | null {
  return Array.from(root.querySelectorAll('*')).find((element) =>
    (element as HTMLElement).id === id
  ) ?? null;
}

// Capture the authored elements before their definitions run. Custom element
// upgrade must happen in place and must not erase state already held by the
// platform or by the application.
const preUpgradeElements = new Map<string, Element>();
const preUpgradeRoot = fixtureShadowRoot();
if (preUpgradeRoot) {
  for (const tag of probeTags) {
    for (const element of preUpgradeRoot.querySelectorAll(tag)) {
      const liveElement = element as LiveStateElement;
      preUpgradeElements.set(liveElement.id, liveElement);
      liveElement.__interopLiveState = `pre-upgrade:${liveElement.id}`;
    }
  }
}

// The generated-host block authors its foreign children as the host's light
// DOM (the page places them there), so they sit outside the fixture island's
// shadow root. Capture them the same way: the point is that the upgrade of the
// host and of the foreign tags happens in place.
const generatedHostElement = findTag(document, generatedHostTag);
const generatedPreUpgradeElements = new Map<string, Element>();
if (generatedHostElement) {
  for (const id of generatedProbeIds) {
    const element = findById(generatedHostElement, id);
    if (!element) continue;
    const liveElement = element as LiveStateElement;
    generatedPreUpgradeElements.set(id, liveElement);
    liveElement.__interopLiveState = `pre-upgrade:${id}`;
  }
}

// Registry snapshot BEFORE any definition in this module: proves the app does
// not auto-register the foreign probe tags anywhere ahead of the fixture client.
const foreignTagsRegisteredBeforeFixtureClient = probeTags.every(
  (tag) => customElements.get(tag) === undefined,
);

function mark(phase: UpgradeEntry['phase'], element: Element): void {
  state().upgradeOrder.push({ phase, tag: element.localName, id: element.id });
}

function emit(element: Element, event: string): void {
  state().events.push(`${element.id}:${event}`);
  element.dispatchEvent(
    new CustomEvent(event, { bubbles: true, composed: true }),
  );
}

class InteropChildHost extends HTMLElement {
  constructor() {
    super();
    mark('constructor', this);
    this.attachShadow({ mode: 'open' }).innerHTML = '<slot></slot>';
  }

  connectedCallback(): void {
    mark('connected', this);
  }
}

class InteropNativeProbe extends HTMLElement {
  static observedAttributes = ['value'];
  #value = '';

  constructor() {
    super();
    mark('constructor', this);
    this.attachShadow({ mode: 'open' }).innerHTML =
      '<button id="control" part="control" type="button"><slot></slot></button>';
    this.shadowRoot!.querySelector('button')!.addEventListener('click', () => {
      emit(this, 'interop-probe-event');
    });
  }

  connectedCallback(): void {
    mark('connected', this);
  }

  attributeChangedCallback(
    name: string,
    _oldValue: string | null,
    value: string | null,
  ): void {
    if (name === 'value') this.#value = value ?? '';
  }

  get value(): string {
    return this.#value;
  }

  set value(next: string) {
    this.#value = String(next);
    this.setAttribute('value', this.#value);
  }
}

class InteropLitProbe extends LitElement {
  static properties = { value: { type: String, reflect: true } };
  static styles = css`
    :host {
      display: inline-block;
    }
    button {
      padding: 0.25rem;
    }
  `;

  constructor() {
    super();
    mark('constructor', this);
  }

  connectedCallback(): void {
    mark('connected', this);
    super.connectedCallback();
  }

  private onClick(): void {
    emit(this, 'interop-probe-event');
  }

  render() {
    return html`
      <button id="control" part="control" type="button" @click=${this.onClick}>
        <slot></slot>
      </button>
    `;
  }
}

class InteropFastProbe extends FASTElement {
  static observedAttributes = ['value'];

  constructor() {
    super();
    mark('constructor', this);
  }

  connectedCallback(): void {
    mark('connected', this);
    super.connectedCallback();
  }

  get value(): string {
    return this.getAttribute('value') ?? '';
  }

  set value(next: string) {
    this.setAttribute('value', String(next));
  }

  private onClick(): void {
    emit(this, 'interop-probe-event');
  }
}

InteropFastProbe.define({
  name: 'interop-fast-probe',
  template: fastHtml<InteropFastProbe>`
    <button id="control" part="control" type="button" @click=${(component) => component.onClick()}>
      <slot></slot>
    </button>
  `,
});

defineIonButton();
const IonButton = customElements.get('ion-button');
if (!IonButton) throw new Error('Stencil/Ionic ion-button did not register');

class InteropStencilProbe extends IonButton {
  constructor() {
    super();
    mark('constructor', this);
  }

  connectedCallback(): void {
    mark('connected', this);
    super.connectedCallback();
  }
}

customElements.define('interop-child-host', InteropChildHost);
customElements.define('interop-native-probe', InteropNativeProbe);
customElements.define('interop-lit-probe', InteropLitProbe);
customElements.define('interop-stencil-probe', InteropStencilProbe);

const postUpgradeRoot = fixtureShadowRoot();
const existingIdentity: Record<string, boolean> = {};
const existingLiveState: Record<string, boolean> = {};
for (const [id, element] of preUpgradeElements) {
  const liveElement = element as LiveStateElement;
  existingIdentity[id] = postUpgradeRoot !== null &&
    findById(postUpgradeRoot, id) === element;
  existingLiveState[id] = liveElement.__interopLiveState === `pre-upgrade:${id}`;
}

const postGeneratedHost = findTag(document, generatedHostTag);
const generatedExistingIdentity: Record<string, boolean> = {};
const generatedExistingLiveState: Record<string, boolean> = {};
for (const [id, element] of generatedPreUpgradeElements) {
  const liveElement = element as LiveStateElement;
  generatedExistingIdentity[id] = postGeneratedHost !== null &&
    findById(postGeneratedHost, id) === element;
  generatedExistingLiveState[id] =
    liveElement.__interopLiveState === `pre-upgrade:${id}`;
}

const interopGlobal = globalThis as typeof globalThis & {
  __interopState?: InteropState;
};
interopGlobal.__interopState = {
  ...state(),
  existingIdentity,
  existingLiveState,
  generatedExistingIdentity,
  generatedExistingLiveState,
  foreignTagsRegisteredBeforeFixtureClient,
  ready: true,
};
