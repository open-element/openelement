/**
 * Unit tests for the real island-scheduler module (#610) — the code the
 * generated client entry inlines verbatim. Covers the #605 open:ready
 * contract (every non-empty strategy bucket fires) and the #606 deep,
 * shadow-root-aware visible scheduling.
 */
import { expect, test } from 'vitest';
import { createIslandScheduler } from '../src/vite/internal/ssg/island-scheduler.ts';

type Win = Window & typeof globalThis;

interface ReadyEvent {
  strategy: string;
  islands: readonly string[];
}

/** Minimal fake element tree with optional shadow roots (for queryAllDeep). */
class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  shadowRoot: FakeElement | null = null;
  constructor(tagName: string) {
    this.tagName = tagName;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement): void => {
      for (const child of el.children) {
        if (selector === '*' || child.tagName.toLowerCase() === selector.toLowerCase()) {
          out.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

function makeDoc(root: FakeElement, readyEvents: ReadyEvent[]) {
  return {
    readyState: 'complete',
    addEventListener: () => {},
    dispatchEvent: (event: { type: string; detail: ReadyEvent }) => {
      if (event.type === 'open:ready') readyEvents.push(event.detail);
      return true;
    },
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
  } as unknown as Document;
}

function makeWin(overrides: Partial<Record<string, unknown>> = {}): Win {
  return {
    setTimeout: (fn: () => void) => fn(),
    CustomEvent: class {
      type: string;
      detail: unknown;
      constructor(type: string, init: { detail: unknown }) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    ...overrides,
  } as unknown as Win;
}

function mapWith(tags: string[]): Record<string, () => Promise<unknown>> {
  const map: Record<string, () => Promise<unknown>> = {};
  for (const tag of tags) map[tag] = () => Promise.resolve();
  return map;
}

/**
 * A fake document tree carrying one host element per named island tag — the
 * page scope the scheduler's activation decision reads (B2). Nesting a tag
 * inside another element's shadow root exercises the deep query (#562).
 */
function treeWithTags(...tags: string[]): FakeElement {
  const body = new FakeElement('body');
  for (const tag of tags) body.children.push(new FakeElement(tag));
  return body;
}

/** The same tree with every host inside a child's shadow root. */
function treeWithShadowTags(...tags: string[]): FakeElement {
  const body = new FakeElement('body');
  const host = new FakeElement('x-page');
  host.shadowRoot = new FakeElement('shadow');
  for (const tag of tags) host.shadowRoot.children.push(new FakeElement(tag));
  body.children.push(host);
  return body;
}

const STRATEGIES = (
  overrides: Partial<{
    load: string[];
    idle: string[];
    visible: string[];
    media: string[];
    only: string[];
  }> = {},
) => ({
  load: overrides.load ?? [],
  idle: overrides.idle ?? [],
  visible: overrides.visible ?? [],
  media: overrides.media ?? [],
  only: overrides.only ?? [],
});

// B2 DEVIATION FROM THE LETTER OF #605, pinned deliberately.
//
// #605's letter, and this test's original name, was "EVERY non-empty strategy
// bucket fires open:ready as its loads are initiated" — the detail carried the
// DECLARED tag list and the event fired whenever the bucket was non-empty,
// whether or not this page could activate anything. B2's page-scope gate makes
// an activation decision a page-scope decision (an island a page has no host
// for is never fetched, the runtime form of the per-page island manifest), and
// that has the logical consequence this test names: a declared-but-unhosted
// bucket is now SILENT, and `detail.islands` is the ACTIVATED subset.
//
// This is a behaviour change for any consumer counting open:ready events per
// page rather than per activation, so it is pinned here as a change rather
// than left as a side effect of the gate. Keep it unless the owner rules
// otherwise — do not "restore" the declared-list event.
test('#605/B2 deviation: a declared bucket with no host is silent, and detail.islands is the activated subset', () => {
  // Side by side, the letter and the current behaviour: the declared lists are
  // all non-empty (so #605's letter fires four events), and the page hosts one
  // tag, so exactly one event fires and it names only what activated.
  const readyEvents: ReadyEvent[] = [];
  const loaded: string[] = [];
  let idleCallback: (() => void) | null = null;
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin({
      requestIdleCallback: (fn: () => void) => (idleCallback = fn),
      // No IntersectionObserver: `visible` resolves synchronously, so the
      // bucket's decision is observable without a fake observer.
    }),
    doc: makeDoc(treeWithTags('x-load'), readyEvents),
    map: {
      'x-load': () => {
        loaded.push('x-load');
        return Promise.resolve();
      },
      'x-only': () => {
        loaded.push('x-only');
        return Promise.resolve();
      },
      'x-idle': () => {
        loaded.push('x-idle');
        return Promise.resolve();
      },
      'x-visible': () => {
        loaded.push('x-visible');
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({
      load: ['x-load', 'x-only'],
      only: ['x-only'],
      idle: ['x-idle'],
      visible: ['x-visible'],
    }),
    onIslandLoaded: null,
  });
  idleCallback!();
  // Only the hosted tag ever loaded, and only its bucket spoke.
  expect(loaded).toEqual(['x-load']);
  expect(readyEvents).toEqual([{ strategy: 'load', islands: ['x-load'] }]);
  // The unhosted declarations were NOT consumed, so a host appearing later
  // (a media-query change, a streamed-in fragment) can still activate them —
  // this is a deferral, never a drop.
  expect(readyEvents.every((event) => event.islands.every((tag) => tag === 'x-load'))).toEqual(
    true,
  );
});

test('#605 load and only buckets fire open:ready immediately for the tags this page hosts', async () => {
  const readyEvents: ReadyEvent[] = [];
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(),
    doc: makeDoc(treeWithTags('x-load', 'x-only'), readyEvents),
    map: mapWith(['x-load', 'x-only']),
    strategies: STRATEGIES({ load: ['x-load'], only: ['x-only'] }),
    onIslandLoaded: null,
  });
  expect(typeof scheduler.observeVisible).toEqual('function');
  expect(readyEvents).toEqual([
    { strategy: 'load', islands: ['x-load'] },
    { strategy: 'only', islands: ['x-only'] },
  ]);
  // The import factories were invoked (entries consumed).
  await Promise.resolve();
});

test('#605 idle bucket fires open:ready when idle time arrives', () => {
  const readyEvents: ReadyEvent[] = [];
  let idleCallback: (() => void) | null = null;
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin({ requestIdleCallback: (fn: () => void) => (idleCallback = fn) }),
    doc: makeDoc(treeWithTags('x-idle'), readyEvents),
    map: mapWith(['x-idle']),
    strategies: STRATEGIES({ idle: ['x-idle'] }),
    onIslandLoaded: null,
  });
  // Not yet: idle deferral means no import and no event so far.
  expect(readyEvents).toEqual([]);
  idleCallback!();
  expect(readyEvents).toEqual([{ strategy: 'idle', islands: ['x-idle'] }]);
});

test('#605 idle fallback defers through setTimeout with the injected policy timeout', () => {
  const readyEvents: ReadyEvent[] = [];
  const scheduled: [() => void, number][] = [];
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    // Neither requestIdleCallback nor requestAnimationFrame exists: the
    // injected element policy constant (IDLE_FALLBACK_TIMEOUT_MS) is the delay.
    win: makeWin({
      setTimeout: (fn: () => void, delay?: number) => {
        scheduled.push([fn, delay ?? 0]);
        return 0;
      },
    }),
    doc: makeDoc(treeWithTags('x-idle'), readyEvents),
    map: mapWith(['x-idle']),
    strategies: STRATEGIES({ idle: ['x-idle'] }),
    onIslandLoaded: null,
  });
  expect(readyEvents).toEqual([]);
  expect(scheduled.length).toEqual(1);
  expect(scheduled[0][1]).toEqual(25);
  scheduled[0][0]();
  expect(readyEvents).toEqual([{ strategy: 'idle', islands: ['x-idle'] }]);
});

test('#605 empty buckets never fire open:ready', () => {
  const readyEvents: ReadyEvent[] = [];
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(),
    doc: makeDoc(new FakeElement('body'), readyEvents),
    map: {},
    strategies: STRATEGIES(),
    onIslandLoaded: null,
  });
  expect(readyEvents).toEqual([]);
});

test('#606 visible scheduling finds islands inside shadow roots (deep query)', () => {
  const readyEvents: ReadyEvent[] = [];
  const observed: FakeElement[] = [];
  class FakeIO {
    static instances: FakeIO[] = [];
    cb: (entries: { isIntersecting: boolean }[]) => void;
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
      this.cb = cb;
      FakeIO.instances.push(this);
    }
    observe(el: FakeElement): void {
      observed.push(el);
    }
    disconnect(): void {}
    intersect(): void {
      this.cb([{ isIntersecting: true }]);
    }
  }

  // <body> -> <x-page shadow> -> <x-vis>: a light-DOM querySelectorAll never
  // sees x-vis (#562); the scheduler must descend into shadow roots.
  const page = new FakeElement('body');
  const host = new FakeElement('x-page');
  const shadow = new FakeElement('shadow');
  const island = new FakeElement('x-vis');
  shadow.children.push(island);
  host.shadowRoot = shadow;
  page.children.push(host);

  let loaded = 0;
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin({ IntersectionObserver: FakeIO }),
    doc: makeDoc(page, readyEvents),
    map: {
      'x-vis': () => {
        loaded++;
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ visible: ['x-vis'] }),
    onIslandLoaded: null,
  });
  expect(observed).toEqual([island]);
  expect(loaded).toEqual(0);
  FakeIO.instances[0].intersect();
  expect(loaded).toEqual(1);
  expect(readyEvents).toEqual([{ strategy: 'visible', islands: ['x-vis'] }]);
});

test('#606 visible without IntersectionObserver loads every visible tag', () => {
  const readyEvents: ReadyEvent[] = [];
  const loaded: string[] = [];
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(), // no IntersectionObserver
    doc: makeDoc(treeWithTags('x-vis'), readyEvents),
    map: {
      'x-vis': () => {
        loaded.push('x-vis');
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ visible: ['x-vis'] }),
    onIslandLoaded: null,
  });
  expect(loaded).toEqual(['x-vis']);
  expect(readyEvents).toEqual([{ strategy: 'visible', islands: ['x-vis'] }]);
});

test('#584 onIslandLoaded runs (macrotask-deferred) after an island module resolves', async () => {
  const calls: string[] = [];
  const timeouts: (() => void)[] = [];
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin({ setTimeout: (fn: () => void) => timeouts.push(fn) }),
    doc: makeDoc(treeWithTags('x-load'), []),
    map: {
      'x-load': () =>
        Promise.resolve().then(() => {
          calls.push('import');
        }),
    },
    strategies: STRATEGIES({ load: ['x-load'] }),
    onIslandLoaded: () => calls.push('rescan'),
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toEqual(['import']);
  expect(timeouts.length).toEqual(1);
  timeouts[0]();
  expect(calls).toEqual(['import', 'rescan']);
});

test('#1039 detached visible island is released and a reinsert gets a fresh observer', () => {
  const readyEvents: ReadyEvent[] = [];
  const observed: FakeElement[] = [];
  const disconnected: FakeIO[] = [];
  class FakeIO {
    static instances: FakeIO[] = [];
    cb: (entries: { isIntersecting: boolean }[]) => void;
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
      this.cb = cb;
      FakeIO.instances.push(this);
    }
    observe(el: FakeElement): void {
      observed.push(el);
    }
    disconnect(): void {
      disconnected.push(this);
    }
    intersect(): void {
      this.cb([{ isIntersecting: true }]);
    }
  }

  const page = new FakeElement('body');
  const island = new FakeElement('x-vis') as FakeElement & { isConnected?: boolean };
  page.children.push(island);

  let loaded = 0;
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin({ IntersectionObserver: FakeIO }),
    doc: makeDoc(page, readyEvents),
    map: {
      'x-vis': () => {
        loaded++;
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ visible: ['x-vis'] }),
    onIslandLoaded: null,
  });
  expect(observed).toEqual([island]);
  expect(FakeIO.instances.length).toEqual(1);

  // The island leaves the DOM before ever intersecting: its observer can
  // never fire again, so it must be released (not pinned forever).
  island.isConnected = false;
  page.children.length = 0;
  scheduler.observeVisible();
  expect(disconnected.length).toEqual(1);
  expect(FakeIO.instances.length).toEqual(1);

  // Reinserted before intersection: a fresh observer is attached so the
  // island still loads when it scrolls into view.
  island.isConnected = true;
  page.children.push(island);
  scheduler.observeVisible();
  expect(FakeIO.instances.length).toEqual(2);
  expect(observed).toEqual([island, island]);
  FakeIO.instances[1].intersect();
  expect(loaded).toEqual(1);
  expect(readyEvents).toEqual([{ strategy: 'visible', islands: ['x-vis'] }]);
});

// ─── B2 page scope: an island no page host reaches is never fetched ────
//
// The build records the per-page island set; the runtime form of that fact is
// this activation gate. Without it an `idle`/`load`/`only` bucket imported
// EVERY declared island chunk on EVERY page — which also dragged the shared
// element runtime into pages whose island manifest is empty.

test('#1544/B2: a bucket whose tags have no host on this page starts no load and fires no open:ready', async () => {
  const readyEvents: ReadyEvent[] = [];
  const loaded: string[] = [];
  const map: Record<string, () => Promise<unknown>> = {
    'x-load': () => {
      loaded.push('x-load');
      return Promise.resolve();
    },
    'x-idle': () => {
      loaded.push('x-idle');
      return Promise.resolve();
    },
  };
  let idleCallback: (() => void) | null = null;
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin({ requestIdleCallback: (fn: () => void) => (idleCallback = fn) }),
    // A page with NO island host at all — the zero-island page shape.
    doc: makeDoc(treeWithTags(), readyEvents),
    map,
    strategies: STRATEGIES({ load: ['x-load'], idle: ['x-idle'] }),
    onIslandLoaded: null,
  });
  idleCallback!();
  await Promise.resolve();
  expect(loaded).toEqual([]);
  expect(readyEvents).toEqual([]);
  // The factories are still in the map: nothing was consumed, so a host that
  // appears later can still activate the island.
  expect(typeof map['x-load']).toEqual('function');
  expect(typeof map['x-idle']).toEqual('function');
});

test('#1544/B2: a bucket fires open:ready with exactly the tags this page carries', () => {
  const readyEvents: ReadyEvent[] = [];
  const loaded: string[] = [];
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(),
    // Two declared islands, one host: only the hosted tag activates.
    doc: makeDoc(treeWithTags('x-present'), readyEvents),
    map: {
      'x-present': () => {
        loaded.push('x-present');
        return Promise.resolve();
      },
      'x-absent': () => {
        loaded.push('x-absent');
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ load: ['x-present', 'x-absent'] }),
    onIslandLoaded: null,
  });
  expect(loaded).toEqual(['x-present']);
  expect(readyEvents).toEqual([{ strategy: 'load', islands: ['x-present'] }]);
});

test('#1544/B2: the host is found through shadow roots (#562), not only in the light DOM', () => {
  const readyEvents: ReadyEvent[] = [];
  const loaded: string[] = [];
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(),
    // Islands live inside page-element DSD shadow roots: a document-level
    // querySelectorAll never sees them, so the gate must descend.
    doc: makeDoc(treeWithShadowTags('x-nested'), readyEvents),
    map: {
      'x-nested': () => {
        loaded.push('x-nested');
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ load: ['x-nested'] }),
    onIslandLoaded: null,
  });
  expect(loaded).toEqual(['x-nested']);
  expect(readyEvents).toEqual([{ strategy: 'load', islands: ['x-nested'] }]);
});

test('#1544/B2: a media island with no host fires nothing, and a later matching query still cannot start it', () => {
  const readyEvents: ReadyEvent[] = [];
  const loaded: string[] = [];
  const listeners: Array<(event: { matches: boolean }) => void> = [];
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(),
    doc: makeDoc(treeWithTags('x-other'), readyEvents),
    map: {
      'x-media': () => {
        loaded.push('x-media');
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ media: ['x-media'] }),
    mediaQueries: {
      'x-media': {
        matches: false,
        addEventListener: (_type: string, fn: (event: { matches: boolean }) => void) => {
          listeners.push(fn);
        },
      },
    } as unknown as Record<string, MediaQueryList>,
    onIslandLoaded: null,
  });
  expect(listeners.length).toEqual(1);
  listeners[0]({ matches: true });
  expect(loaded).toEqual([]);
  expect(readyEvents).toEqual([]);
});
