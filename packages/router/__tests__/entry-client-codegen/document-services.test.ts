/**
 * These tests pin the document bootstrap's own import and installation order.
 * The emitted-chunk guard separately checks the entry's static graph.
 */
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

test('a legacy island does not start its runtime when form enhancement installs', () => {
  const code = generateClientEntry(
    [{ tagName: 'class-card', modulePath: '/abs/app/islands/class-card.tsx', strategy: 'load' }],
    { enhancedForms: true },
  );
  expect(code).toContain(ELEMENT_DOCUMENT_SERVICES_RUNTIME_SPECIFIER);
  expect(code).toContain('Promise.all([__island, __loadElementRuntime()])');
  expect(code).not.toMatch(/^__loadElementRuntime\(\);/m);
  expect(code.match(/__installDeepFragments\(\);/g)).toHaveLength(1);
  expect(code.match(/__installPreHydrationCapture\(document, __tags\);/g)).toHaveLength(1);
  expect(code.indexOf('__installDeepFragments();')).toBeLessThan(code.indexOf('var __scheduler'));
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
