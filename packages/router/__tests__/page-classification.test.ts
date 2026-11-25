/**
 * M11-1 — build-time page-kind classification (M01 C07 retirement).
 *
 * The page classification question ("is this route a compiled class page, a
 * server function page, or a generated-element page?") is answered at BUILD
 * time from the compiler-owned module facts the route scan already records —
 * never from a runtime module-shape property read. These rows pin:
 *
 * 1. the authoring discriminant after the `__partProgram` presence arm was
 *    removed: an ES class is a class page, and a function is a function page
 *    even when it carries a program-shaped property (the retired C07 form);
 * 2. the scan-side facts and the two reachable kinds (class page, function
 *    page) plus the class-only byte identity of the generated entries;
 * 3. the additive-fact rows: an undecidable fact (inline `definePage`
 *    argument, a name the scan cannot resolve, a local function the server
 *    lane declined) falls back to the legacy class-page answer instead of
 *    narrowing a known-legal authoring spelling; the genuinely ambiguous row
 *    (two owning lanes) still fails closed;
 * 4. the third kind: a page component owned by the generated-element lane is
 *    CLASSIFIED and refused with a coded build error — it is never silently
 *    treated as a class page, and this slice does not claim render support.
 *
 * All rows run against the real scanner and the real descriptor/codegen; the
 * ambiguous/generated-element rows are asserted at the descriptor boundary,
 * which is where route/page generation consumes the fact.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { IslandDecl } from '@openelement/protocol/ssg';
import type { RouteEntry } from '@openelement/protocol/framework';
import { definePage } from '../src/index.ts';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { renderEntry } from '../src/vite/internal/ssg/entry-orchestrator.ts';
import { renderSsgSection } from '../src/vite/internal/ssg/entry-render-ssg.ts';
import { scanRoutes } from '../src/vite/internal/ssg/route-scanner.ts';
import {
  PageClassificationCode,
  classifyPageModule,
  buildPageModuleFacts,
  readPageKind,
  readPageModuleFacts,
  resolvePageKind,
  type PageClassificationContext,
  type PageKindCarrier,
  type PageModuleFacts,
} from '../src/vite/internal/ssg/page-classification.ts';
import { DescriptorErrorCode } from '../src/internal/error-codes.ts';
import type { GeneratedElementHostCarrier } from '../src/vite/internal/ssg/generated-element-host-metadata.ts';

/** The code one call raised (throw form). */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    throw error;
  }
  throw new Error('the call returned; a coded rejection was expected');
}

/** The message one call raised (throw form). */
function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return String((error as { message?: unknown }).message);
  }
  throw new Error('the call returned; a coded rejection was expected');
}

// ─── 1. Authoring discriminant: ES class syntax only, no ABI field ──────────

/** A minimal compiled page class (real ES class + the compiled program statics). */
function makeCompiledPageClass(tag: string): CustomElementConstructor {
  const program = { version: 2, tag };
  class CompiledPage {
    render() {}
  }
  Object.defineProperty(CompiledPage, '__partProgram', {
    value: program,
    writable: true,
    configurable: true,
  });
  return CompiledPage as unknown as CustomElementConstructor;
}

test('a compiled page class (real ES class) takes the class descriptor branch', () => {
  const Page = makeCompiledPageClass('compiled-page');
  definePage(Page);
  const descriptor = (Page as unknown as { openElementPage: Record<string, unknown> })
    .openElementPage;
  expect(descriptor.kind).toEqual('page');
  expect(descriptor.render).toEqual(undefined);
});

test('a plain ES class with no compiled program keeps the class branch (existing contract)', () => {
  class HandwrittenPage {}
  definePage(HandwrittenPage as unknown as CustomElementConstructor);
  const descriptor = (HandwrittenPage as unknown as { openElementPage: Record<string, unknown> })
    .openElementPage;
  expect(descriptor.kind).toEqual('page');
});

test('NEGATIVE: a function carrying a __partProgram-shaped property is a function page', () => {
  // The retired M01 C07 form read this property to classify the page. A
  // function is not an ES class, so the shape is a server function page — the
  // property presence must not turn a function into a class page.
  const render = (props: Record<string, unknown>) => `<p>${String(props.title ?? '')}</p>`;
  Object.defineProperty(render, '__partProgram', {
    value: { version: 2, tag: 'not-a-class' },
    writable: true,
    configurable: true,
  });
  const page = definePage(render as unknown as never);
  const descriptor = (page as unknown as { openElementPage: Record<string, unknown> })
    .openElementPage;
  expect(descriptor.kind).toEqual('function-page');
  expect(descriptor.render).toEqual(render);
});

test('NEGATIVE: an arrow function with no program stays a function page', () => {
  const render = (props: Record<string, unknown>) => String(props.title ?? '');
  const page = definePage(render as unknown as never);
  const descriptor = (page as unknown as { openElementPage: Record<string, unknown> })
    .openElementPage;
  expect(descriptor.kind).toEqual('function-page');
});

// ─── 2. Scan-side build facts and the two reachable page kinds ──────────────

async function scanOneRoute(fileName: string, source: string) {
  const dir = await mkdtemp(join(tmpdir(), 'oe-page-classification-'));
  await writeFile(join(dir, fileName), source, 'utf8');
  const routes = await scanRoutes(dir);
  expect(routes).toHaveLength(1);
  return { dir, route: routes[0] };
}

const CLASS_PAGE_ROUTE = [
  "import { definePage } from '@openelement/router';",
  "import { AboutPage } from '../components/about-page.tsx';",
  'export default definePage(AboutPage, { head: { title: "About" } });',
].join('\n');

const FUNCTION_PAGE_ROUTE = [
  "import { definePage } from '@openelement/router';",
  'export function AboutPage(props: { title: string }) {',
  '  return <main><h1>{props.title}</h1></main>;',
  '}',
  'export default definePage(AboutPage, { head: { title: "About" } });',
].join('\n');

test('the scan records the class-page facts: imported page component, no function-page fact', async () => {
  const { route } = await scanOneRoute('about.tsx', CLASS_PAGE_ROUTE);
  const facts = readPageModuleFacts(route);
  expect(facts).toMatchObject({
    definePage: true,
    mdx: false,
    compiledElement: false,
    functionPage: undefined,
    pageArgument: { kind: 'import', name: 'AboutPage', specifier: '../components/about-page.tsx' },
  });
});

test('the scan records the function-page facts: local admitted component + argument shape', async () => {
  const { route } = await scanOneRoute('about.tsx', FUNCTION_PAGE_ROUTE);
  const facts = readPageModuleFacts(route);
  expect(facts?.functionPage).toEqual('AboutPage');
  expect(facts?.pageArgument).toEqual({ kind: 'local', name: 'AboutPage', binding: 'function' });
});

test('a .mdx route is a class page: the router generates its compiled class module', () => {
  const facts = buildPageModuleFacts({
    source: '# Hello',
    filePath: 'about.mdx',
    definePage: true,
    compiledElement: false,
    functionPage: undefined,
  });
  expect(facts.mdx).toEqual(true);
  expect(facts.pageArgument).toEqual(undefined);
  const classification = classifyPageModule(facts);
  expect(classification).toMatchObject({ kind: 'classified', pageKind: 'class-page' });
});

test('buildEntryDescriptor classifies a class page and carries the build fact', async () => {
  const { route } = await scanOneRoute('about.tsx', CLASS_PAGE_ROUTE);
  const desc = buildEntryDescriptor([route], { routesDir: 'app/routes', ssg: true });
  expect(readPageKind(desc.pageRoutes[0])).toEqual('class-page');
  // The fact is build-only metadata: a class-only project's generated bytes
  // never carry it (the public protocol type is unchanged — typecheck-level
  // evidence, pinned by the byte-identity row below).
  // The SSG routeInfo carries no page-kind fact for a class page.
  expect(renderSsgSection(desc)).not.toContain('pageKind');
});

test('buildEntryDescriptor classifies a function page from the same build fact', async () => {
  const { route } = await scanOneRoute('about.tsx', FUNCTION_PAGE_ROUTE);
  const desc = buildEntryDescriptor([route], { routesDir: 'app/routes', ssg: true });
  expect(readPageKind(desc.pageRoutes[0])).toEqual('function-page');
  const ssg = renderSsgSection(desc);
  expect(ssg).toContain(', pageKind: "function-page" }');
  expect(ssg).toContain('if (info.pageKind === "function-page")');
});

// ─── 3. Class-only generated bytes stay byte-identical ──────────────────────

test('class-only generated entry bytes are unchanged by the build-time fact', () => {
  const handBuilt: RouteEntry = {
    path: '/',
    filePath: 'index.tsx',
    type: 'page',
    varName: 'pageIndex',
    definePage: true,
  };
  const withFacts = {
    ...handBuilt,
    pageModule: {
      definePage: true,
      mdx: false,
      compiledElement: false,
      functionPage: undefined,
      pageArgument: { kind: 'import', name: 'Home', specifier: '../components/home.tsx' },
    } satisfies PageModuleFacts,
  } as RouteEntry;

  const legacyEntry = renderEntry(buildEntryDescriptor([handBuilt], { ssg: true }));
  const classifiedEntry = renderEntry(buildEntryDescriptor([withFacts], { ssg: true }));

  expect(classifiedEntry).toEqual(legacyEntry);
  // No runtime page classification of any form remains in the generated entry.
  expect(legacyEntry).not.toContain('page.kind');
  expect(legacyEntry).not.toContain('__partProgram');
  expect(legacyEntry).not.toContain('pageKind');
});

test('the mixed entry forks on the build-time routeInfo fact, not the descriptor kind', () => {
  const classRoute: RouteEntry = {
    path: '/',
    filePath: 'index.tsx',
    type: 'page',
    varName: 'pageIndex',
    definePage: true,
  };
  const functionRoute: RouteEntry = {
    path: '/about',
    filePath: 'about.tsx',
    type: 'page',
    varName: 'pageAbout',
    definePage: true,
    functionPage: 'AboutPage',
  };
  const entry = renderEntry(buildEntryDescriptor([classRoute, functionRoute], { ssg: true }));

  // Exactly one non-class route carries the fact; the class page does not.
  expect(entry.match(/pageKind: "function-page"/g)).toHaveLength(1);
  expect(entry).toContain('if (info.pageKind === "function-page")');
  expect(entry).not.toContain('page.kind ===');
});

// ─── 4. Fail-closed ambiguity rows ──────────────────────────────────────────

test('an inline-arrow definePage argument keeps the legacy class-page answer (no narrowing)', async () => {
  const { route } = await scanOneRoute(
    'about.tsx',
    [
      "import { definePage } from '@openelement/router';",
      'export default definePage((props) => <main>{props.title}</main>);',
    ].join('\n'),
  );
  // The scan records the shape; the classifier does not invent a refusal for
  // a spelling the pre-M11 build accepted.
  expect(readPageModuleFacts(route)?.pageArgument).toMatchObject({ kind: 'inline' });
  const desc = buildEntryDescriptor([route], { routesDir: 'app/routes' });
  expect(readPageKind(desc.pageRoutes[0])).toEqual('class-page');
});

test('a module-local function the server lane did not admit keeps the legacy class-page answer', async () => {
  const { route } = await scanOneRoute(
    'about.tsx',
    [
      "import { definePage } from '@openelement/router';",
      'function Local(props: { title: string }) { return <main>{props.title}</main>; }',
      'export default definePage(Local);',
    ].join('\n'),
  );
  expect(readPageModuleFacts(route)?.pageArgument).toMatchObject({ kind: 'local' });
  const desc = buildEntryDescriptor([route], { routesDir: 'app/routes' });
  expect(readPageKind(desc.pageRoutes[0])).toEqual('class-page');
});

test('a definePage argument name the module cannot resolve keeps the legacy class-page answer', async () => {
  const { route } = await scanOneRoute(
    'about.tsx',
    [
      "import { definePage } from '@openelement/router';",
      'export default definePage(UndefinedPage);',
    ].join('\n'),
  );
  expect(readPageModuleFacts(route)?.pageArgument).toMatchObject({ kind: 'unresolved' });
  const desc = buildEntryDescriptor([route], { routesDir: 'app/routes' });
  expect(readPageKind(desc.pageRoutes[0])).toEqual('class-page');
});

test('NEGATIVE: two owning lanes (compiled-element decorator + server function page) fail closed', async () => {
  const { route } = await scanOneRoute(
    'about.tsx',
    [
      "import { element, OpenElement } from '@openelement/element';",
      "import { definePage } from '@openelement/router';",
      'export function AboutPage(props: { title: string }) {',
      '  return <main>{props.title}</main>;',
      '}',
      "@element('about-page', { root: 'light' })",
      'class AboutElement extends OpenElement {}',
      'export default definePage(AboutPage);',
    ].join('\n'),
  );
  const facts = readPageModuleFacts(route);
  expect(facts?.compiledElement).toEqual(true);
  expect(facts?.functionPage).toEqual('AboutPage');
  expect(codedBuildFailure([route])).toEqual(PageClassificationCode.AMBIGUOUS_PAGE_MODULE);
  expect(codedBuildFailureMessage([route])).toContain('more than one page-owning lane');
});

function codedBuildFailure(routes: RouteEntry[]): string {
  return codeOf(() => buildEntryDescriptor(routes, { routesDir: 'app/routes' }));
}

function codedBuildFailureMessage(routes: RouteEntry[]): string {
  return messageOf(() => buildEntryDescriptor(routes, { routesDir: 'app/routes' }));
}

// ─── 5. The third kind: generated-element page (classified, refused) ────────

const GENERATED_PAGE_ROUTE = [
  "import { definePage } from '@openelement/router';",
  "import ProfileCard from '../islands/profile-card.tsx';",
  'export default definePage(ProfileCard, { head: { title: "Profile" } });',
].join('\n');

type ScannedIslandMeta = Record<string, Partial<IslandDecl> & GeneratedElementHostCarrier>;

function islandOptions(islandMeta: Partial<IslandDecl> & GeneratedElementHostCarrier) {
  return {
    routesDir: 'app/routes',
    islandsDir: 'app/islands',
    islandTagNames: ['profile-card'],
    islandFiles: ['profile-card.tsx'],
    islandMeta: { 'profile-card': islandMeta } as ScannedIslandMeta,
  };
}

test('a producer generated-element page is classified with the compiler tag fact (M11-2)', async () => {
  const { route } = await scanOneRoute('about.tsx', GENERATED_PAGE_ROUTE);
  const options = islandOptions({
    ssr: true,
    generatedElementHost: {
      kind: 'producer',
      component: 'ProfileCard',
      ssrHostExport: 'ProfileCard__ssrHost',
    },
  });
  const desc = buildEntryDescriptor([route], options);
  const decl = desc.pageRoutes[0] as PageRouteDecl & PageKindCarrier;
  expect(readPageKind(decl)).toEqual('generated-element-page');
  // The page tag is the island scan's tag (also the emitted class/host tag).
  expect(decl.tagName).toEqual('profile-card');
  expect(decl.defaultTagName).toEqual('profile-card');
  expect(decl.generatedElementPage).toEqual({
    tagName: 'profile-card',
    identity: {
      kind: 'producer',
      component: 'ProfileCard',
      ssrHostExport: 'ProfileCard__ssrHost',
    },
  });
  // The page route is registered by the island loop (host pairing), never by
  // the page-class loop; the entry literates the build-fact tag.
  const entry = renderEntry(desc);
  expect(entry).toContain('__registerSsrIsland("profile-card"');
  expect(entry).not.toContain('__registerSsrComponent("profile-card"');
  expect(entry).not.toContain('__resolvePageTag($pageAbout');
});

test('a named import alias resolves the generated page under its local binding', async () => {
  const { route } = await scanOneRoute(
    'about.tsx',
    [
      "import { definePage } from '@openelement/router';",
      "import { ProfileCard as RoutePage } from '../islands/profile-card.tsx';",
      'export default definePage(RoutePage);',
    ].join('\n'),
  );
  const descriptor = buildEntryDescriptor(
    [route],
    islandOptions({
      ssr: true,
      generatedElementHost: {
        kind: 'producer',
        component: 'ProfileCard',
        ssrHostExport: 'ProfileCard__ssrHost',
      },
    }),
  );
  expect(readPageModuleFacts(route)?.pageArgument).toEqual({
    kind: 'import',
    name: 'RoutePage',
    specifier: '../islands/profile-card.tsx',
  });
  expect(readPageKind(descriptor.pageRoutes[0])).toEqual('generated-element-page');
});

test('a renamed import cannot claim a same-named local server page', async () => {
  const { route } = await scanOneRoute(
    'about.tsx',
    [
      "import { definePage } from '@openelement/router';",
      "import { ProfileCard as Widget } from '../islands/profile-card.tsx';",
      'export function ProfileCard() { return <main><Widget /></main>; }',
      'export default definePage(ProfileCard);',
    ].join('\n'),
  );
  const descriptor = buildEntryDescriptor(
    [route],
    islandOptions({
      ssr: true,
      generatedElementHost: {
        kind: 'producer',
        component: 'ProfileCard',
        ssrHostExport: 'ProfileCard__ssrHost',
      },
    }),
  );
  expect(readPageModuleFacts(route)?.pageArgument).toEqual({
    kind: 'local',
    name: 'ProfileCard',
    binding: 'function',
  });
  expect(readPageKind(descriptor.pageRoutes[0])).toEqual('function-page');
});

test('a light-root generated page has no host producer and fails closed precisely', async () => {
  const { route } = await scanOneRoute('about.tsx', GENERATED_PAGE_ROUTE);
  const code = codeOf(() =>
    buildEntryDescriptor(
      [route],
      islandOptions({
        ssr: true,
        generatedElementHost: { kind: 'light-no-producer', component: 'ProfileCard' },
      }),
    ),
  );
  expect(code).toEqual(PageClassificationCode.GENERATED_ELEMENT_PAGE_UNSUPPORTED);
  const message = messageOf(() =>
    buildEntryDescriptor(
      [route],
      islandOptions({
        ssr: true,
        generatedElementHost: { kind: 'light-no-producer', component: 'ProfileCard' },
      }),
    ),
  );
  expect(message).toContain('<profile-card>');
  expect(message).toContain('the component root is light');
  // Not hidden behind ssr:false: a page root never silently downgrades.
  expect(message).toContain('no DSD host producer');
});

test('a generated page whose island is not SSR-admitted fails closed (no silent downgrade)', async () => {
  const { route } = await scanOneRoute('about.tsx', GENERATED_PAGE_ROUTE);
  const code = codeOf(() =>
    buildEntryDescriptor(
      [route],
      islandOptions({
        ssr: false,
        generatedElementHost: {
          kind: 'producer',
          component: 'ProfileCard',
          ssrHostExport: 'ProfileCard__ssrHost',
        },
      }),
    ),
  );
  expect(code).toEqual(DescriptorErrorCode.MODULE_IMPORT);
});

test('the generated-element page kind is reachable from the pure classifier', () => {
  const facts: PageModuleFacts = {
    definePage: true,
    mdx: false,
    compiledElement: false,
    functionPage: undefined,
    pageArgument: { kind: 'import', name: 'ProfileCard', specifier: '../islands/profile-card.tsx' },
  };
  const context: PageClassificationContext = {
    routesDir: 'app/routes',
    islandsDir: 'app/islands',
    islands: [
      {
        filePath: 'profile-card.tsx',
        tagName: 'profile-card',
        generatedLaneKind: 'producer',
        generatedElementHost: {
          kind: 'producer',
          component: 'ProfileCard',
          ssrHostExport: 'ProfileCard__ssrHost',
        },
      },
    ],
  };
  const route: RouteEntry = {
    path: '/profile',
    filePath: 'profile.tsx',
    type: 'page',
    varName: 'pageProfile',
    definePage: true,
  };
  // A producer page is classified with its compiler tag fact (M11-2).
  const classification = classifyPageModule(facts, context.islands[0]);
  expect(classification).toMatchObject({
    kind: 'classified',
    pageKind: 'generated-element-page',
    generatedElementPage: { tagName: 'profile-card' },
  });
  expect(resolvePageKind({ ...route, pageModule: facts } as RouteEntry, context)).toEqual(
    'generated-element-page',
  );
  // The same lane kind WITHOUT the compiler host identity (a hand-built
  // context) cannot prove a producer and stays a classified-but-unwired refusal.
  expect(
    classifyPageModule(facts, {
      filePath: 'profile-card.tsx',
      tagName: 'profile-card',
      generatedLaneKind: 'producer',
    }).kind,
  ).toEqual('unsupported-generated-page');
});

test('an island that is NOT a generated element (class lane) keeps the class-page path', async () => {
  const { route } = await scanOneRoute(
    'about.tsx',
    [
      "import { definePage } from '@openelement/router';",
      "import ProfileCard from '../islands/profile-card.tsx';",
      'export default definePage(ProfileCard);',
    ].join('\n'),
  );
  const desc = buildEntryDescriptor(
    [route],
    islandOptions({
      generatedElementHost: { kind: 'lane-declined', reason: 'compiler-declined' },
    }),
  );
  expect(readPageKind(desc.pageRoutes[0])).toEqual('class-page');
});

test('a package/alias page component import stays the class-page assumption', async () => {
  const { route } = await scanOneRoute(
    'about.tsx',
    [
      "import { definePage } from '@openelement/router';",
      "import { Page } from '@some/design-system';",
      'export default definePage(Page);',
    ].join('\n'),
  );
  const desc = buildEntryDescriptor([route], { routesDir: 'app/routes' });
  expect(readPageKind(desc.pageRoutes[0])).toEqual('class-page');
});

// ─── 6. The consumer read is stable across both carriers ────────────────────

test('pageKindOf reads the carried fact and falls back to the protocol fact', async () => {
  const { route } = await scanOneRoute('about.tsx', FUNCTION_PAGE_ROUTE);
  const desc = buildEntryDescriptor([route], { routesDir: 'app/routes', ssg: true });
  // Carried fact present.
  expect(readPageKind(desc.pageRoutes[0])).toEqual('function-page');
  // Protocol-only fallback (a hand-built declaration).
  const handBuilt = {
    kind: 'page' as const,
    path: '/',
    varName: '$page',
    filePath: 'index.tsx',
    defaultTagName: 'x-page',
    tagName: 'x-page',
    importPath: '/app/routes/index.tsx',
  };
  expect(readPageKind({ ...handBuilt, functionPage: 'About' })).toBeUndefined();
});

test('a class-only project produces no page-kind code and renders through __ssr unchanged', () => {
  const handBuilt: RouteEntry = {
    path: '/',
    filePath: 'index.tsx',
    type: 'page',
    varName: 'pageIndex',
    definePage: true,
  };
  const entry = renderEntry(buildEntryDescriptor([handBuilt], { ssg: true }));
  expect(entry).toContain('__ssr(');
  expect(entry).not.toContain('__renderFunctionPageAwaited');
});
