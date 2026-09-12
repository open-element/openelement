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
 * (packages/adapter-vite/__fixtures__/ui-dogfood, www/e2e/theme-system.spec.ts).
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
  style = { setProperty: (_name: string, _value: string) => {} };

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
  /** documentElement.setAttribute arguments, in order. */
  docAttributes: Array<readonly [string, string]>;
  /** documentElement.style.colorScheme assignments, in order. */
  colorSchemes: string[];
  docTheme?: string;
  mediaLight?: boolean;
}

export function themeHarness(init: Partial<ThemeHarness>): ThemeHarness {
  return {
    savedTheme: null,
    writes: [],
    dispatched: [],
    docAttributes: [],
    colorSchemes: [],
    ...init,
  };
}

/**
 * Install the globals open-theme-toggle reads: a fresh capturing
 * document.documentElement (per call, so tests never leak dataset.theme into
 * each other), localStorage, matchMedia, CustomEvent and a dispatchEvent
 * wrapper that records every global event.
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
    getAttribute: () => null,
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
    value: (query: string) => ({
      matches: query.includes('light') ? harness.mediaLight === true : false,
    }),
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
      return prevDispatch ? prevDispatch(event) : true;
    },
  });
}

// ─── open-dialog fakes ───────────────────────────────────────────────────────

export interface FakeDialog {
  open: boolean;
  calls: string[];
  show(): void;
  showModal(): void;
  close(): void;
  setAttribute(name: string, value: string): void;
}

export function fakeDialog(): FakeDialog {
  const calls: string[] = [];
  const fake: FakeDialog = {
    open: false,
    calls,
    show: () => {
      calls.push('show');
      fake.open = true;
    },
    showModal: () => {
      calls.push('showModal');
      fake.open = true;
    },
    close: () => {
      calls.push('close');
      fake.open = false;
    },
    setAttribute: (name: string, _value: string) => {
      calls.push(`setAttribute:${name}`);
      if (name === 'open') fake.open = true;
    },
  };
  return fake;
}

/** An uncompiled OpenDialog whose shadow root resolves `dialog` to `fake`. */
export function dialogWith(fake: FakeDialog, mode?: string) {
  return (async () => {
    const { OpenDialog } = await import('../src/open-dialog.tsx');
    // deno-lint-ignore no-explicit-any
    const el = new (OpenDialog as unknown as new () => any)();
    el.shadowRoot = { querySelector: (sel: string) => (sel === 'dialog' ? fake : null) };
    if (mode) el.setAttribute('mode', mode);
    return el;
  })();
}
