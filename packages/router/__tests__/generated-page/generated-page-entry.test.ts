/**
 * M11-2 — build/codegen facts for a generated element page (Node).
 *
 * A generated page is authored exactly like a class page: a route module
 * `definePage(<imported local generated island>)`. The build-time classifier
 * proves the island's compiler-owned host producer, records the page tag as a
 * build fact (the island scan's tag — also the emitted class/host tag), and the
 * page route renders through the SAME `__ssr` call site every class page uses.
 * The element runtime resolves the registered host-producer pair at the root
 * (see the element suite); the router never reads `__partProgram` for it.
 *
 * These rows pin the emitted artifact:
 *
 * - the page tag is a literal build fact (no `__resolvePageTag` for this
 *   route) and the SSG routeInfo carries `pageKind: "generated-element-page"`;
 * - the island loop pairs the compiled class + host producer
 *   (`__registerSsrIsland`); the page-class registration loop skips the route
 *   so it cannot clear that pair (ADR-0181 A4);
 * - no stream guard is emitted for the bounded synchronous-SSR lane;
 * - the class/function page artifact bytes are unchanged by the added facts;
 * - task12's build-only route → document stylesheet facts emit ONE literal
 *   data channel + per-render seeds only when present (empty = no line).
 */

import { describe, expect, test } from 'vitest';
import type { IslandDecl, PageRouteDecl } from '@openelement/protocol/ssg';
import type { RouteEntry } from '@openelement/protocol/framework';
import { buildEntryDescriptor } from '../../src/vite/internal/ssg/entry-descriptor.ts';
import { renderEntry } from '../../src/vite/internal/ssg/entry-orchestrator.ts';
import type { PageKindCarrier } from '../../src/vite/internal/ssg/page-classification.ts';

const GENERATED_ROUTE = {
  path: '/profile',
  filePath: 'profile.tsx',
  type: 'page',
  varName: 'pageProfile',
  definePage: true,
  pageModule: {
    definePage: true,
    mdx: false,
    compiledElement: false,
    functionPage: undefined,
    pageArgument: {
      kind: 'import',
      name: 'ProfileCard',
      specifier: '../islands/profile-card.tsx',
    },
  },
} as unknown as RouteEntry;

const PRODUCER_ISLAND: Partial<IslandDecl> & {
  generatedElementHost: {
    kind: 'producer';
    component: string;
    ssrHostExport: string;
  };
} = {
  ssr: true,
  generatedElementHost: {
    kind: 'producer',
    component: 'ProfileCard',
    ssrHostExport: 'ProfileCard__ssrHost',
  },
};

function options(
  island: Partial<IslandDecl> & { generatedElementHost?: unknown } = PRODUCER_ISLAND,
  extra: Record<string, unknown> = {},
): never {
  return {
    routesDir: 'app/routes',
    islandsDir: 'app/islands',
    islandTagNames: ['profile-card'],
    islandFiles: ['profile-card.tsx'],
    islandMeta: { 'profile-card': island },
    ...extra,
  } as never;
}

describe('generated element page build facts', () => {
  test('the page tag is a build fact and the island registers the host pair', () => {
    const desc = buildEntryDescriptor([GENERATED_ROUTE], options());
    const decl = desc.pageRoutes[0] as PageRouteDecl & PageKindCarrier;
    expect(decl.pageKind).toBe('generated-element-page');
    expect(decl.tagName).toBe('profile-card');
    expect(decl.generatedElementPage?.tagName).toBe('profile-card');

    const entry = renderEntry(desc);
    // Island registration owns the class + compiler-emitted host producer pair.
    expect(entry).toContain('__registerSsrIsland("profile-card"');
    expect(entry).toContain('import { ProfileCard__ssrHost as __ssrhost_profile_card }');
    // The page-class registration loop must NOT re-register the tag: a
    // class-only re-registration clears the host pair (ADR-0181 A4).
    expect(entry).not.toContain('__registerSsrComponent("profile-card"');
    // The page tag is a literal build fact; the class resolver is not used.
    expect(entry).toContain('let __tag = "profile-card"');
    expect(entry).not.toContain('__resolvePageTag($pageProfile');
    // The bounded lane renders through the ordinary __ssr call site.
    expect(entry).toContain('__ssr(__tag,');
    // Synchronous-SSR only: no stream guard for the generated route.
    expect(entry).not.toContain('__assertStreamRoute($pageProfile');
  });

  test('the SSG routeInfo carries the generated pageKind and literal tag', () => {
    const desc = buildEntryDescriptor([GENERATED_ROUTE], options(PRODUCER_ISLAND, { ssg: true }));
    const entry = renderEntry(desc);
    expect(entry).toContain('pageKind: "generated-element-page"');
    expect(entry).toContain('tagName: "profile-card"');
  });

  test('streaming a generated page fails closed at build (no runtime guard emitted)', () => {
    const streamRoute = {
      ...GENERATED_ROUTE,
      streamManifest: {
        program: { version: 2, tag: 'profile-card', sha256: 'x' },
        fields: [{ field: 'deferred' }],
      },
    } as unknown as RouteEntry;
    expect(() => buildEntryDescriptor([streamRoute], options())).toThrow(/synchronous-SSR only/);
  });

  test('two routes sharing one generated island fail closed (descriptor overwrite)', () => {
    const secondRoute = {
      ...GENERATED_ROUTE,
      path: '/profile-alt',
      filePath: 'profile-alt.tsx',
      varName: 'pageProfileAlt',
    } as unknown as RouteEntry;
    expect(() => buildEntryDescriptor([GENERATED_ROUTE, secondRoute], options())).toThrow(
      /is the page component of multiple routes \(\/profile, \/profile-alt\)/,
    );
    expect(() => buildEntryDescriptor([GENERATED_ROUTE, secondRoute], options())).toThrow(
      /one route one generated component/,
    );
  });

  test('class-only page artifact bytes are unchanged by the build fact', () => {
    const classRoute = {
      path: '/about',
      filePath: 'about.tsx',
      type: 'page',
      varName: 'pageAbout',
      definePage: true,
      pageModule: {
        definePage: true,
        mdx: false,
        compiledElement: false,
        functionPage: undefined,
        pageArgument: { kind: 'unresolved', name: 'AboutPage' },
      },
    } as unknown as RouteEntry;
    const entry = renderEntry(
      buildEntryDescriptor([classRoute], {
        routesDir: 'app/routes',
        islandsDir: 'app/islands',
      }),
    );
    expect(entry).toContain('let __tag = "about-page"');
    expect(entry).not.toContain('__resolvePageTag');
    expect(entry).not.toContain('pageKind: "generated-element-page"');
    expect(entry).not.toContain('generated-page');
  });
});

describe('task12 route → document stylesheet channel (build-only)', () => {
  const LINKS = { '/profile': ['/client/assets/profile-abc.css'] };

  test('present: one literal data channel + per-render seed for the route', () => {
    const desc = buildEntryDescriptor(
      [GENERATED_ROUTE],
      options(PRODUCER_ISLAND, { routeDocumentStyleLinks: LINKS }),
    );
    const entry = renderEntry(desc);
    expect(entry).toContain(
      'const __routeDocumentStyleLinks = { "/profile": ["/client/assets/profile-abc.css"] };',
    );
    expect(entry).toContain('const __routeStyles = __routeDocumentStyleLinks["/profile"];');
    expect(entry).toContain(
      'if (__routeStyles !== undefined) __documentStyles.add(__routeStyles);',
    );
  });

  test('absent: no literal and no seed line (class-only bytes unchanged)', () => {
    const entry = renderEntry(buildEntryDescriptor([GENERATED_ROUTE], options()));
    expect(entry).not.toContain('__routeDocumentStyleLinks');
    expect(entry).not.toContain('__routeStyles');
  });

  test('SSG seeds the runtime routePath only when facts exist', () => {
    const withLinks = renderEntry(
      buildEntryDescriptor(
        [GENERATED_ROUTE],
        options(PRODUCER_ISLAND, { ssg: true, routeDocumentStyleLinks: LINKS }),
      ),
    );
    expect(withLinks).toContain('__routeDocumentStyleLinks[routePath]');
    const withoutLinks = renderEntry(
      buildEntryDescriptor([GENERATED_ROUTE], options(PRODUCER_ISLAND, { ssg: true })),
    );
    expect(withoutLinks).not.toContain('__routeDocumentStyleLinks');
  });
});
