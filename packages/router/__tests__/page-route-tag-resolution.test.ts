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
import { renderRuntimeHelpers } from '../src/vite/internal/ssg/entry-render-runtime.ts';
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

interface ResolvePageTagHarness {
  resolvePageTag(routeModule: unknown, fallback: string): string;
}

async function loadHarness(): Promise<ResolvePageTagHarness> {
  const helpers = renderRuntimeHelpers({ default: false, layouts: {} }, []);
  const harness = `
const customElements = { get() { return undefined; } };
const escapeHtml = (value) => String(value);
const __locales = ["en"];
const __getDefaultLocale = () => "en";
const __navSections = [];
const __headerNav = [];
function renderDsd() { return { html: "" }; }
${helpers}
export function resolvePageTag(routeModule, fallback) { return __resolvePageTag(routeModule, fallback); }
`;
  const mod = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(harness));
  return mod as ResolvePageTagHarness;
}

Deno.test('__resolvePageTag: compiled program tag wins over the path-derived fallback (#1276)', async () => {
  const harness = await loadHarness();
  // The definePage route module default-exports the compiled page class
  // (definePage returns the class), whose __partProgram.tag is the @element
  // tag — this is the mismatch shape from the B1.3 qualification.
  const routeModule = { default: { __partProgram: { tag: 'workspace-records-page' } } };
  assertEquals(harness.resolvePageTag(routeModule, 'workspace-records'), 'workspace-records-page');
});

Deno.test('__resolvePageTag: matching program and fallback tags resolve identically', async () => {
  const harness = await loadHarness();
  const routeModule = { default: { __partProgram: { tag: 'login' } } };
  assertEquals(harness.resolvePageTag(routeModule, 'login'), 'login');
});

Deno.test('__resolvePageTag: no compiled program keeps the path-derived fallback (#1276)', async () => {
  const harness = await loadHarness();
  assertEquals(
    harness.resolvePageTag({ default: class {} }, 'workspace-records'),
    'workspace-records',
  );
  assertEquals(
    harness.resolvePageTag({ default: undefined }, 'workspace-records'),
    'workspace-records',
  );
  assertEquals(harness.resolvePageTag(undefined, 'workspace-records'), 'workspace-records');
});

Deno.test('__resolvePageTag: malformed program tags keep the path-derived fallback (#1276)', async () => {
  const harness = await loadHarness();
  // Not a custom-element tag (no hyphen) or not a string at all: never let a
  // malformed program tag reach the registration/render call sites.
  assertEquals(
    harness.resolvePageTag({ default: { __partProgram: { tag: 'nohyphen' } } }, 'x-page'),
    'x-page',
  );
  assertEquals(
    harness.resolvePageTag({ default: { __partProgram: { tag: 42 } } }, 'x-page'),
    'x-page',
  );
});
