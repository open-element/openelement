/**
 * #1276 (B1.3-F1): definePage route SSR tag-mismatch repair.
 *
 * The route→program tag binding follows the element's declared tag — the
 * compiled Part Program is the one canonical source. The route FILE name
 * derives the ROUTE (path/fallback wiring), never the element's identity:
 * entry codegen resolves the SSR registration/render tag from the route
 * module's compiled program (`default.__partProgram.tag`) at generated-entry
 * evaluation time, with the path-derived tag kept only as the fallback for
 * classes that carry no compiled program (renderDsd still fails closed on
 * those, exactly as before).
 *
 * Pre-fix, definePage routes registered/rendered under the bare path-derived
 * tag, so a page element whose @element tag differed from the file-derived
 * tag (e.g. routes/workspace-records.tsx -> @element('workspace-records-page'))
 * failed closed at REQUEST time: renderDsd tag "workspace-records" does not
 * match the compiled program tag "workspace-records-page" (OE_PROGRAM_MISSING)
 * → HTTP 500. Covered by the request-time and framework-mode fixtures.
 */
import { expect, test } from 'vitest';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';
import {
  resolveCompiledPageTag,
  resolveLitPageTag,
} from '../src/vite/internal/server-runtime/renderer-runtime.ts';
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

const RESOLUTION_EXPR = '__resolvePageTag($pageWorkspaceRecords, "workspace-records")';

test('renderEntry: definePage route registers through the compiled-program tag resolution (#1276)', () => {
  const code = renderEntry(buildEntryDescriptor(definePageRoutes));

  // Registration resolves the tag from the route module's compiled program;
  // the path-derived tag survives only as the resolver's fallback argument.
  expect(code).toContain(
    `__registerSsrComponent(${RESOLUTION_EXPR}, $pageWorkspaceRecords.default)`,
  );
});

test('renderEntry: definePage route handler renders through the compiled-program tag resolution (#1276)', () => {
  const code = renderEntry(buildEntryDescriptor(definePageRoutes));

  expect(code).toContain(`let __tag = ${RESOLUTION_EXPR}`);
});

test('renderEntry: SSG routeInfo resolves the tag from the compiled program (#1276)', () => {
  const code = renderEntry(buildEntryDescriptor(definePageRoutes, { ssg: true }));

  expect(code).toContain(`tagName: ${RESOLUTION_EXPR},`);
});

test('renderEntry: styled 404 route renders through the compiled-program tag resolution (#1276)', () => {
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

  expect(code).toContain('let __tag = __resolvePageTag($pageNotFound, "el-404");');
});

// The generated entry imports the resolvers from
// @openelement/router/server-runtime and binds them per the renderer adapter
// (ADR-0160 rule a); the assertions below execute the shipped module directly.
test('resolveCompiledPageTag: compiled program tag wins over the path-derived fallback (#1276)', () => {
  // The definePage route module default-exports the compiled page class
  // (definePage returns the class), whose __partProgram.tag is the @element
  // tag — this is the mismatch shape from the B1.3 qualification.
  const routeModule = { default: { __partProgram: { tag: 'workspace-records-page' } } };
  expect(resolveCompiledPageTag(routeModule, 'workspace-records')).toEqual(
    'workspace-records-page',
  );
});

test('resolveCompiledPageTag: matching program and fallback tags resolve identically', () => {
  const routeModule = { default: { __partProgram: { tag: 'login' } } };
  expect(resolveCompiledPageTag(routeModule, 'login')).toEqual('login');
});

test('resolveCompiledPageTag: no compiled program keeps the path-derived fallback (#1276)', () => {
  expect(resolveCompiledPageTag({ default: class {} }, 'workspace-records')).toEqual(
    'workspace-records',
  );
  expect(resolveCompiledPageTag({ default: undefined }, 'workspace-records')).toEqual(
    'workspace-records',
  );
  expect(resolveCompiledPageTag(undefined, 'workspace-records')).toEqual('workspace-records');
});

test('resolveCompiledPageTag: malformed program tags keep the path-derived fallback (#1276)', () => {
  // Not a custom-element tag (no hyphen) or not a string at all: never let a
  // malformed program tag reach the registration/render call sites.
  expect(
    resolveCompiledPageTag({ default: { __partProgram: { tag: 'nohyphen' } } }, 'x-page'),
  ).toEqual('x-page');
  expect(resolveCompiledPageTag({ default: { __partProgram: { tag: 42 } } }, 'x-page')).toEqual(
    'x-page',
  );
});

test('resolveLitPageTag: the openElementPageTag static wins over the fallback (#1339)', () => {
  const routeModule = { default: { openElementPageTag: 'lit-notes-page' } };
  expect(resolveLitPageTag(routeModule, 'notes')).toEqual('lit-notes-page');
  expect(resolveLitPageTag({ default: { openElementPageTag: 'notes' } }, 'notes')).toEqual('notes');
  expect(resolveLitPageTag({ default: { openElementPageTag: 7 } }, 'notes')).toEqual('notes');
  expect(resolveLitPageTag({ default: class {} }, 'notes')).toEqual('notes');
  expect(resolveLitPageTag(undefined, 'notes')).toEqual('notes');
});

test('the generated entry imports the tag resolvers per renderer and never forks the call sites', () => {
  const nativeEntry = renderEntry(buildEntryDescriptor(definePageRoutes));
  expect(nativeEntry).toContain(
    "import { resolveCompiledPageTag as __resolvePageTag } from '@openelement/router/server-runtime'",
  );
  expect(nativeEntry.includes('resolveLitPageTag')).toEqual(false);

  const litEntry = renderEntry(
    buildEntryDescriptor(definePageRoutes, { renderer: 'lit', appShell: false }),
  );
  expect(litEntry).toContain(
    "import { resolveLitPageTag as __resolvePageTag } from '@openelement/router/server-runtime'",
  );
  expect(litEntry.includes('resolveCompiledPageTag')).toEqual(false);
  // The binding call sites (registration, handler, routeInfo) stay renderer-
  // neutral: one canonical `__resolvePageTag(module, fallback)` expression.
  expect(litEntry).toContain(`let __tag = ${RESOLUTION_EXPR}`);
});
