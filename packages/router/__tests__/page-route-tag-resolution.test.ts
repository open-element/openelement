/**
 * #1276 (B1.3-F1), re-anchored on C08 (2026-11-24): definePage route tag
 * binding.
 *
 * The route→element tag binding follows the element's declared identity. When
 * the class lane existed, that identity arrived at RUNTIME through the
 * compiled Part Program (`default.__partProgram.tag`) because a definePage
 * route module default-exported a compiled class; the entry called
 * `__resolvePageTag(module, pathTag)` and the program tag won.
 *
 * C08 retired that runtime read with the class compiler: the tag is now a
 * BUILD fact for every page kind the lane emits — a generated element page
 * takes the island scan's tag, a server function page takes the path-derived
 * tag (it has no element of its own) — and the emitted entry evaluates a
 * literal. The behaviour the #1276 repair existed for is preserved by
 * construction: no runtime negotiation can disagree with the module the
 * builder emitted under.
 *
 * The rows below pin exactly that: every emitted consumer (SSR registration,
 * the page handler, the SSG routeInfo, the styled 404) carries the literal,
 * the runtime seam exports no program-tag resolver, and the adapter's import
 * list no longer names one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';
import * as serverRuntime from '../src/vite/internal/server-runtime/mod.ts';
import type { RouteEntry } from '@openelement/protocol/framework';

const definePageRoutes: RouteEntry[] = [
  {
    path: '/workspace-records',
    filePath: 'workspace-records.tsx',
    type: 'page',
    varName: 'pageWorkspaceRecords',
    definePage: true,
  },
];

/** The C08 build fact the emitted consumers read: a literal, never a resolver call. */
const TAG_LITERAL = '"workspace-records"';

test('renderEntry: definePage route registration carries the tag literal (C08)', () => {
  const code = renderEntry(buildEntryDescriptor(definePageRoutes));

  expect(code).toContain(`__registerSsrComponent(${TAG_LITERAL}, $pageWorkspaceRecords.default)`);
  // The runtime program read is gone: no emitted consumer calls a resolver.
  expect(code).not.toContain('__resolvePageTag');
});

test('renderEntry: definePage route handler renders the tag literal (C08)', () => {
  const code = renderEntry(buildEntryDescriptor(definePageRoutes));

  expect(code).toContain(`let __tag = ${TAG_LITERAL}`);
  expect(code).not.toContain('__resolvePageTag');
});

test('renderEntry: SSG routeInfo carries the tag literal (C08)', () => {
  const code = renderEntry(buildEntryDescriptor(definePageRoutes, { ssg: true }));

  expect(code).toContain(`tagName: ${TAG_LITERAL},`);
  expect(code).not.toContain('__resolvePageTag');
});

test('renderEntry: styled 404 route renders the tag literal (C08)', () => {
  const routes: RouteEntry[] = [
    ...definePageRoutes,
    {
      path: '/404',
      filePath: '404.tsx',
      type: 'page',
      varName: 'pageNotFound',
      definePage: true,
    },
  ];
  const code = renderEntry(buildEntryDescriptor(routes));

  expect(code).toContain('let __tag = "el-404";');
  expect(code).not.toContain('__resolvePageTag');
});

test('the runtime seam no longer exports a program-tag resolver (C08 negative)', () => {
  expect('resolveCompiledPageTag' in serverRuntime).toBe(false);
});

test('the renderer adapter imports no program-tag resolver (C08 negative)', () => {
  const adapter = readFileSync(
    join(import.meta.dirname, '../src/vite/internal/ssg/renderer-adapter.ts'),
    'utf8',
  );
  expect(adapter).not.toContain('resolveCompiledPageTag');
  expect(adapter).not.toContain('__resolvePageTag');
});

test('the emitted entry declares no stream machinery (C09/C10 negative)', () => {
  const code = renderEntry(buildEntryDescriptor(definePageRoutes));

  expect(code).not.toContain('__assertStreamRoute');
  expect(code).not.toContain('__streamManifests');
  expect(code).not.toContain('__createStreamPageShell');
});
