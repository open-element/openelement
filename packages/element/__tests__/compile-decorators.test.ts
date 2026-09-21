/**
 * packages/element — #1209 (A10.1) dual-use contract for the canonical
 * compile-time-only decorator intrinsics.
 *
 * `element`/`property` are admitted by the compiler through binding
 * provenance (a runtime named import from '@openelement/element') and are
 * erased from generated code. At runtime they are inert no-ops so modules
 * evaluated WITHOUT the compiler (unit tests, config evaluation) still
 * instantiate safely.
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { element, property } from '../src/index.ts';

Deno.test('compile-time intrinsics: element/property are exported runtime no-ops', () => {
  assertEquals(typeof element, 'function');
  assertEquals(typeof property, 'function');
  // Applying them the way decorator evaluation would returns inert closures
  // that leave the target untouched and return nothing.
  const classDecorator = element('oe-noop', { root: 'shadow-open' });
  assertEquals(typeof classDecorator, 'function');
  class target {}
  assertEquals(classDecorator(target), undefined);
  const fieldDecorator = property({ reflect: true, attribute: 'x', type: String });
  assertEquals(typeof fieldDecorator, 'function');
  assertEquals(fieldDecorator(undefined, {}), undefined);
});

Deno.test('compile-time intrinsics: a decorated uncompiled class evaluates safely', () => {
  // Mirrors uncompiled consumption: decorators apply as no-ops, the class
  // body defines, and nothing records runtime semantics.
  @element('oe-uncompiled-dual-use')
  class DualUse {
    @property({ reflect: false })
    count = 0;
  }
  const instance = new DualUse();
  assertEquals(instance.count, 0);
  assert(
    !('__partProgram' in DualUse),
    'the no-op decorator must not masquerade as the compiler (no program statics)',
  );
});

Deno.test('compile-time intrinsics: the entries stay re-export seams and the contract is @experimental', async () => {
  // #1416: the export list moved to public-surface.ts so the default entry and
  // the claim-free client-only entry cannot drift apart. Both entries are
  // still pure re-export seams, and the intrinsic's contract still lives
  // beside the name it documents.
  for (const entry of ['index.ts', 'client-only.ts']) {
    const source = await Deno.readTextFile(new URL(`../src/${entry}`, import.meta.url));
    assertStringIncludes(source, "export * from './public-surface.ts';");
  }
  const surface = await Deno.readTextFile(new URL('../src/public-surface.ts', import.meta.url));
  assertStringIncludes(surface, "export { element, property } from './public-runtime.ts';");
  assertStringIncludes(surface, '@experimental');
  const runtime = await Deno.readTextFile(new URL('../src/public-runtime.ts', import.meta.url));
  assertStringIncludes(
    runtime,
    "export { element, property } from './internal/core/compile-decorators.ts';",
  );
});
