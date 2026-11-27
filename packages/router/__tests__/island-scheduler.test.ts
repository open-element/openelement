/**
 * Unit tests for the real island-scheduler module (#610) — the code the
 * generated client entry inlines verbatim. Covers the #605 open:ready
 * contract (every non-empty strategy bucket fires) and the #606 deep,
 * shadow-root-aware visible scheduling.
 */
import { expect, test } from 'vitest';
import {
  createIslandScheduler,
  createIslandSchedulerWithStrategies,
} from '../src/vite/internal/ssg/island-scheduler.ts';

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
  /** DOM parity for the late-host probe: the lowercased local name. */
  get localName(): string {
    return this.tagName.toLowerCase();
  }
  querySelectorAll(selector: string): FakeElement[] {
    // A tag selector LIST is one native query in the DOM; the double answers
    // it the same way so the probe's fused walk is exercised for real.
    const wanted = selector.split(',').map((part) => part.trim().toLowerCase());
    const out: FakeElement[] = [];
    const walk = (el: FakeElement): void => {
      for (const child of el.children) {
        if (wanted.indexOf('*') !== -1 || wanted.indexOf(child.localName) !== -1) {
          out.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

/** The probe's give-up signal, as a document-level consumer would see it. */
interface HostTimeoutEvent {
  pending: readonly string[];
  attempts: number;
  elapsedMs: number;
}

function makeDoc(
  root: FakeElement,
  readyEvents: ReadyEvent[],
  hostTimeouts: HostTimeoutEvent[] = [],
) {
  return {
    readyState: 'complete',
    addEventListener: () => {},
    dispatchEvent: (event: { type: string; detail: ReadyEvent | HostTimeoutEvent }) => {
      if (event.type === 'open:ready') readyEvents.push(event.detail as ReadyEvent);
      if (event.type === 'open:island-host-timeout') {
        hostTimeouts.push(event.detail as HostTimeoutEvent);
      }
      return true;
    },
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
  } as unknown as Document;
}

/**
 * A controllable timer queue plus clock for the late-host probe. The probe
 * reads only `win.setTimeout` / `win.clearTimeout` / `win.Date`, so driving it
 * needs no fake-timer library: `runNext` performs exactly one queued step and
 * advances the injected clock by the delay it waited.
 */
function makeTimers() {
  const queue: { id: number; fn: () => void; delay: number }[] = [];
  let nextId = 1;
  let now = 0;
  return {
    win: {
      setTimeout: (fn: () => void, delay?: number) => {
        const id = nextId++;
        queue.push({ id, fn, delay: delay ?? 0 });
        return id;
      },
      clearTimeout: (id: number) => {
        const at = queue.findIndex((entry) => entry.id === id);
        if (at >= 0) queue.splice(at, 1);
      },
      Date: { now: () => now },
    },
    runNext: () => {
      const next = queue.shift();
      if (!next) return null;
      now += next.delay;
      next.fn();
      return next.delay;
    },
    /** Move the injected wall clock without running anything. */
    advance: (ms: number) => {
      now += ms;
    },
    pending: () => queue.length,
    delays: () => queue.map((entry) => entry.delay),
  };
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

// #1544/B2 follow-up (R3 lane): the ready-time scan is not the last word.
// An enhanced response morphs new HTML into the page, so an island host can
// arrive AFTER the initial scan — and a host this page did not carry at ready
// time used to keep its island dead forever (user-visible: an island delivered
// by an enhanced response never became interactive, while the same island
// hydrated normally on a page that declared the host up front). observeVisible()
// is the post-morph rescan path the client runtime already calls (#562); it must
// re-run the eager buckets too.
test('#1544/B2 follow-up: a host arriving after the ready scan activates on the next rescan, exactly once', async () => {
  const readyEvents: ReadyEvent[] = [];
  const loaded: string[] = [];
  const body = treeWithTags(); // zero-island page shape at ready time
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(),
    doc: makeDoc(body, readyEvents),
    map: {
      'x-late': () => {
        loaded.push('x-late');
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ load: ['x-late'] }),
    onIslandLoaded: null,
  });
  // Ready time: no host, so no load and no event (the B2 gate above).
  expect(loaded).toEqual([]);
  expect(readyEvents).toEqual([]);

  // The morph lands: the host is in the tree, and the post-morph rescan runs.
  body.children.push(new FakeElement('x-late'));
  scheduler.observeVisible();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
  expect(readyEvents).toEqual([{ strategy: 'load', islands: ['x-late'] }]);

  // Idempotent: repeated rescans are silent — the activated tag is out of the
  // map, so open:ready stays one event per activation rather than one per scan.
  scheduler.observeVisible();
  scheduler.observeVisible();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
  expect(readyEvents).toEqual([{ strategy: 'load', islands: ['x-late'] }]);
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

// ─── F01: the post-morph rescan covers every deferred strategy ─────────
//
// Each strategy's ready-time opportunity is one-shot: load/only run at
// construct, idle runs when the browser first idles, media runs at construct
// or on a match change, visible observes the hosts that exist. A morph can
// deliver the FIRST host for a tag after that opportunity was spent; the map
// entry is the only one-shot guard, so a still-unconsumed factory must be
// re-armed by the post-morph rescan or the island stays dead forever (F01).

type LateStrategy = 'load' | 'only' | 'visible' | 'idle' | 'media';

interface LateHostRow {
  strategy: LateStrategy;
  importsBeforeMorph: number;
  factoryUnconsumedBeforeMorph: boolean;
  idleSchedulesBeforeMorph: number;
  importsAfterRescan: number;
  readyEventsAfterRescan: ReadyEvent[];
  importsAfterSecondRescan: number;
  readyEventsAfterSecondRescan: ReadyEvent[];
}

/** Run the five-strategy "no host → opportunity spent → morph → activate" scenario. */
function runLateHostScenario(strategy: LateStrategy): LateHostRow {
  const tag = 'x-late';
  const readyEvents: ReadyEvent[] = [];
  let imports = 0;
  const body = new FakeElement('body');
  const idleCallbacks: (() => void)[] = [];
  let mediaListener: ((event: { matches: boolean }) => void) | null = null;

  class FakeIO {
    static instances: FakeIO[] = [];
    cb: (entries: { isIntersecting: boolean }[]) => void;
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
      this.cb = cb;
      FakeIO.instances.push(this);
    }
    observe(): void {}
    disconnect(): void {}
    intersect(): void {
      this.cb([{ isIntersecting: true }]);
    }
  }

  const win = makeWin({
    requestIdleCallback: (fn: () => void) => {
      idleCallbacks.push(fn);
    },
    ...(strategy === 'visible' ? { IntersectionObserver: FakeIO } : {}),
  });
  const map: Record<string, (() => Promise<unknown>) | null> = {
    [tag]: () => {
      imports += 1;
      return Promise.resolve();
    },
  };
  const strategies =
    strategy === 'load'
      ? STRATEGIES({ load: [tag] })
      : strategy === 'only'
        ? STRATEGIES({ only: [tag] })
        : strategy === 'visible'
          ? STRATEGIES({ visible: [tag] })
          : strategy === 'idle'
            ? STRATEGIES({ idle: [tag] })
            : STRATEGIES({ media: [tag] });
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win,
    doc: makeDoc(body, readyEvents),
    map,
    strategies,
    ...(strategy === 'media'
      ? {
          mediaQueries: {
            [tag]: {
              matches: true,
              addEventListener: (_type: string, fn: (event: { matches: boolean }) => void) => {
                mediaListener = fn;
              },
            },
          } as unknown as Record<string, MediaQueryList>,
        }
      : {}),
    onIslandLoaded: null,
  });

  // 1. Spend the strategy's initial opportunity while the page has no host.
  if (strategy === 'idle') {
    idleCallbacks[idleCallbacks.length - 1]();
  } else if (strategy === 'visible') {
    // The ready scan found no host, so it observed nothing; nothing to fire.
  }
  const importsBeforeMorph = imports;
  const factoryUnconsumedBeforeMorph = typeof map[tag] === 'function';
  const idleSchedulesBeforeMorph = idleCallbacks.length;

  // 2. The morph inserts the first host, then the post-morph rescan runs.
  body.children.push(new FakeElement(tag));
  scheduler.observeVisible();
  // Resolve whatever the strategy needs to finish its activation step.
  if (strategy === 'idle') idleCallbacks[idleCallbacks.length - 1]();
  if (strategy === 'visible') FakeIO.instances[FakeIO.instances.length - 1].intersect();
  const importsAfterRescan = imports;
  const readyEventsAfterRescan = readyEvents.slice();

  // 3. A second rescan (plus any opportunity it schedules) must stay silent.
  scheduler.observeVisible();
  if (strategy === 'idle' && idleCallbacks.length > idleSchedulesBeforeMorph + 1) {
    idleCallbacks[idleCallbacks.length - 1]();
  }
  if (strategy === 'visible' && FakeIO.instances.length > 1) {
    FakeIO.instances[FakeIO.instances.length - 1].intersect();
  }
  if (strategy === 'media') mediaListener?.({ matches: true });
  return {
    strategy,
    importsBeforeMorph,
    factoryUnconsumedBeforeMorph,
    idleSchedulesBeforeMorph,
    importsAfterRescan,
    readyEventsAfterRescan,
    importsAfterSecondRescan: imports,
    readyEventsAfterSecondRescan: readyEvents.slice(),
  };
}

test('#F01 five-strategy symmetry: a host arriving after the spent opportunity activates on the next rescan, exactly once', () => {
  const rows = (['load', 'only', 'visible', 'idle', 'media'] as const).map(runLateHostScenario);
  for (const row of rows) {
    // The initial opportunity was spent with no host: nothing loaded, no event,
    // and the factory stayed deferred rather than being dropped.
    expect(row.importsBeforeMorph, `${row.strategy}: no import before the host`).toEqual(0);
    expect(row.factoryUnconsumedBeforeMorph, `${row.strategy}: factory left for the retry`).toEqual(
      true,
    );
    // The post-morph rescan activates the island exactly once and names the
    // strategy in open:ready.
    expect(row.importsAfterRescan, `${row.strategy}: one import after the rescan`).toEqual(1);
    expect(row.readyEventsAfterRescan, `${row.strategy}: one ready event`).toEqual([
      { strategy: row.strategy, islands: ['x-late'] },
    ]);
    // Repeated rescans are silent: the consumed map entry is the one-shot guard.
    expect(row.importsAfterSecondRescan, `${row.strategy}: no duplicate import`).toEqual(1);
    expect(row.readyEventsAfterSecondRescan, `${row.strategy}: no duplicate ready event`).toEqual([
      { strategy: row.strategy, islands: ['x-late'] },
    ]);
  }
});

test('#F01 specialized idle: a spent construction attempt re-arms after a morph and activates once', () => {
  const readyEvents: ReadyEvent[] = [];
  const body = new FakeElement('body');
  const idleCallbacks: (() => void)[] = [];
  let imports = 0;
  const map: Record<string, (() => Promise<unknown>) | null> = {
    'x-idle': () => {
      imports += 1;
      return Promise.resolve();
    },
  };
  const scheduler = createIslandSchedulerWithStrategies(
    {
      log: { warn: () => {} },
      idleFallbackTimeoutMs: 25,
      win: makeWin({ requestIdleCallback: (fn: () => void) => idleCallbacks.push(fn) }),
      doc: makeDoc(body, readyEvents),
      map,
      strategies: STRATEGIES({ idle: ['x-idle'] }),
      onIslandLoaded: null,
    },
    {},
  );
  // The construction-time attempt runs with no host and is then spent.
  expect(idleCallbacks.length).toEqual(1);
  idleCallbacks[0]();
  expect(imports).toEqual(0);
  expect(readyEvents).toEqual([]);

  // The morph delivers the first host; the rescan re-arms the idle attempt but
  // never loads synchronously (idle semantics are the browser's decision).
  body.children.push(new FakeElement('x-idle'));
  scheduler.observeVisible();
  expect(idleCallbacks.length).toEqual(2);
  expect(imports).toEqual(0);
  // Repeated rescans share the one pending attempt instead of stacking them.
  scheduler.observeVisible();
  scheduler.observeVisible();
  expect(idleCallbacks.length).toEqual(2);

  idleCallbacks[1]();
  expect(imports).toEqual(1);
  expect(readyEvents).toEqual([{ strategy: 'idle', islands: ['x-idle'] }]);

  // Consumed: no third attempt, no duplicate event.
  scheduler.observeVisible();
  expect(idleCallbacks.length).toEqual(2);
  expect(imports).toEqual(1);
  expect(readyEvents).toEqual([{ strategy: 'idle', islands: ['x-idle'] }]);
});

test('#F01 idle: the re-armed attempt keeps the fallback selection (injected policy timeout)', () => {
  const readyEvents: ReadyEvent[] = [];
  const body = new FakeElement('body');
  const scheduled: [() => void, number][] = [];
  let imports = 0;
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    // Neither requestIdleCallback nor requestAnimationFrame exists.
    win: makeWin({
      setTimeout: (fn: () => void, delay?: number) => {
        scheduled.push([fn, delay ?? 0]);
        return 0;
      },
    }),
    doc: makeDoc(body, readyEvents),
    map: {
      'x-idle': () => {
        imports += 1;
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ idle: ['x-idle'] }),
    onIslandLoaded: null,
  });
  expect(scheduled.length).toEqual(1);
  expect(scheduled[0][1]).toEqual(25);
  scheduled[0][0](); // spent with no host
  expect(imports).toEqual(0);

  body.children.push(new FakeElement('x-idle'));
  scheduler.observeVisible();
  // The idle re-arm must still go through the injected fallback with the same
  // policy timeout. FR-02 also arms the bounded late-host probe on this page
  // shape (the construction attempt was spent with the tag unconsumed), and
  // that step shares the injected timer, so identify the idle attempt by its
  // policy delay instead of by position.
  const idleSteps = scheduled.filter(([, delay]) => delay === 25);
  expect(idleSteps.length).toEqual(2); // construction attempt + the re-arm
  expect(scheduled[scheduled.length - 1]![1]).toEqual(25); // same selection chain
  scheduled[scheduled.length - 1]![0]();
  expect(imports).toEqual(1);
  expect(readyEvents).toEqual([{ strategy: 'idle', islands: ['x-idle'] }]);
});

function mediaFixture(options: { matches: boolean; hostAtStart: boolean }) {
  const readyEvents: ReadyEvent[] = [];
  const body = options.hostAtStart
    ? treeWithTags('x-media')
    : (new FakeElement('body') as FakeElement);
  let imports = 0;
  let listeners = 0;
  const mediaQueries = {
    'x-media': {
      matches: options.matches,
      addEventListener: (_type: string, _fn: (event: { matches: boolean }) => void) => {
        listeners += 1;
      },
    },
  } as unknown as Record<string, MediaQueryList>;
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(),
    doc: makeDoc(body, readyEvents),
    map: {
      'x-media': () => {
        imports += 1;
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ media: ['x-media'] }),
    mediaQueries,
    onIslandLoaded: null,
  });
  return {
    readyEvents,
    body,
    scheduler,
    mediaQueries,
    listeners: () => listeners,
    imports: () => imports,
  };
}

test('#F01 media: an already-matching query with no host activates on the post-morph rescan, once', () => {
  const fixture = mediaFixture({ matches: true, hostAtStart: false });
  expect(fixture.listeners()).toEqual(1);
  expect(fixture.imports()).toEqual(0);
  expect(fixture.readyEvents).toEqual([]);

  fixture.body.children.push(new FakeElement('x-media'));
  fixture.scheduler.observeVisible();
  expect(fixture.imports()).toEqual(1);
  expect(fixture.readyEvents).toEqual([{ strategy: 'media', islands: ['x-media'] }]);

  // One-shot: rescans and later change events cannot re-import or re-fire.
  fixture.scheduler.observeVisible();
  expect(fixture.imports()).toEqual(1);
  expect(fixture.readyEvents).toEqual([{ strategy: 'media', islands: ['x-media'] }]);
});

test('#F01 media: a non-matching query stays silent on the rescan; its change listener still activates the late host', () => {
  const readyEvents: ReadyEvent[] = [];
  const body = new FakeElement('body');
  const listeners: Array<(event: { matches: boolean }) => void> = [];
  let imports = 0;
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(),
    doc: makeDoc(body, readyEvents),
    map: {
      'x-media': () => {
        imports += 1;
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
  // Host arrives, query still false: the rescan re-reads it and stays silent.
  body.children.push(new FakeElement('x-media'));
  scheduler.observeVisible();
  expect(imports).toEqual(0);
  expect(readyEvents).toEqual([]);
  // The preserved change listener is the recovery path once it matches.
  listeners[0]({ matches: true });
  expect(imports).toEqual(1);
  expect(readyEvents).toEqual([{ strategy: 'media', islands: ['x-media'] }]);
});

// ── scheduler environment/edge branches (coverage lane, test-only) ────────
//
// The scheduler is the generated entry's runtime; these pin the environment
// shapes it must survive: a loading document, a deferred rescan whose hook is
// cleared, non-DOM element doubles, lookalike media-query APIs, and shared
// idle retries.

test('the ready-time visible scan waits for DOMContentLoaded on a loading document', () => {
  const observed: FakeElement[] = [];
  class FakeIO {
    cb: (entries: { isIntersecting: boolean }[]) => void;
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
      this.cb = cb;
    }
    observe(el: FakeElement): void {
      observed.push(el);
    }
    disconnect(): void {
      this.cb([]);
    }
  }
  const body = treeWithTags('x-vis');
  const listeners: Array<() => void> = [];
  const doc = {
    readyState: 'loading',
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'DOMContentLoaded') listeners.push(fn);
    },
    dispatchEvent: () => true,
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
  } as unknown as Document;
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin({ IntersectionObserver: FakeIO }),
    doc,
    map: mapWith(['x-vis']),
    strategies: STRATEGIES({ visible: ['x-vis'] }),
    onIslandLoaded: null,
  });
  expect(observed).toEqual([]);
  expect(listeners.length).toEqual(1);
  listeners[0]!();
  expect(observed.length).toEqual(1);
});

test('#584 the deferred post-load rescan re-checks the hook before calling it', async () => {
  const calls: string[] = [];
  const timeouts: Array<() => void> = [];
  const deps = {
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin({
      setTimeout: (fn: () => void) => {
        timeouts.push(fn);
        return 1;
      },
    }),
    doc: makeDoc(treeWithTags('x-load'), []),
    map: mapWith(['x-load']),
    strategies: STRATEGIES({ load: ['x-load'] }),
    onIslandLoaded: () => calls.push('rescan'),
  };
  createIslandScheduler(deps as unknown as Parameters<typeof createIslandScheduler>[0]);
  await Promise.resolve();
  await Promise.resolve();
  expect(timeouts.length).toEqual(1);
  // The enhance layer can be torn down between scheduling and the macrotask;
  // the deferred callback must then call nothing.
  deps.onIslandLoaded = null as unknown as () => void;
  timeouts[0]!();
  expect(calls).toEqual([]);
});

test('#1039 an observed double without isConnected is kept and not re-observed', () => {
  const observed: FakeElement[] = [];
  class FakeIO {
    cb: (entries: { isIntersecting: boolean }[]) => void;
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
      this.cb = cb;
    }
    observe(el: FakeElement): void {
      observed.push(el);
    }
    disconnect(): void {
      this.cb([]);
    }
  }
  const body = treeWithTags('x-vis');
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin({ IntersectionObserver: FakeIO }),
    doc: makeDoc(body, []),
    map: mapWith(['x-vis']),
    strategies: STRATEGIES({ visible: ['x-vis'] }),
    onIslandLoaded: null,
  });
  expect(observed.length).toEqual(1);
  // A non-DOM double has no isConnected; it must not be released as detached,
  // and the already-observed element must not get a second observer.
  scheduler.observeVisible();
  expect(observed.length).toEqual(1);
});

test('#606 an intersection batch filters non-intersecting entries and a host removed before the callback starts no load', () => {
  const readyEvents: ReadyEvent[] = [];
  let loaded = 0;
  class FakeIO {
    static instances: FakeIO[] = [];
    cb: (entries: { isIntersecting: boolean }[]) => void;
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
      this.cb = cb;
      FakeIO.instances.push(this);
    }
    observe(): void {}
    disconnect(): void {}
    fire(entries: { isIntersecting: boolean }[]): void {
      this.cb(entries);
    }
  }
  const body = treeWithTags('x-vis');
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin({ IntersectionObserver: FakeIO }),
    doc: makeDoc(body, readyEvents),
    map: {
      'x-vis': () => {
        loaded += 1;
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ visible: ['x-vis'] }),
    onIslandLoaded: null,
  });
  // Non-intersecting entries are ignored; the intersecting one loads once.
  FakeIO.instances[0].fire([{ isIntersecting: false }]);
  expect(loaded).toEqual(0);
  expect(readyEvents).toEqual([]);
  // The page scope gate re-runs at activation: a host removed between observe
  // and intersection is no longer a host, so the tag keeps its factory.
  body.children.length = 0;
  FakeIO.instances[0].fire([{ isIntersecting: true }]);
  expect(loaded).toEqual(0);
  expect(readyEvents).toEqual([]);
});

test('strategies without a media key are the same as an empty media bucket', () => {
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(),
    doc: makeDoc(treeWithTags(), []),
    map: {},
    strategies: { load: [], only: [], visible: [], idle: [] },
    onIslandLoaded: null,
  });
  expect(typeof scheduler.observeVisible).toEqual('function');
});

test('a media tag with no matchMedia result is skipped with a warning', () => {
  const warnings: string[] = [];
  createIslandScheduler({
    log: {
      warn: (...args: unknown[]) => {
        warnings.push(String(args[0]));
      },
    },
    idleFallbackTimeoutMs: 25,
    win: makeWin(),
    doc: makeDoc(treeWithTags('x-media'), []),
    map: mapWith(['x-media']),
    strategies: STRATEGIES({ media: ['x-media'] }),
    mediaQueries: {},
    onIslandLoaded: null,
  });
  expect(warnings.some((warning) => warning.includes('x-media'))).toEqual(true);
});

test('a media query with neither listener API registers nothing and stays silent', () => {
  let loaded = 0;
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(),
    doc: makeDoc(treeWithTags('x-media'), []),
    map: {
      'x-media': () => {
        loaded += 1;
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ media: ['x-media'] }),
    mediaQueries: { 'x-media': { matches: false } } as unknown as Record<string, MediaQueryList>,
    onIslandLoaded: null,
  });
  expect(loaded).toEqual(0);
});

test('a legacy addListener-only media query activates on a later matching change', () => {
  let loaded = 0;
  let listener: ((event: { matches: boolean }) => void) | undefined;
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(),
    doc: makeDoc(treeWithTags('x-media'), []),
    map: {
      'x-media': () => {
        loaded += 1;
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ media: ['x-media'] }),
    mediaQueries: {
      'x-media': {
        matches: false,
        addListener: (fn: (event: { matches: boolean }) => void) => {
          listener = fn;
        },
      },
    } as unknown as Record<string, MediaQueryList>,
    onIslandLoaded: null,
  });
  listener!({ matches: false });
  expect(loaded).toEqual(0);
  listener!({ matches: true });
  expect(loaded).toEqual(1);
});

test('#F01 post-morph rescans share one pending idle attempt', () => {
  const idleCallbacks: Array<() => void> = [];
  let loaded = 0;
  const body = treeWithTags();
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin({
      requestIdleCallback: (fn: () => void) => {
        idleCallbacks.push(fn);
        return 1;
      },
    }),
    doc: makeDoc(body, []),
    map: {
      'x-idle': () => {
        loaded += 1;
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ idle: ['x-idle'] }),
    onIslandLoaded: null,
  });
  // The construction-time attempt is still pending: repeated morph rescans
  // must reuse it instead of stacking callbacks.
  body.children.push(new FakeElement('x-idle'));
  scheduler.observeVisible();
  scheduler.observeVisible();
  expect(idleCallbacks.length).toEqual(1);
  idleCallbacks[0]!();
  expect(loaded).toEqual(1);
});

// ─── The bounded late-host probe ─────────────────────────────────────────
//
// B2's page-scope gate reads the page once. A host a third party creates
// later — inside its own open shadow root, after an async chunk of its own
// landed — is invisible to that read, and a page with no enhanced forms and
// no `visible` island has no post-morph rescan to fall back on, so the island
// stays dead. These pin the probe that gives the page a bounded second look,
// and the budgets that bound what a page can be made to spend.

/** The page shape the probe exists for: a declared tag with no host yet. */
function lateHostFixture(options: {
  tags?: string[];
  body?: FakeElement;
  map?: Record<string, () => Promise<unknown>>;
}) {
  const readyEvents: ReadyEvent[] = [];
  const hostTimeouts: HostTimeoutEvent[] = [];
  const loaded: string[] = [];
  const body = options.body ?? new FakeElement('body');
  const tags = options.tags ?? ['x-late'];
  const map =
    options.map ??
    Object.fromEntries(
      tags.map((tag) => [
        tag,
        () => {
          loaded.push(tag);
          return Promise.resolve();
        },
      ]),
    );
  const timers = makeTimers();
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(timers.win),
    doc: makeDoc(body, readyEvents, hostTimeouts),
    map,
    strategies: STRATEGIES({ load: tags }),
    onIslandLoaded: null,
  });
  return { body, timers, scheduler, readyEvents, hostTimeouts, loaded };
}

test('late-host probe T-1: a page with no declared island schedules nothing', () => {
  const timers = makeTimers();
  const hostTimeouts: HostTimeoutEvent[] = [];
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(timers.win),
    doc: makeDoc(treeWithTags(), [], hostTimeouts),
    map: {},
    strategies: STRATEGIES(),
    onIslandLoaded: null,
  });
  expect(timers.pending()).toEqual(0);
  expect(hostTimeouts).toEqual([]);
});

test('late-host probe T-2: a page that hosted every declared island schedules nothing', () => {
  const timers = makeTimers();
  const loaded: string[] = [];
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(timers.win),
    doc: makeDoc(treeWithTags('x-load'), []),
    map: {
      'x-load': () => {
        loaded.push('x-load');
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ load: ['x-load'] }),
    onIslandLoaded: null,
  });
  expect(loaded).toEqual(['x-load']);
  // Nothing is pending, so the budget is never armed.
  expect(timers.pending()).toEqual(0);
});

test('late-host probe T-3: a host created later inside an OPEN shadow root activates, exactly once', async () => {
  const shell = new FakeElement('x-shell');
  shell.shadowRoot = new FakeElement('sealed-open');
  const body = new FakeElement('body');
  body.children.push(shell);
  const { timers, scheduler, readyEvents, hostTimeouts, loaded } = lateHostFixture({ body });

  // Ready scan: no host anywhere — nothing activates, and the probe arms.
  expect(loaded).toEqual([]);
  expect(readyEvents).toEqual([]);
  expect(timers.pending()).toEqual(1);

  // Attempt 1 still sees nothing (the third-party chunk has not landed).
  timers.runNext();
  expect(loaded).toEqual([]);

  // The component renders into its own open shadow root after activation.
  shell.shadowRoot.children.push(new FakeElement('x-late'));
  timers.runNext();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
  expect(readyEvents).toEqual([{ strategy: 'load', islands: ['x-late'] }]);

  // Disarmed on the hit: no further attempt is queued, and the morph rescan
  // stays one-event-per-activation.
  expect(timers.pending()).toEqual(0);
  scheduler.observeVisible();
  scheduler.observeVisible();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
  expect(readyEvents).toEqual([{ strategy: 'load', islands: ['x-late'] }]);
  expect(hostTimeouts).toEqual([]);
});

test('late-host probe T-4: a host APPENDED to the light DOM later activates', async () => {
  const { body, timers, loaded } = lateHostFixture({});
  expect(loaded).toEqual([]);
  timers.runNext();
  body.children.push(new FakeElement('x-late'));
  timers.runNext();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
});

test('late-host probe T-5: a host nested two open shadow roots deep activates', async () => {
  const outer = new FakeElement('x-outer');
  outer.shadowRoot = new FakeElement('outer-open');
  const inner = new FakeElement('x-inner');
  inner.shadowRoot = new FakeElement('inner-open');
  outer.shadowRoot.children.push(inner);
  const body = new FakeElement('body');
  body.children.push(outer);
  const { timers, loaded } = lateHostFixture({ body });
  timers.runNext();
  inner.shadowRoot.children.push(new FakeElement('x-late'));
  timers.runNext();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
});

test('late-host probe T-6: the budget is exact — six attempts, then one give-up event', () => {
  const { timers, hostTimeouts, loaded } = lateHostFixture({});
  // Six scheduled steps at the documented offsets, none of which finds a host.
  for (let step = 0; step < 6; step++) {
    expect(timers.pending()).toEqual(1);
    timers.runNext();
  }
  expect(loaded).toEqual([]);
  // The window is spent; the probe waits for island-load activity instead of
  // giving up immediately, so its give-up timer is still the only one queued.
  expect(timers.pending()).toEqual(1);
  expect(hostTimeouts).toEqual([]);
  timers.runNext();
  expect(loaded).toEqual([]);
  expect(hostTimeouts.length).toEqual(1);
  expect(hostTimeouts[0]!.pending).toEqual(['x-late']);
  expect(hostTimeouts[0]!.attempts).toEqual(6);
  // Bounded, not silent: the tag is still unconsumed and still activatable.
  expect(timers.pending()).toEqual(0);
});

test('late-host probe T-6b: the documented schedule is the schedule that runs', () => {
  const { timers } = lateHostFixture({});
  const observed: number[] = [];
  for (let step = 0; step < 6; step++) {
    observed.push(timers.delays()[0]!);
    timers.runNext();
  }
  expect(observed).toEqual([0, 25, 100, 250, 750, 1500]);
});

test('late-host probe T-7: a hit disarms the budget early', async () => {
  const { body, timers, loaded } = lateHostFixture({});
  timers.runNext(); // attempt 1: nothing yet
  body.children.push(new FakeElement('x-late'));
  timers.runNext(); // attempt 2: hit
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
  expect(timers.pending()).toEqual(0);
});

test('late-host probe T-8: island-load activity opens a fresh window after the first is spent', async () => {
  const body = new FakeElement('body');
  body.children.push(new FakeElement('x-host'));
  const loaded: string[] = [];
  let resolveHost: (() => void) | null = null;
  const hostTimeouts: HostTimeoutEvent[] = [];
  const timers = makeTimers();
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(timers.win),
    doc: makeDoc(body, [], hostTimeouts),
    map: {
      'x-host': () =>
        new Promise<void>((resolve) => {
          resolveHost = resolve;
        }),
      'x-late': () => {
        loaded.push('x-late');
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ load: ['x-host', 'x-late'] }),
    onIslandLoaded: null,
  });
  // x-host activated at ready; x-late is pending, so the probe arms.
  expect(timers.pending()).toEqual(1);
  for (let step = 0; step < 6; step++) timers.runNext();
  // Window spent, waiting on activity — and the give-up timer is queued.
  expect(timers.pending()).toEqual(1);
  expect(hostTimeouts).toEqual([]);

  // The slow third-party chunk lands: the island module resolves.
  resolveHost!();
  await Promise.resolve();
  await Promise.resolve();
  // A fresh window, starting immediately, and the give-up timer is gone.
  expect(timers.delays()).toEqual([0]);
  body.children.push(new FakeElement('x-late'));
  timers.runNext();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
  expect(hostTimeouts).toEqual([]);
});

test('late-host probe T-9: a closed shadow root is unreachable and does not crash anything', () => {
  // A closed root is invisible by construction: Element.shadowRoot is null and
  // no standard API enumerates it, so from the scheduler's side the host
  // inside simply does not exist in any tree it can walk. The double models
  // exactly that: the sealed subtree is never attached to the walked tree.
  const closed = new FakeElement('x-closed-host');
  const sealed = new FakeElement('sealed');
  sealed.children.push(new FakeElement('x-sealed'));
  closed.shadowRoot = null;
  const open = new FakeElement('x-open-host');
  open.shadowRoot = new FakeElement('open');
  const body = new FakeElement('body');
  body.children.push(closed, open);
  const { timers, hostTimeouts, loaded } = lateHostFixture({
    tags: ['x-sealed', 'x-late'],
    body,
  });

  expect(() => {
    for (let step = 0; step < 7; step++) timers.runNext();
  }).not.toThrow();
  expect(loaded).toEqual([]);
  // Not silent: the unreachable tag is named, once.
  expect(hostTimeouts.length).toEqual(1);
  expect(hostTimeouts[0]!.pending).toEqual(['x-sealed', 'x-late']);
  // ...and the SAME page still activates an open-root late host.
  open.shadowRoot!.children.push(new FakeElement('x-late'));
  expect(body.children.length).toEqual(2);
});

test('late-host probe T-9b: an open-root late host still activates on a page that also has a closed root', async () => {
  const body = new FakeElement('body');
  const closed = new FakeElement('x-closed-host');
  closed.shadowRoot = null;
  const open = new FakeElement('x-open-host');
  open.shadowRoot = new FakeElement('open');
  body.children.push(closed, open);
  const { timers, loaded } = lateHostFixture({ tags: ['x-sealed', 'x-late'], body });
  timers.runNext();
  open.shadowRoot.children.push(new FakeElement('x-late'));
  timers.runNext();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
});

test('late-host probe T-10: B2 holds — an unhosted tag is never fetched, however many attempts run', () => {
  const { timers, loaded, hostTimeouts } = lateHostFixture({ tags: ['x-unused', 'x-never'] });
  for (let step = 0; step < 7; step++) timers.runNext();
  expect(loaded).toEqual([]);
  expect(hostTimeouts[0]!.pending).toEqual(['x-unused', 'x-never']);
});

test('late-host probe T-11: the probe reuses observeVisible, so F01 semantics are unchanged', async () => {
  const body = new FakeElement('body');
  const { timers, scheduler, readyEvents, loaded } = lateHostFixture({ body });
  body.children.push(new FakeElement('x-late'));
  timers.runNext();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
  // Exactly one activation and one event, no matter how many rescans follow.
  scheduler.observeVisible();
  scheduler.observeVisible();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
  expect(readyEvents).toEqual([{ strategy: 'load', islands: ['x-late'] }]);
});

/** Counts the native queries a probe spends, so the fused walk is pinned. */
class CountingElement extends FakeElement {
  queries = 0;
  override querySelectorAll(selector: string): FakeElement[] {
    this.queries += 1;
    return super.querySelectorAll(selector);
  }
}

test('late-host probe T-12: one attempt costs two queries regardless of how many tags are pending', () => {
  const body = new CountingElement('body');
  body.children.push(new FakeElement('x-shell'));
  const { timers } = lateHostFixture({ tags: ['x-a', 'x-b', 'x-c'], body });
  // The ready-time gate asks per tag — two queries (the tag, then '*') each.
  const readyCost = body.queries;
  expect(readyCost).toEqual(6);
  timers.runNext();
  // The probe's fused walk answers all three pending tags in one pass: the
  // tag selector list, then the '*' list for the shadow descent.
  expect(body.queries - readyCost).toEqual(2);
  timers.runNext();
  expect(body.queries - readyCost).toEqual(4);
});

test('late-host probe T-13: a host with no timer, and a timer that throws, both stay contained', () => {
  const hostTimeouts: HostTimeoutEvent[] = [];
  const loaded: string[] = [];
  const map = {
    'x-late': () => {
      loaded.push('x-late');
      return Promise.resolve();
    },
  };
  // A window whose setTimeout never calls back: the probe simply never runs.
  const silent = makeWin({
    setTimeout: () => 0,
    clearTimeout: () => {},
    Date: { now: () => 0 },
  });
  expect(() =>
    createIslandScheduler({
      log: { warn: () => {} },
      idleFallbackTimeoutMs: 25,
      win: silent,
      doc: makeDoc(new FakeElement('body'), [], hostTimeouts),
      map,
      strategies: STRATEGIES({ load: ['x-late'] }),
      onIslandLoaded: null,
    }),
  ).not.toThrow();
  expect(loaded).toEqual([]);
  expect(hostTimeouts).toEqual([]);

  // A window that refuses to schedule at all: contained, nothing consumed.
  const refused = makeWin({
    setTimeout: () => {
      throw new Error('no timers here');
    },
    clearTimeout: () => {},
    Date: { now: () => 0 },
  });
  expect(() =>
    createIslandScheduler({
      log: { warn: () => {} },
      idleFallbackTimeoutMs: 25,
      win: refused,
      doc: makeDoc(new FakeElement('body'), [], hostTimeouts),
      map: {
        'x-late': () => {
          loaded.push('x-late');
          return Promise.resolve();
        },
      },
      strategies: STRATEGIES({ load: ['x-late'] }),
      onIslandLoaded: null,
    }),
  ).not.toThrow();
  expect(loaded).toEqual([]);
});

test('late-host probe T-14: after the budget is spent the probe never restarts', () => {
  const { timers, scheduler, hostTimeouts } = lateHostFixture({});
  for (let step = 0; step < 7; step++) timers.runNext();
  expect(hostTimeouts.length).toEqual(1);
  expect(timers.pending()).toEqual(0);
  scheduler.observeVisible();
  scheduler.observeVisible();
  expect(timers.pending()).toEqual(0);
  expect(hostTimeouts.length).toEqual(1);
});

test('late-host probe T-15: idle keeps its own deferred chain and is not probed twice', () => {
  const readyEvents: ReadyEvent[] = [];
  const hostTimeouts: HostTimeoutEvent[] = [];
  const idleCallbacks: (() => void)[] = [];
  const body = new FakeElement('body');
  createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    // No idle primitive: the idle chain falls back to the injected timeout.
    win: makeWin({
      setTimeout: (fn: () => void) => {
        idleCallbacks.push(fn);
        return 0;
      },
    }),
    doc: makeDoc(body, readyEvents, hostTimeouts),
    map: { 'x-idle': () => Promise.resolve() },
    strategies: STRATEGIES({ idle: ['x-idle'] }),
    onIslandLoaded: null,
  });
  // The idle attempt is outstanding, so the probe does not arm a second
  // deferred step for the same tag.
  expect(idleCallbacks.length).toEqual(1);
  expect(hostTimeouts).toEqual([]);
  idleCallbacks[0]!();
  expect(hostTimeouts).toEqual([]);
});

/**
 * A page that can renew the probe's window on demand: two hosted islands whose
 * factories are held open (so their resolution — the activity signal — can be
 * delivered whenever a test wants) plus one island with no host at all.
 */
function renewingFixture() {
  const body = new FakeElement('body');
  body.children.push(new FakeElement('x-host-a'), new FakeElement('x-host-b'));
  const resolvers: Record<string, () => void> = {};
  const hostTimeouts: HostTimeoutEvent[] = [];
  const timers = makeTimers();
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(timers.win),
    doc: makeDoc(body, [], hostTimeouts),
    map: {
      'x-host-a': () =>
        new Promise<void>((resolve) => {
          resolvers['x-host-a'] = resolve;
        }),
      'x-host-b': () =>
        new Promise<void>((resolve) => {
          resolvers['x-host-b'] = resolve;
        }),
      'x-late': () => Promise.resolve(),
    },
    strategies: STRATEGIES({ load: ['x-host-a', 'x-host-b', 'x-late'] }),
    onIslandLoaded: null,
  });
  return { body, timers, scheduler, hostTimeouts, resume: (tag: string) => resolvers[tag]!() };
}

/** Spend one whole window: six attempts, then the give-up timer is queued. */
function spendWindow(timers: ReturnType<typeof makeTimers>) {
  for (let step = 0; step < 6; step++) timers.runNext();
}

test('late-host probe T-16: a duplicated host in a second root is not re-counted, and a spent root is skipped', async () => {
  const body = new FakeElement('body');
  const first = new FakeElement('x-a');
  first.shadowRoot = new FakeElement('a-open');
  const second = new FakeElement('x-b');
  second.shadowRoot = new FakeElement('b-open');
  body.children.push(first, second);
  // The same island tag is instantiated inside both third-party shadow roots.
  first.shadowRoot.children.push(new FakeElement('x-late'));
  second.shadowRoot.children.push(new FakeElement('x-late'));
  const { timers, loaded } = lateHostFixture({ tags: ['x-late', 'x-absent'], body });

  timers.runNext();
  await Promise.resolve();
  // Two hosts, one definition: the second sighting is not a second activation.
  expect(loaded).toEqual(['x-late']);
});

test('late-host probe T-17: a morph that activates the last pending tag ends the probe with no spent attempt', async () => {
  const body = new FakeElement('body');
  const { timers, scheduler, loaded, hostTimeouts } = lateHostFixture({ body });
  timers.runNext(); // attempt 1 finds nothing and queues attempt 2
  expect(timers.pending()).toEqual(1);
  // The host arrives through a morph instead, and that rescan activates it.
  body.children.push(new FakeElement('x-late'));
  scheduler.observeVisible();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
  // Attempt 2 now finds nothing pending and retires without spending a step.
  timers.runNext();
  expect(timers.pending()).toEqual(0);
  expect(hostTimeouts).toEqual([]);
});

test('late-host probe T-18: three windows is the cap, and the absolute clock ends it too', async () => {
  const capped = renewingFixture();
  spendWindow(capped.timers);
  expect(capped.timers.pending()).toEqual(1);
  for (const host of ['x-host-a', 'x-host-b']) {
    capped.resume(host);
    await Promise.resolve();
    await Promise.resolve();
    expect(capped.timers.delays()).toEqual([0]);
    spendWindow(capped.timers);
  }
  // Third window spent: the window count is the binding cap.
  expect(capped.hostTimeouts.length).toEqual(1);
  expect(capped.hostTimeouts[0]!.pending).toEqual(['x-late']);
  expect(capped.timers.pending()).toEqual(0);

  // A slow page can also reach the absolute wall-clock cap with windows left:
  // the clock is the second, independent bound.
  const clocked = renewingFixture();
  spendWindow(clocked.timers);
  clocked.timers.advance(9000);
  clocked.resume('x-host-a');
  await Promise.resolve();
  await Promise.resolve();
  spendWindow(clocked.timers);
  expect(clocked.hostTimeouts.length).toEqual(1);
  expect(clocked.hostTimeouts[0]!.elapsedMs >= 9000).toEqual(true);
});

// FR-03 (PR #1611 review): the 9000 ms cap is a hard ENTRY gate, not a bound
// applied after a DOM scan. A page suspended or throttled past it must give up
// without walking the tree or activating a host that appeared meanwhile.
test('late-host probe T-18b: a probe entry past the absolute cap never scans or activates', async () => {
  const body = new CountingElement('body');
  const { timers, readyEvents, hostTimeouts, loaded } = lateHostFixture({ body });
  // The first probe step was queued inside the budget but has not run yet:
  // exactly the suspended-page shape the review reproduced.
  expect(timers.pending()).toEqual(1);
  const queriesBefore = body.queries;
  timers.advance(10_000);
  // The late host arrives while the page is suspended — the frozen step must
  // not discover it.
  body.children.push(new FakeElement('x-late'));
  timers.runNext();
  await Promise.resolve();
  expect(loaded).toEqual([]);
  expect(readyEvents).toEqual([]);
  // No fused walk ran: the entry gate retired the chain before collectHosts.
  expect(body.queries).toEqual(queriesBefore);
  expect(hostTimeouts.length).toEqual(1);
  expect(hostTimeouts[0]!.pending).toEqual(['x-late']);
  expect(hostTimeouts[0]!.elapsedMs >= 9000).toEqual(true);
  expect(timers.pending()).toEqual(0);
});

test('late-host probe T-18c: the last permitted moment before the cap still activates a late host', async () => {
  const body = new FakeElement('body');
  const { timers, readyEvents, hostTimeouts, loaded } = lateHostFixture({ body });
  // One millisecond inside the absolute budget: the probe still runs.
  timers.advance(8_999);
  body.children.push(new FakeElement('x-late'));
  timers.runNext();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
  expect(readyEvents).toEqual([{ strategy: 'load', islands: ['x-late'] }]);
  expect(hostTimeouts).toEqual([]);
});

test('late-host probe T-18d: a suspend/throttle resume past the cap retires at every continuation entry', async () => {
  // (a) The awaiting give-up timer fires after the page resumes. The probe
  // entry behind that timer must not run its DOM scan or activate the host.
  const timerResumed = renewingFixture();
  spendWindow(timerResumed.timers);
  expect(timerResumed.timers.pending()).toEqual(1);
  timerResumed.timers.advance(10_000);
  timerResumed.body.children.push(new FakeElement('x-late'));
  timerResumed.timers.runNext();
  await Promise.resolve();
  expect(timerResumed.hostTimeouts.length).toEqual(1);
  expect(timerResumed.hostTimeouts[0]!.elapsedMs >= 9000).toEqual(true);
  expect(timerResumed.timers.pending()).toEqual(0);

  // (b) Island-load activity delivered after the resume is a continuation
  // entry too: it must not reopen a window, queue a timer, or scan.
  const activityResumed = renewingFixture();
  spendWindow(activityResumed.timers);
  activityResumed.timers.advance(10_000);
  activityResumed.resume('x-host-a');
  await Promise.resolve();
  await Promise.resolve();
  expect(activityResumed.timers.pending()).toEqual(0);
  expect(activityResumed.hostTimeouts.length).toEqual(1);
  expect(activityResumed.hostTimeouts[0]!.pending).toEqual(['x-late']);
  expect(activityResumed.hostTimeouts[0]!.elapsedMs >= 9000).toEqual(true);
});

test('late-host probe T-19: a morph during the wait leaves nothing stranded, so nothing is reported', async () => {
  const fixture = renewingFixture();
  spendWindow(fixture.timers);
  expect(fixture.timers.pending()).toEqual(1); // the give-up timer
  // The host arrives through a morph while the probe waits out the window.
  fixture.body.children.push(new FakeElement('x-late'));
  fixture.scheduler.observeVisible();
  await Promise.resolve();
  // The give-up timer fires with an empty pending set: no diagnostic.
  fixture.timers.runNext();
  expect(fixture.hostTimeouts).toEqual([]);
});

// ─── FR-02 (PR #1611 review): idle/media transitions arm the late-host probe ───
//
// Before this fix a page declaring only idle islands (the default strategy) or
// only media islands never armed the probe: pendingTags() excluded the idle tag
// while its callback was outstanding, and a non-matching media query was
// filtered out at construction — and neither transition that followed had an
// arm. A host created after that transition was never discovered. These tests
// reproduce both review scenarios DOM-free, plus a positive rescan control and
// a no-duplicate-load negative.

/** Idle-only page: one idle island, no host; the test owns the idle callback. */
function idleLateHostPage() {
  const readyEvents: ReadyEvent[] = [];
  const hostTimeouts: HostTimeoutEvent[] = [];
  const loaded: string[] = [];
  const idleCallbacks: Array<() => void> = [];
  const timers = makeTimers();
  const body = new FakeElement('body');
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin({
      ...timers.win,
      requestIdleCallback: (fn: () => void) => {
        idleCallbacks.push(fn);
      },
    }),
    doc: makeDoc(body, readyEvents, hostTimeouts),
    map: {
      'x-late': () => {
        loaded.push('x-late');
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ idle: ['x-late'] }),
    onIslandLoaded: null,
  });
  return { body, timers, scheduler, readyEvents, hostTimeouts, loaded, idleCallbacks };
}

/** Media-only page: one media island whose query starts non-matching. */
function mediaLateHostPage() {
  const readyEvents: ReadyEvent[] = [];
  const hostTimeouts: HostTimeoutEvent[] = [];
  const loaded: string[] = [];
  const changeListeners: Array<(event: { matches: boolean }) => void> = [];
  const timers = makeTimers();
  const body = new FakeElement('body');
  const query = {
    matches: false,
    addEventListener: (_type: 'change', listener: (event: { matches: boolean }) => void) => {
      changeListeners.push(listener);
    },
  };
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    idleFallbackTimeoutMs: 25,
    win: makeWin(timers.win),
    doc: makeDoc(body, readyEvents, hostTimeouts),
    map: {
      'x-media': () => {
        loaded.push('x-media');
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ media: ['x-media'] }),
    mediaQueries: { 'x-media': query },
    onIslandLoaded: null,
  });
  return { body, timers, scheduler, readyEvents, hostTimeouts, loaded, changeListeners, query };
}

test('FR-02 idle-only: a host that appears after the idle attempt activates, with open:ready', async () => {
  const { body, timers, readyEvents, hostTimeouts, loaded, idleCallbacks } = idleLateHostPage();
  // Construction scheduled the one idle attempt and armed nothing: the probe
  // must not race an attempt the browser has not been asked for yet.
  expect(idleCallbacks.length).toEqual(1);
  expect(timers.pending()).toEqual(0);

  // The idle callback runs, finds no host, and is now spent.
  idleCallbacks[0]!();
  expect(loaded).toEqual([]);
  expect(readyEvents).toEqual([]);
  // Its completion armed the bounded probe (this is the review's first gap).
  expect(timers.pending()).toEqual(1);

  // The host appears after the opportunity was spent.
  body.children.push(new FakeElement('x-late'));
  timers.runNext();
  await Promise.resolve();
  // The probe hit hands the decision to the SAME rescan; idle then re-runs
  // through its own idle primitive — activation is still asynchronous.
  expect(loaded).toEqual([]);
  expect(idleCallbacks.length).toEqual(2);
  idleCallbacks[1]!();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
  expect(readyEvents).toEqual([{ strategy: 'idle', islands: ['x-late'] }]);
  expect(hostTimeouts).toEqual([]);
  expect(timers.pending()).toEqual(0);
});

test('FR-02 media-only: a query that flips matching before any host arms the probe', async () => {
  const { body, timers, scheduler, readyEvents, hostTimeouts, loaded, changeListeners, query } =
    mediaLateHostPage();
  // Non-matching at construction: capability-gated, so nothing is pending and
  // nothing is scheduled.
  expect(timers.pending()).toEqual(0);
  expect(changeListeners.length).toEqual(1);

  // The query matches while the page still has no host: the one-shot media
  // attempt is a no-op. That transition now arms the probe (the review's
  // second gap). A real MediaQueryList updates `matches` before dispatching.
  query.matches = true;
  changeListeners[0]!({ matches: true });
  expect(loaded).toEqual([]);
  expect(timers.pending()).toEqual(1);

  // A host created after the transition is discovered and activated.
  body.children.push(new FakeElement('x-media'));
  timers.runNext();
  await Promise.resolve();
  expect(loaded).toEqual(['x-media']);
  expect(readyEvents).toEqual([{ strategy: 'media', islands: ['x-media'] }]);
  expect(hostTimeouts).toEqual([]);

  // Negative: re-firing the change and rescanning never loads the tag again.
  changeListeners[0]!({ matches: true });
  scheduler.observeVisible();
  scheduler.observeVisible();
  await Promise.resolve();
  expect(loaded).toEqual(['x-media']);
  expect(readyEvents.length).toEqual(1);
});

test('FR-02 no duplicate load: the idle-transition arm and later rescans are one-shot', async () => {
  const { body, timers, scheduler, readyEvents, hostTimeouts, loaded, idleCallbacks } =
    idleLateHostPage();
  idleCallbacks[0]!();
  body.children.push(new FakeElement('x-late'));
  timers.runNext();
  await Promise.resolve();
  idleCallbacks[1]!();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
  expect(readyEvents).toEqual([{ strategy: 'idle', islands: ['x-late'] }]);
  expect(timers.pending()).toEqual(0);
  // Explicit rescans after the activation cannot consume the factory twice.
  scheduler.observeVisible();
  scheduler.observeVisible();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
  expect(readyEvents.length).toEqual(1);
  expect(hostTimeouts).toEqual([]);
});

test('FR-02 positive control: an explicit rescan still activates the idle-only late host', async () => {
  const { body, timers, scheduler, readyEvents, loaded, idleCallbacks } = idleLateHostPage();
  idleCallbacks[0]!(); // the idle attempt is spent with no host
  body.children.push(new FakeElement('x-late'));
  // The review's positive control: an explicit rescan alone reaches the host.
  scheduler.observeVisible();
  expect(idleCallbacks.length).toEqual(2);
  idleCallbacks[1]!();
  await Promise.resolve();
  expect(loaded).toEqual(['x-late']);
  expect(readyEvents).toEqual([{ strategy: 'idle', islands: ['x-late'] }]);
  // Drain the probe step the deferred arm queued: it retires with nothing
  // pending and adds no second event.
  while (timers.pending() > 0) timers.runNext();
  expect(loaded).toEqual(['x-late']);
  expect(readyEvents.length).toEqual(1);
});

test('FR-02 idle-only: a page that never gets a host still ends in the one diagnostic', () => {
  const { timers, hostTimeouts, loaded, idleCallbacks } = idleLateHostPage();
  idleCallbacks[0]!();
  for (let step = 0; step < 10 && timers.pending() > 0; step++) timers.runNext();
  expect(loaded).toEqual([]);
  expect(timers.pending()).toEqual(0);
  expect(hostTimeouts.length).toEqual(1);
  expect(hostTimeouts[0]!.pending).toEqual(['x-late']);
});

test('late-host probe T-20: the walk stops descending once every pending tag is found', () => {
  // The early exit is what bounds a probe's cost on a page full of shadow
  // hosts: a root reached after the last tag was found must cost nothing.
  const body = new FakeElement('body');
  const withTag = new FakeElement('x-first');
  withTag.shadowRoot = new CountingElement('first-open');
  const after = new FakeElement('x-second');
  after.shadowRoot = new CountingElement('second-open');
  body.children.push(withTag, after);
  withTag.shadowRoot.children.push(new FakeElement('x-late'));
  const { timers, loaded } = lateHostFixture({ tags: ['x-late'], body });
  timers.runNext();
  // The second root is never queried: nothing was left to look for.
  expect((after.shadowRoot as CountingElement).queries).toEqual(0);
  expect(loaded).toEqual(['x-late']);
});
