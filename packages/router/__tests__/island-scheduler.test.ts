/**
 * Unit tests for the real island-scheduler module (#610) — the code the
 * generated client entry inlines verbatim. Covers the #605 open:ready
 * contract (every non-empty strategy bucket fires) and the #606 deep,
 * shadow-root-aware visible scheduling.
 */
import { assertEquals } from '@std/assert';
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

const STRATEGIES = (
  overrides: Partial<{ load: string[]; idle: string[]; visible: string[]; only: string[] }> = {},
) => ({
  load: overrides.load ?? [],
  idle: overrides.idle ?? [],
  visible: overrides.visible ?? [],
  only: overrides.only ?? [],
});

Deno.test('#605 load and only buckets fire open:ready immediately', async () => {
  const readyEvents: ReadyEvent[] = [];
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    win: makeWin(),
    doc: makeDoc(new FakeElement('body'), readyEvents),
    map: mapWith(['x-load', 'x-only']),
    strategies: STRATEGIES({ load: ['x-load'], only: ['x-only'] }),
    onIslandLoaded: null,
  });
  assertEquals(typeof scheduler.observeVisible, 'function');
  assertEquals(readyEvents, [
    { strategy: 'load', islands: ['x-load'] },
    { strategy: 'only', islands: ['x-only'] },
  ]);
  // The import factories were invoked (entries consumed).
  await Promise.resolve();
});

Deno.test('#605 idle bucket fires open:ready when idle time arrives', () => {
  const readyEvents: ReadyEvent[] = [];
  let idleCallback: (() => void) | null = null;
  createIslandScheduler({
    log: { warn: () => {} },
    win: makeWin({ requestIdleCallback: (fn: () => void) => (idleCallback = fn) }),
    doc: makeDoc(new FakeElement('body'), readyEvents),
    map: mapWith(['x-idle']),
    strategies: STRATEGIES({ idle: ['x-idle'] }),
    onIslandLoaded: null,
  });
  // Not yet: idle deferral means no import and no event so far.
  assertEquals(readyEvents, []);
  idleCallback!();
  assertEquals(readyEvents, [{ strategy: 'idle', islands: ['x-idle'] }]);
});

Deno.test('#605 empty buckets never fire open:ready', () => {
  const readyEvents: ReadyEvent[] = [];
  createIslandScheduler({
    log: { warn: () => {} },
    win: makeWin(),
    doc: makeDoc(new FakeElement('body'), readyEvents),
    map: {},
    strategies: STRATEGIES(),
    onIslandLoaded: null,
  });
  assertEquals(readyEvents, []);
});

Deno.test('#606 visible scheduling finds islands inside shadow roots (deep query)', () => {
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
  assertEquals(observed, [island]);
  assertEquals(loaded, 0);
  FakeIO.instances[0].intersect();
  assertEquals(loaded, 1);
  assertEquals(readyEvents, [{ strategy: 'visible', islands: ['x-vis'] }]);
});

Deno.test('#606 visible without IntersectionObserver loads every visible tag', () => {
  const readyEvents: ReadyEvent[] = [];
  const loaded: string[] = [];
  createIslandScheduler({
    log: { warn: () => {} },
    win: makeWin(), // no IntersectionObserver
    doc: makeDoc(new FakeElement('body'), readyEvents),
    map: {
      'x-vis': () => {
        loaded.push('x-vis');
        return Promise.resolve();
      },
    },
    strategies: STRATEGIES({ visible: ['x-vis'] }),
    onIslandLoaded: null,
  });
  assertEquals(loaded, ['x-vis']);
  assertEquals(readyEvents, [{ strategy: 'visible', islands: ['x-vis'] }]);
});

Deno.test('#584 onIslandLoaded runs (macrotask-deferred) after an island module resolves', async () => {
  const calls: string[] = [];
  const timeouts: (() => void)[] = [];
  createIslandScheduler({
    log: { warn: () => {} },
    win: makeWin({ setTimeout: (fn: () => void) => timeouts.push(fn) }),
    doc: makeDoc(new FakeElement('body'), []),
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
  assertEquals(calls, ['import']);
  assertEquals(timeouts.length, 1);
  timeouts[0]();
  assertEquals(calls, ['import', 'rescan']);
});

Deno.test('#1039 detached visible island is released and a reinsert gets a fresh observer', () => {
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
  assertEquals(observed, [island]);
  assertEquals(FakeIO.instances.length, 1);

  // The island leaves the DOM before ever intersecting: its observer can
  // never fire again, so it must be released (not pinned forever).
  island.isConnected = false;
  page.children.length = 0;
  scheduler.observeVisible();
  assertEquals(disconnected.length, 1);
  assertEquals(FakeIO.instances.length, 1);

  // Reinserted before intersection: a fresh observer is attached so the
  // island still loads when it scrolls into view.
  island.isConnected = true;
  page.children.push(island);
  scheduler.observeVisible();
  assertEquals(FakeIO.instances.length, 2);
  assertEquals(observed, [island, island]);
  FakeIO.instances[1].intersect();
  assertEquals(loaded, 1);
  assertEquals(readyEvents, [{ strategy: 'visible', islands: ['x-vis'] }]);
});
