/**
 * Shared unit-test harness for @openelement/ui package-level tests.
 *
 * Deno tests import the component sources uncompiled (no Part Program), so
 * nothing here connects an element to the kernel: the fakes below exist to
 * exercise the imperative methods the compiler copies verbatim (lifecycle
 * choreography, event dispatch, form dialog state machines). Semantics that
 * only exist in the compiled program — attribute ↔ signal sinks, computed
 * reactivity, ElementInternals attachment, connectedCallback scheduling — are
 * NOT observable through this harness; those are covered by the element
 * package's compiled suites and by the browser-level fixtures
 * (tests/fixtures/router-ui-dogfood, www/e2e/theme-system.spec.ts).
 */

type TestAttributeStore = WeakMap<object, Map<string, string>>;
type TestListenerStore = WeakMap<object, Map<string, Set<EventListener>>>;

/**
 * Minimal fake HTMLElement. `shadowRoot` is a writable own field so tests can
 * install a fake render root per instance; attributes and listeners are kept
 * in per-instance stores so multi-instance assertions stay truthful.
 */
class TestHTMLElement {
  static observedAttributes?: readonly string[];

  shadowRoot: unknown = null;
  // A real read-back so assertion rows can observe the properties the
  // activation applies (anchor-name and the --oe-dropdown-anchor channel).
  readonly #styleProps = new Map<string, string>();
  style = {
    setProperty: (name: string, value: string) => {
      this.#styleProps.set(name, value);
    },
    getPropertyValue: (name: string) => this.#styleProps.get(name) ?? '',
    removeProperty: (name: string) => {
      this.#styleProps.delete(name);
    },
  };

  readonly #attributes: TestAttributeStore;
  readonly #listeners: TestListenerStore;

  constructor(attributes: TestAttributeStore, listeners: TestListenerStore) {
    this.#attributes = attributes;
    this.#listeners = listeners;
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(this)?.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    let attributes = this.#attributes.get(this);
    if (!attributes) {
      attributes = new Map();
      this.#attributes.set(this, attributes);
    }
    attributes.set(name, value);
  }
  hasAttribute(name: string): boolean {
    return this.#attributes.get(this)?.has(name) ?? false;
  }
  removeAttribute(name: string): void {
    this.#attributes.get(this)?.delete(name);
  }
  addEventListener(type: string, listener: EventListener): void {
    let listeners = this.#listeners.get(this);
    if (!listeners) {
      listeners = new Map();
      this.#listeners.set(this, listeners);
    }
    let typed = listeners.get(type);
    if (!typed) {
      typed = new Set();
      listeners.set(type, typed);
    }
    typed.add(listener);
  }
  removeEventListener(type: string, listener: EventListener): void {
    this.#listeners.get(this)?.get(type)?.delete(listener);
  }
  dispatchEvent(event: Event): boolean {
    const listeners = this.#listeners.get(this)?.get(event.type);
    for (const listener of listeners ?? []) listener.call(this, event);
    return true;
  }
  getRootNode(): Node {
    return this as unknown as Node;
  }
  querySelector(): Element | null {
    return null;
  }
  querySelectorAll(): NodeListOf<Element> {
    return [] as unknown as NodeListOf<Element>;
  }
}

/** Install the fake HTMLElement/document globals exactly once per process. */
export function installDomHarness(): void {
  if (typeof globalThis.HTMLElement !== 'undefined') return;
  const attributes: TestAttributeStore = new WeakMap();
  const listeners: TestListenerStore = new WeakMap();
  const ElementBase = class extends TestHTMLElement {
    constructor() {
      super(attributes, listeners);
    }
  } as unknown as typeof HTMLElement;
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: ElementBase,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: {
        dataset: {},
        style: {},
        getAttribute: () => null,
        setAttribute: () => {},
      },
      createElement: () => new ElementBase(),
      createTreeWalker: () => ({ nextNode: () => null }),
      querySelector: () => null,
      querySelectorAll: () => [],
      body: new ElementBase(),
      head: new ElementBase(),
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    } as unknown as Document,
  });
}

// ─── open-theme-toggle environment ──────────────────────────────────────────

export interface ThemeHarness {
  savedTheme: string | null;
  /** localStorage.setItem values, in order. */
  writes: string[];
  /** globalThis.dispatchEvent event types, in order. */
  dispatched: string[];
  /** `CustomEvent.detail` of every dispatched event, in order (parallel array). */
  eventDetails: unknown[];
  /** documentElement.setAttribute arguments, in order. */
  docAttributes: Array<readonly [string, string]>;
  /** documentElement.style.colorScheme assignments, in order. */
  colorSchemes: string[];
  docTheme?: string;
  mediaLight?: boolean;
  /** Make matchMedia throw, like an embedded WebView with no media support. */
  mediaThrows?: boolean;
}

export function themeHarness(init: Partial<ThemeHarness>): ThemeHarness {
  return {
    savedTheme: null,
    writes: [],
    dispatched: [],
    eventDetails: [],
    docAttributes: [],
    colorSchemes: [],
    ...init,
  };
}

/**
 * Install the globals open-theme-toggle reads: a fresh capturing
 * document.documentElement (per call, so tests never leak dataset.theme into
 * each other), localStorage, matchMedia, CustomEvent and a dispatchEvent
 * wrapper that records every global event's type and detail.
 */
export function installThemeGlobals(harness: ThemeHarness): void {
  const style: Record<string, string> = {};
  Object.defineProperty(style, 'colorScheme', {
    configurable: true,
    get: () => harness.colorSchemes[harness.colorSchemes.length - 1],
    set: (value: string) => {
      harness.colorSchemes.push(value);
    },
  });
  const documentElement = {
    dataset: {} as Record<string, string>,
    style,
    // A realistic read-back: the seam owner's idempotent write compares against
    // the attribute actually present, so a same-value hydration writes nothing.
    getAttribute: (name: string) =>
      name === 'data-theme' ? (documentElement.dataset.theme ?? null) : null,
    setAttribute: (name: string, value: string) => {
      harness.docAttributes.push([name, value]);
      if (name === 'data-theme') documentElement.dataset.theme = value;
    },
  };
  if (harness.docTheme !== undefined) documentElement.dataset.theme = harness.docTheme;
  Object.defineProperty(document, 'documentElement', {
    configurable: true,
    writable: true,
    value: documentElement,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => harness.savedTheme,
      setItem: (_key: string, value: string) => {
        harness.writes.push(value);
      },
    },
  });
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      if (harness.mediaThrows === true) throw new Error('matchMedia unavailable');
      return { matches: query.includes('light') ? harness.mediaLight === true : false };
    },
  });
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: class extends Event {
      detail: unknown;
      constructor(type: string, init?: CustomEventInit) {
        super(type, init);
        this.detail = init?.detail;
      }
    },
  });
  const prevDispatch = globalThis.dispatchEvent;
  Object.defineProperty(globalThis, 'dispatchEvent', {
    configurable: true,
    value: (event: Event) => {
      harness.dispatched.push((event as CustomEvent).type);
      harness.eventDetails.push((event as CustomEvent).detail);
      return prevDispatch ? prevDispatch(event) : true;
    },
  });
}

// ─── open-dialog fakes ───────────────────────────────────────────────────────

export interface FakeDialog {
  open: boolean;
  calls: string[];
  /** Platform top-layer session mirror: true while `:modal` matches. */
  modal: boolean;
  show(): void;
  showModal(): void;
  close(): void;
  matches(selector: string): boolean;
  setAttribute(name: string, value: string): void;
}

export function fakeDialog(): FakeDialog {
  const calls: string[] = [];
  const fake: FakeDialog = {
    open: false,
    calls,
    modal: false,
    show: () => {
      calls.push('show');
      fake.open = true;
    },
    showModal: () => {
      calls.push('showModal');
      fake.open = true;
      fake.modal = true;
    },
    close: () => {
      calls.push('close');
      fake.open = false;
      fake.modal = false;
    },
    matches: (selector: string) => selector === ':modal' && fake.modal,
    setAttribute: (name: string, _value: string) => {
      calls.push(`setAttribute:${name}`);
      if (name === 'open') fake.open = true;
    },
  };
  return fake;
}

/**
 * A fake generated-element host whose shadow root resolves `dialog` to
 * `fake` and whose declared `open` property stands in for the compiled row:
 * the dialog-machine helpers take this host shape directly.
 */
export function dialogHostWith(fake: FakeDialog, mode?: string) {
  installDomHarness();
  // oxlint-disable-next-line no-explicit-any
  const el = new (globalThis.HTMLElement as unknown as new () => any)();
  el.shadowRoot = { querySelector: (sel: string) => (sel === 'dialog' ? fake : null) };
  if (mode) el.setAttribute('mode', mode);
  el.open = false;
  return el;
}

/**
 * A fake generated-element host whose shadow root resolves `.content` to
 * `content` and whose declared `anchorName` property stands in for the
 * compiled row: the dropdown-machine helpers take this host shape directly.
 */
export function dropdownHostWith(content: Record<string, unknown>) {
  installDomHarness();
  // The compiled content leaf's inline-style guard reads the attribute API.
  if (typeof (content as { hasAttribute?: unknown }).hasAttribute !== 'function') {
    const attributes = new Set<string>();
    Object.assign(content, {
      hasAttribute: (name: string) => attributes.has(name),
      removeAttribute: (name: string) => attributes.delete(name),
      setAttribute: (name: string) => attributes.add(name),
    });
  }
  // oxlint-disable-next-line no-explicit-any
  const el = new (globalThis.HTMLElement as unknown as new () => any)();
  el.shadowRoot = {
    querySelector: (sel: string) => (sel === '.content' ? content : null),
    // The focus-return listeners wire on the retained shadow root (the
    // popover's beforetoggle/toggle events neither bubble nor compose, so the
    // root is the last node on their truncated path).
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  el.anchorName = '';
  return el;
}
