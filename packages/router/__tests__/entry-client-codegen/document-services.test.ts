/**
 * The generated entry's document-services installer (generated-lane page floor).
 *
 * The two document-level services the entry installs — deep fragment navigation
 * (#1090) and the bounded pre-hydration click capture — used to arrive ONLY as
 * a side effect of the entry's lazy element-runtime `import()`. On a page whose
 * islands are all generated-lane that import is not emitted at all
 * (`clientEntryNeedsElementRuntime()` false, M11-3 — the P1 win, deliberately
 * kept), so both services stopped being installed and
 * `page-structure.spec.ts`'s deep-fragment case regressed with no
 * `data-open-target` on `#start`.
 *
 * This file pins the consumer side of the fix, all fail-closed:
 *
 * 1. The generated-lane-only shape carries a STATIC import of the
 *    document-services virtual specifier and CALLS both installers at entry
 *    evaluation (before any island factory can run, because a direct load with
 *    a `#hash` must scroll into a DSD subtree before activation).
 * 2. That shape carries NO `__loadElementRuntime` — restoring the lazy loader
 *    to re-install the services would undo the P1 win this fix exists to keep.
 * 3. The class-lane shape is byte-identical to its pinned ABI hash: its lazy
 *    `element-services` import is still the one installer there (the shared
 *    runtime chunk is fetched anyway, so a static import would add a real
 *    static edge to it for no benefit).
 * 4. The specifier resolves to a real module, and that module's own closure
 *    contains no P1 executor entry — the property that makes a static import
 *    from the page floor legal at all.
 * 5. Gate: the entry never calls a `__` binding it does not define (the
 *    88bda88bf regression class, re-asserted for the new call).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  ELEMENT_DOCUMENT_SERVICES_RUNTIME_SPECIFIER,
  generateClientEntry,
  resolveElementServicesRuntimeModule,
} from '../../src/vite/internal/ssg/entry-client-codegen.ts';
import { buildClientIslandEntries } from '../../src/vite/internal/ssg/client-island-entries.ts';

// .../packages/router/__tests__/entry-client-codegen -> repository root
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ELEMENT_DIR = resolve(REPO_ROOT, 'packages/element');

/** One generated-lane island delivery entry (the www shape). */
function generatedLaneEntry(): ReturnType<typeof buildClientIslandEntries>[number] {
  return buildClientIslandEntries({
    root: '/proj',
    islandsDir: 'app/islands',
    islandTagNames: ['gen-page'],
    islandFiles: ['gen-page.tsx'],
    islandMeta: {
      'gen-page': {
        generatedElementHost: { kind: 'producer', component: 'GenPage' },
      } as never,
    },
    packageIslandDecls: [],
    compilerBehaviorDecls: [],
  })[0]!;
}

test('the generated-lane entry statically imports and installs both document services', () => {
  const entry = generateClientEntry([generatedLaneEntry()]);

  // The static import exists and names the stable virtual id (never a
  // filesystem path: the entry is a virtual module, and an absolute path would
  // bake the build machine's checkout into the emitted bytes).
  expect(entry).toContain(ELEMENT_DOCUMENT_SERVICES_RUNTIME_SPECIFIER);
  expect(entry).toMatch(/^import \{[^}]*ensureDeepFragmentNavigation[^}]*\} from '/m);
  expect(entry).toContain('ensurePreHydrationClickCapture as __installPreHydrationCapture');

  // Both calls run at entry evaluation, after `__tags` (the capture needs the
  // island list) and before the scheduler is constructed.
  const tagsIndex = entry.indexOf('var __tags = [');
  const deepIndex = entry.indexOf('__installDeepFragments();');
  const captureIndex = entry.indexOf('__installPreHydrationCapture(document, __tags);');
  const schedulerIndex = entry.indexOf('var __scheduler = __schedule({');
  expect(tagsIndex).toBeGreaterThan(-1);
  expect(deepIndex).toBeGreaterThan(tagsIndex);
  expect(captureIndex).toBeGreaterThan(tagsIndex);
  expect(schedulerIndex).toBeGreaterThan(captureIndex);
});

test('the generated-lane entry still carries NO lazy element-runtime loader', () => {
  // The P1 win this fix must not undo: restoring `__loadElementRuntime` to
  // re-install the services would put the generic executor back on every
  // generated-lane page.
  const entry = generateClientEntry([generatedLaneEntry()]);
  expect(entry).not.toContain('__loadElementRuntime');
  expect(entry).not.toContain('element-services');
});

test.each([false, true])(
  'enhanced forms use document services with generated islands: %s',
  (withIsland) => {
    const entry = generateClientEntry(withIsland ? [generatedLaneEntry()] : [], {
      enhancedForms: true,
    });
    expect(entry).toContain(ELEMENT_DOCUMENT_SERVICES_RUNTIME_SPECIFIER);
    expect(entry).toContain('__installDeepFragments();');
    expect(entry).toContain('__installPreHydrationCapture(document, __tags);');
    expect(entry).toContain('createEnhanceClient');
    expect(entry).not.toContain('__loadElementRuntime');
    expect(entry).not.toContain('element-services');
  },
);

test('the class-lane entry is byte-identical to its pinned ABI hash', () => {
  // Its lazy `element-services` import remains the single installer there. The
  // hash is the guardrail: any accidental static document-services import on
  // this shape would add a static edge to the shared runtime chunk (which #1544
  // groups by package root) for a chunk that is already fetched.
  const code = generateClientEntry([
    { tagName: 'class-card', modulePath: '/abs/app/islands/class-card.tsx', strategy: 'load' },
  ]);
  expect(createHash('sha256').update(code).digest('hex')).toBe(
    '929dbd80514dd613ebbf453f740cae12fa4762ada3d38c0270b377cf49485c92',
  );
  expect(code).not.toContain('element-document-services');
});

test('the specifier resolves to the wrapper, and the wrapper reaches no executor entry', () => {
  const wrapperPath = resolveElementServicesRuntimeModule(
    ELEMENT_DOCUMENT_SERVICES_RUNTIME_SPECIFIER,
  );
  expect(wrapperPath, 'the document-services virtual id has no resolution rule').not.toBeNull();
  const wrapper = readFileSync(wrapperPath!, 'utf8');
  // The wrapper re-exports from the narrow element subpath — never the root
  // entry (which installs the hydration executor and Block builders).
  expect(wrapper).toContain("from '@openelement/element/document-services'");

  // Walk the element-side closure the wrapper pulls: the leaf modules must not
  // name any of the six P1 executor entries.
  const leaves = [
    resolve(ELEMENT_DIR, 'src/document-services.ts'),
    resolve(ELEMENT_DIR, 'src/internal/core/deep-fragment.ts'),
    resolve(ELEMENT_DIR, 'src/internal/compiled/runtime/pre-upgrade-events.ts'),
  ];
  for (const leaf of leaves) {
    const source = readFileSync(leaf, 'utf8');
    // Strip comments first: the doc prose legitimately NAMES the executor
    // modules it explains it avoids, so a raw substring test would fail on the
    // explanation instead of on an edge. Then strip `import type` / `export type`
    // statements: they are erased at build time and contribute no runtime edge —
    // verified independently by the emitted graph, which contains no
    // `runtime/hydrate.ts` module even though pre-upgrade-events.ts names it in a
    // type-only import for its public parameter shape.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/^[ \t]*(?:import|export)[ \t]+type[ \t][\s\S]*?from[ \t]*'[^']+';?/gm, '');
    for (const forbidden of [
      './program-kernel.ts',
      './hydrate.ts',
      './fresh-dom.ts',
      './kernel.ts',
      '../facade-host.ts',
      '../runtime-program.ts',
    ]) {
      const needle = `from '${forbidden}'`;
      expect(code.includes(needle), `${leaf} must not import ${forbidden}`).toBe(false);
    }
  }
  // Negative control on the walk: the deep-fragment leaf is real and readable.
  expect(
    readFileSync(resolve(ELEMENT_DIR, 'src/internal/core/deep-fragment.ts'), 'utf8'),
  ).toContain('export function ensureDeepFragmentNavigation');
});

test('gate: the new entry shape never calls a __ binding it does not define', () => {
  // 88bda88bf regression class: a shared emission block calling a binding only
  // one shape defines. The document-services calls are emitted on one shape
  // only, so this re-asserts the property for the new call sites.
  const entry = generateClientEntry([generatedLaneEntry()]);
  const defined = new Set<string>();
  for (const pattern of [/\bvar\s+(__\w+)/g, /\bfunction\s+(__\w+)/g, /\bas\s+(__\w+)/g]) {
    for (const match of entry.matchAll(pattern)) defined.add(match[1]);
  }
  const called = new Set<string>();
  for (const match of entry.matchAll(/\b(__\w+)\s*\(/g)) called.add(match[1]);
  expect([...called].filter((name) => !defined.has(name)).sort()).toEqual([]);
});
