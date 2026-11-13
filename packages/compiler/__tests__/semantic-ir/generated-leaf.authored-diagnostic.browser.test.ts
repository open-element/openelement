/**
 * M08-4 diagnostic lane — authored claim-mismatch locations (acceptance target).
 *
 * This file is the authoring-side acceptance witness for the Lead decision in
 * `m08-diagnostic-owner-decision.md`:
 *
 *   - the mismatch keeps its long-standing `OEIR_LEAF_CLAIM_MISMATCH` code,
 *     `csr` phase, `error` severity, non-recoverability and DOM path;
 *   - the message additionally ends with the authored `file:line:column` of
 *     the construct whose claim check failed;
 *   - the location is a compile-time constant, not a runtime source-map
 *     lookup, and no structured `file`/`line`/`column` field is added to
 *     `OpenElementError`.
 *
 * The expected positions below are hand-derived from the authored fixture and
 * point at the real JSX/expression start (1-based line and column), not at a
 * generated line and not at the DOM path. They are deliberately exact: a
 * regex that merely looks for "authored" would not prove the location.
 *
 * RED by design on the current tree: `leafClaimMismatch(detail)` has no origin
 * argument and the generator emits no span, so every test here fails on the
 * missing `(authored ...)` suffix. The implementation plan that turns this
 * green is `diagnostic-implementation-handoff.md`; this file is not a gap
 * reproducer and must not be skipped to manufacture a green suite.
 *
 * LOCAL Chromium only; no M08 exit, no public ABI change, no CI dependency.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Browser, chromium } from 'playwright';
import {
  buildRuntimeBundle,
  compileFixture,
  openGeneratedPage,
  type RuntimeBundle,
  ssr,
} from './testlib/m08-browser-harness.ts';

const FILE = '/proj/src/authored-diagnostic.tsx';

/**
 * One component per diagnostic shape. Every mismatch target sits on its own
 * authored line so the expected location is unambiguous. (`Attr` keeps the
 * static-attribute element shape in the fixture; the two asserted leaf shapes
 * are `Leaf` and `Ordered`.)
 *
 * Column notes (1-based, JSX/expression start):
 *   - `Leaf` `<p` line 4 column 10, `count.value` line 4 column 31;
 *   - `Ordered` first `<b` line 11 column 5;
 *   - `List` `items.value.map(...)` line 16 column 15;
 *   - `Cond` then-branch `<p class="on">` line 22 column 9.
 */
const SOURCE = `import { signal } from '@openelement/element';
function Leaf(props) {
  const count = signal(1);
  return <p id="t" class="x">{count.value}</p>;
}
function Attr(props) {
  return <div id="a" class="b"><span>ok</span></div>;
}
function Ordered(props) {
  return <div>
    <b>alpha</b>tail
  </div>;
}
function List(props) {
  const items = signal([{ id: 'a', label: 'A' }]);
  return <ul>{items.value.map((item) => <li key={item.id}>{item.label}</li>)}</ul>;
}
function Cond(props) {
  const open = signal(true);
  return <div>
    {open.value
      ? <p class="on">open</p>
      : <em class="off">closed</em>}
    <span>tail</span>
  </div>;
}
`;

const POSITION = {
  /** `Leaf`'s dynamic-text expression `count.value`. */
  leafText: { line: 4, column: 31 },
  /** `Leaf`'s static `<p>` element. */
  leafElement: { line: 4, column: 10 },
  /** `Ordered`'s first child `<b>alpha</b>`. */
  orderedFirstChild: { line: 11, column: 5 },
  /** `List`'s `items.value.map(...)` expression. */
  listExpression: { line: 16, column: 15 },
  /** `Cond`'s then-branch `<p class="on">open</p>`. */
  conditionThenBranch: { line: 22, column: 9 },
} as const;

interface Position {
  readonly line: number;
  readonly column: number;
}

interface ClaimFailure {
  readonly code: string | null;
  readonly name: string | null;
  readonly phase: string | null;
  readonly severity: string | null;
  readonly recoverable: boolean | null;
  readonly message: string | null;
  readonly hasFile: boolean;
}

interface PageScope {
  dispose(detachOwnedNodes?: boolean): void;
}

interface PageSignal<T> {
  value: T;
  subscribe(fn: (value: T) => void): () => void;
}

interface PageRuntime {
  claimRecipe(owner: PageScope, recipe: unknown, parent: Node): unknown;
  readonly LifetimeScope: new () => PageScope;
  readonly signal: <T>(value: T) => PageSignal<T>;
}

interface PageModule {
  [name: string]: ((owner: PageScope, host: unknown) => unknown) | undefined;
}

interface PageGlobals {
  readonly __oeRuntime: PageRuntime;
  readonly __oeModule: PageModule;
}

const FIXTURE = compileFixture(SOURCE, FILE);

let bundle: RuntimeBundle;
let browser: Browser;

beforeAll(async () => {
  bundle = await buildRuntimeBundle();
  browser = await chromium.launch();
  console.log(`[M08-diagnostic] engine=chromium version=${browser.version()} LOCAL`);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  bundle?.dispose();
});

function render(component: string, values: Record<string, unknown>): string {
  // The SSR producer reads host values as signals (`.value`); the claim side
  // below creates real runtime signals from the same plain values.
  const bindings = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, { value }]),
  );
  return ssr(FIXTURE.loaded, component)({}, { bindings });
}

async function claimFailure(
  component: string,
  html: string,
  bindings: Record<string, unknown>,
): Promise<ClaimFailure> {
  const page = await openGeneratedPage(browser, bundle, FIXTURE);
  try {
    return (await page.evaluate(
      ({ serverHtml, componentName, initialBindings }) => {
        const globals = window as unknown as PageGlobals;
        const runtime = globals.__oeRuntime;
        const factories = globals.__oeModule;

        document.body.innerHTML = '<div id="host"></div>';
        const host = document.getElementById('host') as HTMLElement;
        host.innerHTML = serverHtml;

        const liveBindings: Record<string, PageSignal<unknown>> = {};
        for (const [name, value] of Object.entries(initialBindings)) {
          liveBindings[name] = runtime.signal(value);
        }

        const createRecipe = factories[`create${componentName}Recipe`];
        if (createRecipe === undefined) throw new Error(`missing create${componentName}Recipe`);
        const scope = new runtime.LifetimeScope();
        const recipe = createRecipe(scope, {
          props: {},
          bindings: liveBindings,
          propsChanged: runtime.signal(0),
        });

        let message: string | null = null;
        let code: string | null = null;
        let name: string | null = null;
        let phase: string | null = null;
        let severity: string | null = null;
        let recoverable: boolean | null = null;
        let hasFile = false;
        try {
          runtime.claimRecipe(scope, recipe, host);
        } catch (caught) {
          const error = caught as Error & {
            readonly code?: unknown;
            readonly phase?: unknown;
            readonly severity?: unknown;
            readonly recoverable?: unknown;
          };
          message = error.message;
          code = typeof error.code === 'string' ? error.code : null;
          name = error.name;
          phase = typeof error.phase === 'string' ? error.phase : null;
          severity = typeof error.severity === 'string' ? error.severity : null;
          recoverable = typeof error.recoverable === 'boolean' ? error.recoverable : null;
          hasFile = 'file' in error;
        }
        scope.dispose(false);
        return { message, code, name, phase, severity, recoverable, hasFile };
      },
      { serverHtml: html, componentName: component, initialBindings: bindings },
    )) as ClaimFailure;
  } finally {
    await page.close();
  }
}

function expectAuthored(result: ClaimFailure, detail: string, position: Position): void {
  expect(result.name).toBe('OpenElementError');
  expect(result.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
  expect(result.phase).toBe('csr');
  expect(result.severity).toBe('error');
  expect(result.recoverable).toBe(false);
  // The design is message-only: no structured public position is added.
  expect(result.hasFile).toBe(false);
  expect(result.message).toBe(
    `OEIR_LEAF_CLAIM_MISMATCH: ${detail} ` +
      `(authored ${FILE}:${position.line}:${position.column})`,
  );
}

describe('M08-4 authored claim diagnostics', () => {
  test('dynamic-text start missing reports the authored expression position', async () => {
    const html = render('Leaf', { count: 1 }).replace('<!--oe:t:0-->', '');
    const result = await claimFailure('Leaf', html, { count: 1 });
    expectAuthored(
      result,
      'text boundary start at /0/0/text-start is not a comment',
      POSITION.leafText,
    );
  });

  test('static attribute seed mismatch reports the authored element position', async () => {
    const html = render('Leaf', { count: 1 }).replace(
      '<p id="t" class="x">',
      '<p id="t" class="x" data-extra="1">',
    );
    const result = await claimFailure('Leaf', html, { count: 1 });
    expectAuthored(
      result,
      'static attribute seed count is 3, declared 2 at /0',
      POSITION.leafElement,
    );
  });

  test('static attribute order mismatch reports the authored element position', async () => {
    const html = render('Leaf', { count: 1 }).replace(
      '<p id="t" class="x">',
      '<p class="x" id="t">',
    );
    const result = await claimFailure('Leaf', html, { count: 1 });
    expectAuthored(
      result,
      'static attribute id is out of order (found class) at /0',
      POSITION.leafElement,
    );
  });

  test('child order mismatch reports the authored first expected JSX element', async () => {
    // The authored order is `<b>alpha</b>` then the static text `tail`; the
    // server moves the text first, so the first claim check sees text where the
    // authored JSX starts with the `<b>` element.
    const html = render('Ordered', {}).replace(
      '<div><b>alpha</b>tail </div>',
      '<div>tail <b>alpha</b></div>',
    );
    const result = await claimFailure('Ordered', html, {});
    expectAuthored(result, "expected element 'b' at /0/0", POSITION.orderedFirstChild);
  });

  test('list end missing reports the authored list expression position', async () => {
    const html = render('List', { items: [{ id: 'a', label: 'A' }] }).replace(
      '<!--oe:/each-->',
      '',
    );
    const result = await claimFailure('List', html, { items: [{ id: 'a', label: 'A' }] });
    expectAuthored(result, 'list end is missing at /0/0/each/end', POSITION.listExpression);
  });

  test('list seed mismatch reports the authored list expression position', async () => {
    // The server has one keyed entry but the client list is empty: the strict
    // seed predicate throws directly with the dynamic detail expression.
    const html = render('List', { items: [{ id: 'a', label: 'A' }] });
    const result = await claimFailure('List', html, { items: [] });
    expectAuthored(
      result,
      'server entry key has no client item at /0/0/each',
      POSITION.listExpression,
    );
  });

  test('condition branch mismatch reports the authored then-branch position', async () => {
    const html = render('Cond', { open: true }).replace(
      '<p class="on">open</p>',
      '<em class="on">open</em>',
    );
    const result = await claimFailure('Cond', html, { open: true });
    expectAuthored(result, "expected element 'p' at /0/0/then/0", POSITION.conditionThenBranch);
  });
});
