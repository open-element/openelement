/**
 * M08-4 resource-parity lane — LOCAL Chromium negatives and two-region resource
 * accounting.
 *
 * The existing S2 vertical (`generated-leaf.s2-ssr-claim.browser.test.ts`)
 * records the positive SSR → parse → claim → update → dispose chain. This file
 * adds only the resource/negative edges that were still open:
 *
 *   - a list-entry activation throw releases every subscription that is open
 *     at the throw and leaves the borrowed DOM in place (an earlier dynamic write is allowed to
 *     remain; the claim is not a byte transaction);
 *   - one throwing cleanup does not suppress the other cleanups or any live
 *     subscription, in both dispose(false) and dispose(true);
 *   - the consumer fixture disposes the old projection before rebuilding the
 *     same host, so subscriptions do not accumulate; the runtime has no host
 *     registry, so the undisposed path is recorded as a gap, not auto-rejected;
 *   - a two-root / two-list SSR → parse → claim keeps two regions with separate
 *     entry owners and exact per-dependency subscriptions, then exercises
 *     dispose(false) and dispose(true);
 *   - the S2 Board's logical dependency multiset is exact per phase;
 *   - the claim-mismatch diagnostic keeps its code and DOM path and now ends
 *     with the authored `file:line:column` in the MESSAGE ONLY. The error
 *     object still has no structured position field. Directory range-interior
 *     precision stays deferred (the static sibling-range consumer keeps its
 *     `[compiled-runtime] file#Component` label) and the nested-directory
 *     seed-mismatch DOM-path form is not proven here;
 *   - the repeated-insertion fixture now has a server producer
 *     (`Twice__ssr`), so this file pins the produced bytes only. The
 *     authoritative server → parse → claim isolation witness for the SAME
 *     recipe is `generated-leaf.composition-ssr.browser.test.ts` (claim probe
 *     projections=3 regions=3 owners=3 subs=2, 0 claim mutations), so this
 *     file does not duplicate that browser vertical.
 *
 * Not claimed by this file: M08 exit, TSX-18/TSX-30 pass, the repeated-
 * instance claim vertical (owned by the composition browser suite above),
 * Firefox/WebKit/M13, a public ABI or release evidence. The eight browser
 * tests are LOCAL Chromium (147.0.7727.15) only; the repeated-instance
 * producer test is a Node static/SSR assertion.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Browser, chromium, type Page } from 'playwright';
import {
  buildRuntimeBundle,
  compileFixture,
  openGeneratedPage,
  type CompiledFixture,
  ssr,
  type RuntimeBundle,
} from './testlib/m08-browser-harness.ts';

const FILE = '/proj/src/m08-resource-parity.tsx';

const S2_BOARD = `import { signal } from '@openelement/element';
function Board(props) {
  const items = signal([{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }]);
  const open = signal(true);
  const count = signal(0);
  return <section>
    {open.value ? <p class="on">open</p> : <em class="off">closed</em>}
    <ul>{items.value.map((item) => <li key={item.id}>{item.label}: {count.value}</li>)}</ul>
    <p id="draft" contenteditable="true">note</p>
  </section>;
}
`;

const S2_INITIAL = [
  { id: 'a', label: 'A' },
  { id: 'c', label: 'C' },
];

const TWO_REGION = `import { signal } from '@openelement/element';
function Pair(props) {
  const leftItems = signal([{ id: 'a', label: 'A' }]);
  const leftCount = signal(0);
  const rightItems = signal([{ id: 'b', label: 'B' }]);
  const rightCount = signal(0);
  return <>
    <section class="left"><ul>{leftItems.value.map((item) => <li key={item.id}>{item.label}: {leftCount.value}</li>)}</ul></section>
    <section class="right"><ul>{rightItems.value.map((item) => <li key={item.id}>{item.label}: {rightCount.value}</li>)}</ul></section>
  </>;
}
`;

const TWICE = `function Twice(props) {
  const item = <span>x</span>;
  return <div>{item}{item}</div>;
}
`;

const S2_FIXTURE = compileFixture(S2_BOARD, FILE);
const S2_MAPPED_FIXTURE = compileFixture(S2_BOARD, FILE, S2_BOARD);
const TWO_REGION_FIXTURE = compileFixture(TWO_REGION, FILE);
const TWICE_FIXTURE = compileFixture(TWICE, FILE);

function renderBoard(items: readonly unknown[] = S2_INITIAL, open = true, count = 0): string {
  return ssr(S2_FIXTURE.loaded, 'Board')(
    {},
    {
      bindings: { open: { value: open }, items: { value: items }, count: { value: count } },
    },
  );
}

function renderPair(): string {
  return ssr(TWO_REGION_FIXTURE.loaded, 'Pair')(
    {},
    {
      bindings: {
        leftItems: { value: [{ id: 'a', label: 'A' }] },
        leftCount: { value: 0 },
        rightItems: { value: [{ id: 'b', label: 'B' }] },
        rightCount: { value: 0 },
      },
    },
  );
}

interface Probe {
  projections: number;
  regions: number;
  owners: number;
  nodes: number;
  rangeCleanups: number;
  subscriptions: number;
  unsubscribed: number;
  lineageAccepted: number;
  lineageRejected: number;
  disposed: number;
}

interface ProjectionPage {
  readonly nodes: readonly Node[];
  readonly owner: LifetimeScopePage;
  dispose(detachOwnedNodes?: boolean): void;
}

interface LifetimeScopePage {
  add(cleanup: () => void): void;
  dispose(detachOwnedNodes?: boolean): void;
}

interface SignalPage<T> {
  value: T;
  subscribe(fn: (value: T) => void): () => void;
}

interface RuntimePage {
  claimRecipe(owner: unknown, recipe: unknown, parent: Node): ProjectionPage;
  insertRecipe(owner: unknown, recipe: unknown, parent: Node): ProjectionPage;
  readonly LifetimeScope: new () => LifetimeScopePage;
  readonly signal: <T>(value: T) => SignalPage<T>;
  readonly runtimeProbe: { reset(): void; snapshot(): Probe };
}

interface TrackedStats {
  readonly name: string;
  readonly reads: number;
  readonly opened: number;
  readonly closed: number;
}

interface TrackedSignal<T> {
  readonly signal: SignalPage<T>;
  readonly stats: TrackedStats;
}

interface PageSignalFactory {
  <T>(
    runtime: RuntimePage,
    name: string,
    initial: T,
    log: string[],
    throwOnRead?: number,
  ): TrackedSignal<T>;
}

interface PageHelpers {
  readonly __oeSignal: PageSignalFactory;
  readonly __oeSameNodes: (before: readonly Node[], after: readonly Node[]) => boolean;
  readonly __oeInstrumentChildOwners: (runtime: RuntimePage) => { count: number };
}

interface PageModule {
  [name: string]: ((owner: unknown, host: unknown) => unknown) | undefined;
}

type PageGlobals = PageHelpers & {
  readonly __oeRuntime: RuntimePage;
  readonly __oeModule: PageModule;
};

let bundle: RuntimeBundle;
let browser: Browser;

beforeAll(async () => {
  bundle = await buildRuntimeBundle();
  browser = await chromium.launch();
  console.log(`[M08-resource] engine=chromium version=${browser.version()} LOCAL`);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  bundle?.dispose();
});

function newPage(fixture: CompiledFixture): Promise<Page> {
  return openGeneratedPage(browser, bundle, fixture);
}

interface ActivationThrowResult {
  readonly error: string | null;
  readonly mutations: readonly string[];
  readonly texts: readonly (string | null)[];
  readonly identity: boolean;
  readonly stillInHost: boolean;
  readonly probe: Probe;
  readonly log: readonly string[];
  readonly openStats: TrackedStats;
  readonly itemsStats: TrackedStats;
  readonly countStats: TrackedStats;
  readonly retry: {
    readonly error: string | null;
    readonly mutations: readonly string[];
    readonly texts: readonly (string | null)[];
    readonly identity: boolean;
    readonly probe: Probe;
    readonly afterDispose: Probe;
    readonly log: readonly string[];
    readonly countStats: TrackedStats;
  };
}

describe('M08-4 list activation throw', () => {
  test('a throwing entry activation releases owner subscriptions without deleting borrowed DOM', async () => {
    const html = renderBoard(S2_INITIAL, true, 0);
    expect(html).toBe(
      '<section><!--oe:when--><p class="on">open</p><!--oe:/when--><ul><!--oe:each--><!--oe:k:s:61--><li><!--oe:t:0-->A<!--oe:/t:0-->: <!--oe:t:1-->0<!--oe:/t:1--></li><!--oe:k:s:63--><li><!--oe:t:0-->C<!--oe:/t:0-->: <!--oe:t:1-->0<!--oe:/t:1--></li><!--oe:/each--></ul><p id="draft" contenteditable="true">note</p></section>',
    );
    const page = await newPage(S2_FIXTURE);

    const result = (await page.evaluate((serverHtml) => {
      const globals = window as unknown as PageGlobals;
      const runtime = globals.__oeRuntime;
      const factories = globals.__oeModule;
      const track = globals.__oeSignal;
      const sameNodes = globals.__oeSameNodes;

      const host = document.createElement('div');
      document.body.innerHTML = '';
      document.body.appendChild(host);
      host.innerHTML = serverHtml;
      const section = host.firstChild as Element;
      const ul = section.querySelector('ul') as Element;
      const lis = [...ul.querySelectorAll('li')];
      const ulChildren = [...ul.childNodes];
      const sectionChildren = [...section.childNodes];

      const subscribeLog: string[] = [];
      const open = track(runtime, 'open', true, subscribeLog);
      const items = track(
        runtime,
        'items',
        [
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ],
        subscribeLog,
      );
      // Entry 1 reads count for its compare-write (1) and for the binding
      // snapshot (2). Entry 2's compare-write is the third read: throwing there
      // happens after entry 1 wrote and subscribed, but before entry 2 activates.
      const count = track(runtime, 'count', 7, subscribeLog, 3);

      const scope = new runtime.LifetimeScope();
      const recipe = factories.createBoardRecipe!(scope, {
        props: {},
        bindings: { open: open.signal, items: items.signal, count: count.signal },
        propsChanged: runtime.signal(0),
      });

      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });

      runtime.runtimeProbe.reset();
      let error: string | null = null;
      try {
        runtime.claimRecipe(scope, recipe, host);
        error = 'NO_THROW';
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      for (const record of observer.takeRecords()) mutations.push(record.type);
      observer.disconnect();

      const probe = runtime.runtimeProbe.snapshot();
      const afterLis = [...ul.querySelectorAll('li')];
      const identity =
        host.firstChild === section &&
        section.querySelector('ul') === ul &&
        sameNodes(sectionChildren, [...section.childNodes]) &&
        sameNodes(ulChildren, [...ul.childNodes]) &&
        afterLis.length === lis.length &&
        afterLis.every((li, index) => li === lis[index]);
      const texts = afterLis.map((li) => li.textContent);
      const stillInHost = host.contains(section);
      const failed = {
        error,
        mutations: [...mutations],
        texts,
        identity,
        stillInHost,
        probe,
        log: [...subscribeLog],
        openStats: { ...open.stats },
        itemsStats: { ...items.stats },
        countStats: { ...count.stats },
      };
      scope.dispose(false);

      // Bounded recovery on the same borrowed DOM: the first entry's allowed
      // write stays, the fresh claim writes the second entry and adopts the
      // same nodes. This is a new consumer step, not a rollback of the first.
      const retryLog: string[] = [];
      const retryOpen = track(runtime, 'open', true, retryLog);
      const retryItems = track(
        runtime,
        'items',
        [
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ],
        retryLog,
      );
      const retryCount = track(runtime, 'count-retry', 7, retryLog);
      const retryScope = new runtime.LifetimeScope();
      const retryRecipe = factories.createBoardRecipe!(retryScope, {
        props: {},
        bindings: {
          open: retryOpen.signal,
          items: retryItems.signal,
          count: retryCount.signal,
        },
        propsChanged: runtime.signal(0),
      });
      const retryMutations: string[] = [];
      const retryObserver = new MutationObserver((records) => {
        for (const record of records) retryMutations.push(record.type);
      });
      retryObserver.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      runtime.runtimeProbe.reset();
      let retryError: string | null = null;
      let retryProjection: ProjectionPage | null = null;
      try {
        retryProjection = runtime.claimRecipe(retryScope, retryRecipe, host);
      } catch (caught) {
        retryError = caught instanceof Error ? caught.message : String(caught);
      }
      for (const record of retryObserver.takeRecords()) retryMutations.push(record.type);
      retryObserver.disconnect();
      const retryProbe = runtime.runtimeProbe.snapshot();
      const retryLis = [...ul.querySelectorAll('li')];
      const retryTexts = retryLis.map((li) => li.textContent);
      const retryIdentity =
        host.firstChild === section &&
        retryLis.length === 2 &&
        retryLis.every((li, index) => li === lis[index]);
      retryProjection?.dispose(false);
      const afterDispose = runtime.runtimeProbe.snapshot();
      retryScope.dispose(false);
      return {
        ...failed,
        retry: {
          error: retryError,
          mutations: [...retryMutations],
          texts: retryTexts,
          identity: retryIdentity,
          probe: retryProbe,
          afterDispose,
          log: [...retryLog],
          countStats: { ...retryCount.stats },
        },
      };
    }, html)) as ActivationThrowResult;

    expect(result.error).toContain('tracked activation throw: count');
    // The earlier dynamic write is deliberately not rolled back; this is the
    // documented non-transactional claim contract, not a missing transaction.
    expect(result.mutations).toEqual(['characterData']);
    expect(result.texts).toEqual(['A: 7', 'C: 0']);
    expect(result.identity).toBe(true);
    expect(result.stillInHost).toBe(true);
    expect(result.probe).toMatchObject({
      owners: 1,
      projections: 0,
      rangeCleanups: 0,
      subscriptions: 2,
      unsubscribed: 2,
      disposed: 0,
    });
    expect(result.log).toEqual(['open', 'count']);
    expect(result.openStats).toMatchObject({ opened: 1, closed: 1 });
    expect(result.itemsStats).toMatchObject({ opened: 0, closed: 0 });
    expect(result.countStats).toMatchObject({ reads: 3, opened: 1, closed: 1 });

    expect(result.retry.error).toBeNull();
    expect(result.retry.mutations).toEqual(['characterData']);
    expect(result.retry.texts).toEqual(['A: 7', 'C: 7']);
    expect(result.retry.identity).toBe(true);
    expect(result.retry.probe).toMatchObject({
      owners: 1,
      projections: 1,
      subscriptions: 4,
      unsubscribed: 0,
      disposed: 0,
    });
    expect(result.retry.afterDispose).toMatchObject({
      unsubscribed: 4,
      disposed: 1,
    });
    expect(result.retry.log).toEqual(['open', 'count-retry', 'count-retry', 'items']);
    expect(result.retry.countStats).toMatchObject({ opened: 2, closed: 2 });
    console.log(
      `[M08-resource] activation-throw opened=${result.probe.subscriptions} closed=${result.probe.unsubscribed} ` +
        `borrowed=${result.stillInHost} writes=${result.mutations.length} retry-subs=${result.retry.probe.subscriptions}`,
    );
    await page.close();
  }, 120_000);
});

interface CleanupRun {
  readonly error: string | null;
  readonly secondError: string | null;
  readonly order: readonly string[];
  readonly subscriptionsDelta: number;
  readonly unsubscribedDelta: number;
  readonly secondUnsubscribedDelta: number;
  readonly stillInHost: boolean;
  readonly hostChildren: number;
  readonly claimSubscriptions: number;
  readonly identity: boolean;
  readonly opened: readonly TrackedStats[];
  readonly closed: readonly TrackedStats[];
}

describe('M08-4 throwing cleanup', () => {
  test('one throwing cleanup still closes every other cleanup and subscription in both dispose modes', async () => {
    const html = renderBoard();
    const page = await newPage(S2_FIXTURE);

    const result = (await page.evaluate((serverHtml) => {
      const globals = window as unknown as PageGlobals;
      const runtime = globals.__oeRuntime;
      const factories = globals.__oeModule;
      const track = globals.__oeSignal;
      const sameNodes = globals.__oeSameNodes;

      const run = (detach: boolean): CleanupRun => {
        document.body.innerHTML = '<div id="host"></div>';
        const host = document.getElementById('host') as HTMLElement;
        host.innerHTML = serverHtml;
        const section = host.firstChild as Element;
        const ul = section.querySelector('ul') as Element;
        const lis = [...ul.querySelectorAll('li')];
        const ulChildren = [...ul.childNodes];
        const log: string[] = [];
        const open = track(runtime, 'open', true, log);
        const items = track(
          runtime,
          'items',
          [
            { id: 'a', label: 'A' },
            { id: 'c', label: 'C' },
          ],
          log,
        );
        const count = track(runtime, 'count', 0, log);

        const scope = new runtime.LifetimeScope();
        const recipe = factories.createBoardRecipe!(scope, {
          props: {},
          bindings: { open: open.signal, items: items.signal, count: count.signal },
          propsChanged: runtime.signal(0),
        });
        runtime.runtimeProbe.reset();
        const projection = runtime.claimRecipe(scope, recipe, host);
        const claimSubscriptions = runtime.runtimeProbe.snapshot().subscriptions;

        const order: string[] = [];
        projection.owner.add(() => order.push('normal-1'));
        projection.owner.add(() => {
          order.push('throwing');
          throw new Error('cleanup boom');
        });
        projection.owner.add(() => order.push('normal-2'));

        const before = runtime.runtimeProbe.snapshot();
        let error: string | null = null;
        try {
          projection.dispose(detach);
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
        }
        const after = runtime.runtimeProbe.snapshot();
        let secondError: string | null = null;
        try {
          projection.dispose(detach);
        } catch (caught) {
          secondError = caught instanceof Error ? caught.message : String(caught);
        }
        const afterSecond = runtime.runtimeProbe.snapshot();
        const identity =
          section.querySelector('ul') === ul &&
          (detach
            ? true
            : sameNodes(ulChildren, [...ul.childNodes]) &&
              [...ul.querySelectorAll('li')].every((li, index) => li === lis[index]));
        return {
          error,
          secondError,
          order,
          subscriptionsDelta: after.subscriptions - before.subscriptions,
          unsubscribedDelta: after.unsubscribed - before.unsubscribed,
          secondUnsubscribedDelta: afterSecond.unsubscribed - after.unsubscribed,
          stillInHost: host.contains(section),
          hostChildren: host.childNodes.length,
          claimSubscriptions,
          identity,
          opened: [{ ...open.stats }, { ...items.stats }, { ...count.stats }],
          closed: [{ ...open.stats }, { ...items.stats }, { ...count.stats }],
        };
      };

      return { keep: run(false), detach: run(true) };
    }, html)) as { readonly keep: CleanupRun; readonly detach: CleanupRun };

    for (const [label, run] of Object.entries(result)) {
      expect(run.error, label).toBe('cleanup boom');
      expect(run.secondError, label).toBeNull();
      expect(run.order, label).toEqual(['normal-2', 'throwing', 'normal-1']);
      expect(run.subscriptionsDelta, label).toBe(0);
      expect(run.unsubscribedDelta, label).toBe(run.claimSubscriptions);
      expect(run.unsubscribedDelta, label).toBe(4);
      expect(run.secondUnsubscribedDelta, label).toBe(0);
      expect(run.identity, label).toBe(true);
      expect(run.claimSubscriptions, label).toBe(4);
      expect(run.opened.map((stats) => [stats.name, stats.opened])).toEqual([
        ['open', 1],
        ['items', 1],
        ['count', 2],
      ]);
      expect(run.closed.map((stats) => [stats.name, stats.closed])).toEqual([
        ['open', 1],
        ['items', 1],
        ['count', 2],
      ]);
    }
    expect(result.keep.stillInHost).toBe(true);
    expect(result.keep.hostChildren).toBe(1);
    expect(result.detach.stillInHost).toBe(false);
    expect(result.detach.hostChildren).toBe(0);
    console.log(
      `[M08-resource] cleanup-throw keep=${result.keep.stillInHost} detach=${result.detach.hostChildren} ` +
        `unsub=${result.keep.unsubscribedDelta}/${result.detach.unsubscribedDelta} order=${result.keep.order.join('>')}`,
    );
    await page.close();
  }, 120_000);
});

interface RebuildResult {
  readonly claimA: Probe;
  readonly disposeA: Probe;
  readonly oldStillBeforeReplace: boolean;
  readonly oldConnectedAfterReplace: boolean;
  readonly claimB: Probe;
  readonly mutationB: readonly string[];
  readonly textsB: readonly (string | null)[];
  readonly newSection: boolean;
  readonly disposeB: Probe;
  readonly hostChildrenAfterB: number;
}

describe('M08-4 same-host rebuild', () => {
  test('the consumer disposes the old projection before replacing the live host bytes', async () => {
    const html = renderBoard();
    const page = await newPage(S2_FIXTURE);

    const result = (await page.evaluate(async (serverHtml) => {
      const globals = window as unknown as PageGlobals;
      const runtime = globals.__oeRuntime;
      const factories = globals.__oeModule;
      const track = globals.__oeSignal;

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      };

      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const sectionA = host.firstChild as Element;
      const logA: string[] = [];
      const openA = track(runtime, 'open-a', true, logA);
      const itemsA = track(
        runtime,
        'items-a',
        [
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ],
        logA,
      );
      const countA = track(runtime, 'count-a', 0, logA);
      const scopeA = new runtime.LifetimeScope();
      const recipeA = factories.createBoardRecipe!(scopeA, {
        props: {},
        bindings: { open: openA.signal, items: itemsA.signal, count: countA.signal },
        propsChanged: runtime.signal(0),
      });
      runtime.runtimeProbe.reset();
      const projectionA = runtime.claimRecipe(scopeA, recipeA, host);
      const claimA = runtime.runtimeProbe.snapshot();
      countA.signal.value = 9;
      await flush();
      projectionA.dispose(false);
      const disposeA = runtime.runtimeProbe.snapshot();
      const oldStillBeforeReplace = host.contains(sectionA);

      host.innerHTML = serverHtml;
      const sectionB = host.firstChild as Element;
      const oldConnectedAfterReplace = document.contains(sectionA);
      const logB: string[] = [];
      const openB = track(runtime, 'open-b', true, logB);
      const itemsB = track(
        runtime,
        'items-b',
        [
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ],
        logB,
      );
      const countB = track(runtime, 'count-b', 0, logB);
      const scopeB = new runtime.LifetimeScope();
      const recipeB = factories.createBoardRecipe!(scopeB, {
        props: {},
        bindings: { open: openB.signal, items: itemsB.signal, count: countB.signal },
        propsChanged: runtime.signal(0),
      });
      const mutationsB: string[] = [];
      const observerB = new MutationObserver((records) => {
        for (const record of records) mutationsB.push(record.type);
      });
      observerB.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      runtime.runtimeProbe.reset();
      const projectionB = runtime.claimRecipe(scopeB, recipeB, host);
      for (const record of observerB.takeRecords()) mutationsB.push(record.type);
      observerB.disconnect();
      const claimB = runtime.runtimeProbe.snapshot();
      const textsB = [...host.querySelectorAll('li')].map((li) => li.textContent);
      const newSection = host.firstChild === sectionB && sectionB !== sectionA;
      projectionB.dispose(true);
      const disposeB = runtime.runtimeProbe.snapshot();
      return {
        claimA,
        disposeA,
        oldStillBeforeReplace,
        oldConnectedAfterReplace,
        claimB,
        mutationB: [...mutationsB],
        textsB,
        newSection,
        disposeB,
        hostChildrenAfterB: host.childNodes.length,
      };
    }, html)) as RebuildResult;

    expect(result.claimA).toMatchObject({ owners: 1, projections: 1, subscriptions: 4 });
    expect(result.disposeA).toMatchObject({
      unsubscribed: result.claimA.subscriptions,
      disposed: 1,
    });
    expect(result.oldStillBeforeReplace).toBe(true);
    expect(result.oldConnectedAfterReplace).toBe(false);
    expect(result.claimB).toMatchObject({
      owners: 1,
      projections: 1,
      subscriptions: result.claimA.subscriptions,
      unsubscribed: 0,
    });
    expect(result.claimB.subscriptions).not.toBe(result.claimA.subscriptions * 2);
    expect(result.mutationB).toEqual([]);
    expect(result.textsB).toEqual(['A: 0', 'C: 0']);
    expect(result.newSection).toBe(true);
    expect(result.disposeB).toMatchObject({
      unsubscribed: result.claimB.subscriptions,
      disposed: 1,
    });
    expect(result.hostChildrenAfterB).toBe(0);
    console.log(
      `[M08-resource] rebuild claimA=${result.claimA.subscriptions} disposeA=${result.disposeA.unsubscribed} ` +
        `claimB=${result.claimB.subscriptions} disposeB=${result.disposeB.unsubscribed} mutationsB=${result.mutationB.length}`,
    );
    await page.close();
  }, 120_000);

  test('gap: with no host registry an undisposed replacement leaks the old subscription set', async () => {
    const html = renderBoard();
    const page = await newPage(S2_FIXTURE);

    const result = (await page.evaluate((serverHtml) => {
      const globals = window as unknown as PageGlobals;
      const runtime = globals.__oeRuntime;
      const factories = globals.__oeModule;
      const track = globals.__oeSignal;

      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const sectionA = host.firstChild as Element;
      const scopeA = new runtime.LifetimeScope();
      const logA: string[] = [];
      const openA = track(runtime, 'open-a', true, logA);
      const itemsA = track(
        runtime,
        'items-a',
        [
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ],
        logA,
      );
      const countA = track(runtime, 'count-a', 0, logA);
      const recipeA = factories.createBoardRecipe!(scopeA, {
        props: {},
        bindings: { open: openA.signal, items: itemsA.signal, count: countA.signal },
        propsChanged: runtime.signal(0),
      });
      runtime.runtimeProbe.reset();
      let errorA: string | null = null;
      let projectionA: ProjectionPage | null = null;
      try {
        projectionA = runtime.claimRecipe(scopeA, recipeA, host);
      } catch (caught) {
        errorA = caught instanceof Error ? caught.message : String(caught);
      }
      const subsA = runtime.runtimeProbe.snapshot();

      // Deliberately wrong consumer order: no dispose before the replacement.
      host.innerHTML = serverHtml;
      const sectionB = host.firstChild as Element;
      const logB: string[] = [];
      const openB = track(runtime, 'open-b', true, logB);
      const itemsB = track(
        runtime,
        'items-b',
        [
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ],
        logB,
      );
      const countB = track(runtime, 'count-b', 0, logB);
      const scopeB = new runtime.LifetimeScope();
      const recipeB = factories.createBoardRecipe!(scopeB, {
        props: {},
        bindings: { open: openB.signal, items: itemsB.signal, count: countB.signal },
        propsChanged: runtime.signal(0),
      });
      let errorB: string | null = null;
      let projectionB: ProjectionPage | null = null;
      try {
        projectionB = runtime.claimRecipe(scopeB, recipeB, host);
      } catch (caught) {
        errorB = caught instanceof Error ? caught.message : String(caught);
      }
      const subsAfterB = runtime.runtimeProbe.snapshot();
      projectionB?.dispose(false);
      const afterB = runtime.runtimeProbe.snapshot();
      projectionA?.dispose(false);
      const finalProbe = runtime.runtimeProbe.snapshot();
      return {
        errorA,
        errorB,
        subsA: subsA.subscriptions - subsA.unsubscribed,
        subsAfterB: subsAfterB.subscriptions - subsAfterB.unsubscribed,
        liveAfterB: afterB.subscriptions - afterB.unsubscribed,
        unsubscribedAfterB: afterB.unsubscribed,
        liveFinal: finalProbe.subscriptions - finalProbe.unsubscribed,
        sectionAConnected: document.contains(sectionA),
        sectionBConnected: document.contains(sectionB),
        hostFirstB: host.firstChild === sectionB,
      };
    }, html)) as {
      readonly errorA: string | null;
      readonly errorB: string | null;
      readonly subsA: number;
      readonly subsAfterB: number;
      readonly liveAfterB: number;
      readonly unsubscribedAfterB: number;
      readonly liveFinal: number;
      readonly sectionAConnected: boolean;
      readonly sectionBConnected: boolean;
      readonly hostFirstB: boolean;
    };

    // This is the recorded gap: there is no runtime host registry, so an
    // undisposed replacement is not auto-rejected. The consumer fixture above
    // shows the correct disposal-first flow; this test does not treat the leak
    // as acceptable behavior or as M08 exit evidence.
    expect(result.errorA).toBeNull();
    expect(result.errorB).toBeNull();
    expect(result.subsA).toBe(4);
    expect(result.subsAfterB).toBe(8);
    expect(result.liveAfterB).toBe(4);
    expect(result.unsubscribedAfterB).toBe(4);
    expect(result.liveFinal).toBe(0);
    expect(result.sectionAConnected).toBe(false);
    expect(result.sectionBConnected).toBe(true);
    expect(result.hostFirstB).toBe(true);
    console.log(
      `[M08-resource] no-registry subsA=${result.subsA} subsAfterB=${result.subsAfterB} ` +
        `liveAfterDisposeB=${result.liveAfterB} final=${result.liveFinal}`,
    );
    await page.close();
  }, 120_000);
});

interface TwoRegionClaim {
  readonly mutations: readonly string[];
  readonly probe: Probe;
  readonly childOwners: number;
  readonly leftTexts: readonly (string | null)[];
  readonly rightTexts: readonly (string | null)[];
  readonly identity: boolean;
  readonly log: readonly string[];
  readonly perDependency: readonly (readonly [string, number])[];
}

interface TwoRegionResult {
  readonly claim: TwoRegionClaim;
  readonly leftInsert: {
    readonly leftTexts: readonly (string | null)[];
    readonly rightTexts: readonly (string | null)[];
    readonly ownerDelta: number;
    readonly subscriptionDelta: number;
    readonly unsubscriptionDelta: number;
    readonly rightSame: boolean;
  };
  readonly leftCountWrite: {
    readonly leftTexts: readonly (string | null)[];
    readonly rightTexts: readonly (string | null)[];
    readonly subscriptionDelta: number;
  };
  readonly rightCountWrite: {
    readonly leftTexts: readonly (string | null)[];
    readonly rightTexts: readonly (string | null)[];
    readonly subscriptionDelta: number;
  };
  readonly disposeFalse: {
    readonly stillInHost: boolean;
    readonly leftTexts: readonly (string | null)[];
    readonly rightTexts: readonly (string | null)[];
    readonly unsubscribedDelta: number;
  };
}

describe('M08-4 two-region SSR -> parse -> claim', () => {
  test('two roots keep separate entry owners and exact per-dependency subscriptions', async () => {
    const html = renderPair();
    expect(html.match(/<!--oe:each-->/g)).toHaveLength(2);
    expect(html.match(/<section class="(?:left|right)">/g)).toHaveLength(2);
    const page = await newPage(TWO_REGION_FIXTURE);

    const result = (await page.evaluate(async (serverHtml) => {
      const globals = window as unknown as PageGlobals;
      const runtime = globals.__oeRuntime;
      const factories = globals.__oeModule;
      const track = globals.__oeSignal;
      const instrumentChildOwners = globals.__oeInstrumentChildOwners;

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      };
      const texts = (root: ParentNode): string[] =>
        [...root.querySelectorAll('li')].map((li) => li.textContent);

      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const leftSection = host.querySelector('section.left') as Element;
      const rightSection = host.querySelector('section.right') as Element;
      const leftUl = leftSection.querySelector('ul') as Element;
      const rightUl = rightSection.querySelector('ul') as Element;
      const leftLi = leftUl.querySelector('li') as Element;
      const rightLi = rightUl.querySelector('li') as Element;

      const log: string[] = [];
      const leftItems = track(runtime, 'leftItems', [{ id: 'a', label: 'A' }], log);
      const leftCount = track(runtime, 'leftCount', 0, log);
      const rightItems = track(runtime, 'rightItems', [{ id: 'b', label: 'B' }], log);
      const rightCount = track(runtime, 'rightCount', 0, log);

      const scope = new runtime.LifetimeScope();
      const recipe = factories.createPairRecipe!(scope, {
        props: {},
        bindings: {
          leftItems: leftItems.signal,
          leftCount: leftCount.signal,
          rightItems: rightItems.signal,
          rightCount: rightCount.signal,
        },
        propsChanged: runtime.signal(0),
      });
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      runtime.runtimeProbe.reset();
      const childOwners = instrumentChildOwners(runtime);
      const projection = runtime.claimRecipe(scope, recipe, host);
      for (const record of observer.takeRecords()) mutations.push(record.type);
      observer.disconnect();
      const claimProbe = runtime.runtimeProbe.snapshot();
      const claim = {
        mutations: [...mutations],
        probe: claimProbe,
        childOwners: childOwners.count,
        leftTexts: texts(leftUl),
        rightTexts: texts(rightUl),
        identity:
          host.querySelector('section.left') === leftSection &&
          host.querySelector('section.right') === rightSection &&
          leftSection.querySelector('ul') === leftUl &&
          rightSection.querySelector('ul') === rightUl &&
          leftUl.querySelector('li') === leftLi &&
          rightUl.querySelector('li') === rightLi,
        log: [...log],
        perDependency: [
          ['leftItems', leftItems.stats.opened],
          ['leftCount', leftCount.stats.opened],
          ['rightItems', rightItems.stats.opened],
          ['rightCount', rightCount.stats.opened],
        ] as const,
      };

      let before = runtime.runtimeProbe.snapshot();
      const childOwnersBeforeInsert = childOwners.count;
      leftItems.signal.value = [
        { id: 'a', label: 'A' },
        { id: 'a2', label: 'A2' },
      ];
      await flush();
      const afterInsert = runtime.runtimeProbe.snapshot();
      const leftInsert = {
        leftTexts: texts(leftUl),
        rightTexts: texts(rightUl),
        ownerDelta: childOwners.count - childOwnersBeforeInsert,
        subscriptionDelta: afterInsert.subscriptions - before.subscriptions,
        unsubscriptionDelta: afterInsert.unsubscribed - before.unsubscribed,
        rightSame: rightUl.querySelector('li') === rightLi,
      };

      before = runtime.runtimeProbe.snapshot();
      leftCount.signal.value = 9;
      await flush();
      const afterLeftCount = runtime.runtimeProbe.snapshot();
      const leftCountWrite = {
        leftTexts: texts(leftUl),
        rightTexts: texts(rightUl),
        subscriptionDelta: afterLeftCount.subscriptions - before.subscriptions,
      };

      before = runtime.runtimeProbe.snapshot();
      rightCount.signal.value = 8;
      await flush();
      const afterRightCount = runtime.runtimeProbe.snapshot();
      const rightCountWrite = {
        leftTexts: texts(leftUl),
        rightTexts: texts(rightUl),
        subscriptionDelta: afterRightCount.subscriptions - before.subscriptions,
      };

      before = runtime.runtimeProbe.snapshot();
      projection.dispose(false);
      const afterDispose = runtime.runtimeProbe.snapshot();
      const disposeFalse = {
        stillInHost: host.contains(leftSection) && host.contains(rightSection),
        leftTexts: texts(leftUl),
        rightTexts: texts(rightUl),
        unsubscribedDelta: afterDispose.unsubscribed - before.unsubscribed,
      };
      scope.dispose(false);
      return { claim, leftInsert, leftCountWrite, rightCountWrite, disposeFalse };
    }, html)) as TwoRegionResult;

    expect(result.claim.mutations).toEqual([]);
    expect(result.claim.probe).toMatchObject({
      owners: 1,
      projections: 1,
      rangeCleanups: 1,
      subscriptions: 4,
      unsubscribed: 0,
      disposed: 0,
    });
    expect(result.claim.childOwners).toBe(3);
    expect(result.claim.leftTexts).toEqual(['A: 0']);
    expect(result.claim.rightTexts).toEqual(['B: 0']);
    expect(result.claim.identity).toBe(true);
    expect([...result.claim.log].sort()).toEqual([
      'leftCount',
      'leftItems',
      'rightCount',
      'rightItems',
    ]);
    expect(result.claim.perDependency).toEqual([
      ['leftItems', 1],
      ['leftCount', 1],
      ['rightItems', 1],
      ['rightCount', 1],
    ]);

    expect(result.leftInsert.leftTexts).toEqual(['A: 0', 'A2: 0']);
    expect(result.leftInsert.rightTexts).toEqual(['B: 0']);
    expect(result.leftInsert.ownerDelta).toBe(1);
    expect(result.leftInsert.subscriptionDelta).toBe(1);
    expect(result.leftInsert.unsubscriptionDelta).toBe(0);
    expect(result.leftInsert.rightSame).toBe(true);

    expect(result.leftCountWrite.leftTexts).toEqual(['A: 9', 'A2: 9']);
    expect(result.leftCountWrite.rightTexts).toEqual(['B: 0']);
    expect(result.leftCountWrite.subscriptionDelta).toBe(0);

    expect(result.rightCountWrite.leftTexts).toEqual(['A: 9', 'A2: 9']);
    expect(result.rightCountWrite.rightTexts).toEqual(['B: 8']);
    expect(result.rightCountWrite.subscriptionDelta).toBe(0);

    expect(result.disposeFalse.stillInHost).toBe(true);
    expect(result.disposeFalse.leftTexts).toEqual(['A: 9', 'A2: 9']);
    expect(result.disposeFalse.rightTexts).toEqual(['B: 8']);
    expect(result.disposeFalse.unsubscribedDelta).toBe(5);
    console.log(
      `[M08-resource] two-region claim owners=${result.claim.probe.owners} subs=${result.claim.probe.subscriptions} ` +
        `insert Δowner=${result.leftInsert.ownerDelta} Δsub=${result.leftInsert.subscriptionDelta} ` +
        `disposeFalse Δunsub=${result.disposeFalse.unsubscribedDelta}`,
    );
    await page.close();
  }, 120_000);

  test('dispose(false) keeps both regions and dispose(true) removes both after a fresh claim', async () => {
    const html = renderPair();
    const page = await newPage(TWO_REGION_FIXTURE);

    const result = (await page.evaluate((serverHtml) => {
      const globals = window as unknown as PageGlobals;
      const runtime = globals.__oeRuntime;
      const factories = globals.__oeModule;
      const track = globals.__oeSignal;

      const claim = (
        host: HTMLElement,
        suffix: string,
      ): {
        projection: ProjectionPage;
        log: string[];
        probe: Probe;
      } => {
        const log: string[] = [];
        const leftItems = track(runtime, `leftItems-${suffix}`, [{ id: 'a', label: 'A' }], log);
        const leftCount = track(runtime, `leftCount-${suffix}`, 0, log);
        const rightItems = track(runtime, `rightItems-${suffix}`, [{ id: 'b', label: 'B' }], log);
        const rightCount = track(runtime, `rightCount-${suffix}`, 0, log);
        const scope = new runtime.LifetimeScope();
        const recipe = factories.createPairRecipe!(scope, {
          props: {},
          bindings: {
            leftItems: leftItems.signal,
            leftCount: leftCount.signal,
            rightItems: rightItems.signal,
            rightCount: rightCount.signal,
          },
          propsChanged: runtime.signal(0),
        });
        const projection = runtime.claimRecipe(scope, recipe, host);
        return { projection, log, probe: runtime.runtimeProbe.snapshot() };
      };

      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const left = host.querySelector('section.left') as Element;
      const right = host.querySelector('section.right') as Element;
      runtime.runtimeProbe.reset();
      const first = claim(host, 'first');
      first.projection.dispose(false);
      const afterDefault = runtime.runtimeProbe.snapshot();
      const kept =
        host.contains(left) &&
        host.contains(right) &&
        host.querySelector('section.left') === left &&
        host.querySelector('section.right') === right;

      // A fresh owner reclaims the same parsed DOM; the first owner's range
      // cleanups were dropped with dispose(false), so the nodes are still here.
      const pending: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) pending.push(record.type);
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      runtime.runtimeProbe.reset();
      const second = claim(host, 'second');
      for (const record of observer.takeRecords()) pending.push(record.type);
      observer.disconnect();
      const secondMutations = pending.length;
      const secondSameNodes =
        host.querySelector('section.left') === left &&
        host.querySelector('section.right') === right;
      const beforeDetach = runtime.runtimeProbe.snapshot();
      second.projection.dispose(true);
      const afterDetach = runtime.runtimeProbe.snapshot();
      return {
        firstSubscriptions: first.probe.subscriptions,
        firstLog: first.log,
        afterDefaultUnsubscribed: afterDefault.unsubscribed,
        kept,
        secondSubscriptions: second.probe.subscriptions,
        secondSameNodes,
        secondMutations,
        detachUnsubscribed: afterDetach.unsubscribed - beforeDetach.unsubscribed,
        hostChildrenAfterDetach: host.childNodes.length,
      };
    }, html)) as {
      readonly firstSubscriptions: number;
      readonly firstLog: readonly string[];
      readonly afterDefaultUnsubscribed: number;
      readonly kept: boolean;
      readonly secondSubscriptions: number;
      readonly secondSameNodes: boolean;
      readonly secondMutations: number;
      readonly detachUnsubscribed: number;
      readonly hostChildrenAfterDetach: number;
    };

    expect(result.firstSubscriptions).toBe(4);
    expect([...result.firstLog].sort()).toEqual([
      'leftCount-first',
      'leftItems-first',
      'rightCount-first',
      'rightItems-first',
    ]);
    expect(result.afterDefaultUnsubscribed).toBe(4);
    expect(result.kept).toBe(true);
    expect(result.secondSubscriptions).toBe(4);
    expect(result.secondSameNodes).toBe(true);
    expect(result.secondMutations).toBe(0);
    expect(result.detachUnsubscribed).toBe(4);
    expect(result.hostChildrenAfterDetach).toBe(0);
    console.log(
      `[M08-resource] two-region dispose false=${result.afterDefaultUnsubscribed} kept=${result.kept} ` +
        `true=${result.detachUnsubscribed} children=${result.hostChildrenAfterDetach}`,
    );
    await page.close();
  }, 120_000);
});

interface DependencyMultisetResult {
  readonly claim: {
    readonly probe: Probe;
    readonly log: readonly string[];
    readonly perDependency: readonly (readonly [string, number])[];
  };
  readonly draft: { readonly subscriptionDelta: number; readonly logDelta: readonly string[] };
  readonly reorder: { readonly subscriptionDelta: number; readonly logDelta: readonly string[] };
  readonly insert: {
    readonly subscriptionDelta: number;
    readonly ownerDelta: number;
    readonly logDelta: readonly string[];
  };
  readonly remove: { readonly unsubscribedDelta: number; readonly logDelta: readonly string[] };
  readonly dispose: { readonly unsubscribedDelta: number; readonly logDelta: readonly string[] };
  readonly reclaim: {
    readonly probe: Probe;
    readonly log: readonly string[];
    readonly perDependency: readonly (readonly [string, number])[];
  };
}

describe('M08-4 exact logical dependency multiset', () => {
  test('each logical dependency opens one subscription per live appearance and dispose closes exactly those', async () => {
    const html = renderBoard();
    const page = await newPage(S2_FIXTURE);

    const result = (await page.evaluate(async (serverHtml) => {
      const globals = window as unknown as PageGlobals;
      const runtime = globals.__oeRuntime;
      const factories = globals.__oeModule;
      const track = globals.__oeSignal;
      const instrumentChildOwners = globals.__oeInstrumentChildOwners;

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      };
      const dependencyCounts = (log: readonly string[]): Array<[string, number]> => {
        const counts = new Map<string, number>();
        for (const name of log) counts.set(name, (counts.get(name) ?? 0) + 1);
        return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
      };

      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const log: string[] = [];
      const open = track(runtime, 'open', true, log);
      const items = track(
        runtime,
        'items',
        [
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ],
        log,
      );
      const count = track(runtime, 'count', 0, log);
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createBoardRecipe!(scope, {
        props: {},
        bindings: { open: open.signal, items: items.signal, count: count.signal },
        propsChanged: runtime.signal(0),
      });
      runtime.runtimeProbe.reset();
      const childOwners = instrumentChildOwners(runtime);
      const projection = runtime.claimRecipe(scope, recipe, host);
      const claimProbe = runtime.runtimeProbe.snapshot();
      const claimLog = [...log];
      const perDependency = dependencyCounts(claimLog);

      let before = runtime.runtimeProbe.snapshot();
      const beforeLog = log.length;
      count.signal.value = 9;
      await flush();
      const afterDraft = runtime.runtimeProbe.snapshot();
      const draft = {
        subscriptionDelta: afterDraft.subscriptions - before.subscriptions,
        logDelta: log.slice(beforeLog),
      };

      before = runtime.runtimeProbe.snapshot();
      const beforeReorderLog = log.length;
      items.signal.value = [
        { id: 'c', label: 'C' },
        { id: 'a', label: 'A' },
      ];
      await flush();
      const afterReorder = runtime.runtimeProbe.snapshot();
      const reorder = {
        subscriptionDelta: afterReorder.subscriptions - before.subscriptions,
        logDelta: log.slice(beforeReorderLog),
      };

      before = runtime.runtimeProbe.snapshot();
      const beforeInsertLog = log.length;
      const beforeInsertOwnerCount = childOwners.count;
      items.signal.value = [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ];
      await flush();
      const afterInsert = runtime.runtimeProbe.snapshot();
      const insert = {
        subscriptionDelta: afterInsert.subscriptions - before.subscriptions,
        ownerDelta: childOwners.count - beforeInsertOwnerCount,
        logDelta: log.slice(beforeInsertLog),
      };

      before = runtime.runtimeProbe.snapshot();
      const beforeRemoveLog = log.length;
      items.signal.value = [
        { id: 'a', label: 'A' },
        { id: 'c', label: 'C' },
      ];
      await flush();
      const afterRemove = runtime.runtimeProbe.snapshot();
      const remove = {
        unsubscribedDelta: afterRemove.unsubscribed - before.unsubscribed,
        logDelta: log.slice(beforeRemoveLog),
      };

      before = runtime.runtimeProbe.snapshot();
      const beforeDisposeLog = log.length;
      projection.dispose(false);
      const afterDispose = runtime.runtimeProbe.snapshot();
      const dispose = {
        unsubscribedDelta: afterDispose.unsubscribed - before.unsubscribed,
        logDelta: log.slice(beforeDisposeLog),
      };

      // Fresh claim of the same parsed DOM: the exact multiset is re-opened,
      // never doubled by the disposed owner.
      const reclaimLog: string[] = [];
      const open2 = track(runtime, 'open', true, reclaimLog);
      const items2 = track(
        runtime,
        'items',
        [
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ],
        reclaimLog,
      );
      const count2 = track(runtime, 'count', 0, reclaimLog);
      const scope2 = new runtime.LifetimeScope();
      const recipe2 = factories.createBoardRecipe!(scope2, {
        props: {},
        bindings: { open: open2.signal, items: items2.signal, count: count2.signal },
        propsChanged: runtime.signal(0),
      });
      runtime.runtimeProbe.reset();
      const projection2 = runtime.claimRecipe(scope2, recipe2, host);
      const reclaimProbe = runtime.runtimeProbe.snapshot();
      const reclaimLogCopy = [...reclaimLog];
      projection2.dispose(false);
      scope2.dispose(false);
      return {
        claim: { probe: claimProbe, log: claimLog, perDependency },
        draft,
        reorder,
        insert,
        remove,
        dispose,
        reclaim: {
          probe: reclaimProbe,
          log: reclaimLogCopy,
          perDependency: dependencyCounts(reclaimLogCopy),
        },
      };
    }, html)) as DependencyMultisetResult;

    expect(result.claim.probe).toMatchObject({ subscriptions: 4, unsubscribed: 0 });
    expect(result.claim.perDependency).toEqual([
      ['count', 2],
      ['items', 1],
      ['open', 1],
    ]);
    expect([...result.claim.log].sort()).toEqual(['count', 'count', 'items', 'open']);

    expect(result.draft.subscriptionDelta).toBe(0);
    expect(result.draft.logDelta).toEqual([]);
    expect(result.reorder.subscriptionDelta).toBe(0);
    expect(result.reorder.logDelta).toEqual([]);
    expect(result.insert.subscriptionDelta).toBe(1);
    expect(result.insert.ownerDelta).toBe(1);
    expect(result.insert.logDelta).toEqual(['count']);
    expect(result.remove.unsubscribedDelta).toBe(1);
    expect(result.remove.logDelta).toEqual([]);
    expect(result.dispose.unsubscribedDelta).toBe(4);
    expect(result.dispose.logDelta).toEqual([]);
    expect(result.reclaim.probe).toMatchObject({
      subscriptions: 4,
      unsubscribed: 0,
      owners: 1,
      projections: 1,
    });
    expect(result.reclaim.perDependency).toEqual([
      ['count', 2],
      ['items', 1],
      ['open', 1],
    ]);
    console.log(
      `[M08-resource] dependency multiset claim=${JSON.stringify(result.claim.perDependency)} ` +
        `reclaim=${JSON.stringify(result.reclaim.perDependency)}`,
    );
    await page.close();
  }, 120_000);
});

interface MismatchDiagnosticResult {
  readonly code: string | null;
  readonly name: string | null;
  readonly phase: string | null;
  readonly severity: string | null;
  readonly recoverable: boolean | null;
  readonly message: string | null;
  readonly hasFile: boolean;
  readonly hasLine: boolean;
  readonly hasColumn: boolean;
  readonly hasSpan: boolean;
  readonly hasSource: boolean;
  readonly json: Record<string, unknown> | null;
}

describe('M08-4 claim-mismatch diagnostic', () => {
  test('a mismatch keeps the DOM path and appends the authored list location to the message only', async () => {
    expect(S2_MAPPED_FIXTURE.sourceMap).not.toBeNull();
    const html = renderBoard().replace('<!--oe:/each-->', '');
    const page = await newPage(S2_MAPPED_FIXTURE);

    const result = (await page.evaluate((serverHtml) => {
      const globals = window as unknown as PageGlobals;
      const runtime = globals.__oeRuntime;
      const factories = globals.__oeModule;
      const track = globals.__oeSignal;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const log: string[] = [];
      const open = track(runtime, 'open', true, log);
      const items = track(
        runtime,
        'items',
        [
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ],
        log,
      );
      const count = track(runtime, 'count', 0, log);
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createBoardRecipe!(scope, {
        props: {},
        bindings: { open: open.signal, items: items.signal, count: count.signal },
        propsChanged: runtime.signal(0),
      });
      runtime.runtimeProbe.reset();
      let caught: Record<string, unknown> | null = null;
      try {
        runtime.claimRecipe(scope, recipe, host);
      } catch (error) {
        caught = error as Record<string, unknown>;
      }
      scope.dispose(false);
      if (caught === null) throw new Error('claim did not throw');
      const json =
        typeof caught.toJSON === 'function'
          ? (caught.toJSON as () => Record<string, unknown>)()
          : null;
      return {
        code: typeof caught.code === 'string' ? caught.code : null,
        name: typeof caught.name === 'string' ? caught.name : null,
        phase: typeof caught.phase === 'string' ? caught.phase : null,
        severity: typeof caught.severity === 'string' ? caught.severity : null,
        recoverable: typeof caught.recoverable === 'boolean' ? caught.recoverable : null,
        message: typeof caught.message === 'string' ? caught.message : null,
        hasFile: 'file' in caught,
        hasLine: 'line' in caught,
        hasColumn: 'column' in caught,
        hasSpan: 'span' in caught,
        hasSource: 'source' in caught,
        json,
      };
    }, html)) as MismatchDiagnosticResult;

    expect(result.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
    expect(result.name).toBe('OpenElementError');
    expect(result.phase).toBe('csr');
    expect(result.severity).toBe('error');
    expect(result.recoverable).toBe(false);
    expect(result.message).toContain('list end is missing at /0/1/0/each/end');
    // The authored location is additive and message-only. S2_BOARD's list
    // expression is `items.value.map(...)` on source line 8, starting at
    // 1-based column 10 (the `<ul>` is column 5; the expression starts after
    // `<ul>{`). The suffix is asserted exactly, not merely "present".
    const AUTHORED = { line: 8, column: 10 } as const;
    expect(result.message).toBe(
      'OEIR_LEAF_CLAIM_MISMATCH: list end is missing at /0/1/0/each/end' +
        ` (authored ${FILE}:${AUTHORED.line}:${AUTHORED.column})`,
    );
    const located = / \(authored (.+):(\d+):(\d+)\)$/.exec(String(result.message));
    expect(located).not.toBeNull();
    expect(located![1]).toBe(FILE);
    expect(Number(located![2])).toBe(AUTHORED.line);
    expect(Number(located![3])).toBe(AUTHORED.column);
    // The authored location is now present in the MESSAGE ONLY. The error
    // object still carries no file/line/column/span/source field, and its
    // toJSON has no position key. Directory range-interior precision stays
    // deferred: the static sibling-range consumer keeps its
    // '[compiled-runtime] file#Component' label. The nested-directory
    // seed-mismatch DOM-path form remains NOT proven.
    expect(result.hasFile).toBe(false);
    expect(result.hasLine).toBe(false);
    expect(result.hasColumn).toBe(false);
    expect(result.hasSpan).toBe(false);
    expect(result.hasSource).toBe(false);
    expect(result.json).not.toBeNull();
    expect(result.json).not.toHaveProperty('file');
    expect(result.json).not.toHaveProperty('line');
    expect(result.json).not.toHaveProperty('column');
    expect(result.json).not.toHaveProperty('span');
    // `toJSON` does carry the message, so the file path is expected INSIDE that
    // string; it must not be a position field, and no position key may own it.
    expect(result.json!.message).toBe(result.message);
    const positionKeys = ['file', 'line', 'column', 'span', 'source'];
    expect(Object.keys(result.json!).filter((key) => positionKeys.includes(key))).toEqual([]);
    console.log(
      `[M08-resource] mismatch code=${String(result.code)} ` +
        `domPath=${String(result.message).includes('/0/1/0/each/end')} ` +
        `authored=${FILE}:${AUTHORED.line}:${AUTHORED.column} messageOnly=true`,
    );
    await page.close();
  }, 120_000);
});

describe('M08-4 repeated-instance server producer', () => {
  test('the same recipe inserted twice now emits two authored regions on the server', () => {
    // `TWICE_FIXTURE.loaded` is the instantiated generated module, so this test
    // exercises the real producer rather than a substring of the source text.
    expect(TWICE_FIXTURE.module).toContain('createTwiceRecipe');
    expect(TWICE_FIXTURE.module).toContain('function Twice__claim');
    expect(TWICE_FIXTURE.module).toContain('function Twice__ssr');
    expect(typeof TWICE_FIXTURE.loaded.Twice__ssr).toBe('function');
    const html = ssr(TWICE_FIXTURE.loaded, 'Twice')();
    // The exact bytes for `const item = <span>x</span>;
    // return <div>{item}{item}</div>;` — two authored insertion regions in
    // authored order, not a guessed shape.
    expect(html).toBe('<div><span>x</span><span>x</span></div>');
    const regions = [...html.matchAll(/<span[^>]*>x<\/span>/g)];
    expect(regions).toHaveLength(2);
    expect(regions[0]!.index).toBeLessThan(regions[1]!.index!);
    // This Node test pins the producer and its bytes only. The authoritative
    // server -> parse -> claim isolation evidence for the SAME recipe is
    // generated-leaf.composition-ssr.browser.test.ts (the `Duo` vertical:
    // claim probe projections=3 regions=3 owners=3 subs=2, 0 claim mutations).
    // This file does not duplicate that browser vertical.
    console.log(
      `[M08-resource] repeated-instance server producer present spans=${regions.length} ` +
        'authoritative-vertical=generated-leaf.composition-ssr.browser.test.ts ' +
        'projections=3 regions=3 owners=3 subs=2 claimMutations=0',
    );
  });
});
