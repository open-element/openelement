/**
 * The document-services subpath (generated-lane page floor, P1 seam).
 *
 * `@openelement/element/document-services` exists for ONE measured reason. The
 * generated client entry installs two DOCUMENT-LEVEL services — deep fragment
 * navigation (#1090) and the bounded pre-hydration click capture — and both
 * used to arrive only as a side effect of the entry's LAZY element-runtime
 * `import()`. A page whose islands are all generated-lane emits no such import
 * (`clientEntryNeedsElementRuntime()` returns false, M11-3 — the P1 win, not a
 * bug), so both services silently stopped being installed. Measured
 * regression: `page-structure.spec.ts` "deep fragments scroll inside DSD"
 * failed because `#start` never received `data-open-target`.
 *
 * What is pinned here, all fail-closed:
 *
 * 1. THE EXECUTOR BOUNDARY. The subpath's whole value-import closure reaches no
 *    P1 executor entry module (`program-kernel`, `hydrate`, `fresh-dom`,
 *    `kernel`, `facade-host`, `runtime-program`) and no authoring surface. This
 *    is the assertion that makes the static import legal: a single executor
 *    edge would make the page floor load the generic Part Program executor,
 *    which is exactly what P1 forbids and what
 *    `requireEntryStaticGraphFreeOfRuntime` would fail the build over.
 * 2. The subpath exports BOTH installers plus `deepGetElementById` — no
 *    executor-free half silently dropped, no fourth name.
 * 3. The exported functions are the SAME function objects the root entry
 *    exports (identity, not shape), so a page importing the narrow subpath and
 *    a page importing the root cannot run two different implementations whose
 *    `installed` flags would disagree.
 * 4. The subpath is not in `sideEffects`: importing it must never be forced to
 *    evaluate, because its installers are CALLED by the entry.
 *
 * The consumption side lives in the router test suite
 * (`packages/router/__tests__/entry-client-codegen/document-services.test.ts`),
 * which pins the emitted entry's static import + install call, and in the www
 * e2e suite, which pins the behaviour (`data-open-target` inside a DSD root).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import * as rootEntry from '../src/index.ts';
import * as documentServicesEntry from '../src/document-services.ts';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ELEMENT_SRC = resolve(PKG_DIR, 'src');

/** The six P1 executor ENTRY modules (packages/router/src/vite/internal/browser-entry-graph-artifact.ts). */
const EXECUTOR_ENTRY_RELATIVE_MODULES = [
  'src/internal/compiled/facade-host.ts',
  'src/internal/compiled/runtime-program.ts',
  'src/internal/compiled/runtime/fresh-dom.ts',
  'src/internal/compiled/runtime/hydrate.ts',
  'src/internal/compiled/runtime/kernel.ts',
  'src/internal/compiled/runtime/program-kernel.ts',
] as const;

/** The class-authoring surface: loading it implies an executor entry. */
const AUTHORING_RELATIVE_MODULES = [
  'src/index.ts',
  'src/client-only.ts',
  'src/no-blocks.ts',
  'src/base.ts',
  'src/public-surface.ts',
  'src/open-element.ts',
  'src/open-element-implementation.ts',
] as const;

/**
 * Resolve one relative or `@openelement/protocol/*` specifier to a source file,
 * or null when it is not a module this walk follows (bare packages other than
 * the protocol workspace, which is itself import-free at these leaves).
 */
function resolveModulePath(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith('@openelement/protocol/')) {
    const subpath = specifier.slice('@openelement/protocol/'.length);
    const candidate = resolve(ELEMENT_SRC, '../..', 'protocol', 'src', `${subpath}.ts`);
    return candidate;
  }
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  return base.endsWith('.ts') ? base : `${base}.ts`;
}

/** Value-import closure (type-only imports are erased and contribute nothing). */
function valueImportClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    // `import type` / `export type` add no runtime edge.
    const pattern =
      /^[ \t]*(?:import|export)[ \t]+(?!type[ \t])([\s\S]*?)[ \t]*from[ \t]*'([^']+)'/gm;
    for (const match of source.matchAll(pattern)) {
      const target = resolveModulePath(match[2], file);
      if (target !== null) queue.push(target);
    }
    // Bare side-effect imports (`import './x.ts';`).
    for (const match of source.matchAll(/^[ \t]*import[ \t]*'([^']+)'/gm)) {
      const target = resolveModulePath(match[1], file);
      if (target !== null) queue.push(target);
    }
  }
  return seen;
}

test('the subpath exports both installers plus the deep lookup, and nothing else', () => {
  expect(Object.keys(documentServicesEntry).sort()).toEqual([
    'deepGetElementById',
    'ensureDeepFragmentNavigation',
    'ensurePreHydrationClickCapture',
  ]);
});

test('the subpath re-exports the SAME function objects as the root entry', () => {
  // Identity, not shape: two implementations would each carry their own
  // `installed` flag / capture registry, so a page calling both spellings would
  // install two listener sets while each side believed it was the first.
  expect(documentServicesEntry.deepGetElementById).toBe(rootEntry.deepGetElementById);
  expect(documentServicesEntry.ensureDeepFragmentNavigation).toBe(
    rootEntry.ensureDeepFragmentNavigation,
  );
  expect(documentServicesEntry.ensurePreHydrationClickCapture).toBe(
    rootEntry.ensurePreHydrationClickCapture,
  );
});

test('the whole value-import closure reaches no executor entry and no authoring surface', () => {
  const closure = valueImportClosure(resolve(ELEMENT_SRC, 'document-services.ts'));
  expect(closure.size).toBeGreaterThan(1);
  const relative = [...closure].map((file) => file.slice(PKG_DIR.length + 1)).sort();

  const executorHits = relative.filter((path) =>
    (EXECUTOR_ENTRY_RELATIVE_MODULES as readonly string[]).includes(path),
  );
  expect(
    executorHits,
    `the document-services closure must reach no P1 executor entry — a single edge makes the ` +
      `generated-lane page floor load the generic Part Program executor. Closure: ${relative.join(', ')}`,
  ).toEqual([]);

  const authoringHits = relative.filter((path) =>
    (AUTHORING_RELATIVE_MODULES as readonly string[]).includes(path),
  );
  expect(
    authoringHits,
    `the document-services closure must not reach the class-authoring surface (it installs the ` +
      `executor through the root entry). Closure: ${relative.join(', ')}`,
  ).toEqual([]);

  // Negative control: the closure walk must actually follow edges. If it read
  // only the entry file, every assertion above would pass vacuously.
  expect(relative).toContain('src/internal/core/deep-fragment.ts');
  expect(relative).toContain('src/internal/compiled/runtime/pre-upgrade-events.ts');
});

test('the pre-upgrade capture reaches the error façade, never the executor kernel', () => {
  // The one edge that used to make this impossible: pre-upgrade-events.ts
  // imported `fail` from program-kernel.ts for a single throw. `fail` IS
  // `raiseFrameworkError('render', code, message)`, so the substitution is
  // mechanical and the thrown code/phase/message are unchanged — but the edge
  // is not, and it is the edge the P1 predicate is about.
  const source = readFileSync(
    resolve(ELEMENT_SRC, 'internal/compiled/runtime/pre-upgrade-events.ts'),
    'utf8',
  );
  expect(source).not.toContain("from './program-kernel.ts'");
  expect(source).toContain('raiseFrameworkError');
  // The message text and the code are still the ones the caller observes.
  expect(source).toContain('ClaimErrorCode.PRE_UPGRADE_EVENTS_INVALID');
  expect(source).toContain(
    '[compiled-hydration] preUpgradeEvents: expected an event array or capture object',
  );
});

test('the subpath is registered as a package export and is not a side-effect path', () => {
  const manifest = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8')) as {
    exports?: Record<string, string>;
    sideEffects?: string[];
  };
  expect(manifest.exports?.['./document-services']).toBe('./src/document-services.ts');
  // Negative pin: flagging the module in `sideEffects` would make every
  // importer evaluate it and defeat "the entry CALLS the installers".
  expect(manifest.sideEffects ?? []).not.toContain('./src/document-services.ts');
});
