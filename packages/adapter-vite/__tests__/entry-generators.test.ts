import { assert, assertEquals, assertThrows } from '@std/assert';
import { generateClientEntry, validateClientIslandEntry } from '../src/internal/ssg/index.ts';

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
    assertEquals(true, false, `Syntax error: ${String(e)}`);
  }
}

// #868 budget: the client entry must stay a thin wiring shell. Before the
// virtual-module refactor the runtime was inlined via toString() (client.js
// 13.7KB -> 10.5KB); this pins the entry generator so the runtime cannot
// creep back inline. 2KB covers the wiring plus the ADR-0120 enhance layer.
const CLIENT_ENTRY_BUDGET_BYTES = 2048;

Deno.test('#868 client entry stays within the wiring budget', () => {
  const code = generateClientEntry([
    { tagName: 'x-counter', modulePath: './counter.ts', strategy: 'load' },
  ]);
  assert(
    code.length < CLIENT_ENTRY_BUDGET_BYTES,
    `client entry ${code.length}B exceeds ${CLIENT_ENTRY_BUDGET_BYTES}B budget`,
  );
});

Deno.test('empty -> zero JS', () => {
  assert(generateClientEntry([]).includes('zero client JS needed'));
});

Deno.test('zero islands + enhancedForms emits the enhancement layer (#569)', () => {
  const code = generateClientEntry([], { enhancedForms: true });
  assert(!code.includes('zero client JS needed'));
  // #868: the runtime is a real bundled module — the entry wires it.
  assert(code.includes('createEnhanceClient'), 'enhancement runtime is wired');
  assert(code.includes('virtual:open-client-runtime/enhance'), 'enhance import emitted');
  assert(code.includes('scanSubmitRoots'), 'submit interception wiring is emitted');
  assertEntrySyntax(code);
});

Deno.test('zero islands without enhancedForms keeps the stub (#569)', () => {
  assert(generateClientEntry([], { enhancedForms: false }).includes('zero client JS needed'));
});

Deno.test('client:load island loads immediately', () => {
  const code = generateClientEntry([
    {
      tagName: 'open-theme-toggle',
      modulePath: '@acme/components/open-theme-toggle',
      strategy: 'load',
    },
  ]);
  assert(code.includes('import("@acme/components/open-theme-toggle")'));
  assert(code.includes('load: ["open-theme-toggle"]'));
  assertEntrySyntax(code);
});

Deno.test('client:idle island deferred to idle', () => {
  const code = generateClientEntry([
    { tagName: 'open-hero-ping', modulePath: './ping.ts', strategy: 'idle' },
  ]);
  assert(code.includes('idle: ["open-hero-ping"]'));
  assert(code.includes('import("./ping.ts")'));
  assertEntrySyntax(code);
});

Deno.test('mixed load+idle', () => {
  const code = generateClientEntry([
    {
      tagName: 'open-theme-toggle',
      modulePath: '@acme/components/open-theme-toggle',
      strategy: 'load',
    },
    { tagName: 'open-hero-ping', modulePath: '@acme/components/open-hero-ping', strategy: 'idle' },
  ]);
  assert(code.includes('load: ["open-theme-toggle"]'));
  assert(code.includes('idle: ["open-hero-ping"]'));
  assertEntrySyntax(code);
});

Deno.test('no legacy SSR client runtime', () => {
  const code = generateClientEntry([
    { tagName: 'my-counter', modulePath: './counter.ts', strategy: 'idle' },
  ]);
  assertEquals(code.includes('LitElement'), false);
  assertEquals(code.includes('lit-element-hydrate-support'), false);
});

Deno.test('open:ready event', () => {
  const code = generateClientEntry([
    { tagName: 'my-island', modulePath: './island.ts', strategy: 'idle' },
  ]);
  assert(code.includes('idle: ["my-island"]'));
  assertEntrySyntax(code);
});

Deno.test('client:only islands are scheduled with immediate load (not idle)', () => {
  const code = generateClientEntry([
    {
      tagName: 'client-only-widget',
      modulePath: './client-only-widget.ts',
      strategy: 'only',
      ssr: false,
      dsd: false,
    },
  ]);

  assert(code.includes('only: ["client-only-widget"]'));
  assert(code.includes('"client-only-widget"'));
  // v0.21: only uses immediate load, NOT idle deferral
  assertEquals(code.includes('client:idle and client:only'), false);
  assertEntrySyntax(code);
});

Deno.test('legacy eager/lazy strategies are not emitted by v0.21 runtime', () => {
  const code = generateClientEntry([
    { tagName: 'x-load', modulePath: './load.ts', strategy: 'load' },
    { tagName: 'x-idle', modulePath: './idle.ts', strategy: 'idle' },
  ]);

  assertEquals(code.includes('eager'), false);
  assertEquals(code.includes('lazy'), false);
});

// Section

Deno.test('package island strategy:load is preserved in client entry', () => {
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
  assert(code.includes('"open-theme-toggle"'));
  // Both must appear in the island map
  assert(code.includes('import("@acme/components/open-theme-toggle")'));
  assert(code.includes('import("@acme/components/open-button")'));
});

Deno.test('client entry safely escapes tag names and module paths', () => {
  const code = generateClientEntry([
    {
      tagName: 'x-safe',
      modulePath: './safe-module.ts',
      strategy: 'load',
    },
  ]);

  assert(code.includes('"x-safe": () => import("./safe-module.ts")'));
  assertEntrySyntax(code);
});

Deno.test('client entry admits only validated module specifiers before code generation', () => {
  const admitted = validateClientIslandEntry({
    tagName: 'x-safe',
    modulePath: '@acme/components/open-button',
    strategy: 'load',
  });

  assertEquals(admitted.modulePath, '@acme/components/open-button');
  assertEquals(admitted.tagName, 'x-safe');

  for (const modulePath of REJECTED_ISLAND_MODULE_PATHS) {
    assertThrows(
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

Deno.test('client entry rejects malicious package island metadata', () => {
  assertThrows(
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

  assertThrows(
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
    assertThrows(
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

Deno.test('client entry rejects legacy eager/lazy strategy values', () => {
  assertThrows(
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

Deno.test('client entry includes the ADR-0120 form enhancement layer', () => {
  const code = generateClientEntry(
    [{ tagName: 'x-counter', modulePath: './counter.ts', strategy: 'load' }],
    { enhancedForms: true },
  );
  // #868: the runtime is the real enhance-client.ts module, bundled via the
  // virtual specifier — the entry wires it (behavior is unit-tested against
  // the module in __tests__/enhance-client.test.ts).
  assert(code.includes('createEnhanceClient'));
  assert(code.includes('virtual:open-client-runtime/enhance'));
  assert(code.includes('actionHeader: "x-openelement-action"'));
  // Wiring for ADR-0121: submit listeners attach per shadow root, late-hydrate
  // rescan after island loads, and the scheduler hook.
  assert(code.includes('scanSubmitRoots(document)'));
  assert(code.includes('observeVisible: __scheduler.observeVisible'));
  // The entry must NOT carry the runtime internals inline any more (#868).
  assert(!code.includes('attachSubmit'));
  assert(!code.includes('history.pushState'));
  assert(!code.includes('__openElementSeq'));
});

Deno.test('#868 client entry bundles the real scheduler module (#606 single owner)', () => {
  const code = generateClientEntry([
    { tagName: 'x-counter', modulePath: './counter.ts', strategy: 'load' },
  ]);
  assert(code.includes('createIslandScheduler'));
  assert(code.includes('virtual:open-client-runtime/scheduler'));
  // The visible-strategy deep query lives in the scheduler module, not inline.
  assert(!code.includes('queryAllDeep'));
  assertEntrySyntax(code);
});

Deno.test('islands without enhancedForms omit the enhancement layer (#569 complement)', () => {
  // Static sites with islands but no data-open-enhance forms keep a lean
  // client bundle (ADR-0120 zero-upgrade-cost consequence) and, critically,
  // no popstate listener that could interfere with their own routing JS.
  const code = generateClientEntry([
    { tagName: 'x-counter', modulePath: './counter.ts', strategy: 'load' },
  ]);
  assert(code.includes('live-counter') === false); // sanity: only x-counter
  assert(!code.includes('createEnhanceClient'));
  assert(!code.includes('virtual:open-client-runtime/enhance'));
  assert(code.includes('the form enhancement layer is omitted'));
  // #597: the scheduler must not reference scanSubmitRoots when the enhance
  // layer is omitted — that symbol only exists in the enhance module.
  assert(!code.includes('scanSubmitRoots'));
});

Deno.test('#597/#584 late-hydrate rescan only when enhancedForms', () => {
  const withEnhance = generateClientEntry(
    [{ tagName: 'x-counter', modulePath: './counter.ts', strategy: 'load' }],
    { enhancedForms: true },
  );
  assert(withEnhance.includes('scanSubmitRoots(document)'));
  const without = generateClientEntry(
    [{ tagName: 'x-counter', modulePath: './counter.ts', strategy: 'load' }],
    { enhancedForms: false },
  );
  assert(!without.includes('scanSubmitRoots'));
});
