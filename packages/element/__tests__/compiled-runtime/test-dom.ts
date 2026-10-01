export interface TestDomCounts {
  elements: number;
  texts: number;
  comments: number;
  attributes: number;
  textWrites: number;
  valueWrites: number;
  removals: number;
}

export type TestNode = TestElement | TestText | TestComment;

interface TestListener {
  fn: (event: unknown) => void;
  once: boolean;
}

abstract class TestNodeBase {
  readonly ownerDocument: TestDocument;
  parentNode: TestElement | null = null;
  childNodes: TestNode[] = [];

  constructor(ownerDocument: TestDocument) {
    this.ownerDocument = ownerDocument;
  }

  get nextSibling(): TestNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this as unknown as TestNode);
    return index >= 0 ? (this.parentNode.childNodes[index + 1] ?? null) : null;
  }

  getRootNode(): TestNodeBase {
    let root = this.parentNode;
    if (!root) return this;
    while (root.parentNode) root = root.parentNode;
    return root;
  }

  appendChild(node: TestNode): TestNode {
    this.detach(node);
    node.parentNode = this as unknown as TestElement;
    this.childNodes.push(node);
    return node;
  }

  insertBefore(node: TestNode, reference: TestNode | null): TestNode {
    this.detach(node);
    if (reference === null) return this.appendChild(node);
    const index = this.childNodes.indexOf(reference);
    if (index < 0) throw new Error('insertBefore reference is not a child');
    node.parentNode = this as unknown as TestElement;
    this.childNodes.splice(index, 0, node);
    return node;
  }

  removeChild(node: TestNode): TestNode {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error('removeChild node is not a child');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    this.ownerDocument.counts.removals++;
    return node;
  }

  private detach(node: TestNode): void {
    const parent = node.parentNode;
    if (!parent) return;
    const index = parent.childNodes.indexOf(node);
    if (index >= 0) parent.childNodes.splice(index, 1);
    node.parentNode = null;
  }
}

export class TestText extends TestNodeBase {
  readonly nodeType = 3;
  #data: string;

  constructor(ownerDocument: TestDocument, data: string) {
    super(ownerDocument);
    this.#data = data;
  }

  get data(): string {
    return this.#data;
  }

  set data(value: string) {
    this.#data = value;
    this.ownerDocument.counts.textWrites++;
  }
}

export class TestComment extends TestNodeBase {
  readonly nodeType = 8;

  constructor(
    ownerDocument: TestDocument,
    readonly data: string,
  ) {
    super(ownerDocument);
  }
}

export class TestElement extends TestNodeBase {
  readonly nodeType = 1;
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<TestListener>>();
  shadowRoot: TestShadowRoot | null = null;
  #value = '';

  constructor(ownerDocument: TestDocument, tagName: string) {
    super(ownerDocument);
    this.tagName = tagName.toUpperCase();
  }

  get value(): string {
    return this.#value;
  }

  set value(next: string) {
    this.#value = next;
    this.ownerDocument.counts.valueWrites++;
  }

  get innerHTML(): string {
    return this.childNodes.map(toHtml).join('');
  }

  set innerHTML(html: string) {
    for (const child of [...this.childNodes]) this.removeChild(child);
    const fragment = parseHtml(this.ownerDocument, html);
    for (const child of [...fragment.childNodes]) this.appendChild(child);
  }

  simulateUserInput(next: string): void {
    this.#value = next;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    this.ownerDocument.counts.attributes++;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    if (this.attributes.delete(name)) this.ownerDocument.counts.attributes++;
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  addEventListener(type: string, fn: (event: unknown) => void, options?: { once?: boolean }): void {
    const listeners = this.listeners.get(type) ?? new Set<TestListener>();
    listeners.add({ fn, once: options?.once === true });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, fn: (event: unknown) => void): void {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) {
      if (listener.fn === fn) listeners.delete(listener);
    }
  }

  dispatch(type: string): void {
    const listeners = [...(this.listeners.get(type) ?? [])];
    for (const listener of listeners) {
      listener.fn({ type });
      if (listener.once) this.listeners.get(type)?.delete(listener);
    }
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
      listener.fn(event);
      if (listener.once) this.listeners.get(event.type)?.delete(listener);
      if (event.cancelBubble) break;
    }
    if (!event.cancelBubble && event.bubbles) {
      const parent = this.parentNode as unknown;
      if (parent instanceof TestElement || parent instanceof TestShadowRoot) {
        parent.dispatchEvent(event);
      }
    }
    return !event.defaultPrevented;
  }

  attachShadow(init: { mode: 'open' | 'closed' }): TestShadowRoot {
    if (this.shadowRoot) throw new Error('shadow root already exists');
    const root = new TestShadowRoot(this.ownerDocument, this);
    if (init.mode === 'open') this.shadowRoot = root;
    return root;
  }
}

export class TestShadowRoot extends TestNodeBase {
  readonly nodeType = 11;
  readonly adoptedStyleSheets: unknown[] = [];

  constructor(
    ownerDocument: TestDocument,
    readonly host: TestElement,
  ) {
    super(ownerDocument);
  }

  dispatchEvent(event: Event): boolean {
    if (!event.cancelBubble && event.bubbles && event.composed) {
      return this.host.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }
}

export class TestDocument {
  readonly head: TestElement;
  readonly counts: TestDomCounts = {
    elements: 0,
    texts: 0,
    comments: 0,
    attributes: 0,
    textWrites: 0,
    valueWrites: 0,
    removals: 0,
  };

  constructor() {
    this.head = new TestElement(this, 'head');
  }

  createElement(tagName: string): TestElement {
    this.counts.elements++;
    return new TestElement(this, tagName);
  }

  createTextNode(data: string): TestText {
    this.counts.texts++;
    return new TestText(this, data);
  }

  createComment(data: string): TestComment {
    this.counts.comments++;
    return new TestComment(this, data);
  }

  resetCounts(): void {
    for (const key of Object.keys(this.counts) as Array<keyof TestDomCounts>) this.counts[key] = 0;
  }
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function toHtml(node: TestNode): string {
  if (node instanceof TestText) return escapeText(node.data);
  if (node instanceof TestComment) return `<!--${node.data}-->`;
  const tag = node.tagName.toLowerCase();
  const attrs = [...node.attributes.entries()]
    .map(
      ([name, value]) => ` ${name}="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`,
    )
    .join('');
  if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${node.childNodes.map(toHtml).join('')}</${tag}>`;
}

function unescapeText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
}

/** Small deterministic parser for serializer output used only by claim tests. */
export function parseHtml(doc: TestDocument, html: string): TestElement {
  const host = doc.createElement('host');
  const stack: TestElement[] = [host];
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g)) {
    const token = match[0];
    const parent = stack[stack.length - 1];
    if (token.startsWith('<!--')) {
      parent.appendChild(doc.createComment(token.slice(4, -3)));
    } else if (token.startsWith('</')) {
      stack.pop();
    } else if (token.startsWith('<')) {
      const inner = token.slice(1, -1);
      const space = inner.search(/\s/);
      const tag = (space < 0 ? inner : inner.slice(0, space)).toLowerCase();
      const element = doc.createElement(tag);
      const attrs = space < 0 ? '' : inner.slice(space);
      for (const attr of attrs.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
        element.setAttribute(attr[1], unescapeText(attr[2]));
      }
      parent.appendChild(element);
      if (!VOID_TAGS.has(tag)) stack.push(element);
    } else {
      parent.appendChild(doc.createTextNode(unescapeText(token)));
    }
  }
  return host;
}
