/**
 * Shared DOM stubs for Deno test environment.
 *
 * Used by preact.test.ts and preact-smoke.test.ts. The stub semantics are
 * strict on purpose: insertBefore preserves insertion order, removeChild
 * throws for non-children and clears parentNode.
 *
 * When Deno's HTMLElement becomes available natively, delete this.
 */

export class StubNode {
  nodeType: number;
  nodeName: string;
  localName: string;
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  childNodes: Node[] = [];
  parentNode: StubNode | null = null;
  data = '';
  nodeValue: string | null = null;
  #attrs: Array<{ name: string; value: string }> = [];

  constructor(nodeType = 1, nodeName = 'DIV') {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.localName = nodeName.toLowerCase();
  }

  get firstChild(): Node | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): Node | null {
    return this.childNodes.at(-1) ?? null;
  }

  get nextSibling(): Node | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this as unknown as Node);
    return this.parentNode.childNodes[index + 1] ?? null;
  }

  get previousSibling(): Node | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this as unknown as Node);
    return this.parentNode.childNodes[index - 1] ?? null;
  }

  #adopt(node: Node): void {
    const previousParent = (node as { parentNode?: StubNode | null }).parentNode;
    previousParent?.removeChild(node);
    Object.defineProperty(node, 'parentNode', {
      value: this,
      writable: true,
      configurable: true,
    });
  }

  appendChild(node: Node): Node {
    this.#adopt(node);
    this.childNodes.push(node);
    return node;
  }

  insertBefore(node: Node, refChild: Node | null): Node {
    if (refChild == null) {
      return this.appendChild(node);
    }
    if (!this.childNodes.includes(refChild)) {
      throw new Error('Reference node not found');
    }
    this.#adopt(node);
    const index = this.childNodes.indexOf(refChild);
    this.childNodes.splice(index, 0, node);
    return node;
  }

  removeChild(node: Node): Node {
    const index = this.childNodes.indexOf(node);
    if (index === -1) {
      throw new Error('Node not found');
    }
    this.childNodes.splice(index, 1);
    Object.defineProperty(node, 'parentNode', {
      value: null,
      writable: true,
      configurable: true,
    });
    return node;
  }

  get attributes(): Array<{ name: string; value: string }> {
    return this.#attrs;
  }

  get textContent(): string {
    if (this.nodeType === 3) return this.data;
    return this.childNodes.map((child) => (child as unknown as StubNode).textContent ?? '').join(
      '',
    );
  }

  set textContent(value: string) {
    this.childNodes = [];
    this.appendChild(new StubTextNode(value) as unknown as Node);
  }

  setAttribute(name: string, value: string): void {
    const existing = this.#attrs.findIndex((attr) => attr.name === name);
    if (existing >= 0) {
      this.#attrs[existing] = { name, value };
    } else {
      this.#attrs.push({ name, value });
    }
  }

  getAttribute(name: string): string | null {
    return this.#attrs.find((attr) => attr.name === name)?.value ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }

  removeAttribute(name: string): void {
    this.#attrs = this.#attrs.filter((attr) => attr.name !== name);
  }

  addEventListener(): void {}
  removeEventListener(): void {}
}

/**
 * Minimal HTMLElement stub that supports OpenElement's lifecycle APIs:
 * attachShadow, shadowRoot, attributes (iterable), getAttribute/setAttribute/hasAttribute/removeAttribute.
 */
export class TestElement extends StubNode {
  shadowRoot: ShadowRoot | null = null;

  constructor() {
    super();
  }

  attachShadow(): ShadowRoot {
    this.shadowRoot = new StubNode() as unknown as ShadowRoot;
    return this.shadowRoot;
  }

  get isConnected(): boolean {
    return true;
  }

  get tagName(): string {
    return 'TEST-ELEMENT';
  }
}

export class StubTextNode extends StubNode {
  constructor(text: string) {
    super(3, '#text');
    this.data = text;
    this.nodeValue = text;
  }
}

export function installDomStubs(): () => void {
  const previousCustomElements = globalThis.customElements;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousDocument = globalThis.document;
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancelRaf = globalThis.cancelAnimationFrame;
  const registry = new Map<string, CustomElementConstructor>();
  (globalThis as { customElements?: CustomElementRegistry }).customElements = {
    define(name: string, ctor: CustomElementConstructor) {
      registry.set(name, ctor);
    },
    get(name: string) {
      return registry.get(name);
    },
  } as CustomElementRegistry;

  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = TestElement as never;
  (globalThis as { document?: Document }).document = {
    createElement(tagName: string) {
      return new StubNode(1, tagName.toUpperCase());
    },
    createElementNS(_namespace: string, tagName: string) {
      return new StubNode(1, tagName.toUpperCase());
    },
    createTextNode(text: string) {
      return new StubTextNode(text);
    },
  } as unknown as Document;
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame })
    .requestAnimationFrame = (
      callback,
    ) => {
      callback(performance.now());
      return 1;
    };
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame })
    .cancelAnimationFrame = () => {};

  return () => {
    (globalThis as { customElements?: CustomElementRegistry }).customElements =
      previousCustomElements;
    (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = previousHTMLElement;
    (globalThis as { document?: Document }).document = previousDocument;
    (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame })
      .requestAnimationFrame = previousRaf;
    (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame })
      .cancelAnimationFrame = previousCancelRaf;
  };
}

/** Simulate SSR by temporarily deleting globalThis.document. */
export function suppressDocument(): () => void {
  const origDoc = globalThis.document;
  // @ts-expect-error - intentionally clearing for SSR test
  delete globalThis.document;
  return () => {
    (globalThis as { document?: Document }).document = origDoc;
  };
}
