/**
 * Pre-upgrade replay double-delivery across a 422 morph (live.spec.ts:185).
 *
 * WHY THIS FILE LIVES IN `packages/router/__tests__`. The contract it documents
 * is a seam between two owners:
 *   - the morph client (`src/vite/internal/ssg/morph-align.ts` +
 *     `island-lifecycle.ts`, router) decides that a hydrated island SURVIVES the
 *     morph (`islandIntact` true) but the parent alignment still MOVES it
 *     (`morphChildren` -> `insertBefore`), which runs the platform's
 *     `disconnectedCallback`/`connectedCallback` pair;
 *   - the generated-element shell (element) calls its pre-upgrade replay at that
 *     reconnect (shell.ts:2844), and the replay registry (element) only pins its
 *     first-activation cutoff at the root's first REPLAY PASS
 *     (pre-upgrade-events.ts:478-480), not at the element's first activation.
 * The bug is only visible when both halves are composed, so the pin needs the
 * real router half. The element half is a MODEL inside `createReplayModel`, with
 * every line mapped to the production line it transcribes; the authoritative
 * end-to-end reproduction (real built fixture, real chromium) is recorded in the
 * F16 diagnosis report for live.spec.ts:185, not here.
 *
 * MEASURED MECHANISM (fixture `router-request-time`, chromium, built dist):
 *   1. `page.goto('/form')`; `live-counter` is a generated-lane island whose
 *      activation factory imports ONLY its island chunk (entry-client-codegen.ts
 *      activation factory for generated islands), so its first connect can run
 *      BEFORE the entry loads the element runtime that installs the page capture
 *      (`ensurePreHydrationClickCapture(document, __tags)`, client entry's
 *      `__loadElementRuntime().then`). Measured chromium: island connect at
 *      15.6ms / 19.6ms vs capture install at 16.7ms / 20.8ms in 2 of 6 runs
 *      (those 2 runs measured count 4 after the morph); the other 4 chromium
 *      runs and 12 of 12 firefox/webkit runs had capture-before-island and
 *      stayed at 3. That ordering race is the "chromium only" part.
 *   2. `markPreUpgradeIslandSettled` has NO production call site (git grep: only
 *      the definition in pre-upgrade-events.ts:117 and the internal re-export;
 *      the class facade that used to call it was deleted in 5ff82e101), so the
 *      capture's pending-owner filter (pre-upgrade-events.ts:201-234) keeps
 *      accepting clicks inside the already-hydrated island. Each of the 3 live
 *      clicks is retained as one record (per target/type, latest wins,
 *      pre-upgrade-events.ts:308-344).
 *   3. The 422 response moves `span[data-error="none"]` to `p#error`; the parent
 *      morph moves the intact `live-counter` (browser log: `insertBefore` with
 *      the live node) -> disconnected + connected.
 *   4. At the reconnect the shell replays (shell.ts:2844). The hook was null at
 *      the island's true first activation, so no bucket/cutoff was pinned there;
 *      the reconnect's `adoptRootBucket` (pre-upgrade-events.ts:638-656) is the
 *      root's FIRST adoption, adopts the retained click, and
 *      `replayPreUpgradeEvents` dispatches it (`isTrusted` still true because the
 *      recorded native Event object is re-dispatched). Measured: one dispatch on
 *      `button#increment`, count 3 -> 4. A second 422 morph adds nothing (the
 *      bucket is adopted and drained), i.e. exactly one extra increment per
 *      island activation lifetime, not per morph.
 *
 * CLASS-LANE COMPARISON (git, measured committed history): before the class lane
 * was deleted, the facade marked its host settled in `finally`
 * (`open-element-implementation.ts:408` at 5ff82e101^) and replayed ONLY on a
 * non-resumed claim (`activation.resumed` guard, same file :386-390). Both
 * protections are absent from the generated shell, so this is a REGRESSION
 * introduced by the class->generated migration, not a pre-existing quirk.
 *
 * PROPOSED FIX (element, out of this file's write scope; NOT applied):
 *   packages/element/src/internal/compiled/generated-element/shell.ts:2844
 *     -   replayPreUpgradeCaptures(this);
 *     +   if (!hadInstance) replayPreUpgradeCaptures(this);
 *   `hadInstance` already exists at shell.ts:2787 (`state.instance !== null`);
 *   it is exactly the class lane's `activation.resumed` fact. Verified against
 *   the built fixture in /tmp: gating the emitted `Dn(this)` call the same way
 *   took the exact live.spec.ts:185 flow from 2/5 + 2/6 failing chromium runs
 *   (count 4) to 8/8 + 5/5 clean (count 3), while both activation orderings
 *   still occurred. The second defect above (settle marker never set) should be
 *   a follow-up row: it retains live traffic page-long and lets an enclosing
 *   root's first activation replay a nested island's live click.
 *
 * Test layout:
 *   - `morph: ...` uses ONLY the real router code (createMorphAlign +
 *     createIslandLifecycle) over a minimal fake DOM; it pins the reconnect
 *     trigger.
 *   - the replay tests add the documented element-side model and pin (a) the
 *     ordering that passes, (b) the defect, (c) the proposed fix's contract.
 */
import { expect, test } from 'vitest';
import { createMorphAlign } from '../src/vite/internal/ssg/morph-align.ts';
import { createIslandLifecycle } from '../src/vite/internal/ssg/island-lifecycle.ts';

type Win = Window & typeof globalThis;

// ─── Minimal fake DOM (platform semantics the morph/replay path needs) ──────

const DOCUMENT_NODE = 9;
const DOCUMENT_FRAGMENT_NODE = 11;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

class FakeNode {
  nodeType = ELEMENT_NODE;
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  /** Shadow roots only: their host, so connectivity composes across the boundary. */
  host: FakeNode | null = null;

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  get nextSibling(): FakeNode | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this);
    return index >= 0 ? (siblings[index + 1] ?? null) : null;
  }

  /** True when the node composes to the document root through parentNode/host. */
  get isConnected(): boolean {
    return isNodeConnected(this);
  }

  appendChild<T extends FakeNode>(node: T): T {
    return this.insertBefore(node, null);
  }

  /**
   * Platform pre-insert semantics: a node that already has a parent is REMOVED
   * first (firing the custom-element disconnect reaction) and inserted second
   * (firing the connect reaction), even when the final position is unchanged.
   * That is why `morphChildren`'s `insertBefore` re-arms an island.
   */
  insertBefore<T extends FakeNode>(node: T, reference: FakeNode | null): T {
    if (node.parentNode) node.parentNode.detachInternal(node);
    const insertAt =
      reference === null ? this.childNodes.length : this.childNodes.indexOf(reference);
    if (insertAt < 0) throw new Error('insertBefore: reference node is not a child of this node');
    this.childNodes.splice(insertAt, 0, node);
    node.parentNode = this;
    if (this.isConnected) notifyConnected(node);
    return node;
  }

  removeChild<T extends FakeNode>(node: T): T {
    this.detachInternal(node);
    return node;
  }

  remove(): void {
    if (this.parentNode) this.parentNode.detachInternal(this);
  }

  replaceWith(node: FakeNode): void {
    const parent = this.parentNode;
    if (!parent) return;
    parent.insertBefore(node, this);
    parent.detachInternal(this);
  }

  protected detachInternal(node: FakeNode): void {
    const index = this.childNodes.indexOf(node);
    if (index < 0) return;
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    if (!node.isConnected) notifyDisconnected(node);
  }
}

/** Custom-element reactions, in tree order, across shadow boundaries. */
function notifyConnected(node: FakeNode): void {
  if (node instanceof FakeElement) {
    const callback = (node as unknown as { connectedCallback?: () => void }).connectedCallback;
    if (typeof callback === 'function') callback.call(node);
  }
  for (const child of node.childNodes) notifyConnected(child);
  const shadow = (node as FakeElement).shadowRoot;
  if (shadow) for (const child of shadow.childNodes) notifyConnected(child);
}

function notifyDisconnected(node: FakeNode): void {
  if (node instanceof FakeElement) {
    const callback = (node as unknown as { disconnectedCallback?: () => void })
      .disconnectedCallback;
    if (typeof callback === 'function') callback.call(node);
  }
  for (const child of node.childNodes) notifyDisconnected(child);
  const shadow = (node as FakeElement).shadowRoot;
  if (shadow) for (const child of shadow.childNodes) notifyDisconnected(child);
}

/** Composed connectivity walk (crosses shadow roots through their host). */
function isNodeConnected(node: FakeNode): boolean {
  let current: FakeNode | null = node;
  for (let depth = 0; current && depth < 1024; depth++) {
    if (current.parentNode) {
      current = current.parentNode;
    } else if (current.host) {
      current = current.host;
    } else {
      return current.nodeType === DOCUMENT_NODE;
    }
  }
  return false;
}

class FakeText extends FakeNode {
  override nodeType = TEXT_NODE;
  data: string;
  constructor(data: string) {
    super();
    this.data = data;
  }
}

class FakeComment extends FakeNode {
  override nodeType = COMMENT_NODE;
  data: string;
  constructor(data: string) {
    super();
    this.data = data;
  }
}

class FakeShadowRoot extends FakeNode {
  override nodeType = DOCUMENT_FRAGMENT_NODE;
  override host: FakeNode | null;
  constructor(host: FakeNode) {
    super();
    this.host = host;
  }
}

type ClickListener = (event: { type: string; target: FakeElement }) => void;

interface FakeAttribute {
  name: string;
  value: string;
}

class FakeElement extends FakeNode {
  override nodeType = ELEMENT_NODE;
  tagName: string;
  attrs = new Map<string, string>();
  shadowRoot: FakeShadowRoot | null = null;
  /** Template content (only `template[shadowrootmode]` uses it). */
  content: FakeNode | null = null;
  listeners = new Map<string, ClickListener[]>();

  constructor(tag: string) {
    super();
    this.tagName = tag.toUpperCase();
  }

  get id(): string {
    return this.getAttribute('id') ?? '';
  }

  set id(value: string) {
    this.setAttribute('id', value);
  }

  get attributes(): FakeAttribute[] {
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

  addEventListener(type: string, listener: ClickListener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  dispatchEvent(event: { type: string; target?: FakeElement }): boolean {
    const withTarget = event as { type: string; target: FakeElement };
    withTarget.target = this;
    for (const listener of this.listeners.get(event.type) ?? []) listener(withTarget);
    return true;
  }
}

class FakeDocument extends FakeNode {
  override nodeType = DOCUMENT_NODE;
  title = '';
  activeElement: FakeElement | null = null;
  body: FakeElement;
  constructor() {
    super();
    this.body = new FakeElement('body');
    this.body.parentNode = this;
  }
}

function el(tag: string, ...children: FakeNode[]): FakeElement {
  const node = new FakeElement(tag);
  for (const child of children) node.appendChild(child);
  return node;
}

const text = (data: string): FakeText => new FakeText(data);
const comment = (data: string): FakeComment => new FakeComment(data);

/** `<template shadowrootmode="open">` whose content fragment carries a shadow tree. */
function shadowTemplate(...content: FakeNode[]): FakeElement {
  const template = el('template');
  template.setAttribute('shadowrootmode', 'open');
  const fragment = new FakeNode();
  fragment.nodeType = DOCUMENT_FRAGMENT_NODE;
  for (const child of content) fragment.appendChild(child);
  template.content = fragment;
  return template;
}

// ─── Replay model: transcribes the element-side registry + shell call sites ──

interface CapturedClick {
  target: FakeElement;
  type: 'click';
  /** The ORIGINAL (trusted) event object — production re-dispatches this object. */
  event: { type: string; target?: FakeElement };
  seq: number;
}

interface ReplayModel {
  /** entry-client-codegen.ts:729 — capture install also publishes the hook. */
  installCapture(): void;
  /** pre-upgrade-events.ts:362-410 capture listener + :201-234 accept filter. */
  captureClick(island: FakeElement, event: { type: string; target?: FakeElement }): void;
  /** pre-upgrade-events.ts:729-731 (`replayPreUpgradeCaptures`). */
  replay(root: FakeNode): void;
  /** pre-upgrade-events.ts:740-742 (`releasePreUpgradeCapturesFor`). */
  release(root: FakeNode): void;
  /** Test instrumentation: the records the replay actually delivered. */
  readonly replayed: CapturedClick[];
}

/**
 * The documented model of `pre-upgrade-events.ts`'s facade registry. Every
 * behaviour below mirrors a specific production line; nothing here is invented:
 *   - the shared pending pool + one-record-per-target/type dedup (:308-344);
 *   - the accept filter's pending-owner rule (:201-234) — and the measured fact
 *     that `markPreUpgradeIslandSettled` has no production caller, so the
 *     settled set is permanently empty and live traffic inside a hydrated
 *     declared island is still captured;
 *   - one-time bucket adoption + replay + release (:471-525, :638-656,
 *     :729-742);
 *   - the first-activation cutoff pinned at the root's FIRST REPLAY PASS
 *     (:478-480) — the exact approximation the bug exploits;
 *   - the hook being a null no-op before the capture is installed
 *     (pre-upgrade-replay-hook.ts:57-64).
 */
function createReplayModel(): ReplayModel {
  const DECLARED_ISLAND_TAGS = new Set(['form-page', 'live-counter']);
  let sequence = 0;
  let hookInstalled = false;
  const pool: CapturedClick[] = [];
  const buckets = new WeakMap<object, { events: CapturedClick[]; adopted: boolean }>();
  const consumed = new WeakSet<object>();
  const cutoffByRoot = new WeakMap<object, number>();
  const replayed: CapturedClick[] = [];

  const isInsideRoot = (root: FakeNode, target: FakeNode): boolean => {
    let current: FakeNode | null = target;
    for (let depth = 0; current && depth < 1024; depth++) {
      if (current === root) return true;
      current = current.parentNode ?? current.host;
    }
    return false;
  };

  const adopt = (root: FakeNode): CapturedClick[] => {
    let bucket = buckets.get(root);
    if (!bucket) {
      bucket = { events: [], adopted: false };
      buckets.set(root, bucket);
    }
    if (bucket.adopted) return bucket.events;
    bucket.adopted = true;
    for (let index = pool.length - 1; index >= 0; index--) {
      if (isInsideRoot(root, pool[index].target)) {
        bucket.events.push(pool[index]);
        pool.splice(index, 1);
      }
    }
    return bucket.events;
  };

  return {
    installCapture(): void {
      hookInstalled = true;
    },

    captureClick(island: FakeElement, event): void {
      // The composed path of a click on the island's increment button: the
      // button, the island's shadow root, the declared host — all declared
      // hosts are unsettled because the settle marker is never set.
      const path: FakeNode[] = [island];
      const declaredOnPath = path.some((node) =>
        DECLARED_ISLAND_TAGS.has((node as FakeElement).tagName?.toLowerCase() ?? ''),
      );
      if (!declaredOnPath) return;
      sequence += 1;
      const record: CapturedClick = {
        target: (event as { target: FakeElement }).target,
        type: 'click',
        event,
        seq: sequence,
      };
      const existing = pool.findIndex(
        (candidate) => candidate.target === record.target && candidate.type === 'click',
      );
      if (existing >= 0) pool[existing] = record;
      else pool.push(record);
    },

    replay(root: FakeNode): void {
      if (!hookInstalled) return; // null hook is a correct no-op
      const events = adopt(root);
      const seenCutoff = cutoffByRoot.get(root);
      const cutoff = seenCutoff ?? sequence;
      if (seenCutoff === undefined) cutoffByRoot.set(root, cutoff);
      for (const record of events.slice()) {
        if (record.seq > cutoff) continue; // post-activation interaction: live island handled it
        if (consumed.has(record)) continue;
        if (!isInsideRoot(root, record.target)) continue;
        consumed.add(record);
        if (!record.target.isConnected) continue;
        replayed.push(record);
        record.target.dispatchEvent(record.event);
      }
    },

    release(root: FakeNode): void {
      if (!hookInstalled) return; // null hook is a correct no-op
      adopt(root).length = 0;
    },

    replayed,
  };
}

// ─── Island model: the generated shell's connect/activation protocol ─────────

interface LiveCounterOptions {
  count: number;
  replayModel: ReplayModel;
  /**
   * true  = production shell shape: shell.ts:2844 replays on EVERY connect.
   * false = proposed fix shape: replay is gated on `!hadInstance`
   *         (shell.ts:2787), the class facade's `activation.resumed` rule.
   */
  replayOnEveryConnect: boolean;
}

class LiveCounterHost extends FakeElement {
  count: number;
  connects = 0;
  disconnects = 0;
  button: FakeElement;
  readonly replayModel: ReplayModel;
  readonly replayOnEveryConnect: boolean;
  private hadInstance = false;
  private countText: FakeText;

  constructor(options: LiveCounterOptions) {
    super('live-counter');
    this.count = options.count;
    this.replayModel = options.replayModel;
    this.replayOnEveryConnect = options.replayOnEveryConnect;

    const shadow = new FakeShadowRoot(this);
    this.shadowRoot = shadow;
    const row = el('div');
    row.setAttribute('class', 'counter-row');
    this.button = el('button', text(' + '));
    this.button.setAttribute('id', 'increment');
    this.button.setAttribute('type', 'button');
    this.button.addEventListener('click', () => this.increment());
    const countSpan = el('span');
    countSpan.setAttribute('id', 'count');
    this.countText = text(String(this.count));
    countSpan.appendChild(this.countText);
    row.appendChild(this.button);
    row.appendChild(countSpan);
    shadow.appendChild(row);
  }

  increment(): void {
    this.count += 1;
    this.countText.data = String(this.count);
  }

  /** shell.ts:2801-2905 `connectedCallback` — claim + replay + release. */
  connectedCallback(): void {
    const hadInstance = this.hadInstance;
    this.hadInstance = true;
    this.connects += 1;
    // shell.ts:2844: replay runs at EVERY successful claim/mount in production.
    if (this.replayOnEveryConnect || !hadInstance) this.replayModel.replay(this);
    // shell.ts:2919 finally: activation decision, win or lose.
    this.replayModel.release(this);
  }

  /** shell.ts:2810-2845 `disconnectedCallback` keeps the retained instance/state. */
  disconnectedCallback(): void {
    this.disconnects += 1;
  }
}

// ─── Harness ────────────────────────────────────────────────────────────────

interface FormPageTree {
  host: FakeElement;
  island: LiveCounterHost;
  main: FakeElement;
}

/**
 * The `/form` page's claimed shadow tree, transcribed from the fixture's built
 * HTML (the SSR emits no whitespace between `main`'s children; the conditional
 * branch is wrapped in `<!--oe:when-->` comments). The 422 response swaps
 * `span[data-error="none"]` for `p#error`, which is what makes the parent
 * alignment move the otherwise-intact island.
 */
function buildLiveFormPage(options: LiveCounterOptions): FormPageTree {
  const island = new LiveCounterHost(options);
  const body = el('form');
  body.setAttribute('method', 'post');
  body.setAttribute('data-open-enhance', 'true');
  const errorPlaceholder = el('span');
  errorPlaceholder.setAttribute('data-error', 'none');
  const echoParagraph = el('p', text('echo='));
  echoParagraph.setAttribute('id', 'echo');
  const main = el(
    'main',
    el('h1', text('request-time form')),
    body,
    comment('oe:when'),
    errorPlaceholder,
    comment('oe:/when'),
    echoParagraph,
    island,
  );
  const host = new FakeElement('form-page');
  // The claim consumed the SSR prop-seed transport attribute: the live host
  // carries no attributes (see morph-align.ts CONSUMED_TRANSPORT_ATTRIBUTE).
  const shadow = new FakeShadowRoot(host);
  host.shadowRoot = shadow;
  shadow.appendChild(main);
  return { host, island, main };
}

/** The 422 response's `form-page` element (inert template shadow tree). */
function buildIncomingErrorFormPage(): FakeElement {
  const incomingIsland = new FakeElement('live-counter');
  incomingIsland.appendChild(
    shadowTemplate(
      (() => {
        const row = el('div');
        row.setAttribute('class', 'counter-row');
        const button = el('button', text(' + '));
        button.setAttribute('id', 'increment');
        const span = el('span');
        span.setAttribute('id', 'count');
        row.appendChild(button);
        row.appendChild(span);
        return row;
      })(),
    ),
  );
  const error = el('p', text('message is required'));
  error.setAttribute('id', 'error');
  const echo = el('p', text('echo='));
  echo.setAttribute('id', 'echo');
  const main = el(
    'main',
    el('h1', text('request-time form')),
    (() => {
      const body = el('form');
      body.setAttribute('method', 'post');
      body.setAttribute('data-open-enhance', 'true');
      return body;
    })(),
    comment('oe:when'),
    error,
    comment('oe:/when'),
    echo,
    incomingIsland,
  );
  const host = new FakeElement('form-page');
  host.setAttribute('data-oe-prop-seed', '{"hasError":1}');
  host.appendChild(shadowTemplate(main));
  return host;
}

interface MorphHarness {
  doc: FakeDocument;
  align: ReturnType<typeof createMorphAlign>;
  instantiated: FakeNode[];
  /** Queue the next 422-style incoming document (consumed by one morph). */
  queue(incoming: FakeElement): void;
}

function makeMorphHarness(): MorphHarness {
  const doc = new FakeDocument();
  const instantiated: FakeNode[] = [];
  const islands = createIslandLifecycle({ observeVisible: () => {} });
  let queuedIncoming: { title: string; body: FakeElement } | null = null;
  const win = {
    CSS: { escape: (value: string) => value },
    DOMParser: class {
      parseFromString(): { title: string; body: FakeElement } {
        if (!queuedIncoming) throw new Error('no incoming document queued');
        const next = queuedIncoming;
        queuedIncoming = null;
        return next;
      }
    },
  };
  const align = createMorphAlign({
    log: { warn: () => {} },
    win: win as unknown as Win,
    doc: doc as unknown as Document,
    // The fixture's generated client entry emits its morph tag list WITHOUT page
    // roots (page-root admission, F16 §8) and with the generated islands.
    tags: ['live-counter'],
    webkit: {
      instantiateDsd: (node: unknown) => {
        instantiated.push(node as FakeNode);
      },
      repairShadowUpgrades: () => {},
    },
    islands: {
      islandIntact: islands.islandIntact,
      observeVisible: islands.observeVisible,
    },
    focus: { captureFocus: () => null, restoreFocus: () => {} },
    scroll: { captureScroll: () => ({ x: 0, y: 0 }), restoreScroll: () => {} },
  });
  return {
    doc,
    align,
    instantiated,
    // A queued incoming document is consumed by the next morph.
    queue(incoming: FakeElement) {
      queuedIncoming = {
        title: '',
        body: (() => {
          const body = new FakeElement('body');
          body.appendChild(incoming);
          return body;
        })(),
      };
    },
  } as MorphHarness & { queue(incoming: FakeElement): void };
}

/** A trusted user click: document capture first, then the live target handler. */
function userClick(island: LiveCounterHost): { type: string; target?: FakeElement } {
  const event: { type: string; target?: FakeElement } = { type: 'click' };
  island.replayModel.captureClick(island, Object.assign(event, { target: island.button }));
  island.button.dispatchEvent(event);
  return event;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test('morph: the 422 error-branch shift moves a hydrated island that islandIntact() preserves', () => {
  const model = createReplayModel();
  const { doc, align, queue } = makeMorphHarness();
  const tree = buildLiveFormPage({ count: 3, replayModel: model, replayOnEveryConnect: true });
  doc.body.appendChild(tree.host);
  expect(tree.island.connects, 'first activation ran at mount').toBe(1);
  expect(tree.island.disconnects).toBe(0);

  queue(buildIncomingErrorFormPage());
  expect(align.morphDocument('<html></html>', null, null)).toBe(true);

  // The island is NOT replaced (islandIntact says it survives) — the same node
  // is still in the live shadow tree...
  expect(tree.main.childNodes.includes(tree.island), 'same island node survives').toBe(true);
  // ...but the parent alignment MOVED it (insertBefore -> platform reconnect),
  // which is the lifecycle event the shell reacts to.
  expect(tree.island.disconnects, 'morph moved the island: one disconnect').toBe(1);
  expect(tree.island.connects, 'morph moved the island: one reconnect').toBe(2);
  expect(tree.island.count, 'the retained instance kept its state').toBe(3);
  // The 422 branch really is in place (the failure echo the e2e asserts).
  const errorParagraph = tree.main.childNodes.find(
    (node) => node instanceof FakeElement && node.tagName === 'P' && node.id === 'error',
  ) as FakeElement | undefined;
  expect(errorParagraph?.childNodes[0] && (errorParagraph.childNodes[0] as FakeText).data).toBe(
    'message is required',
  );
});

test('replay: capture installed BEFORE the island activation -> the morph reconnect replays nothing', () => {
  const model = createReplayModel();
  const { doc, align, queue } = makeMorphHarness();
  const tree = buildLiveFormPage({ count: 0, replayModel: model, replayOnEveryConnect: true });

  // The ordering firefox/webkit measured: the entry's element-runtime load (and
  // with it the page capture + replay hook) wins the race against this island's
  // chunk-only activation, so the capture exists before the first connect and
  // the first activation pins the root's cutoff and adopts+drains its bucket.
  model.installCapture();
  doc.body.appendChild(tree.host);
  expect(tree.island.connects).toBe(1);

  userClick(tree.island);
  userClick(tree.island);
  userClick(tree.island);
  expect(tree.island.count, 'the live island handled all three clicks').toBe(3);

  queue(buildIncomingErrorFormPage());
  expect(align.morphDocument('<html></html>', null, null)).toBe(true);

  expect(tree.island.connects).toBe(2);
  expect(model.replayed.length, 'no pre-activation record is left to replay').toBe(0);
  expect(tree.island.count, 'count stays 3 across the morph').toBe(3);
});
test('replay: capture installed AFTER the island activation does not re-deliver on the morph reconnect', () => {
  const model = createReplayModel();
  const { doc, align, queue } = makeMorphHarness();
  // The SHIPPED shell: the replay is gated on the first activation
  // (`!hadInstance`, shell.ts) — the class facade's own `!activation.resumed`.
  const tree = buildLiveFormPage({ count: 0, replayModel: model, replayOnEveryConnect: false });

  // The chromium ordering measured on the built fixture: the generated island
  // connects first (18.3ms vs 17.1ms on one run; 16.7/15.6 and 20.8/19.6 in the
  // two failing runs), so the NULL hook means its true first activation pins no
  // cutoff, adopts no bucket and releases nothing.
  doc.body.appendChild(tree.host);
  expect(tree.island.connects).toBe(1);
  model.installCapture();

  const firstClick = userClick(tree.island);
  userClick(tree.island);
  const lastClick = userClick(tree.island);
  expect(tree.island.count).toBe(3);

  queue(buildIncomingErrorFormPage());
  expect(align.morphDocument('<html></html>', null, null)).toBe(true);

  // The morph still re-arms the island (the alignment moves an intact host),
  // but a reconnect is not a first activation, so nothing is replayed and the
  // user's three increments stay three.
  expect(tree.island.connects, 'the morph reconnected the island').toBe(2);
  expect(tree.island.disconnects).toBe(1);
  expect(model.replayed.length, 'a reconnect replays nothing').toBe(0);
  expect(tree.island.count, 'count stays 3 across the morph').toBe(3);

  // A second 422 morph does not move the island again.
  queue(buildIncomingErrorFormPage());
  expect(align.morphDocument('<html></html>', null, null)).toBe(true);
  expect(tree.island.connects, 'the second morph does not reconnect the island').toBe(2);
  expect(tree.island.count, 'no further increment').toBe(3);
  expect(firstClick === lastClick).toBe(false);
});

test('replay HAZARD: without the first-activation gate the same ordering double-delivers', () => {
  const model = createReplayModel();
  const { doc, align, queue } = makeMorphHarness();
  // The PRE-FIX shell shape (`replayPreUpgradeCaptures` on EVERY connect). This
  // row pins WHY the gate exists: with the measured chromium ordering the
  // reconnect is the registry's first replay pass, so an already-handled click
  // is dispatched a second time into the live handler.
  const tree = buildLiveFormPage({ count: 0, replayModel: model, replayOnEveryConnect: true });

  doc.body.appendChild(tree.host);
  model.installCapture();
  userClick(tree.island);
  userClick(tree.island);
  const lastClick = userClick(tree.island);
  expect(tree.island.count).toBe(3);

  queue(buildIncomingErrorFormPage());
  expect(align.morphDocument('<html></html>', null, null)).toBe(true);

  expect(tree.island.connects, 'the morph reconnected the island').toBe(2);
  expect(model.replayed.length, 'the un-gated shape re-delivers exactly one click').toBe(1);
  expect(model.replayed[0].event, 'the ORIGINAL trusted event object is re-dispatched').toBe(
    lastClick,
  );
  expect(tree.island.count, 'double delivery: 3 clicks plus one replay -> 4').toBe(4);
});
