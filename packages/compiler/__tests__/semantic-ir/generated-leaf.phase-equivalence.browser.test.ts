/**
 * M08-3 per-phase equivalence evidence — one authored stateful input, one
 * S → K → U → D row.
 *
 * The authored input is the S2 Board shape (a condition sibling of the keyed
 * list plus a static focus carrier) with one added authored props slot
 * (`props.title`) so the props-read count is observable in every phase. It is
 * compiled once with the real frontend/generator and exercised as:
 *
 *   S  Node `Board__ssr(props, host)`: one-shot request bindings, exact server
 *      bytes, one props read, zero owner/subscription/DOM/connect activity, and
 *      the SSR source-map positions decoded through the pinned
 *      `@jridgewell/trace-mapping@0.3.31`.
 *   K  Real Chromium parses the S bytes and the generated claim adopts them
 *      with the equal seed: 0 claim-period mutations, one owner/projection/
 *      region, one range cleanup, one props read, the exact per-logical-
 *      dependency subscription multiset, preserved focus/selection and node
 *      identity, and the decoded claim-position map.
 *   U  Keyed reorder (`a,c` → `c,a`) plus a props replacement (`props.title`
 *      replaced through the props record and announced on `host.propsChanged`):
 *      DOM/identity mapping, 0 new subscriptions, one update-time props read,
 *      and the decoded update-position map.
 *   D  `dispose(false)` keeps the parsed DOM and closes every subscription; a
 *      fresh parse+claim then `dispose(true)` removes exactly the owned region
 *      while a foreign marker outside the claim parent stays in place; a
 *      throwing cleanup surfaces the first error while the remaining cleanups
 *      still run.
 *
 * The mount baseline is the generated `createBoardRecipe` mount on an empty
 * host for the same props. It is compared with the parsed S bytes through a
 * structural signature (node kind, element localName, ordered attribute
 * name/value pairs, text/comment data, child order) — author order, not raw
 * bytes — and the raw innerHTML equality is recorded separately, not asserted.
 *
 * This file records LOCAL Chromium evidence only. It is not an M08 exit, does
 * not fill TSX-18 or TSX-30, and does not prove Firefox/WebKit/M13.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { chromium, type Browser, type Page } from 'playwright';
import { runtimeProbe } from '../../../element/src/internal/compiled/runtime/observability.ts';
import {
  buildRuntimeBundle,
  compileFixture,
  openGeneratedPage,
  ssr,
  type CompiledFixture,
  type RuntimeBundle,
} from './testlib/m08-browser-harness.ts';

const FILE = '/proj/src/m08-3-phase-equivalence.tsx';
const PROPS_TITLE = 'Board';

const S2_INITIAL: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'a', label: 'A' },
  { id: 'c', label: 'C' },
];

/**
 * The M06 S2 Board shape plus one authored props text slot. The condition is a
 * sibling of the keyed list, the key is `item.id`, the private draft is the
 * component-local `count` signal, and the focus carrier is the static
 * `contenteditable` paragraph.
 */
const S2_BOARD = `import { signal } from '@openelement/element';
function Board(props) {
  const items = signal([{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }]);
  const open = signal(true);
  const count = signal(0);
  return <section>
    <h1>{props.title}</h1>
    {open.value ? <p class="on">open</p> : <em class="off">closed</em>}
    <ul>{items.value.map((item) => <li key={item.id}>{item.label}: {count.value}</li>)}</ul>
    <p id="draft" contenteditable="true">note</p>
  </section>;
}
`;

/** The exact S bytes: condition sibling, keyed list, props slot, focus carrier. */
const EXPECTED_SSR =
  '<section><h1><!--oe:t:0-->Board<!--oe:/t:0--></h1><!--oe:when--><p class="on">open</p><!--oe:/when--><ul><!--oe:each--><!--oe:k:s:61--><li><!--oe:t:0-->A<!--oe:/t:0-->: <!--oe:t:1-->0<!--oe:/t:1--></li><!--oe:k:s:63--><li><!--oe:t:0-->C<!--oe:/t:0-->: <!--oe:t:1-->0<!--oe:/t:1--></li><!--oe:/each--></ul><p id="draft" contenteditable="true">note</p></section>';

const FIXTURE: CompiledFixture = compileFixture(S2_BOARD, FILE, S2_BOARD);

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

interface Position {
  readonly line: number;
  readonly column: number;
}

interface DecodedPlacement {
  readonly phase: 'S' | 'K' | 'U';
  readonly role: string;
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly authoredLine: number;
  readonly authoredColumn: number;
}

interface PositionTarget {
  readonly role: string;
  readonly pattern: string;
  readonly authored: string;
}

const TARGETS: readonly PositionTarget[] = [
  { role: 'props.title', pattern: 'props\\s*\\.\\s*title', authored: 'props.title' },
  { role: 'condition test', pattern: 'open\\s*\\.\\s*value', authored: 'open.value' },
  { role: 'list items', pattern: 'items\\s*\\.\\s*value', authored: 'items.value.map' },
  { role: 'list key', pattern: 'item\\s*\\.\\s*id', authored: 'item.id' },
  { role: 'entry slot 0', pattern: 'item\\s*\\.\\s*label', authored: 'item.label' },
  { role: 'entry slot 1', pattern: 'count\\s*\\.\\s*value', authored: 'count.value' },
];

function positionAt(text: string, offset: number): Position {
  const before = text.slice(0, offset);
  return {
    line: before.split('\n').length,
    column: offset - (before.lastIndexOf('\n') + 1),
  };
}

const AUTHORED_POSITIONS: Readonly<Record<string, Position>> = Object.fromEntries(
  TARGETS.map((target) => {
    const offset = S2_BOARD.indexOf(target.authored);
    if (offset < 0) throw new Error(`authored target missing: ${target.authored}`);
    return [target.authored, positionAt(S2_BOARD, offset)];
  }),
);

interface FunctionRange {
  readonly name: string;
  /** 0-based inclusive line indexes into the generated module. */
  readonly startLine: number;
  readonly endLine: number;
}

const FUNCTION_HEADER = /^\s*(?:export\s+)?function\s+([\w$]+)\s*\(/;

/** Remove quoted literals so braces inside strings cannot move a range end. */
function stripQuoted(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function functionRanges(module: string): readonly FunctionRange[] {
  const lines = module.split('\n');
  const ranges: FunctionRange[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = FUNCTION_HEADER.exec(lines[index]!);
    if (match === null) continue;
    let depth = 0;
    let opened = false;
    for (let cursor = index; cursor < lines.length; cursor++) {
      for (const char of stripQuoted(lines[cursor]!)) {
        if (char === '{') {
          depth += 1;
          opened = true;
        } else if (char === '}') {
          depth -= 1;
        }
      }
      if (opened && depth === 0) {
        ranges.push({ name: match[1]!, startLine: index, endLine: cursor });
        break;
      }
    }
  }
  return ranges;
}

const MODULE_LINES = FIXTURE.module.split('\n');
const RANGES = functionRanges(FIXTURE.module);
const RANGE_BY_NAME = new Map(RANGES.map((range) => [range.name, range]));

function traceMap(): TraceMap {
  if (FIXTURE.sourceMap === null) throw new Error('generated source map is missing');
  return new TraceMap(FIXTURE.sourceMap as ConstructorParameters<typeof TraceMap>[0]);
}

function decodeMatches(
  map: TraceMap,
  phase: DecodedPlacement['phase'],
  ranges: readonly FunctionRange[],
): readonly DecodedPlacement[] {
  const decoded: DecodedPlacement[] = [];
  const found = new Set<string>();
  for (const target of TARGETS) {
    for (const range of ranges) {
      for (let index = range.startLine; index <= range.endLine; index++) {
        const line = MODULE_LINES[index]!;
        const pattern = new RegExp(target.pattern, 'g');
        let match = pattern.exec(line);
        while (match !== null) {
          const original = originalPositionFor(map, { line: index + 1, column: match.index });
          const authored = AUTHORED_POSITIONS[target.authored]!;
          expect(original.source, `${phase} ${target.role} source`).toBe(FILE);
          expect(
            { line: original.line, column: original.column },
            `${phase} ${target.role} generated ${index + 1}:${match.index}`,
          ).toEqual(authored);
          decoded.push({
            phase,
            role: target.role,
            generatedLine: index + 1,
            generatedColumn: match.index,
            authoredLine: original.line!,
            authoredColumn: original.column!,
          });
          found.add(target.role);
          match = pattern.exec(line);
        }
      }
    }
  }
  expect([...found].sort(), `${phase} decoded targets`).toEqual(
    TARGETS.map((target) => target.role).sort(),
  );
  return decoded;
}

function decodeSsrPositions(map: TraceMap): readonly DecodedPlacement[] {
  const range = RANGE_BY_NAME.get('Board__ssr');
  if (range === undefined) throw new Error('missing Board__ssr');
  return decodeMatches(map, 'S', [range]);
}

function decodeClaimPositions(map: TraceMap): readonly DecodedPlacement[] {
  const range = RANGE_BY_NAME.get('Board__claim');
  if (range === undefined) throw new Error('missing Board__claim');
  return decodeMatches(map, 'K', [range]);
}

function decodeUpdatePositions(map: TraceMap): readonly DecodedPlacement[] {
  const createBuilders = RANGES.filter((range) => /EntryCreate|Create/.test(range.name));
  const updateRanges = RANGES.filter(
    (range) =>
      /Refresh|refresh|eachKey/.test(range.name) &&
      !createBuilders.some(
        (builder) => range.startLine > builder.startLine && range.endLine <= builder.endLine,
      ),
  );
  expect(updateRanges.length, 'update refresh/key functions').toBeGreaterThanOrEqual(5);
  return decodeMatches(map, 'U', updateRanges);
}

interface ServerPhase {
  readonly html: string;
  readonly expectedHtml: string;
  readonly propsReads: number;
  readonly bindingLookups: Readonly<Record<string, number>>;
  readonly valueReads: Readonly<Record<string, number>>;
  readonly connectCalls: readonly string[];
  readonly probe: Probe;
  readonly positions: readonly DecodedPlacement[];
}

function recordServerPhase(): ServerPhase {
  let propsReads = 0;
  const props = {
    get title(): string {
      propsReads += 1;
      return PROPS_TITLE;
    },
  };
  const bindingLookups: Record<string, number> = { open: 0, items: 0, count: 0 };
  const valueReads: Record<string, number> = { open: 0, items: 0, count: 0 };
  const oneShot = (name: string, value: unknown) => ({
    get value(): unknown {
      valueReads[name] = (valueReads[name] ?? 0) + 1;
      return value;
    },
    subscribe(): () => void {
      throw new Error(`SSR must not subscribe to the "${name}" request binding`);
    },
  });
  const signals = {
    open: oneShot('open', true),
    items: oneShot('items', S2_INITIAL),
    count: oneShot('count', 0),
  };
  const connectCalls: string[] = [];
  const host = {
    bindings: {
      get open() {
        bindingLookups.open = (bindingLookups.open ?? 0) + 1;
        return signals.open;
      },
      get items() {
        bindingLookups.items = (bindingLookups.items ?? 0) + 1;
        return signals.items;
      },
      get count() {
        bindingLookups.count = (bindingLookups.count ?? 0) + 1;
        return signals.count;
      },
    },
    connect: () => connectCalls.push('connect'),
    onConnect: () => connectCalls.push('onConnect'),
    disconnect: () => connectCalls.push('disconnect'),
  };

  runtimeProbe.reset();
  const html = ssr(FIXTURE.loaded, 'Board')(props, host);
  const probe = runtimeProbe.snapshot() as Probe;
  return {
    html,
    expectedHtml: EXPECTED_SSR,
    propsReads,
    bindingLookups,
    valueReads,
    connectCalls,
    probe,
    positions: decodeSsrPositions(traceMap()),
  };
}

interface TrackedStats {
  readonly name: string;
  readonly reads: number;
  readonly opened: number;
  readonly closed: number;
}

interface BrowserSignal<T> {
  value: T;
  subscribe(fn: (value: T) => void): () => void;
}

interface BrowserTrackedSignal<T> {
  readonly signal: BrowserSignal<T>;
  readonly stats: TrackedStats;
}

interface BrowserScope {
  add(cleanup: () => void): void;
  dispose(detachOwnedNodes?: boolean): void;
}

interface BrowserProjection {
  readonly owner: BrowserScope;
  readonly nodes: readonly Node[];
  dispose(detachOwnedNodes?: boolean): void;
}

interface BrowserRuntime {
  claimRecipe(owner: unknown, recipe: unknown, parent: Node): BrowserProjection;
  insertRecipe(owner: unknown, recipe: unknown, parent: Node): BrowserProjection;
  readonly LifetimeScope: new () => BrowserScope;
  readonly signal: <T>(value: T) => BrowserSignal<T>;
  readonly runtimeProbe: { reset(): void; snapshot(): Probe };
}

interface BrowserGlobals {
  readonly __oeRuntime: BrowserRuntime;
  readonly __oeModule: Record<string, ((owner: unknown, host: unknown) => unknown) | undefined>;
  readonly __oeSignal: <T>(
    runtime: BrowserRuntime,
    name: string,
    initial: T,
    log: string[],
    throwOnRead?: number,
  ) => BrowserTrackedSignal<T>;
  readonly __oeSameNodes: (before: readonly Node[], after: readonly Node[]) => boolean;
}

interface ErrorDialect {
  readonly name: string | null;
  readonly code: string | null;
  readonly phase: string | null;
  readonly severity: string | null;
  readonly recoverable: boolean | null;
  readonly message: string | null;
}

interface ClaimPhase {
  readonly mutations: readonly string[];
  readonly probe: Probe;
  readonly perDependency: readonly (readonly [string, number])[];
  readonly subscriptionLog: readonly string[];
  readonly propsReads: number;
  readonly bindingReads: Readonly<Record<string, number>>;
  readonly rangeCleanups: number;
  readonly focusPreserved: boolean;
  readonly selectionPreserved: boolean;
  readonly nodeIdentity: boolean;
  readonly classification: {
    readonly structure: string;
    readonly values: string;
    readonly clean: boolean;
  };
  readonly texts: readonly string[];
  readonly markers: readonly string[];
  readonly positions: readonly DecodedPlacement[];
}

interface UpdatePhase {
  readonly reorder: {
    readonly mutations: readonly string[];
    readonly subscriptionDelta: number;
    readonly unsubscriptionDelta: number;
    readonly ownerDelta: number;
    readonly projectionDelta: number;
    readonly sameObjects: boolean;
    readonly texts: readonly string[];
    readonly markers: readonly string[];
    readonly ulSame: boolean;
    readonly sectionSame: boolean;
    readonly h1Same: boolean;
    readonly h1TextSame: boolean;
  };
  readonly props: {
    readonly mutations: readonly string[];
    readonly subscriptionDelta: number;
    readonly unsubscriptionDelta: number;
    readonly ownerDelta: number;
    readonly projectionDelta: number;
    readonly propsReads: number;
    readonly textBefore: string;
    readonly textAfter: string;
    readonly textNodeSame: boolean;
    readonly texts: readonly string[];
  };
  readonly identity: {
    readonly sectionSame: boolean;
    readonly ulSame: boolean;
    readonly h1Same: boolean;
    readonly h1TextSame: boolean;
    readonly listIdentityAfterReorder: boolean;
    readonly listIdentityAfterProps: boolean;
  };
  readonly positions: readonly DecodedPlacement[];
}

interface DisposePhase {
  readonly detachment: {
    readonly liveSubscriptionsBefore: number;
    readonly subscriptionsDelta: number;
    readonly unsubscribedDelta: number;
    readonly disposedDelta: number;
    readonly stillInHost: boolean;
    readonly domIdentity: boolean;
    readonly sectionChildCount: number;
    readonly stillInHostAfterNoopDetach: boolean;
    readonly closed: Readonly<Record<string, { readonly opened: number; readonly closed: number }>>;
  };
  readonly detach: {
    readonly claimMutations: readonly string[];
    readonly claimProbe: Probe;
    readonly claimSubscriptions: number;
    readonly subscriptionsDelta: number;
    readonly unsubscribedDelta: number;
    readonly disposedDelta: number;
    readonly regionChildrenAfter: number;
    readonly stageChildCount: number;
    readonly ownedTopLevelNodes: number;
    readonly foreignIdentity: boolean;
    readonly foreignConnected: boolean;
    readonly foreignText: string;
    readonly sectionRemoved: boolean;
  };
  readonly throwingCleanup: {
    readonly order: readonly string[];
    readonly sameIdentity: boolean;
    readonly dialect: ErrorDialect;
    readonly subscriptionsDelta: number;
    readonly unsubscribedDelta: number;
    readonly liveSubscriptionsBefore: number;
    readonly claimSubscriptions: number;
    readonly regionChildrenAfter: number;
    readonly closed: Readonly<Record<string, { readonly opened: number; readonly closed: number }>>;
  };
}

interface MountBaseline {
  readonly signatureEqual: boolean;
  readonly rawHtmlEqual: boolean;
  readonly propsReads: number;
  readonly probe: Probe;
  readonly perDependency: readonly (readonly [string, number])[];
  readonly subscriptionLog: readonly string[];
  readonly nodeCounts: {
    readonly elements: number;
    readonly texts: number;
    readonly comments: number;
  };
  readonly texts: readonly string[];
  readonly markers: readonly string[];
}

interface ClaimUpdateResult {
  readonly claim: ClaimPhase;
  readonly update: UpdatePhase;
  readonly dispose: DisposePhase['detachment'];
}

interface DetachResult {
  readonly mount: Omit<
    MountBaseline,
    'propsReads' | 'probe' | 'perDependency' | 'subscriptionLog'
  > & {
    readonly propsReads: number;
    readonly probe: Probe;
    readonly perDependency: readonly (readonly [string, number])[];
    readonly subscriptionLog: readonly string[];
  };
  readonly detach: DisposePhase['detach'];
  readonly throwingCleanup: DisposePhase['throwingCleanup'];
}

interface MismatchResult {
  readonly dialect: ErrorDialect;
  readonly mutations: readonly string[];
  readonly probe: Probe;
  readonly domSame: boolean;
}

let runtimeBundle: RuntimeBundle;
let browser: Browser;

beforeAll(async () => {
  runtimeBundle = await buildRuntimeBundle();
  browser = await chromium.launch();
  console.log(`[M08-3] engine=chromium version=${browser.version()} LOCAL`);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  runtimeBundle?.dispose();
});

function newPage(): Promise<Page> {
  return openGeneratedPage(browser, runtimeBundle, FIXTURE);
}

describe('M08-3 per-phase equivalence — one S2 Board row', () => {
  test('records S → K → U → D for one authored stateful input', async () => {
    const s = recordServerPhase();
    const map = traceMap();

    const page = await newPage();
    const claimUpdate = (await page.evaluate(
      async ({ serverHtml, titleText, initialItems }) => {
        const globals = window as unknown as BrowserGlobals;
        const runtime = globals.__oeRuntime;
        const factories = globals.__oeModule;
        const track = globals.__oeSignal;
        const sameNodes = globals.__oeSameNodes;

        const snapshot = (): Probe => runtime.runtimeProbe.snapshot() as Probe;
        const delta = (before: Probe, after: Probe): Probe => ({
          projections: after.projections - before.projections,
          regions: after.regions - before.regions,
          owners: after.owners - before.owners,
          nodes: after.nodes - before.nodes,
          rangeCleanups: after.rangeCleanups - before.rangeCleanups,
          subscriptions: after.subscriptions - before.subscriptions,
          unsubscribed: after.unsubscribed - before.unsubscribed,
          lineageAccepted: after.lineageAccepted - before.lineageAccepted,
          lineageRejected: after.lineageRejected - before.lineageRejected,
          disposed: after.disposed - before.disposed,
        });
        const flush = async (): Promise<void> => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        };
        const collect = (observer: MutationObserver, pending: readonly string[]): string[] => {
          const out = [...pending];
          for (const record of observer.takeRecords()) out.push(record.type);
          return out;
        };
        const comments = (root: ParentNode): string[] => {
          const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_COMMENT);
          const found: string[] = [];
          for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            found.push((node as Comment).nodeValue ?? '');
          }
          return found;
        };
        const listMarkers = (root: ParentNode): string[] =>
          comments(root).filter(
            (marker) => marker === 'oe:each' || marker === 'oe:/each' || marker.startsWith('oe:k:'),
          );
        const dependencyCounts = (log: readonly string[]): Array<[string, number]> => {
          const counts = new Map<string, number>();
          for (const name of log) counts.set(name, (counts.get(name) ?? 0) + 1);
          return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
        };
        const statsOf = (tracked: BrowserTrackedSignal<unknown>) => ({
          opened: tracked.stats.opened,
          closed: tracked.stats.closed,
        });

        document.body.innerHTML = '<div id="host"></div>';
        const host = document.getElementById('host') as HTMLElement;
        host.innerHTML = serverHtml;
        const section = host.firstChild as Element;
        const ul = section.querySelector('ul') as Element;
        const draftEl = section.querySelector('#draft') as HTMLElement;
        const branch = section.querySelector('p.on') as Element;
        const h1 = section.querySelector('h1') as Element;
        const h1Text = h1.childNodes[1] as Text;
        const lis = [...ul.querySelectorAll('li')];
        const serverTexts = lis.map((li) => li.textContent);
        const serverH1Text = h1.textContent;
        const sectionChildren = [...section.childNodes];
        const ulChildren = [...ul.childNodes];
        const liChildren = lis.map((li) => [...li.childNodes]);
        const draftText = draftEl.firstChild as Text;

        draftEl.focus();
        const range = document.createRange();
        range.setStart(draftText, 1);
        range.setEnd(draftText, 4);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const focusBefore = document.activeElement === draftEl;
        const selectionBefore =
          selection?.anchorNode === draftText &&
          selection.anchorOffset === 1 &&
          selection.focusOffset === 4;

        const log: string[] = [];
        const open = track(runtime, 'open', true, log);
        const items = track(runtime, 'items', initialItems, log);
        const count = track(runtime, 'count', 0, log);
        const propsChanged = track(runtime, 'props', 0, log);
        const title = runtime.signal(titleText);
        let propsReads = 0;
        const props = {
          get title(): string {
            propsReads += 1;
            return title.value;
          },
        };
        const scope = new runtime.LifetimeScope();
        const recipe = factories.createBoardRecipe!(scope, {
          props,
          bindings: { open: open.signal, items: items.signal, count: count.signal },
          propsChanged: propsChanged.signal,
        });

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
        const propsReadsBeforeClaim = propsReads;
        const readsBeforeClaim = {
          open: open.stats.reads,
          items: items.stats.reads,
          count: count.stats.reads,
          props: propsChanged.stats.reads,
        };
        const projection = runtime.claimRecipe(scope, recipe, host);
        const claimMutations = collect(observer, pending.splice(0));
        const claimProbe = snapshot();
        const afterClaimLis = [...ul.querySelectorAll('li')];
        const claimNodeIdentity =
          host.firstChild === section &&
          sameNodes(sectionChildren, [...section.childNodes]) &&
          section.querySelector('ul') === ul &&
          sameNodes(ulChildren, [...ul.childNodes]) &&
          afterClaimLis.length === lis.length &&
          afterClaimLis.every((li, index) => li === lis[index]) &&
          afterClaimLis.every((li, index) =>
            sameNodes(liChildren[index] ?? [], [...li.childNodes]),
          ) &&
          section.querySelector('p.on') === branch &&
          section.querySelector('h1') === h1 &&
          h1.childNodes[1] === h1Text &&
          section.querySelector('#draft') === draftEl &&
          draftEl.firstChild === draftText;
        const claim = {
          mutations: claimMutations,
          probe: claimProbe,
          perDependency: dependencyCounts(log),
          subscriptionLog: [...log],
          propsReads: propsReads - propsReadsBeforeClaim,
          bindingReads: {
            open: open.stats.reads - readsBeforeClaim.open,
            items: items.stats.reads - readsBeforeClaim.items,
            count: count.stats.reads - readsBeforeClaim.count,
            props: propsChanged.stats.reads - readsBeforeClaim.props,
          },
          rangeCleanups: claimProbe.rangeCleanups,
          focusPreserved: focusBefore && document.activeElement === draftEl,
          selectionPreserved:
            selectionBefore &&
            selection?.anchorNode === draftText &&
            selection.anchorOffset === 1 &&
            selection.focusOffset === 4,
          nodeIdentity: claimNodeIdentity,
          classification: {
            structure: claimNodeIdentity ? 'equal' : 'different',
            values:
              serverH1Text === h1.textContent &&
              serverTexts.every((text, index) => text === afterClaimLis[index]?.textContent)
                ? 'equal'
                : 'different',
            clean: claimMutations.length === 0,
          },
          texts: afterClaimLis.map((li) => li.textContent),
          markers: listMarkers(ul),
        };

        let before = snapshot();
        items.signal.value = [...initialItems].reverse();
        await flush();
        const reorderedProbe = snapshot();
        const reordered = [...ul.querySelectorAll('li')];
        const reorder = {
          mutations: collect(observer, pending.splice(0)),
          subscriptionDelta: reorderedProbe.subscriptions - before.subscriptions,
          unsubscriptionDelta: reorderedProbe.unsubscribed - before.unsubscribed,
          ownerDelta: reorderedProbe.owners - before.owners,
          projectionDelta: reorderedProbe.projections - before.projections,
          sameObjects: reordered.length === 2 && reordered[0] === lis[1] && reordered[1] === lis[0],
          texts: reordered.map((li) => li.textContent),
          markers: listMarkers(ul),
          ulSame: section.querySelector('ul') === ul,
          sectionSame: host.firstChild === section,
          h1Same: section.querySelector('h1') === h1,
          h1TextSame: h1.childNodes[1] === h1Text,
        };

        before = snapshot();
        const propsReadsBeforeUpdate = propsReads;
        const textBefore = h1Text.nodeValue;
        title.value = `${titleText} v2`;
        propsChanged.signal.value = 1;
        await flush();
        const propsProbe = snapshot();
        const afterPropsLis = [...ul.querySelectorAll('li')];
        const propsUpdate = {
          mutations: collect(observer, pending.splice(0)),
          subscriptionDelta: propsProbe.subscriptions - before.subscriptions,
          unsubscriptionDelta: propsProbe.unsubscribed - before.unsubscribed,
          ownerDelta: propsProbe.owners - before.owners,
          projectionDelta: propsProbe.projections - before.projections,
          propsReads: propsReads - propsReadsBeforeUpdate,
          textBefore,
          textAfter: h1.textContent,
          textNodeSame: h1.childNodes[1] === h1Text,
          texts: afterPropsLis.map((li) => li.textContent),
        };

        const update = {
          reorder,
          props: propsUpdate,
          identity: {
            sectionSame: host.firstChild === section,
            ulSame: section.querySelector('ul') === ul,
            h1Same: section.querySelector('h1') === h1,
            h1TextSame: h1.childNodes[1] === h1Text,
            listIdentityAfterReorder:
              reordered.length === 2 && reordered[0] === lis[1] && reordered[1] === lis[0],
            listIdentityAfterProps:
              afterPropsLis.length === 2 &&
              afterPropsLis[0] === lis[1] &&
              afterPropsLis[1] === lis[0],
          },
        };

        const liveSubscriptionsBefore = claimProbe.subscriptions - claimProbe.unsubscribed;
        const preDisposeSectionChildren = [...section.childNodes];
        const preDisposeUlChildren = [...ul.childNodes];
        const preDisposeLis = [...ul.querySelectorAll('li')];
        before = snapshot();
        projection.dispose(false);
        const defaultProbe = snapshot();
        const defaultDelta = delta(before, defaultProbe);
        const stillInHost = host.contains(section);
        projection.dispose(true);
        const stillInHostAfterNoopDetach = host.contains(section);
        const detachment = {
          liveSubscriptionsBefore,
          subscriptionsDelta: defaultDelta.subscriptions,
          unsubscribedDelta: defaultDelta.unsubscribed,
          disposedDelta: defaultDelta.disposed,
          stillInHost,
          domIdentity:
            host.firstChild === section &&
            sameNodes(preDisposeSectionChildren, [...section.childNodes]) &&
            section.querySelector('ul') === ul &&
            sameNodes(preDisposeUlChildren, [...ul.childNodes]) &&
            [...ul.querySelectorAll('li')].every((li, index) => li === preDisposeLis[index]),
          sectionChildCount: section.childNodes.length,
          stillInHostAfterNoopDetach,
          closed: {
            open: statsOf(open),
            items: statsOf(items),
            count: statsOf(count),
            props: statsOf(propsChanged),
          },
        };
        observer.disconnect();
        scope.dispose(false);

        return {
          claim: {
            ...claim,
            positions: [],
          },
          update: { ...update, positions: [] },
          dispose: detachment,
        };
      },
      { serverHtml: s.html, titleText: PROPS_TITLE, initialItems: S2_INITIAL },
    )) as unknown as ClaimUpdateResult;
    await page.close();

    const claim = { ...claimUpdate.claim, positions: decodeClaimPositions(map) };
    const update = { ...claimUpdate.update, positions: decodeUpdatePositions(map) };
    const claimSubscriptions = claim.probe.subscriptions;

    expect(s.html).toBe(s.expectedHtml);
    expect(s.propsReads).toBe(1);
    expect(s.bindingLookups).toEqual({ open: 1, items: 1, count: 1 });
    expect(s.valueReads).toEqual({ open: 1, items: 1, count: 2 });
    expect(s.connectCalls).toEqual([]);
    expect(s.probe).toEqual({
      projections: 0,
      regions: 0,
      owners: 0,
      nodes: 0,
      rangeCleanups: 0,
      subscriptions: 0,
      unsubscribed: 0,
      lineageAccepted: 0,
      lineageRejected: 0,
      disposed: 0,
    });
    expect(s.positions.length).toBe(6);

    expect(claim.mutations).toEqual([]);
    expect(claim.probe).toMatchObject({
      owners: 1,
      projections: 1,
      regions: 1,
      rangeCleanups: 1,
      unsubscribed: 0,
      disposed: 0,
    });
    expect(claimSubscriptions).toBe(5);
    expect(claim.perDependency).toEqual([
      ['count', 2],
      ['items', 1],
      ['open', 1],
      ['props', 1],
    ]);
    expect(claim.subscriptionLog).toEqual(['props', 'open', 'count', 'count', 'items']);
    expect(claim.propsReads).toBe(1);
    expect(claim.rangeCleanups).toBe(1);
    expect(claim.focusPreserved).toBe(true);
    expect(claim.selectionPreserved).toBe(true);
    expect(claim.nodeIdentity).toBe(true);
    expect(claim.classification).toEqual({
      structure: 'equal',
      values: 'equal',
      clean: true,
    });
    expect(claim.texts).toEqual(['A: 0', 'C: 0']);
    expect(claim.markers).toEqual(['oe:each', 'oe:k:s:61', 'oe:k:s:63', 'oe:/each']);
    expect(claim.positions.length).toBeGreaterThanOrEqual(6);

    expect(update.reorder.mutations).toContain('childList');
    expect(update.reorder.mutations).not.toContain('characterData');
    expect(update.reorder.subscriptionDelta).toBe(0);
    expect(update.reorder.unsubscriptionDelta).toBe(0);
    expect(update.reorder.ownerDelta).toBe(0);
    expect(update.reorder.projectionDelta).toBe(0);
    expect(update.reorder.sameObjects).toBe(true);
    expect(update.reorder.texts).toEqual(['C: 0', 'A: 0']);
    expect(update.reorder.markers).toEqual(['oe:each', 'oe:k:s:63', 'oe:k:s:61', 'oe:/each']);
    expect(update.reorder.ulSame).toBe(true);
    expect(update.reorder.sectionSame).toBe(true);
    expect(update.reorder.h1Same).toBe(true);
    expect(update.reorder.h1TextSame).toBe(true);

    expect(update.props.mutations).toEqual(['characterData']);
    expect(update.props.subscriptionDelta).toBe(0);
    expect(update.props.unsubscriptionDelta).toBe(0);
    expect(update.props.ownerDelta).toBe(0);
    expect(update.props.projectionDelta).toBe(0);
    expect(update.props.propsReads).toBe(1);
    expect(update.props.textBefore).toBe('Board');
    expect(update.props.textAfter).toBe('Board v2');
    expect(update.props.textNodeSame).toBe(true);
    expect(update.props.texts).toEqual(['C: 0', 'A: 0']);

    expect(update.identity).toEqual({
      sectionSame: true,
      ulSame: true,
      h1Same: true,
      h1TextSame: true,
      listIdentityAfterReorder: true,
      listIdentityAfterProps: true,
    });
    expect(update.positions.length).toBeGreaterThanOrEqual(6);

    expect(claimUpdate.dispose.liveSubscriptionsBefore).toBe(claimSubscriptions);
    expect(claimUpdate.dispose.subscriptionsDelta).toBe(0);
    expect(claimUpdate.dispose.unsubscribedDelta).toBe(claimSubscriptions);
    expect(claimUpdate.dispose.disposedDelta).toBe(1);
    expect(claimUpdate.dispose.stillInHost).toBe(true);
    expect(claimUpdate.dispose.domIdentity).toBe(true);
    expect(claimUpdate.dispose.sectionChildCount).toBe(6);
    expect(claimUpdate.dispose.stillInHostAfterNoopDetach).toBe(true);
    expect(claimUpdate.dispose.closed).toEqual({
      open: { opened: 1, closed: 1 },
      items: { opened: 1, closed: 1 },
      count: { opened: 2, closed: 2 },
      props: { opened: 1, closed: 1 },
    });

    const detachPage = await newPage();
    const detachResult = (await detachPage.evaluate(
      ({ serverHtml, titleText, initialItems }) => {
        const globals = window as unknown as BrowserGlobals;
        const runtime = globals.__oeRuntime;
        const factories = globals.__oeModule;
        const track = globals.__oeSignal;

        const snapshot = (): Probe => runtime.runtimeProbe.snapshot() as Probe;
        const delta = (before: Probe, after: Probe): Probe => ({
          projections: after.projections - before.projections,
          regions: after.regions - before.regions,
          owners: after.owners - before.owners,
          nodes: after.nodes - before.nodes,
          rangeCleanups: after.rangeCleanups - before.rangeCleanups,
          subscriptions: after.subscriptions - before.subscriptions,
          unsubscribed: after.unsubscribed - before.unsubscribed,
          lineageAccepted: after.lineageAccepted - before.lineageAccepted,
          lineageRejected: after.lineageRejected - before.lineageRejected,
          disposed: after.disposed - before.disposed,
        });
        const collect = (observer: MutationObserver, pending: readonly string[]): string[] => {
          const out = [...pending];
          for (const record of observer.takeRecords()) out.push(record.type);
          return out;
        };
        const comments = (root: ParentNode): string[] => {
          const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_COMMENT);
          const found: string[] = [];
          for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            found.push((node as Comment).nodeValue ?? '');
          }
          return found;
        };
        const listMarkers = (root: ParentNode): string[] =>
          comments(root).filter(
            (marker) => marker === 'oe:each' || marker === 'oe:/each' || marker.startsWith('oe:k:'),
          );
        const dependencyCounts = (log: readonly string[]): Array<[string, number]> => {
          const counts = new Map<string, number>();
          for (const name of log) counts.set(name, (counts.get(name) ?? 0) + 1);
          return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
        };
        const statsOf = (tracked: BrowserTrackedSignal<unknown>) => ({
          opened: tracked.stats.opened,
          closed: tracked.stats.closed,
        });
        const treeSignature = (node: Node): unknown => {
          if (node.nodeType === 3) return { kind: 'text', value: node.nodeValue };
          if (node.nodeType === 8) return { kind: 'comment', value: node.nodeValue };
          if (node.nodeType !== 1) return { kind: 'other', value: node.nodeType };
          const element = node as Element;
          const attributes: Array<[string, string]> = [];
          for (let index = 0; index < element.attributes.length; index++) {
            const attribute = element.attributes.item(index);
            if (attribute !== null) attributes.push([attribute.name, attribute.value]);
          }
          const children: unknown[] = [];
          for (let index = 0; index < element.childNodes.length; index++) {
            const child = element.childNodes.item(index);
            if (child !== null) children.push(treeSignature(child));
          }
          return { kind: 'element', name: element.localName, attributes, children };
        };
        const nodeCounts = (root: Node) => {
          const out = { elements: 0, texts: 0, comments: 0 };
          const visit = (node: Node): void => {
            if (node.nodeType === 1) out.elements += 1;
            else if (node.nodeType === 3) out.texts += 1;
            else if (node.nodeType === 8) out.comments += 1;
            for (let index = 0; index < node.childNodes.length; index++) {
              const child = node.childNodes.item(index);
              if (child !== null) visit(child);
            }
          };
          visit(root);
          return out;
        };

        document.body.innerHTML = '<div id="mount-host"></div><div id="parsed-host"></div>';
        const mountHost = document.getElementById('mount-host') as HTMLElement;
        const parsedHost = document.getElementById('parsed-host') as HTMLElement;
        parsedHost.innerHTML = serverHtml;
        const parsedSection = parsedHost.firstChild as Element;

        const mountLog: string[] = [];
        const mountOpen = track(runtime, 'open', true, mountLog);
        const mountItems = track(runtime, 'items', initialItems, mountLog);
        const mountCount = track(runtime, 'count', 0, mountLog);
        const mountPropsChanged = track(runtime, 'props', 0, mountLog);
        const mountTitle = runtime.signal(titleText);
        let mountPropsReads = 0;
        const mountProps = {
          get title(): string {
            mountPropsReads += 1;
            return mountTitle.value;
          },
        };
        const mountScope = new runtime.LifetimeScope();
        const mountRecipe = factories.createBoardRecipe!(mountScope, {
          props: mountProps,
          bindings: {
            open: mountOpen.signal,
            items: mountItems.signal,
            count: mountCount.signal,
          },
          propsChanged: mountPropsChanged.signal,
        });
        runtime.runtimeProbe.reset();
        const mountProjection = runtime.insertRecipe(mountScope, mountRecipe, mountHost);
        const mountProbe = snapshot();
        const mountSection = mountHost.firstChild as Element;
        const mount = {
          signatureEqual:
            JSON.stringify(treeSignature(mountSection)) ===
            JSON.stringify(treeSignature(parsedSection)),
          rawHtmlEqual: mountHost.innerHTML === parsedHost.innerHTML,
          propsReads: mountPropsReads,
          probe: mountProbe,
          perDependency: dependencyCounts(mountLog),
          subscriptionLog: [...mountLog],
          nodeCounts: nodeCounts(mountSection),
          texts: [...mountHost.querySelectorAll('li')].map((li) => li.textContent),
          markers: listMarkers(mountSection),
        };
        mountProjection.dispose(true);
        mountScope.dispose(false);

        document.body.innerHTML =
          '<div id="stage"><div id="region"></div><span id="foreign">foreign</span></div>';
        const stage = document.getElementById('stage') as HTMLElement;
        const region = document.getElementById('region') as HTMLElement;
        const foreign = document.getElementById('foreign') as HTMLElement;
        region.innerHTML = serverHtml;
        const section = region.firstChild as Element;

        const detachLog: string[] = [];
        const detachOpen = track(runtime, 'open', true, detachLog);
        const detachItems = track(runtime, 'items', initialItems, detachLog);
        const detachCount = track(runtime, 'count', 0, detachLog);
        const detachPropsChanged = track(runtime, 'props', 0, detachLog);
        const detachTitle = runtime.signal(titleText);
        let detachPropsReads = 0;
        const detachProps = {
          get title(): string {
            detachPropsReads += 1;
            return detachTitle.value;
          },
        };
        const detachScope = new runtime.LifetimeScope();
        const detachRecipe = factories.createBoardRecipe!(detachScope, {
          props: detachProps,
          bindings: {
            open: detachOpen.signal,
            items: detachItems.signal,
            count: detachCount.signal,
          },
          propsChanged: detachPropsChanged.signal,
        });
        const pending: string[] = [];
        const observer = new MutationObserver((records) => {
          for (const record of records) pending.push(record.type);
        });
        observer.observe(stage, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        runtime.runtimeProbe.reset();
        const detachProjection = runtime.claimRecipe(detachScope, detachRecipe, region);
        const detachClaimMutations = collect(observer, pending.splice(0));
        const detachClaimProbe = snapshot();
        const claimSubscriptions = detachClaimProbe.subscriptions;
        const beforeDetach = snapshot();
        detachProjection.dispose(true);
        const detachDelta = delta(beforeDetach, snapshot());
        const detach = {
          claimMutations: detachClaimMutations,
          claimProbe: detachClaimProbe,
          claimSubscriptions,
          subscriptionsDelta: detachDelta.subscriptions,
          unsubscribedDelta: detachDelta.unsubscribed,
          disposedDelta: detachDelta.disposed,
          regionChildrenAfter: region.childNodes.length,
          stageChildCount: stage.childNodes.length,
          ownedTopLevelNodes: detachProjection.nodes.length,
          foreignIdentity: document.getElementById('foreign') === foreign,
          foreignConnected: foreign.isConnected,
          foreignText: foreign.textContent ?? '',
          sectionRemoved: !region.contains(section),
        };
        observer.disconnect();
        detachScope.dispose(false);

        region.innerHTML = serverHtml;
        const throwingLog: string[] = [];
        const throwingOpen = track(runtime, 'open', true, throwingLog);
        const throwingItems = track(runtime, 'items', initialItems, throwingLog);
        const throwingCount = track(runtime, 'count', 0, throwingLog);
        const throwingPropsChanged = track(runtime, 'props', 0, throwingLog);
        const throwingTitle = runtime.signal(titleText);
        const throwingProps = {
          get title(): string {
            return throwingTitle.value;
          },
        };
        const throwingScope = new runtime.LifetimeScope();
        const throwingRecipe = factories.createBoardRecipe!(throwingScope, {
          props: throwingProps,
          bindings: {
            open: throwingOpen.signal,
            items: throwingItems.signal,
            count: throwingCount.signal,
          },
          propsChanged: throwingPropsChanged.signal,
        });
        runtime.runtimeProbe.reset();
        const throwingProjection = runtime.claimRecipe(throwingScope, throwingRecipe, region);
        const throwingClaimProbe = snapshot();
        const liveSubscriptionsBefore =
          throwingClaimProbe.subscriptions - throwingClaimProbe.unsubscribed;
        const order: string[] = [];
        const firstError = new Error('first cleanup error');
        throwingProjection.owner.add(() => order.push('normal-before'));
        throwingProjection.owner.add(() => {
          order.push('throwing');
          throw firstError;
        });
        throwingProjection.owner.add(() => order.push('normal-after'));
        const beforeThrowingDispose = snapshot();
        let failure: unknown = null;
        try {
          throwingProjection.dispose(true);
        } catch (caught) {
          failure = caught;
        }
        const throwingDelta = delta(beforeThrowingDispose, snapshot());
        const thrown = failure as {
          readonly name?: string;
          readonly code?: string;
          readonly phase?: string;
          readonly severity?: string;
          readonly recoverable?: boolean;
          readonly message?: string;
        } | null;
        const throwingCleanup = {
          order,
          sameIdentity: failure === firstError,
          dialect: {
            name: thrown?.name ?? null,
            code: thrown?.code ?? null,
            phase: thrown?.phase ?? null,
            severity: thrown?.severity ?? null,
            recoverable: typeof thrown?.recoverable === 'boolean' ? thrown.recoverable : null,
            message: thrown?.message ?? null,
          },
          subscriptionsDelta: throwingDelta.subscriptions,
          unsubscribedDelta: throwingDelta.unsubscribed,
          liveSubscriptionsBefore,
          claimSubscriptions: throwingClaimProbe.subscriptions,
          regionChildrenAfter: region.childNodes.length,
          closed: {
            open: statsOf(throwingOpen),
            items: statsOf(throwingItems),
            count: statsOf(throwingCount),
            props: statsOf(throwingPropsChanged),
          },
        };
        throwingScope.dispose(false);

        return { mount, detach, throwingCleanup };
      },
      { serverHtml: s.html, titleText: PROPS_TITLE, initialItems: S2_INITIAL },
    )) as unknown as DetachResult;
    await detachPage.close();

    expect(detachResult.mount.signatureEqual).toBe(true);
    expect(detachResult.mount.propsReads).toBe(1);
    expect(detachResult.mount.probe).toMatchObject({
      owners: 1,
      projections: 1,
      regions: 1,
      rangeCleanups: 1,
      unsubscribed: 0,
      disposed: 0,
    });
    expect(detachResult.mount.probe.subscriptions).toBe(claimSubscriptions);
    expect(detachResult.mount.perDependency).toEqual(claim.perDependency);
    expect(detachResult.mount.texts).toEqual(claim.texts);
    expect(detachResult.mount.markers).toEqual(claim.markers);
    expect(detachResult.mount.nodeCounts).toEqual({ elements: 7, texts: 9, comments: 16 });

    expect(detachResult.detach.claimMutations).toEqual([]);
    expect(detachResult.detach.claimProbe).toMatchObject({
      owners: 1,
      projections: 1,
      regions: 1,
      rangeCleanups: 1,
      unsubscribed: 0,
      disposed: 0,
    });
    expect(detachResult.detach.claimSubscriptions).toBe(claimSubscriptions);
    expect(detachResult.detach.subscriptionsDelta).toBe(0);
    expect(detachResult.detach.unsubscribedDelta).toBe(claimSubscriptions);
    expect(detachResult.detach.disposedDelta).toBe(1);
    expect(detachResult.detach.regionChildrenAfter).toBe(0);
    expect(detachResult.detach.stageChildCount).toBe(2);
    expect(detachResult.detach.ownedTopLevelNodes).toBe(1);
    expect(detachResult.detach.foreignIdentity).toBe(true);
    expect(detachResult.detach.foreignConnected).toBe(true);
    expect(detachResult.detach.foreignText).toBe('foreign');
    expect(detachResult.detach.sectionRemoved).toBe(true);

    expect(detachResult.throwingCleanup.order).toEqual([
      'normal-after',
      'throwing',
      'normal-before',
    ]);
    expect(detachResult.throwingCleanup.sameIdentity).toBe(true);
    expect(detachResult.throwingCleanup.dialect).toEqual({
      name: 'Error',
      code: null,
      phase: null,
      severity: null,
      recoverable: null,
      message: 'first cleanup error',
    });
    expect(detachResult.throwingCleanup.subscriptionsDelta).toBe(0);
    expect(detachResult.throwingCleanup.unsubscribedDelta).toBe(
      detachResult.throwingCleanup.liveSubscriptionsBefore,
    );
    expect(detachResult.throwingCleanup.regionChildrenAfter).toBe(0);
    expect(detachResult.throwingCleanup.closed).toEqual({
      open: { opened: 1, closed: 1 },
      items: { opened: 1, closed: 1 },
      count: { opened: 2, closed: 2 },
      props: { opened: 1, closed: 1 },
    });

    const mismatchPage = await newPage();
    const corrupt = s.html.replace('<!--oe:k:s:61-->', '');
    const mismatch = (await mismatchPage.evaluate(
      ({ serverHtml, initialItems }) => {
        const globals = window as unknown as BrowserGlobals;
        const runtime = globals.__oeRuntime;
        const factories = globals.__oeModule;
        const track = globals.__oeSignal;
        const sameNodes = globals.__oeSameNodes;

        const collect = (observer: MutationObserver, pending: readonly string[]): string[] => {
          const out = [...pending];
          for (const record of observer.takeRecords()) out.push(record.type);
          return out;
        };

        document.body.innerHTML = '<div id="host"></div>';
        const host = document.getElementById('host') as HTMLElement;
        host.innerHTML = serverHtml;
        const section = host.firstChild as Element;
        const beforeHtml = host.innerHTML;
        const beforeNodes = [...section.childNodes];
        const log: string[] = [];
        const open = track(runtime, 'open', true, log);
        const items = track(runtime, 'items', initialItems, log);
        const count = track(runtime, 'count', 0, log);
        const propsChanged = track(runtime, 'props', 0, log);
        const title = runtime.signal('Board');
        const props = {
          get title(): string {
            return title.value;
          },
        };
        const scope = new runtime.LifetimeScope();
        const recipe = factories.createBoardRecipe!(scope, {
          props,
          bindings: { open: open.signal, items: items.signal, count: count.signal },
          propsChanged: propsChanged.signal,
        });
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
        let failure: unknown = null;
        try {
          runtime.claimRecipe(scope, recipe, host);
        } catch (caught) {
          failure = caught;
        }
        const mutations = collect(observer, pending.splice(0));
        observer.disconnect();
        const probe = runtime.runtimeProbe.snapshot() as Probe;
        const domSame =
          host.firstChild === section &&
          host.innerHTML === beforeHtml &&
          sameNodes(beforeNodes, [...section.childNodes]);
        scope.dispose(false);
        const thrown = failure as {
          readonly name?: string;
          readonly code?: string;
          readonly phase?: string;
          readonly severity?: string;
          readonly recoverable?: boolean;
          readonly message?: string;
        } | null;
        return {
          dialect: {
            name: thrown?.name ?? null,
            code: thrown?.code ?? null,
            phase: thrown?.phase ?? null,
            severity: thrown?.severity ?? null,
            recoverable: typeof thrown?.recoverable === 'boolean' ? thrown.recoverable : null,
            message: thrown?.message ?? null,
          },
          mutations,
          probe,
          domSame,
        };
      },
      { serverHtml: corrupt, initialItems: S2_INITIAL },
    )) as unknown as MismatchResult;
    await mismatchPage.close();

    expect(mismatch.dialect).toMatchObject({
      name: 'OpenElementError',
      code: 'OEIR_LEAF_CLAIM_MISMATCH',
      phase: 'csr',
      severity: 'error',
      recoverable: false,
    });
    expect(mismatch.dialect.message).toContain('OEIR_LEAF_CLAIM_MISMATCH');
    expect(mismatch.mutations).toEqual([]);
    expect(mismatch.probe.subscriptions).toBe(0);
    expect(mismatch.probe.unsubscribed).toBe(0);
    expect(mismatch.domSame).toBe(true);

    console.log(
      `[M08-3] S propsReads=${s.propsReads} bindingLookups=${JSON.stringify(s.bindingLookups)} ` +
        `valueReads=${JSON.stringify(s.valueReads)} ` +
        `probe=${JSON.stringify(s.probe)}`,
    );
    console.log(`[M08-3] S positions=${JSON.stringify(s.positions)}`);
    console.log(
      `[M08-3] K mutations=${claim.mutations.length} owners=${claim.probe.owners} ` +
        `subscriptions=${claimSubscriptions} multiset=${JSON.stringify(claim.perDependency)} ` +
        `rangeCleanups=${claim.rangeCleanups} propsReads=${claim.propsReads} ` +
        `bindingReads=${JSON.stringify(claim.bindingReads)} log=${JSON.stringify(claim.subscriptionLog)}`,
    );
    console.log(`[M08-3] K positions=${JSON.stringify(claim.positions)}`);
    console.log(
      `[M08-3] U reorderΔsubs=${update.reorder.subscriptionDelta} ` +
        `propsΔsubs=${update.props.subscriptionDelta} ` +
        `propsReads=${update.props.propsReads} ` +
        `text=${update.props.textBefore}->${update.props.textAfter}`,
    );
    console.log(`[M08-3] U positions=${JSON.stringify(update.positions)}`);
    console.log(
      `[M08-3] D dispose(false) live=${claimUpdate.dispose.liveSubscriptionsBefore} ` +
        `Δunsub=${claimUpdate.dispose.unsubscribedDelta} kept=${claimUpdate.dispose.stillInHost}; ` +
        `dispose(true) Δunsub=${detachResult.detach.unsubscribedDelta} regionChildren=${detachResult.detach.regionChildrenAfter} ` +
        `stageChildren=${detachResult.detach.stageChildCount} foreign=${detachResult.detach.foreignConnected}; ` +
        `throwing order=${JSON.stringify(detachResult.throwingCleanup.order)} ` +
        `dialect=${JSON.stringify(detachResult.throwingCleanup.dialect)}`,
    );
    console.log(
      `[M08-3] mount signature=${detachResult.mount.signatureEqual} rawHtml=${detachResult.mount.rawHtmlEqual} ` +
        `subscriptions=${detachResult.mount.probe.subscriptions} counts=${JSON.stringify(detachResult.mount.nodeCounts)}`,
    );
    console.log(
      `[M08-3] mismatch dialect=${JSON.stringify(mismatch.dialect)} mutations=${mismatch.mutations.length} ` +
        `subs=${mismatch.probe.subscriptions} domSame=${mismatch.domSame}`,
    );
  }, 180_000);
});

describe('M08-3 per-phase equivalence — independent map consumer', () => {
  test('pins the trace-mapping consumer and the authored sources', () => {
    const require = createRequire(import.meta.url);
    const manifest = JSON.parse(
      readFileSync(require.resolve('@jridgewell/trace-mapping/package.json'), 'utf8'),
    ) as { version: string };
    expect(manifest.version).toBe('0.3.31');

    const map = traceMap();
    expect(map.sources).toEqual([FILE]);
    expect(map.sourcesContent).toEqual([S2_BOARD]);
    expect(decodeSsrPositions(map).length).toBe(6);
    expect(decodeClaimPositions(map).length).toBeGreaterThanOrEqual(6);
    expect(decodeUpdatePositions(map).length).toBeGreaterThanOrEqual(6);
  });
});
