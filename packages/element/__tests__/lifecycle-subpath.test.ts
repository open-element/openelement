/**
 * The tree-shakeable lifecycle subpath (A16-LANE-M, M10-P1/P4).
 *
 * `@openelement/element/lifecycle` exists for ONE reason: the lifecycle
 * intrinsics are COMPILER-ERASED, so the authored import survives into the
 * browser graph only to satisfy the compiler's binding-provenance check. The
 * package root entry is flagged in `sideEffects` (it carries the hydration and
 * when/each Block install edges), so an author module importing an intrinsic
 * from the root kept the generic Part Program executor in the client graph for
 * a binding the emitted module never references — the measured M10-P1
 * violation.
 *
 * What is pinned here, all fail-closed:
 *
 * 1. The subpath is a PURE re-export: the module is not in `sideEffects`, has
 *    no module-scope call, and its import list reaches neither
 *    `public-surface.ts` nor any executor entry. A bundler may therefore drop
 *    it entirely once compilation removes the calls.
 * 2. The subpath exports EXACTLY the three intrinsics the compiler admits —
 *    no fourth name, and nothing else from the public surface.
 * 3. The three exported functions are the SAME function objects the root entry
 *    exports (`===`), so the runtime stand-in identity cannot fork: calling an
 *    intrinsic outside the compiler fails closed with the same error class,
 *    code, phase and message from either entry.
 * 4. A module that does NOT use the intrinsics is unaffected: the subpath is
 *    not referenced from any entry's surface re-export, so the root's export
 *    list is byte-identical to the pre-slice tree.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { FacadeErrorCode, OpenElementError } from '../../protocol/src/errors.ts';
import * as rootEntry from '../src/index.ts';
import * as lifecycleEntry from '../src/lifecycle.ts';

const PKG_MANIFEST = new URL('../package.json', import.meta.url);
const LIFECYCLE_SOURCE = new URL('../src/lifecycle.ts', import.meta.url);

/** Every module-scope name the subpath exports, sorted. */
const LIFECYCLE_EXPORTS = Object.keys(lifecycleEntry).sort();

test('the subpath exports exactly the three compiler-erased intrinsics', () => {
  expect(LIFECYCLE_EXPORTS).toEqual(['onConnect', 'onDispose', 'onPropertyChange']);
});

test('the subpath re-exports the SAME function objects as the root entry', () => {
  // Identity, not shape: a second implementation would fork the fail-closed
  // stand-in contract the compiler's erasure depends on documenting.
  expect(lifecycleEntry.onConnect).toBe(rootEntry.onConnect);
  expect(lifecycleEntry.onDispose).toBe(rootEntry.onDispose);
  expect(lifecycleEntry.onPropertyChange).toBe(rootEntry.onPropertyChange);
});

test('calling an intrinsic from the subpath fails closed with the root identity', () => {
  for (const [intrinsic, call] of [
    ['onConnect', () => lifecycleEntry.onConnect(() => undefined)],
    ['onDispose', () => lifecycleEntry.onDispose(() => undefined)],
    ['onPropertyChange', () => lifecycleEntry.onPropertyChange(() => undefined)],
  ] as const) {
    let thrown: unknown;
    try {
      call();
    } catch (error) {
      thrown = error;
    }
    expect(thrown, intrinsic).toBeInstanceOf(OpenElementError);
    expect((thrown as OpenElementError).code, intrinsic).toBe(FacadeErrorCode.JSX_OUTSIDE_COMPILER);
    expect((thrown as OpenElementError).phase, intrinsic).toBe('build');
    expect((thrown as OpenElementError).message, intrinsic).toContain(intrinsic);
    // The message is IDENTICAL to the root spelling's, so an error report
    // cannot tell which entry the author imported.
    const fromRoot = (() => {
      try {
        rootEntry[intrinsic](() => undefined);
      } catch (error) {
        return error as OpenElementError;
      }
      return null;
    })();
    expect(fromRoot?.message, intrinsic).toBe((thrown as OpenElementError).message);
  }
});

test('the subpath is side-effect free and absent from the declared sideEffects list', () => {
  const manifest = JSON.parse(readFileSync(PKG_MANIFEST, 'utf8')) as {
    sideEffects?: string[];
    exports?: Record<string, string>;
  };
  // Registered as a public subpath...
  expect(manifest.exports?.['./lifecycle']).toBe('./src/lifecycle.ts');
  // ...and deliberately NOT a side-effect path: adding one would defeat the
  // whole point (a flagged module is never dropped, so the executor clause
  // would ride into the client graph again). This is a negative pin.
  expect(manifest.sideEffects ?? []).not.toContain('./src/lifecycle.ts');
});

test('the subpath module has no module-scope side effect and no executor path', () => {
  const text = readFileSync(LIFECYCLE_SOURCE, 'utf8');
  // Strip comments so the doc prose cannot satisfy or trip the assertions.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const statements = code
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  // One re-export statement, nothing else executable at module scope.
  expect(statements).toEqual([
    "export { onConnect, onDispose, onPropertyChange } from './internal/core/compile-lifecycle.ts';",
  ]);
  // The dependency is the leaf stand-in module, never the public surface (which
  // pulls OpenElement → the class lane → the executor) and never an
  // artifact-resolution subpath.
  expect(code).not.toContain('public-surface');
  expect(code).not.toContain('open-element');
  expect(code).not.toContain('compiled/runtime');
});
