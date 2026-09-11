/**
 * Counting fake DOM for the micro benchmark suite (issue #1219).
 *
 * Extracted verbatim from the retired tools/benchmark-v044.ts harness. It is
 * deliberately a measurement harness, not a renderer or a compatibility
 * path: every node creation and DOM write increments a deterministic
 * counter, so tests can assert exact DOM-op counts without layout/paint
 * noise.
 */

export interface DomCounts {
  elements: number;
  texts: number;
  comments: number;
  textWrites: number;
  valueWrites: number;
  /** Attribute writes (setAttribute/removeAttribute) — micro diagnostics (#1219). */
  attrWrites: number;
  /** appendChild/insertBefore calls — Region move diagnostics (#1219). */
  insertions: number;
  listenerAdds: number;
  listenerRemoves: number;
  removals: number;
  walkVisits: number;
}

export type FNode = FElement | FText | FComment;

export abstract class FNodeBase {
  readonly ownerDocument: FDocument;
  parentNode: FElement | null = null;
  childNodes: FNode[] = [];

  constructor(ownerDocument: FDocument) {
    this.ownerDocument = ownerDocument;
  }

  get nextSibling(): FNode | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this as unknown as FNode);
    return index >= 0 && index + 1 < siblings.length ? siblings[index + 1] : null;
  }

  appendChild(node: FNode): FNode {
    this.detachForMove(node);
    node.parentNode = this as unknown as FElement;
    this.childNodes.push(node);
    this.ownerDocument.counts.insertions++;
    return node;
  }

  insertBefore(node: FNode, reference: FNode): FNode {
    this.detachForMove(node);
    const index = this.childNodes.indexOf(reference);
    if (index < 0) throw new Error('[v044-performance] insertBefore reference is missing');
    node.parentNode = this as unknown as FElement;
    this.childNodes.splice(index, 0, node);
    this.ownerDocument.counts.insertions++;
    return node;
  }

  private detachForMove(node: FNode): void {
    const parent = node.parentNode;
    if (!parent) return;
    const index = parent.childNodes.indexOf(node);
    if (index >= 0) parent.childNodes.splice(index, 1);
    node.parentNode = null;
  }

  removeChild(node: FNode): FNode {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error('[v044-performance] removeChild node is missing');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    this.ownerDocument.counts.removals++;
    return node;
  }
}

export class FText extends FNodeBase {
  readonly nodeType = 3;
  #data: string;

  constructor(ownerDocument: FDocument, data: string) {
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

export class FComment extends FNodeBase {
  readonly nodeType = 8;

  constructor(ownerDocument: FDocument, readonly data: string) {
    super(ownerDocument);
  }
}

export class FElement extends FNodeBase {
  readonly nodeType = 1;
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<EventListener>>();
  #value: unknown = '';

  constructor(ownerDocument: FDocument, tagName: string) {
    super(ownerDocument);
    this.tagName = tagName.toUpperCase();
  }

  get value(): unknown {
    return this.#value;
  }

  set value(next: unknown) {
    this.#value = next;
    this.ownerDocument.counts.valueWrites++;
  }

  simulateUserInput(next: string): void {
    this.#value = next;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    this.ownerDocument.counts.attrWrites++;
  }

  removeAttribute(name: string): void {
    if (this.attributes.delete(name)) this.ownerDocument.counts.attrWrites++;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }

  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    this.ownerDocument.counts.listenerAdds++;
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (this.listeners.get(type)?.delete(listener)) this.ownerDocument.counts.listenerRemoves++;
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ type } as Event);
  }

  listenerCount(): number {
    let count = 0;
    for (const listeners of this.listeners.values()) count += listeners.size;
    for (const child of this.childNodes) {
      if (child instanceof FElement) count += child.listenerCount();
    }
    return count;
  }
}

export class FDocument {
  readonly counts: DomCounts = {
    elements: 0,
    texts: 0,
    comments: 0,
    textWrites: 0,
    valueWrites: 0,
    attrWrites: 0,
    insertions: 0,
    listenerAdds: 0,
    listenerRemoves: 0,
    removals: 0,
    walkVisits: 0,
  };

  createElement(tagName: string): FElement {
    this.counts.elements++;
    return new FElement(this, tagName);
  }

  createTextNode(data: string): FText {
    this.counts.texts++;
    return new FText(this, data);
  }

  createComment(data: string): FComment {
    this.counts.comments++;
    return new FComment(this, data);
  }

  resetCounts(): void {
    for (const key of Object.keys(this.counts) as Array<keyof DomCounts>) this.counts[key] = 0;
  }
}

const voidTags = new Set([
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

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

function unescapeText(value: string): string {
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll(
    '&amp;',
    '&',
  );
}

export function toHtml(node: FNode): string {
  if (node instanceof FText) return escapeText(node.data);
  if (node instanceof FComment) return `<!--${node.data}-->`;
  const tag = node.tagName.toLowerCase();
  const attrs = Array.from(node.attributes.entries())
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('');
  if (voidTags.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${node.childNodes.map(toHtml).join('')}</${tag}>`;
}

export function parseHtml(doc: FDocument, html: string): FElement {
  const host = doc.createElement('host');
  const stack: FElement[] = [host];
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g)) {
    const token = match[0];
    const parent = stack[stack.length - 1];
    if (token.startsWith('<!--')) {
      parent.appendChild(doc.createComment(token.slice(4, -3)));
    } else if (token.startsWith('</')) {
      if (stack.length === 1) throw new Error('[v044-performance] malformed fixture closing tag');
      stack.pop();
    } else if (token.startsWith('<')) {
      const inner = token.slice(1, -1);
      const space = inner.search(/\s/);
      const tag = (space < 0 ? inner : inner.slice(0, space)).toLowerCase();
      const element = doc.createElement(tag);
      const attrSource = space < 0 ? '' : inner.slice(space);
      for (const attr of attrSource.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
        // Bare attributes parse as present-with-empty-value, matching HTML.
        element.setAttribute(attr[1], unescapeText(attr[2] ?? ''));
      }
      parent.appendChild(element);
      if (!voidTags.has(tag)) stack.push(element);
    } else {
      parent.appendChild(doc.createTextNode(unescapeText(token)));
    }
  }
  if (stack.length !== 1) throw new Error('[v044-performance] malformed fixture opening tag');
  return host;
}

export function allocationCount(counts: DomCounts): number {
  return counts.elements + counts.texts + counts.comments;
}
