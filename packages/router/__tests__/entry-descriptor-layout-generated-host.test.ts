/**
 * A generated-element LAYOUT (alpha16 layout-pair slice) — the descriptor
 * carries the compiler's host export and the entry registers the PAIR.
 *
 * A generated element has no Part Program, so registering one class-only makes
 * `renderToString` fail PROGRAM_MISSING on every render of the layout — i.e. on
 * every page. The convention layout has no island declaration to derive a pair
 * from, so the fact must ride the descriptor: the declared-tag scan resolves it
 * from the module's own sidecar (`declaredElementTags` + `declaredElementHostExports`),
 * `buildLayoutPlan` attaches it, and `renderEntry` emits `__registerSsrIsland`.
 *
 * A class layout must keep byte-identical registration — that is the property
 * that makes the slice safe to land.
 */
import { expect, test } from 'vitest';
import type { RouteEntry } from '@openelement/protocol/framework';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';

const routes: RouteEntry[] = [
  { path: '/', filePath: 'index.ts', type: 'page', varName: 'pageIndex' },
];

function descriptorWithLayout(
  declaredTags: ReadonlyMap<string, string>,
  declaredHostExports: ReadonlyMap<string, string>,
) {
  return buildEntryDescriptor(routes, {
    layout: { tagName: 'app-layout', import: './app/layout.tsx', props: {} },
    declaredElementTags: declaredTags,
    declaredElementHostExports: declaredHostExports,
  });
}

test('a generated layout carries the compiler host export into the descriptor', () => {
  const descriptor = descriptorWithLayout(
    new Map([['/app/layout.tsx', 'app-layout']]),
    new Map([['/app/layout.tsx', 'AppLayout__ssrHost']]),
  );
  expect(descriptor.layout.default).toMatchObject({
    tagName: 'app-layout',
    generatedHostExport: 'AppLayout__ssrHost',
  });
});

test('the entry registers a generated layout through the host PAIR channel', () => {
  const descriptor = descriptorWithLayout(
    new Map([['/app/layout.tsx', 'app-layout']]),
    new Map([['/app/layout.tsx', 'AppLayout__ssrHost']]),
  );
  const entry = renderEntry(descriptor);
  // The descriptor normalizes a `./`-relative layout import to a root-anchored
  // path (`/app/layout.tsx`), so both the namespace and the host import use it.
  expect(entry).toContain(
    'import { AppLayout__ssrHost as __layouthost_app_layout } from "/app/layout.tsx"',
  );
  expect(entry).toContain(
    '__registerSsrIsland("app-layout", __layout_0.default, __layouthost_app_layout)',
  );
  // The class-only registration would register a class with no Part Program.
  expect(entry).not.toContain('__registerSsrComponent("app-layout"');
});

test('a layout that is NOT a generated element keeps the class registration bytes', () => {
  const descriptor = descriptorWithLayout(new Map(), new Map());
  expect(descriptor.layout.default).not.toHaveProperty('generatedHostExport');
  const entry = renderEntry(descriptor);
  expect(entry).toContain('__registerSsrComponent("app-layout", __layout_0.default)');
  expect(entry).not.toContain('__registerSsrIsland("app-layout"');
});

test('a declared layout with no host exporter (a LIGHT root) stays on the class path', () => {
  // A light root emits no DSD wrapper, so the scan records its tag but no host
  // export. Absence is the law: the layout keeps class registration rather than
  // pairing against a producer that does not exist.
  const descriptor = descriptorWithLayout(new Map([['/app/layout.tsx', 'app-layout']]), new Map());
  expect(descriptor.layout.default).not.toHaveProperty('generatedHostExport');
  const entry = renderEntry(descriptor);
  expect(entry).toContain('__registerSsrComponent("app-layout", __layout_0.default)');
});
