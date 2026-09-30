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
import { assertEquals, assertStringIncludes } from '@std/assert';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';
import {
  resolveCompiledPageTag,
  resolveLitPageTag,
} from '../src/vite/internal/server-runtime/renderer-runtime.ts';
import type { RouteEntry } from '../src/vite/internal/protocol/framework.ts';

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

Deno.test('renderEntry: definePage route registers through the compiled-program tag resolution (#1276)', () => {
  const code = renderEntry(buildEntryDescriptor(definePageRoutes));

  // Registration resolves the tag from the route module's compiled program;
  // the path-derived tag survives only as the resolver's fallback argument.
  assertStringIncludes(
    code,
    `__registerSsrComponent(${RESOLUTION_EXPR}, $pageWorkspaceRecords.default)`,
  );
});

Deno.test('renderEntry: definePage route handler renders through the compiled-program tag resolution (#1276)', () => {
  const code = renderEntry(buildEntryDescriptor(definePageRoutes));

  assertStringIncludes(code, `let __tag = ${RESOLUTION_EXPR}`);
});

Deno.test('renderEntry: SSG routeInfo resolves the tag from the compiled program (#1276)', () => {
  const code = renderEntry(buildEntryDescriptor(definePageRoutes, { ssg: true }));

  assertStringIncludes(code, `tagName: ${RESOLUTION_EXPR},`);
});

Deno.test('renderEntry: styled 404 route renders through the compiled-program tag resolution (#1276)', () => {
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

  assertStringIncludes(code, 'let __tag = __resolvePageTag($pageNotFound, "el-404");');
});

// The generated entry imports the resolvers from
// @openelement/router/server-runtime and binds them per the renderer adapter
// (ADR-0160 rule a); the assertions below execute the shipped module directly.
Deno.test('resolveCompiledPageTag: compiled program tag wins over the path-derived fallback (#1276)', () => {
  // The definePage route module default-exports the compiled page class
  // (definePage returns the class), whose __partProgram.tag is the @element
  // tag — this is the mismatch shape from the B1.3 qualification.
  const routeModule = { default: { __partProgram: { tag: 'workspace-records-page' } } };
  assertEquals(resolveCompiledPageTag(routeModule, 'workspace-records'), 'workspace-records-page');
});

Deno.test('resolveCompiledPageTag: matching program and fallback tags resolve identically', () => {
  const routeModule = { default: { __partProgram: { tag: 'login' } } };
  assertEquals(resolveCompiledPageTag(routeModule, 'login'), 'login');
});

Deno.test('resolveCompiledPageTag: no compiled program keeps the path-derived fallback (#1276)', () => {
  assertEquals(
    resolveCompiledPageTag({ default: class {} }, 'workspace-records'),
    'workspace-records',
  );
  assertEquals(
    resolveCompiledPageTag({ default: undefined }, 'workspace-records'),
    'workspace-records',
  );
  assertEquals(resolveCompiledPageTag(undefined, 'workspace-records'), 'workspace-records');
});

Deno.test('resolveCompiledPageTag: malformed program tags keep the path-derived fallback (#1276)', () => {
  // Not a custom-element tag (no hyphen) or not a string at all: never let a
  // malformed program tag reach the registration/render call sites.
  assertEquals(
    resolveCompiledPageTag({ default: { __partProgram: { tag: 'nohyphen' } } }, 'x-page'),
    'x-page',
  );
  assertEquals(
    resolveCompiledPageTag({ default: { __partProgram: { tag: 42 } } }, 'x-page'),
    'x-page',
  );
});

Deno.test('resolveLitPageTag: the openElementPageTag static wins over the fallback (#1339)', () => {
  const routeModule = { default: { openElementPageTag: 'lit-notes-page' } };
  assertEquals(resolveLitPageTag(routeModule, 'notes'), 'lit-notes-page');
  assertEquals(resolveLitPageTag({ default: { openElementPageTag: 'notes' } }, 'notes'), 'notes');
  assertEquals(resolveLitPageTag({ default: { openElementPageTag: 7 } }, 'notes'), 'notes');
  assertEquals(resolveLitPageTag({ default: class {} }, 'notes'), 'notes');
  assertEquals(resolveLitPageTag(undefined, 'notes'), 'notes');
});

Deno.test('the generated entry imports the tag resolvers per renderer and never forks the call sites', () => {
  const nativeEntry = renderEntry(buildEntryDescriptor(definePageRoutes));
  assertStringIncludes(
    nativeEntry,
    "import { resolveCompiledPageTag as __resolvePageTag } from '@openelement/router/server-runtime'",
  );
  assertEquals(nativeEntry.includes('resolveLitPageTag'), false);

  const litEntry = renderEntry(
    buildEntryDescriptor(definePageRoutes, { renderer: 'lit', appShell: false }),
  );
  assertStringIncludes(
    litEntry,
    "import { resolveLitPageTag as __resolvePageTag } from '@openelement/router/server-runtime'",
  );
  assertEquals(litEntry.includes('resolveCompiledPageTag'), false);
  // The binding call sites (registration, handler, routeInfo) stay renderer-
  // neutral: one canonical `__resolvePageTag(module, fallback)` expression.
  assertStringIncludes(litEntry, `let __tag = ${RESOLUTION_EXPR}`);
});
