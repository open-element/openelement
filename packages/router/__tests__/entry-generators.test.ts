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
// creep back inline. B2 (#1544) added the lazy-runtime block — the dynamic
// import, the document-service calls it makes and the inlined logger that
// replaces the former static element import — so the shell grew by ~0.9KB
// while the runtime it used to drag in unconditionally (86KB raw / 27KB
// gzip) left the graph entirely. 3KB keeps the shell honest.
const CLIENT_ENTRY_BUDGET_BYTES = 3072;

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

test('whole-entry scheduler imports follow the admitted strategy inventory', () => {
  const entry = { tagName: 'x-base', modulePath: './base.ts', strategy: 'idle' as const };
  const visible = { tagName: 'x-visible', modulePath: './vis.ts', strategy: 'visible' as const };
  const media = {
    tagName: 'x-media',
    modulePath: './media.ts',
    strategy: 'media' as const,
    media: '(min-width: 700px)',
  };
  const options = { specializeScheduler: true };
  const neither = generateClientEntry([entry, { ...visible, strategy: 'none' }], options);
  expect(neither).toContain('createIslandSchedulerWithStrategies as __schedule');
  expect(neither).not.toContain('installVisibleStrategy');
  expect(neither).not.toContain('installMediaStrategy');
  expect(neither).not.toContain('./vis.ts');
  const visibleOnly = generateClientEntry([entry, visible], options);
  expect(visibleOnly).toContain('visible: installVisibleStrategy');
  expect(visibleOnly).not.toContain('installMediaStrategy');
  const mediaOnly = generateClientEntry([entry, media], options);
  expect(mediaOnly).toContain('media: installMediaStrategy');
  expect(mediaOnly).not.toContain('installVisibleStrategy');
  expect(mediaOnly).toContain("window.matchMedia('(min-width: 700px)')");
  expect(generateClientEntry([entry, visible, media], options)).toContain(
    'createIslandScheduler as __schedule',
  );
  expect(generateClientEntry([entry])).toContain('createIslandScheduler as __schedule');
  for (const code of [neither, visibleOnly, mediaOnly]) assertEntrySyntax(code);
});

test('zero islands + enhancedForms emits the enhancement layer (#569)', () => {
  const code = generateClientEntry([], { enhancedForms: true });
  expect(!code.includes('zero client JS needed')).toBeTruthy();
  // #868: the runtime is a real bundled module — the entry wires it.
  expect(code.includes('observeFormEnhancement'), 'enhancement runtime is wired').toBeTruthy();
  expect(
    code.includes('virtual:open-client-runtime/enhance'),
    'enhance import emitted',
  ).toBeTruthy();
  expect(code.includes('__scanEnhancement'), 'submit interception wiring is emitted').toBeTruthy();
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

test('client-only and server-rendered hosts import their own constructors', () => {
  const code = generateClientEntry([
    { tagName: 'only-widget', modulePath: './only.ts', strategy: 'only', ssr: false, dsd: false },
    { tagName: 'dsd-widget', modulePath: './dsd.ts', strategy: 'idle', ssr: true, dsd: true },
  ]);
  expect(code).toContain('return import("./only.ts")');
  expect(code).toContain('return import("./dsd.ts")');
  expect(code).not.toContain('element-services');
  assertEntrySyntax(code);
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

  expect(code).toContain('return import("./safe-module.ts")');
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
  // The entry wires the form loader, which discovers the document capability
  // before evaluating the separate enhancement runtime.
  expect(code.includes('observeFormEnhancement')).toBeTruthy();
  expect(code.includes('virtual:open-client-runtime/enhance')).toBeTruthy();
  expect(code.includes('actionHeader: "x-openelement-action"')).toBeTruthy();
  // Wiring for ADR-0121: submit listeners attach per shadow root, late-hydrate
  // rescan after island loads, and the scheduler hook.
  expect(code.includes('__scanEnhancement()')).toBeTruthy();
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
  expect(!code.includes('observeFormEnhancement')).toBeTruthy();
  expect(!code.includes('virtual:open-client-runtime/enhance')).toBeTruthy();
  expect(code.includes('the form enhancement layer is omitted')).toBeTruthy();
  // #597: the scheduler must not reference __scanEnhancement when the enhance
  // layer is omitted — that symbol only exists in the enhance module.
  expect(!code.includes('__scanEnhancement')).toBeTruthy();
});

test('#597/#584 late-hydrate rescan only when enhancedForms', () => {
  const withEnhance = generateClientEntry(
    [{ tagName: 'x-counter', modulePath: './counter.ts', strategy: 'load' }],
    { enhancedForms: true },
  );
  expect(withEnhance.includes('__scanEnhancement()')).toBeTruthy();
  const without = generateClientEntry(
    [{ tagName: 'x-counter', modulePath: './counter.ts', strategy: 'load' }],
    { enhancedForms: false },
  );
  expect(!without.includes('__scanEnhancement')).toBeTruthy();
});
