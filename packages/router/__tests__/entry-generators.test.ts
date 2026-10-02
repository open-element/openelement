import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { IDLE_FALLBACK_TIMEOUT_MS } from '@openelement/element';
import { generateClientEntry, validateClientIslandEntry } from '../src/vite/internal/ssg/index.ts';

const REJECTED_ISLAND_MODULE_PATHS = [
  'https://example.com/island.js',
  'data:text/javascript,alert(1)',
  'javascript:alert(1)',
  '../outside.ts',
  './nested/../../outside.ts',
  './bad path.ts',
  './bad\npath.ts',
  './bad\\path.ts',
  './bad%0a.ts',
  './bad<path.ts',
  './bad\u2028path.ts',
  '',
] as const;

// #868: the generated entry is a real ESM module now (static imports for the
// bundled runtimes), so `new Function` cannot parse it directly. Strip the
// single-line import prologue and syntax-check the remaining wiring.
function assertEntrySyntax(code: string): void {
  const body = code.replace(/^import .*;\n/gm, '');
  try {
    new Function(body);
  } catch (e) {
    expect(true, `Syntax error: ${String(e)}`).toEqual(false);
  }
}

// #868 budget: the client entry must stay a thin wiring shell. Before the
// virtual-module refactor the runtime was inlined via toString() (client.js
// 13.7KB -> 10.5KB); this pins the entry generator so the runtime cannot
// creep back inline. 2KB covers the wiring plus the ADR-0120 enhance layer.
const CLIENT_ENTRY_BUDGET_BYTES = 2048;

test('#868 client entry stays within the wiring budget', () => {
  const code = generateClientEntry([
    { tagName: 'x-counter', modulePath: './counter.ts', strategy: 'load' },
  ]);
  expect(
    code.length < CLIENT_ENTRY_BUDGET_BYTES,
    `client entry ${code.length}B exceeds ${CLIENT_ENTRY_BUDGET_BYTES}B budget`,
  ).toBeTruthy();
});

test('#868 the idle fallback timeout is the serialized policy constant, not a second literal', () => {
  // The import-free island-scheduler module receives the number through its
  // deps; the emitted value must re-derive from the element policy constant
  // (the __maxActionBodyBytes precedent — the pin reads the derivation, not
  // a bare literal).
  const code = generateClientEntry([
    { tagName: 'x-counter', modulePath: './counter.ts', strategy: 'idle' },
  ]);
  expect(
    code.includes(`idleFallbackTimeoutMs: ${IDLE_FALLBACK_TIMEOUT_MS},`),
    'client entry must serialize the IDLE_FALLBACK_TIMEOUT_MS policy constant into the scheduler deps',
  ).toBeTruthy();
});

test('empty -> zero JS', () => {
  expect(generateClientEntry([]).includes('zero client JS needed')).toBeTruthy();
});

test('zero islands + enhancedForms emits the enhancement layer (#569)', () => {
  const code = generateClientEntry([], { enhancedForms: true });
  expect(!code.includes('zero client JS needed')).toBeTruthy();
  // #868: the runtime is a real bundled module — the entry wires it.
  expect(code.includes('createEnhanceClient'), 'enhancement runtime is wired').toBeTruthy();
  expect(
    code.includes('virtual:open-client-runtime/enhance'),
    'enhance import emitted',
  ).toBeTruthy();
  expect(code.includes('scanSubmitRoots'), 'submit interception wiring is emitted').toBeTruthy();
  assertEntrySyntax(code);
});

test('zero islands without enhancedForms keeps the stub (#569)', () => {
  expect(
    generateClientEntry([], { enhancedForms: false }).includes('zero client JS needed'),
  ).toBeTruthy();
});

test('client:load island loads immediately', () => {
  const code = generateClientEntry([
    {
      tagName: 'open-theme-toggle',
      modulePath: '@acme/components/open-theme-toggle',
      strategy: 'load',
    },
  ]);
  expect(code.includes('import("@acme/components/open-theme-toggle")')).toBeTruthy();
  expect(code.includes('load: ["open-theme-toggle"]')).toBeTruthy();
  assertEntrySyntax(code);
});

test('client:idle island deferred to idle', () => {
  const code = generateClientEntry([
    { tagName: 'open-hero-ping', modulePath: './ping.ts', strategy: 'idle' },
  ]);
  expect(code.includes('idle: ["open-hero-ping"]')).toBeTruthy();
  expect(code.includes('import("./ping.ts")')).toBeTruthy();
  assertEntrySyntax(code);
});

test('mixed load+idle', () => {
  const code = generateClientEntry([
    {
      tagName: 'open-theme-toggle',
      modulePath: '@acme/components/open-theme-toggle',
      strategy: 'load',
    },
    { tagName: 'open-hero-ping', modulePath: '@acme/components/open-hero-ping', strategy: 'idle' },
  ]);
  expect(code.includes('load: ["open-theme-toggle"]')).toBeTruthy();
  expect(code.includes('idle: ["open-hero-ping"]')).toBeTruthy();
  assertEntrySyntax(code);
});

test('no legacy SSR client runtime', () => {
  const code = generateClientEntry([
    { tagName: 'my-counter', modulePath: './counter.ts', strategy: 'idle' },
  ]);
  expect(code.includes('LitElement')).toEqual(false);
  expect(code.includes('lit-element-hydrate-support')).toEqual(false);
});

test('open:ready event', () => {
  const code = generateClientEntry([
    { tagName: 'my-island', modulePath: './island.ts', strategy: 'idle' },
  ]);
  expect(code.includes('idle: ["my-island"]')).toBeTruthy();
  assertEntrySyntax(code);
});

test('client:only islands are scheduled with immediate load (not idle)', () => {
  const code = generateClientEntry([
    {
      tagName: 'client-only-widget',
      modulePath: './client-only-widget.ts',
      strategy: 'only',
      ssr: false,
      dsd: false,
    },
  ]);

  expect(code.includes('only: ["client-only-widget"]')).toBeTruthy();
  expect(code.includes('"client-only-widget"')).toBeTruthy();
  // v0.21: only uses immediate load, NOT idle deferral
  expect(code.includes('client:idle and client:only')).toEqual(false);
  assertEntrySyntax(code);
});

// #1416: the element entry is chosen per page. A page whose every island is
// client-only hydrates nothing, so its bundle imports the claim-free entry;
// everything else keeps the full one.

test('#1416: a page with only client-only islands imports the client-only entry', () => {
  const code = generateClientEntry([
    {
      tagName: 'client-only-widget',
      modulePath: './client-only-widget.ts',
      strategy: 'only',
      ssr: false,
      dsd: false,
    },
    {
      tagName: 'another-widget',
      modulePath: './another-widget.ts',
      strategy: 'only',
      ssr: false,
      dsd: false,
    },
  ]);

  expect(
    code.includes("from '@openelement/element/client-only'"),
    'client-only entry is imported when no island can hydrate server DOM',
  ).toBeTruthy();
  expect(
    code.includes("from '@openelement/element'"),
    'the full entry must not also be imported',
  ).toEqual(false);
  assertEntrySyntax(code);
});

test('#1416: a page with any dsd island never takes the client-only entry', () => {
  // The ruling's reverse case, and the direction that matters: a wrong guess
  // here breaks hydration instead of costing bytes. An island that hydrates
  // is enough, even next to client-only ones.
  const code = generateClientEntry([
    {
      tagName: 'client-only-widget',
      modulePath: './client-only-widget.ts',
      strategy: 'only',
      ssr: false,
      dsd: false,
    },
    {
      tagName: 'hydrating-widget',
      modulePath: './hydrating-widget.ts',
      strategy: 'idle',
      ssr: true,
      dsd: true,
    },
  ]);

  expect(
    code.includes("from '@openelement/element'"),
    'full entry for a hydrating page',
  ).toBeTruthy();
  expect(
    code.includes("'@openelement/element/client-only'"),
    'the claim-free entry must never appear on a page that can hydrate',
  ).toEqual(false);
});

/** Import prologue lines only: the header comments mention module names. */
function importLines(code: string): string[] {
  return code.split('\n').filter((line) => line.startsWith('import'));
}

test('#1416: an island that declares nothing keeps the full entry (conservative)', () => {
  // Silence is not a client-only claim: ssr/dsd absent means "not known to be
  // client-only", so the full entry stands. Same for one flag set and the
  // other absent, and for ssr:true/dsd:false — every partial declaration
  // resolves to the full entry.
  const silent = generateClientEntry([
    { tagName: 'x-silent', modulePath: './silent.ts', strategy: 'idle' },
  ]);
  expect(
    importLines(silent).some((line) => line.endsWith("from '@openelement/element';")),
  ).toBeTruthy();
  expect(importLines(silent).some((line) => line.includes('client-only'))).toEqual(false);

  const halfDeclared = generateClientEntry([
    { tagName: 'x-half', modulePath: './half.ts', strategy: 'idle', ssr: false },
  ]);
  expect(
    importLines(halfDeclared).some((line) => line.endsWith("from '@openelement/element';")),
  ).toBeTruthy();

  const dsdOnly = generateClientEntry([
    { tagName: 'x-dsd-only', modulePath: './dsd-only.ts', strategy: 'idle', ssr: false, dsd: true },
  ]);
  expect(
    importLines(dsdOnly).some((line) => line.endsWith("from '@openelement/element';")),
    'dsd alone keeps the claim: only both flags false prove client-only',
  ).toBeTruthy();
});

test('#1416: both ssr and dsd false is client-only even off the "only" strategy', () => {
  // The predicate agrees with the build's own client-only determination
  // (build-ssg.ts: `meta.ssr !== false` decides the client-only stub), and it
  // is the same declaration: `ssr: false, dsd: false` means no server output
  // for this island, so there is nothing to claim. `strategy: 'only'` carries
  // the same meaning by definition (island.ts: "client-only render, no DSD/SSR
  // output"), which is why it is admitted without the explicit flags.
  const explicit = generateClientEntry([
    { tagName: 'x-load', modulePath: './load.ts', strategy: 'load', ssr: false, dsd: false },
  ]);
  expect(
    importLines(explicit).some((line) => line.includes("'@openelement/element/client-only'")),
  ).toBeTruthy();

  const onlyWithoutFlags = generateClientEntry([
    { tagName: 'x-only', modulePath: './only.ts', strategy: 'only' },
  ]);
  expect(
    importLines(onlyWithoutFlags).some((line) =>
      line.includes("'@openelement/element/client-only'"),
    ),
  ).toBeTruthy();
});

test('#1416: the lit renderer entry imports no element entry at all', () => {
  const code = generateClientEntry(
    [{ tagName: 'x-lit', modulePath: './lit.ts', strategy: 'idle' }],
    { renderer: 'lit' },
  );
  expect(importLines(code).some((line) => line.includes('@openelement/element'))).toEqual(false);
});

test('legacy eager/lazy strategies are not emitted by v0.21 runtime', () => {
  const code = generateClientEntry([
    { tagName: 'x-load', modulePath: './load.ts', strategy: 'load' },
    { tagName: 'x-idle', modulePath: './idle.ts', strategy: 'idle' },
  ]);

  expect(code.includes('eager')).toEqual(false);
  expect(code.includes('lazy')).toEqual(false);
});

// Section

test('package island strategy:load is preserved in client entry', () => {
  // Bug: buildClient used to drop strategy from packageIslands, so
  // open-theme-toggle (strategy: 'load') must stay in the immediate bucket.
  // Fix: strategy is now passed through from metadata.
  const code = generateClientEntry([
    {
      tagName: 'open-theme-toggle',
      modulePath: '@acme/components/open-theme-toggle',
      strategy: 'load',
      isPackage: true,
    },
    {
      tagName: 'open-button',
      modulePath: '@acme/components/open-button',
      strategy: 'idle',
      isPackage: true,
    },
  ]);

  // Load island must appear in the immediate-load array
  expect(code.includes('"open-theme-toggle"')).toBeTruthy();
  // Both must appear in the island map
  expect(code.includes('import("@acme/components/open-theme-toggle")')).toBeTruthy();
  expect(code.includes('import("@acme/components/open-button")')).toBeTruthy();
});

test('client entry safely escapes tag names and module paths', () => {
  const code = generateClientEntry([
    {
      tagName: 'x-safe',
      modulePath: './safe-module.ts',
      strategy: 'load',
    },
  ]);

  expect(code.includes('"x-safe": () => import("./safe-module.ts")')).toBeTruthy();
  assertEntrySyntax(code);
});

test('client entry admits only validated module specifiers before code generation', () => {
  const admitted = validateClientIslandEntry({
    tagName: 'x-safe',
    modulePath: '@acme/components/open-button',
    strategy: 'load',
  });

  expect(admitted.modulePath).toEqual('@acme/components/open-button');
  expect(admitted.tagName).toEqual('x-safe');

  for (const modulePath of REJECTED_ISLAND_MODULE_PATHS) {
    assertThrowsIncludes(
      () =>
        validateClientIslandEntry({
          tagName: 'x-safe',
          modulePath,
          strategy: 'load',
        }),
      Error,
      'Invalid island modulePath',
    );
  }
});

test('client entry rejects malicious package island metadata', () => {
  assertThrowsIncludes(
    () =>
      generateClientEntry([
        {
          tagName: "x-bad');alert(1);//",
          modulePath: './safe.ts',
          strategy: 'idle',
        },
      ]),
    Error,
    'Invalid island tagName',
  );

  assertThrowsIncludes(
    () =>
      generateClientEntry([
        {
          tagName: 'x-safe',
          modulePath: 'javascript:alert(1)',
          strategy: 'idle',
        },
      ]),
    Error,
    'Invalid island modulePath',
  );

  for (const modulePath of REJECTED_ISLAND_MODULE_PATHS) {
    assertThrowsIncludes(
      () =>
        generateClientEntry([
          {
            tagName: 'x-safe',
            modulePath,
            strategy: 'idle',
          },
        ]),
      Error,
      'Invalid island modulePath',
    );
  }
});

test('client entry rejects legacy eager/lazy strategy values', () => {
  assertThrowsIncludes(
    () =>
      generateClientEntry([
        {
          tagName: 'x-old',
          modulePath: './old.ts',
          strategy: 'eager',
        } as never,
      ]),
    Error,
    'Invalid island strategy',
  );
});

test('client entry includes the ADR-0120 form enhancement layer', () => {
  const code = generateClientEntry(
    [{ tagName: 'x-counter', modulePath: './counter.ts', strategy: 'load' }],
    { enhancedForms: true },
  );
  // #868: the runtime is the real enhance-client.ts module, bundled via the
  // virtual specifier — the entry wires it (behavior is unit-tested against
  // the module in __tests__/enhance-client.test.ts).
  expect(code.includes('createEnhanceClient')).toBeTruthy();
  expect(code.includes('virtual:open-client-runtime/enhance')).toBeTruthy();
  expect(code.includes('actionHeader: "x-openelement-action"')).toBeTruthy();
  // Wiring for ADR-0121: submit listeners attach per shadow root, late-hydrate
  // rescan after island loads, and the scheduler hook.
  expect(code.includes('scanSubmitRoots(document)')).toBeTruthy();
  expect(code.includes('observeVisible: __scheduler.observeVisible')).toBeTruthy();
  // The entry must NOT carry the runtime internals inline any more (#868).
  expect(!code.includes('attachSubmit')).toBeTruthy();
  expect(!code.includes('history.pushState')).toBeTruthy();
  expect(!code.includes('__openElementSeq')).toBeTruthy();
});

test('#868 client entry bundles the real scheduler module (#606 single owner)', () => {
  const code = generateClientEntry([
    { tagName: 'x-counter', modulePath: './counter.ts', strategy: 'load' },
  ]);
  expect(code.includes('createIslandScheduler')).toBeTruthy();
  expect(code.includes('virtual:open-client-runtime/scheduler')).toBeTruthy();
  // The visible-strategy deep query lives in the scheduler module, not inline.
  expect(!code.includes('queryAllDeep')).toBeTruthy();
  assertEntrySyntax(code);
});

test('islands without enhancedForms omit the enhancement layer (#569 complement)', () => {
  // Static sites with islands but no data-open-enhance forms keep a lean
  // client bundle (ADR-0120 zero-upgrade-cost consequence) and, critically,
  // no popstate listener that could interfere with their own routing JS.
  const code = generateClientEntry([
    { tagName: 'x-counter', modulePath: './counter.ts', strategy: 'load' },
  ]);
  expect(code.includes('live-counter') === false).toBeTruthy(); // sanity: only x-counter
  expect(!code.includes('createEnhanceClient')).toBeTruthy();
  expect(!code.includes('virtual:open-client-runtime/enhance')).toBeTruthy();
  expect(code.includes('the form enhancement layer is omitted')).toBeTruthy();
  // #597: the scheduler must not reference scanSubmitRoots when the enhance
  // layer is omitted — that symbol only exists in the enhance module.
  expect(!code.includes('scanSubmitRoots')).toBeTruthy();
});

test('#597/#584 late-hydrate rescan only when enhancedForms', () => {
  const withEnhance = generateClientEntry(
    [{ tagName: 'x-counter', modulePath: './counter.ts', strategy: 'load' }],
    { enhancedForms: true },
  );
  expect(withEnhance.includes('scanSubmitRoots(document)')).toBeTruthy();
  const without = generateClientEntry(
    [{ tagName: 'x-counter', modulePath: './counter.ts', strategy: 'load' }],
    { enhancedForms: false },
  );
  expect(!without.includes('scanSubmitRoots')).toBeTruthy();
});
