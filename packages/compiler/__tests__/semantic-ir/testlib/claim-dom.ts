export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

interface ClaimAttribute {
  name: string;
  value: string;
}

export interface ClaimNode {
  nodeType: number;
  parentNode: ClaimNode | null;
  nodeValue?: string;
  localName?: string;
  tagName?: string;
  namespaceURI?: string | null;
  childNodes?: ClaimNode[];
  readonly firstChild?: ClaimNode | null;
  readonly nextSibling?: ClaimNode | null;
  attributes?: { readonly length: number; item(index: number): ClaimAttribute | null };
  getAttribute?(name: string): string | null;
  hasAttribute?(name: string): boolean;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
  toggleAttribute?(name: string, force?: boolean): boolean;
  appendChild?(node: ClaimNode): ClaimNode;
  insertBefore?(node: ClaimNode, reference: ClaimNode | null): ClaimNode;
  removeChild?(node: ClaimNode): ClaimNode;
  remove?(): void;
}

export function element(tag: string, namespaceURI: string | null = HTML_NAMESPACE): ClaimNode {
  const attrs: ClaimAttribute[] = [];
  const attributes = {
    get length() {
      return attrs.length;
    },
    item(index: number) {
      return attrs[index] ?? null;
    },
  };
  const node: ClaimNode = {
    nodeType: 1,
    parentNode: null,
    localName: tag,
    tagName: tag.toUpperCase(),
    namespaceURI,
    childNodes: [],
    attributes,
    get firstChild() {
      return node.childNodes![0] ?? null;
    },
    get nextSibling() {
      const parent = node.parentNode;
      if (parent === null) return null;
      const siblings = parent.childNodes ?? [];
      const index = siblings.indexOf(node);
      return index < 0 ? null : (siblings[index + 1] ?? null);
    },
    getAttribute: (name) => attrs.find((entry) => entry.name === name)?.value ?? null,
    hasAttribute: (name) => attrs.some((entry) => entry.name === name),
    setAttribute: (name, value) => {
      const found = attrs.find((entry) => entry.name === name);
      if (found) found.value = value;
      else attrs.push({ name, value });
    },
    removeAttribute: (name) => {
      const index = attrs.findIndex((entry) => entry.name === name);
      if (index >= 0) attrs.splice(index, 1);
    },
    toggleAttribute: (name, force) => {
      const has = attrs.some((entry) => entry.name === name);
      const on = force === undefined ? !has : force;
      if (on) node.setAttribute!(name, '');
      else node.removeAttribute!(name);
      return on;
    },
    appendChild: (child) => {
      child.parentNode?.removeChild?.(child);
      child.parentNode = node;
      node.childNodes!.push(child);
      return child;
    },
    insertBefore: (child, reference) => {
      child.parentNode?.removeChild?.(child);
      if (reference === null) return node.appendChild!(child);
      const index = node.childNodes!.indexOf(reference);
      if (index < 0) throw new Error('insertBefore reference is not a child');
      child.parentNode = node;
      node.childNodes!.splice(index, 0, child);
      return child;
    },
    removeChild: (child) => {
      const index = node.childNodes!.indexOf(child);
      if (index < 0) throw new Error('removeChild node is not a child');
      node.childNodes!.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    remove: () => {
      node.parentNode?.removeChild?.(node);
    },
  };
  return node;
}

export function text(value: string): ClaimNode {
  const node: ClaimNode = { nodeType: 3, parentNode: null, nodeValue: value };
  Object.defineProperty(node, 'nextSibling', {
    get() {
      const parent = node.parentNode;
      if (parent === null) return null;
      const siblings = parent.childNodes ?? [];
      const index = siblings.indexOf(node);
      return index < 0 ? null : (siblings[index + 1] ?? null);
    },
  });
  Object.defineProperty(node, 'firstChild', { value: null });
  node.remove = () => node.parentNode?.removeChild?.(node);
  return node;
}

export function comment(value: string): ClaimNode {
  const node: ClaimNode = { nodeType: 8, parentNode: null, nodeValue: value };
  Object.defineProperty(node, 'nextSibling', {
    get() {
      const parent = node.parentNode;
      if (parent === null) return null;
      const siblings = parent.childNodes ?? [];
      const index = siblings.indexOf(node);
      return index < 0 ? null : (siblings[index + 1] ?? null);
    },
  });
  Object.defineProperty(node, 'firstChild', { value: null });
  node.remove = () => node.parentNode?.removeChild?.(node);
  return node;
}
