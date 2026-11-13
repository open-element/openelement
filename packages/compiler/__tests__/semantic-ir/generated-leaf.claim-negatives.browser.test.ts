/**
 * M08-4 claim-negative slice — LOCAL Chromium only.
 *
 * The existing S2 vertical (`generated-leaf.s2-ssr-claim.browser.test.ts`), the
 * list browser contract (`generated-leaf.claim-list.browser.test.ts`) and the
 * resource-parity lane (`generated-leaf.m08-resource-parity.browser.test.ts`)
 * already prove: a failed full-Board claim leaves no subscription and the same
 * host retries cleanly; duplicate-key wire multiplicity and a wire key with no
 * client item fail closed with the documented S1–S3 seed semantics; a claimed
 * update preflights unsupported keys without writing `u`; a list-entry
 * activation throw releases owners/subscriptions and keeps borrowed DOM; a
 * throwing cleanup does not suppress the others in either dispose mode.
 *
 * This file adds only the negative shapes those files do not cover:
 *
 *   - a condition boundary whose anchor is stripped or whose end marker is
 *     foreign fails closed, opens no subscription and keeps the borrowed DOM;
 *   - a list entry template whose tag or child list does not match fails closed
 *     before activation;
 *   - a static-attribute seed mismatch on an element inside / at a nested static
 *     sibling directory fails closed without a write.
 *
 * Every claim input starts from the Node-produced `__ssr()` bytes parsed by a
 * real Chromium page. Not claimed by this file: M08 exit, TSX-18/TSX-30 rows,
 * authored source locations (the diagnostic lane owns that wiring), Firefox /
 * WebKit / M13, a public ABI or release evidence.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Browser, chromium } from 'playwright';
import {
  buildRuntimeBundle,
  compileFixture,
  openGeneratedPage,
  type CompiledFixture,
  ssr,
  type RuntimeBundle,
} from './testlib/m08-browser-harness.ts';

const FILE = '/proj/src/m08-4-claim-negatives.tsx';

const CONDITION_SOURCE = `import { signal } from '@openelement/element';
function Gate(props) {
  const open = signal(true);
  return <div><span class="before">before</span>{open.value ? <p class="on">open</p> : <em class="off">closed</em>}<span class="after">after</span></div>;
}
`;

const LIST_SOURCE = `import { signal } from '@openelement/element';
function Ledger(props) {
  const items = signal([{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }]);
  return <ul>{items.value.map((item) => <li key={item.id}><b>{item.label}</b>: <i>{item.id}</i></li>)}</ul>;
}
`;

const NESTED_DIRECTORY_SOURCE = `import { signal } from '@openelement/element';
function Nested(props) {
  const label = signal('x');
  return <section>
    <div class="panel" data-kind="nested">
      <span data-a="1" data-b="2">alpha</span>
      <span data-c="3">beta</span>
    </div>
    <p>{label.value}</p>
  </section>;
}
`;

const CONDITION_FIXTURE = compileFixture(CONDITION_SOURCE, FILE);
const LIST_FIXTURE = compileFixture(LIST_SOURCE, FILE);
const NESTED_DIRECTORY_FIXTURE = compileFixture(NESTED_DIRECTORY_SOURCE, FILE);

const CONDITION_HTML = ssr(CONDITION_FIXTURE.loaded, 'Gate')(
  {},
  { bindings: { open: { value: true } } },
);
const LIST_HTML = ssr(LIST_FIXTURE.loaded, 'Ledger')(
  {},
  {
    bindings: {
      items: {
        value: [
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ],
      },
    },
  },
);
const NESTED_DIRECTORY_HTML = ssr(NESTED_DIRECTORY_FIXTURE.loaded, 'Nested')(
  {},
  { bindings: { label: { value: 'x' } } },
);

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

interface PageScope {
  dispose(detachOwnedNodes?: boolean): void;
}

interface PageRuntime {
  claimRecipe(owner: PageScope, recipe: unknown, parent: Node): unknown;
  readonly LifetimeScope: new () => PageScope;
  readonly signal: <T>(value: T) => { value: T };
  readonly runtimeProbe: { reset(): void; snapshot(): Probe };
}

interface PageModule {
  [name: string]: ((owner: unknown, host: unknown) => unknown) | undefined;
}

type PageGlobals = {
  readonly __oeRuntime: PageRuntime;
  readonly __oeModule: PageModule;
};

interface CaseOutcome {
  readonly error: string | null;
  readonly code: string | null;
  readonly mutations: readonly string[];
  readonly sameRoot: boolean;
  readonly sameChildren: boolean;
  readonly sameHtml: boolean;
  readonly subscriptions: number;
  readonly unsubscribed: number;
}

let bundle: RuntimeBundle;
let browser: Browser;

beforeAll(async () => {
  bundle = await buildRuntimeBundle();
  browser = await chromium.launch();
  console.log(`[M08-4 negatives] engine=chromium version=${browser.version()} LOCAL`);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  bundle?.dispose();
});

function newPage(fixture: CompiledFixture) {
  return openGeneratedPage(browser, bundle, fixture);
}

describe('M08-4 condition boundary negatives', () => {
  test('a stripped anchor or a foreign end marker fails closed without a write', async () => {
    const page = await newPage(CONDITION_FIXTURE);
    const cases = [
      {
        label: 'stripped anchor',
        html: CONDITION_HTML.replace('<!--oe:when-->', ''),
        detail: 'condition anchor',
        path: '/0/1/anchor',
      },
      {
        label: 'foreign end marker',
        html: CONDITION_HTML.replace('<!--oe:/when-->', '<!--oe:/each-->'),
        detail: 'condition end',
        path: '/0/1/end',
      },
    ] as const;

    const result = (await page.evaluate((inputCases) => {
      const { __oeRuntime: runtime, __oeModule: factories } = window as unknown as PageGlobals;

      const run = (html: string): CaseOutcome => {
        document.body.innerHTML = '<div id="host"></div>';
        const host = document.getElementById('host') as HTMLElement;
        host.innerHTML = html;
        const root = host.firstChild as Element;
        const beforeNodes = [...root.childNodes];
        const beforeHtml = host.innerHTML;
        const open = runtime.signal(true);
        const scope = new runtime.LifetimeScope();
        const recipe = factories.createGateRecipe!(scope, {
          props: {},
          bindings: { open },
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
        let code: string | null = null;
        try {
          runtime.claimRecipe(scope, recipe, host);
          error = 'NO_THROW';
          code = 'NO_THROW';
        } catch (caught) {
          const failure = caught as { readonly code?: string; readonly message?: string };
          error = failure.message ?? String(caught);
          code = failure.code ?? null;
        }
        for (const record of observer.takeRecords()) mutations.push(record.type);
        observer.disconnect();
        const after = runtime.runtimeProbe.snapshot();
        const afterRoot = host.firstChild as Element | null;
        const sameChildren =
          afterRoot !== null &&
          afterRoot.childNodes.length === beforeNodes.length &&
          beforeNodes.every((node, index) => afterRoot.childNodes[index] === node);
        const outcome: CaseOutcome = {
          error,
          code,
          mutations: [...mutations],
          sameRoot: afterRoot === root,
          sameChildren,
          sameHtml: beforeHtml === host.innerHTML,
          subscriptions: after.subscriptions,
          unsubscribed: after.unsubscribed,
        };
        scope.dispose(false);
        return outcome;
      };

      return inputCases.map((input) => ({ ...input, outcome: run(input.html) }));
    }, cases)) as Array<{
      readonly label: string;
      readonly detail: string;
      readonly path: string;
      readonly outcome: CaseOutcome;
    }>;

    expect(CONDITION_HTML).toBe(
      '<div><span class="before">before</span><!--oe:when--><p class="on">open</p><!--oe:/when--><span class="after">after</span></div>',
    );
    for (const { label, detail, path, outcome } of result) {
      expect(outcome.code, label).toBe('OEIR_LEAF_CLAIM_MISMATCH');
      expect(outcome.error, label).toContain('OEIR_LEAF_CLAIM_MISMATCH');
      expect(outcome.error, label).toContain(detail);
      expect(outcome.error, label).toContain(path);
      expect(outcome.mutations, label).toEqual([]);
      expect(outcome.sameRoot, label).toBe(true);
      expect(outcome.sameChildren, label).toBe(true);
      expect(outcome.sameHtml, label).toBe(true);
      expect(outcome.subscriptions, label).toBe(0);
      expect(outcome.unsubscribed, label).toBe(0);
      console.log(`[M08-4 negatives] condition ${label}: ${outcome.error}`);
    }
    await page.close();
  }, 120_000);
});

describe('M08-4 list entry template negatives', () => {
  test('a wrong tag, a missing child or an extra child fails closed before activation', async () => {
    const page = await newPage(LIST_FIXTURE);
    const cases = [
      {
        label: 'wrong entry tag',
        html: LIST_HTML.replace('<li>', '<span>').replace('</li>', '</span>'),
        detail: "expected element 'li'",
        path: '/0/0/each/entry/0',
      },
      {
        label: 'missing child',
        html: LIST_HTML.replace('<b><!--oe:t:0-->A<!--oe:/t:0--></b>', ''),
        detail: "expected element 'b'",
        path: '/0/0/each/entry/0/0',
      },
      {
        label: 'extra child',
        html: LIST_HTML.replace('</i></li>', '</i><em>extra</em></li>'),
        detail: 'extra node',
        path: '/0/0/each/entry/0',
      },
    ] as const;

    const result = (await page.evaluate((inputCases) => {
      const { __oeRuntime: runtime, __oeModule: factories } = window as unknown as PageGlobals;

      const run = (html: string): CaseOutcome => {
        document.body.innerHTML = '<div id="host"></div>';
        const host = document.getElementById('host') as HTMLElement;
        host.innerHTML = html;
        const root = host.firstChild as Element;
        const beforeNodes = [...root.childNodes];
        const beforeHtml = host.innerHTML;
        const items = runtime.signal([
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ]);
        const scope = new runtime.LifetimeScope();
        const recipe = factories.createLedgerRecipe!(scope, {
          props: {},
          bindings: { items },
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
        let code: string | null = null;
        try {
          runtime.claimRecipe(scope, recipe, host);
          error = 'NO_THROW';
          code = 'NO_THROW';
        } catch (caught) {
          const failure = caught as { readonly code?: string; readonly message?: string };
          error = failure.message ?? String(caught);
          code = failure.code ?? null;
        }
        for (const record of observer.takeRecords()) mutations.push(record.type);
        observer.disconnect();
        const after = runtime.runtimeProbe.snapshot();
        const afterRoot = host.firstChild as Element | null;
        const sameChildren =
          afterRoot !== null &&
          afterRoot.childNodes.length === beforeNodes.length &&
          beforeNodes.every((node, index) => afterRoot.childNodes[index] === node);
        const outcome: CaseOutcome = {
          error,
          code,
          mutations: [...mutations],
          sameRoot: afterRoot === root,
          sameChildren,
          sameHtml: beforeHtml === host.innerHTML,
          subscriptions: after.subscriptions,
          unsubscribed: after.unsubscribed,
        };
        scope.dispose(false);
        return outcome;
      };

      return inputCases.map((input) => ({ ...input, outcome: run(input.html) }));
    }, cases)) as Array<{
      readonly label: string;
      readonly detail: string;
      readonly path: string;
      readonly outcome: CaseOutcome;
    }>;

    expect(LIST_HTML).toBe(
      '<ul><!--oe:each--><!--oe:k:s:61--><li><b><!--oe:t:0-->A<!--oe:/t:0--></b>: <i><!--oe:t:1-->a<!--oe:/t:1--></i></li><!--oe:k:s:63--><li><b><!--oe:t:0-->C<!--oe:/t:0--></b>: <i><!--oe:t:1-->c<!--oe:/t:1--></i></li><!--oe:/each--></ul>',
    );
    for (const { label, detail, path, outcome } of result) {
      expect(outcome.code, label).toBe('OEIR_LEAF_CLAIM_MISMATCH');
      expect(outcome.error, label).toContain(detail);
      expect(outcome.error, label).toContain(path);
      expect(outcome.mutations, label).toEqual([]);
      expect(outcome.sameRoot, label).toBe(true);
      expect(outcome.sameChildren, label).toBe(true);
      expect(outcome.sameHtml, label).toBe(true);
      expect(outcome.subscriptions, label).toBe(0);
      expect(outcome.unsubscribed, label).toBe(0);
      console.log(`[M08-4 negatives] list ${label}: ${outcome.error}`);
    }
    await page.close();
  }, 120_000);
});

describe('M08-4 nested static sibling directory negative', () => {
  test('a static-attribute seed mismatch at a nested directory fails closed without a write', async () => {
    const page = await newPage(NESTED_DIRECTORY_FIXTURE);
    const cases = [
      {
        label: 'directory parent seed',
        html: NESTED_DIRECTORY_HTML.replace(
          '<div class="panel" data-kind="nested">',
          '<div data-kind="nested" class="panel">',
        ),
        code: 'OEIR_LEAF_CLAIM_MISMATCH',
        detail: 'static attribute class is out of order',
        path: '/0/0',
      },
      {
        label: 'nested range interior seed',
        html: NESTED_DIRECTORY_HTML.replace(
          '<span data-a="1" data-b="2">alpha</span>',
          '<span data-b="2" data-a="1">alpha</span>',
        ),
        code: 'OE_RUNTIME_STATIC_RANGE_MISMATCH',
        detail: 'static-seed: node 0 does not match the declaration',
        // The directory consumer reports its caller-supplied source
        // (`file#Component`), not a numbered DOM path. Only the directory
        // parent's ordinary leaf check carries the path. This precision gap is
        // recorded in the report, not asserted as a requirement here.
        path: '#Nested',
      },
    ] as const;

    const result = (await page.evaluate((inputCases) => {
      const { __oeRuntime: runtime, __oeModule: factories } = window as unknown as PageGlobals;

      const run = (html: string): CaseOutcome => {
        document.body.innerHTML = '<div id="host"></div>';
        const host = document.getElementById('host') as HTMLElement;
        host.innerHTML = html;
        const root = host.firstChild as Element;
        const beforeNodes = [...root.childNodes];
        const beforeHtml = host.innerHTML;
        const label = runtime.signal('x');
        const scope = new runtime.LifetimeScope();
        const recipe = factories.createNestedRecipe!(scope, {
          props: {},
          bindings: { label },
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
        let code: string | null = null;
        try {
          runtime.claimRecipe(scope, recipe, host);
          error = 'NO_THROW';
          code = 'NO_THROW';
        } catch (caught) {
          const failure = caught as { readonly code?: string; readonly message?: string };
          error = failure.message ?? String(caught);
          code = failure.code ?? null;
        }
        for (const record of observer.takeRecords()) mutations.push(record.type);
        observer.disconnect();
        const after = runtime.runtimeProbe.snapshot();
        const afterRoot = host.firstChild as Element | null;
        const sameChildren =
          afterRoot !== null &&
          afterRoot.childNodes.length === beforeNodes.length &&
          beforeNodes.every((node, index) => afterRoot.childNodes[index] === node);
        const outcome: CaseOutcome = {
          error,
          code,
          mutations: [...mutations],
          sameRoot: afterRoot === root,
          sameChildren,
          sameHtml: beforeHtml === host.innerHTML,
          subscriptions: after.subscriptions,
          unsubscribed: after.unsubscribed,
        };
        scope.dispose(false);
        return outcome;
      };

      return inputCases.map((input) => ({ ...input, outcome: run(input.html) }));
    }, cases)) as Array<{
      readonly label: string;
      readonly code: string;
      readonly detail: string;
      readonly path: string;
      readonly outcome: CaseOutcome;
    }>;

    expect(NESTED_DIRECTORY_HTML).toContain('<!--oe:r:0-->');
    expect(NESTED_DIRECTORY_HTML).toContain('<!--oe:r:1-->');
    for (const { label, code, detail, path, outcome } of result) {
      expect(outcome.code, label).toBe(code);
      expect(outcome.error, label).toContain(detail);
      if (path !== '') expect(outcome.error, label).toContain(path);
      expect(outcome.mutations, label).toEqual([]);
      expect(outcome.sameRoot, label).toBe(true);
      expect(outcome.sameChildren, label).toBe(true);
      expect(outcome.sameHtml, label).toBe(true);
      expect(outcome.subscriptions, label).toBe(0);
      expect(outcome.unsubscribed, label).toBe(0);
      console.log(`[M08-4 negatives] nested ${label}: ${outcome.error}`);
    }
    await page.close();
  }, 120_000);
});
