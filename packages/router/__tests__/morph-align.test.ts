/**
 * Unit tests for the morph tree alignment (morph-align.ts) — driven through
 * createMorphAlign with a minimal fake DOM, the same harness style as
 * enhance-client.test.ts (no browser/DOM library in the Deno test runtime).
 */
import { assertEquals } from '@std/assert';
import { createMorphAlign } from '../src/vite/internal/ssg/morph-align.ts';

type Win = Window & typeof globalThis;

class FakeNode {
  nodeType = 1;
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get nextSibling(): FakeNode | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this);
    return index >= 0 ? siblings[index + 1] ?? null : null;
  }
  appendChild(node: FakeNode): void {
    this.insertBefore(node, null);
  }
  insertBefore(node: FakeNode, ref: FakeNode | null): void {
    node.remove();
    node.parentNode = this;
    const index = ref ? this.childNodes.indexOf(ref) : -1;
    if (index >= 0) this.childNodes.splice(index, 0, node);
    else this.childNodes.push(node);
  }
  remove(): void {
    if (!this.parentNode) return;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentNode = null;
  }
  replaceWith(node: FakeNode): void {
    const parent = this.parentNode;
    if (!parent) return;
    parent.insertBefore(node, this);
    this.remove();
  }
}

class FakeText extends FakeNode {
  override nodeType = 3;
  constructor(public data: string) {
    super();
  }
}

class FakeElement extends FakeNode {
  override nodeType = 1;
  id = '';
  shadowRoot: FakeNode | null = null;
  /** Template content fragment (template[shadowrootmode] only). */
  content: FakeNode | null = null;
  attrs = new Map<string, string>();
  constructor(public tagName: string) {
    super();
  }
  get attributes(): { name: string; value: string }[] {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
}

function el(tag: string, ...children: FakeNode[]): FakeElement {
  const node = new FakeElement(tag.toUpperCase());
  for (const child of children) node.appendChild(child);
  return node;
}

function text(data: string): FakeText {
  return new FakeText(data);
}

/** A <template shadowrootmode> whose content fragment carries the shadow tree. */
function shadowTemplate(...content: FakeNode[]): FakeElement {
  const template = el('template');
  template.setAttribute('shadowrootmode', 'open');
  const fragment = new FakeNode();
  for (const child of content) fragment.appendChild(child);
  template.content = fragment;
  return template;
}

function isDsdTemplate(node: FakeNode): boolean {
  return node instanceof FakeElement && node.tagName === 'TEMPLATE' &&
    node.hasAttribute('shadowrootmode');
}

function makeHarness(options: {
  tags?: string[];
  islandIntact?: () => boolean;
} = {}) {
  const incomingQueue: { title: string; body: FakeElement }[] = [];
  const instantiated: FakeNode[] = [];
  const doc = { title: '', body: el('body') };
  const win = {
    CSS: { escape: (s: string) => s },
    DOMParser: class {
      parseFromString(): { title: string; body: FakeElement } {
        const next = incomingQueue.shift();
        if (!next) throw new Error('no incoming document queued');
        return next;
      }
    },
  };
  const align = createMorphAlign({
    log: { warn: () => {} },
    win: win as unknown as Win,
    doc: doc as unknown as Document,
    tags: options.tags ?? [],
    webkit: {
      instantiateDsd: (node: unknown) => {
        instantiated.push(node as FakeNode);
      },
      repairShadowUpgrades: () => {},
    },
    islands: {
      islandIntact: options.islandIntact ?? (() => false),
      observeVisible: () => {},
    },
    focus: { captureFocus: () => null, restoreFocus: () => {} },
    scroll: { captureScroll: () => ({ x: 0, y: 0 }), restoreScroll: () => {} },
  });
  return { align, doc, incomingQueue, instantiated };
}

Deno.test('morph: a preserved slot-fallback app shell receives the new route document', () => {
  const { align, doc, incomingQueue } = makeHarness({
    tags: ['app-shell'],
    // The legacy light-surface comparison sees both hosts as empty and would
    // preserve the stale shell wholesale without the slot-fallback path.
    islandIntact: () => true,
  });

  const host = el('app-shell');
  const liveShadow = new FakeNode();
  liveShadow.appendChild(
    el('main', el('slot', el('contact-page', el('p', text('before'))))),
  );
  host.shadowRoot = liveShadow;
  doc.body.appendChild(host);

  incomingQueue.push({
    title: '',
    body: el(
      'body',
      el(
        'app-shell',
        shadowTemplate(
          el('main', el('slot', el('contact-page', el('p', text('after'))))),
        ),
      ),
    ),
  });

  assertEquals(align.morphDocument('<html></html>', null, null), true);
  const main = liveShadow.childNodes[0] as FakeElement;
  const slot = main.childNodes[0] as FakeElement;
  const page = slot.childNodes[0] as FakeElement;
  const paragraph = page.childNodes[0] as FakeElement;
  assertEquals((paragraph.childNodes[0] as FakeText).data, 'after');
  assertEquals(doc.body.childNodes[0], host, 'the activated shell host survives');
});

Deno.test('morph: the light-DOM pass never inserts an inert DSD template into a live host', () => {
  const { align, doc, incomingQueue, instantiated } = makeHarness();

  // Live host: already DSD-instantiated (shadowRoot set) with a slotted
  // light-DOM child — the #937 slot-based shell shape.
  const host = el('page-x', el('span', text('slotted')));
  const liveShadow = new FakeNode();
  liveShadow.appendChild(el('p', text('shadow v1')));
  host.shadowRoot = liveShadow;
  doc.body.appendChild(host);

  // Incoming document: the host carries its shadow tree as an inert
  // <template shadowrootmode> child plus the slotted light DOM.
  const buildIncoming = () => ({
    title: '',
    body: el(
      'body',
      el('page-x', shadowTemplate(el('p', text('shadow v2'))), el('span', text('slotted'))),
    ),
  });
  incomingQueue.push(buildIncoming(), buildIncoming());

  const morphedOnce = align.morphDocument('<html></html>', null, null);
  const morphedTwice = align.morphDocument('<html></html>', null, null);
  assertEquals(morphedOnce, true, 'first morph applies');
  assertEquals(morphedTwice, true, 'second morph applies');

  const leaked = host.childNodes.filter(isDsdTemplate);
  assertEquals(
    leaked.length,
    0,
    'host light DOM must not retain a template[shadowrootmode] node',
  );
  // The shadow tree itself IS morphed from the template content.
  const shadowText = (liveShadow.childNodes[0] as FakeElement).childNodes[0] as FakeText;
  assertEquals(shadowText.data, 'shadow v2', 'shadow content follows the incoming template');
  // The slotted light DOM child survives the morph.
  assertEquals(
    host.childNodes.some((n) => n instanceof FakeElement && n.tagName === 'SPAN'),
    true,
    'slotted light DOM child is preserved',
  );
  // No template node was ever pushed through DSD instantiation as a light
  // child (instantiateDsd's querySelectorAll does not match the node itself).
  assertEquals(instantiated.filter(isDsdTemplate).length, 0);
});
