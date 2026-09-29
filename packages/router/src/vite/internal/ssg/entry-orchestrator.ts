/**
 * @openelement/router - Entry Orchestrator
 *
 * Top-level composition axis of the entry-* family (#901): renderEntry()
 * composes the codegen fragments (entry-codegen.ts), the serialized runtime
 * data + the createGeneratedApp factory call, and the SSG section
 * (entry-render-ssg.ts) into the complete virtual Hono entry module.
 *
 * Pure function: routes + options -> Hono entry virtual module code.
 *
 * The generated entry's final form (ADR-0160 rule a, #1470 block e) is
 * imports + route descriptor data + one createGeneratedApp(...) factory call
 * plus per-route wiring. The assembly logic — the Hono app and its WinterCG
 * bridge, the composed handler exports, the client-script plumbing, the SSR
 * registry guard, the dispatch table, and the page-render bindings — is the
 * imported server-runtime factory (server-runtime/app.ts); the entry keeps
 * only route wiring: it imports route modules, emits the per-route
 * GET/POST/404 handlers, registers components through the guard, and
 * re-exports the factory results under the consumer contract names.
 *
 * Architecture notes:
 * - API routes mount either as (ctx) => Response functions (app.all) or as
 *   method-keyed WinterCG handler records joined into the shared route
 *   middleware below (405/Allow semantics from @openelement/router/http).
 * - Island upgrade is handled by the client entry (built by Vite in Phase 2).
 *   No inline script in SSG HTML; the client entry is a Vite-built module
 *   referenced via <script type="module" src="..."> and imports island modules
 *   for side-effect custom element registration.
 * - HTML document wrapping delegates to wrapInDocument from html-escape.ts
 *   (imported at runtime - single source of truth, no duplicate HTML logic)
 * - DSD output must remain plain HTML, without Lit SSR marker comments.
 *
 * Thin orchestrator: delegates code generation to focused sub-modules:
 *   - entry-codegen.ts         — entry code string generation (#901)
 *   - renderer-adapter.ts      — the typed page-render runtime seam (imports
 *                                + factory config; ADR-0160 rule a)
 *   - entry-render-ssg.ts      — SSG re-export & routeInfo/renderRoute/getStaticPaths
 *
 * v0.41.0-alpha.1: Consumers build a descriptor via `buildEntryDescriptor()`
 * (entry-descriptor.ts; the EntryDescriptor type lives in protocol/ssg.ts)
 * and pass it directly to `renderEntry()`.
 */

import type { EntryDescriptor } from '../protocol/ssg.ts';
import { validateIslandModuleSpecifier } from './entry-generators.ts';
import { renderActionRoute, renderPageRoute } from './entry-codegen.ts';
import { renderNotFoundRoute } from './entry-not-found-codegen.ts';
import { pageRouteTagExpr, renderImport } from './entry-route-helpers.ts';
import { renderApiRoute, renderMiddleware } from './entry-server-codegen.ts';
import { renderSsgSection } from './entry-render-ssg.ts';
import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';
import { selectRendererAdapter } from './renderer-adapter.ts';

/**
 * Render an EntryDescriptor into a complete virtual module string.
 *
 * Pure function - deterministic, testable, side-effect-free.
 */
export function renderEntry(desc: EntryDescriptor): string {
  const lines: string[] = [];
  const ssrAdmissionPlan = desc.ssrAdmissionPlan;
  const adapter = selectRendererAdapter(desc.renderer);
  for (const island of desc.islands) validateIslandModuleSpecifier(island.modulePath);

  if (adapter.firstServerImport) {
    // #1339: the lit SSR DOM shim must be the FIRST import of the entry so it
    // evaluates before @openelement/element, lit, and every route/island
    // module (route module imports are emitted below). Covers the dev entry,
    // the SSG bundle and the request-time server entry uniformly.
    lines.push(adapter.firstServerImport);
  }
  lines.push(
    "import { createRouteMiddleware as __createRouteMiddleware } from '@openelement/router/http';",
  );
  // The lifecycle guards stay the authoring imports; the emitted catch blocks
  // call them directly (the redirect/not-found channels).
  lines.push(
    `import { isOpenElementRedirect as __isOpenElementRedirect, isOpenElementNotFound as __isOpenElementNotFound } from '@openelement/router';`,
  );

  // --- Imports ---
  for (const imp of desc.imports) {
    lines.push(renderImport(imp));
  }

  // --- Island lookup (build-time known list) ---
  const islandLookup: Record<string, string> = {};
  for (const island of desc.islands) {
    islandLookup[island.tagName] = island.modulePath;
  }
  // --- App-shell imports + explicit registration ---
  // Compiled shell modules do not self-register: the entry imports the
  // module namespace and registers the default-exported compiled class under
  // the configured shell tag. renderDsd fails closed on a tag mismatch.
  // Deduped by importPath — one module maps to one compiled class and tag.
  const appShellModules = new Map<string, string>();
  const collectShellModule = (shell: typeof desc.appShell.default) => {
    if (shell && !appShellModules.has(shell.importPath)) {
      appShellModules.set(shell.importPath, shell.tagName);
    }
  };
  collectShellModule(desc.appShell.default);
  for (const shell of Object.values(desc.appShell.layouts)) collectShellModule(shell);

  lines.push(
    `// Known islands (determined at build time by scanning islandsDir)`,
  );
  lines.push(`const __islandMap = ${quoteGeneratedJavaScriptValue(islandLookup, 2)}`);
  lines.push('');

  // --- Island client script (#951, descriptor-driven) ---
  // The island client entry lives at one deterministic public URL in dev and
  // prod (cli/build-client.ts emits hash-free islands/[name].js; in dev the
  // open:dev-island-client plugin serves the same URL). Whoever knows the URL
  // hands it to the entry; the resolved document carries the descriptors and
  // wrapInDocument embeds the tags at render time (#1471), so a CSP nonce
  // (middleware.csp.nonce) reaches them — no post-hoc HTML splicing.
  // - Dev: no client build exists, so the entry computes the URL itself
  //   (import.meta.env.DEV/BASE_URL are compile-time constants in both the
  //   dev module runner and the build; the built bundle keeps this branch as
  //   dead code). The setter seam and the descriptor list live in the
  //   generated-app factory (server-runtime/app.ts).
  // - Prod request-time: whether Phase 2 actually shipped a client bundle is
  //   only known at request time, so the generated dist/server/index.js
  //   calls __setRequestTimeClientScript (with the entry URL from the
  //   structured client asset manifest, ./client-assets.js) once at startup.
  // - Prod SSG: the build calls the same setter before prerendering with the
  //   Phase 2 manifest entry (client-before-SSG build order), so the static
  //   pages embed the final script tag at document time too.
  const hasClientEntry = desc.islands.length > 0 || desc.hasEnhancedForms === true;
  lines.push('// #951: island client script descriptors (serialized by wrapInDocument)');
  lines.push('');

  // Element owns document and compiled-render semantics; this entry wires them.
  const appShellModuleList = [...appShellModules].map(([importPath, tagName], index) => ({
    importPath,
    tagName,
    varName: `__shell_${index}`,
  }));
  for (const shellModule of appShellModuleList) {
    lines.push(
      `import * as ${shellModule.varName} from ${
        quoteGeneratedJavaScriptValue(shellModule.importPath)
      };`,
    );
  }
  const staticComponentModules = desc.staticComponents.map((component, index) => ({
    ...component,
    varName: `__static_component_${index}`,
  }));
  for (const component of staticComponentModules) {
    lines.push(
      `import * as ${component.varName} from ${
        quoteGeneratedJavaScriptValue(component.modulePath)
      };`,
    );
  }
  lines.push('');

  // --- Route module imports ---
  for (const route of [...desc.apiRoutes, ...desc.pageRoutes]) {
    lines.push(`import * as ${route.varName} from '${route.importPath}'`);
  }
  for (const renderer of desc.renderers) {
    lines.push(`import * as ${renderer.varName} from '${renderer.importPath}'`);
  }
  for (const mwScope of desc.middlewareScopes) {
    lines.push(`import * as ${mwScope.varName} from '${mwScope.importPath}'`);
  }
  // middleware.use entries are MODULE PATHS — the entry imports each module
  // and hands its default export to the factory, which composes them at the
  // handler boundary, so user middleware keeps its module graph (closures,
  // helpers, third-party deps) instead of being serialized into the entry.
  const fetchMiddlewareVars = (desc.fetchMiddleware ?? []).map((importPath, index) => {
    const varName = `__mw_${index}`;
    lines.push(`import * as ${varName} from ${quoteGeneratedJavaScriptValue(importPath)}`);
    return varName;
  });
  lines.push('');

  // --- Serialized route-descriptor data ---
  // The admission plan, shell plan, and locale declaration are per-project
  // build data (the descriptor's own values — there is no importable source
  // for them), so they stay generated data handed to the factory.
  lines.push('// v0.17.4: SSR admission plan');
  lines.push(
    `export const ssrAdmissionPlan = ${quoteGeneratedJavaScriptValue(ssrAdmissionPlan, 2)};`,
  );
  lines.push('');

  // --- SSG: headExtras via define injection ---
  // Always emitted in SSG mode: renderRouteHandler references __headExtras
  // unconditionally, so a project without headExtras would otherwise render
  // every static page into a 500 (latent until the request-time fixture hit it).
  if (desc.isSSG) {
    lines.push(
      '// SSG: headExtras injected via Vite define (Phase A)',
    );
    lines.push('// Replaces the old .openElement/head-extras.html runtime file read');
    lines.push('const __headExtras = __HEAD_EXTRAS__ || "";');
    lines.push('');
  }

  // --- Stream manifests (stream routes; consumed by the handlers, the
  // deferred-shell gate, and the SSG routeInfo) ---
  const streamManifests = Object.fromEntries(
    desc.pageRoutes
      .filter((route) => route.streamManifest)
      .map((route) => [route.path, route.streamManifest]),
  );
  if (Object.keys(streamManifests).length > 0) {
    lines.push(
      `export const __streamManifests = ${quoteGeneratedJavaScriptValue(streamManifests)};`,
    );
    lines.push('');
    // Stream pump runtime (ADR-0160 rule a): the pump, the browser bootstrap,
    // and (Amendment 1) the deferred-shell gate are imported runtime; the
    // entry binds the pump to its escapeAttr import and the gate to its
    // serialized manifests + createDeferredDsdExecutor import.
    lines.push(
      "// Stream pump runtime (ADR-0160 rule a), bound to the entry's escapeAttr import.",
    );
    lines.push('const __streamBody = __createStreamBody({ escapeAttr });');
    lines.push(
      "// The deferred-shell gate (ADR-0160 rule a, Amendment 1), bound to the entry's",
      '// serialized stream manifests and its createDeferredDsdExecutor import.',
    );
    lines.push(
      'const __createDeferredPageShell = __createDeferredPageShellGate({ streamManifests: __streamManifests, createDeferredDsdExecutor });',
    );
    lines.push('');
  }

  // --- Generated-app assembly (ADR-0160 rule a, #1470 block e) ---
  // One factory call owns what the entry template used to emit as assembly
  // code: the Hono app + WinterCG bridge, the composed openElementHandler
  // exports, the island client-script plumbing, the SSR registry guard, the
  // page handler/dispatch tables, the body-limit middleware, and the
  // page-render runtime bindings. The entry passes its serialized build data
  // and its Element imports; dangerous keys and the body-limit budget are
  // NOT passed — the factory imports the canonical policy values from the
  // kernel-free /authoring leaf, so the entry carries no serialized copy.
  lines.push('// Generated-app assembly (ADR-0160 rule a): the factory owns the Hono app,');
  lines.push('// its bridge, the handler exports, the SSR registry guard, and the');
  lines.push('// page-render bindings; the entry keeps the route wiring below.');
  // Nav data is not part of the 1.0 surface: the app-shell layout props keep
  // their contract with empty defaults. Locales, by contrast, are a project
  // declaration (`openElement({ i18n })`) — the entry carries them so
  // path-derived locale resolution and shell href localization agree with
  // the pages the build emits (see expandI18nLocales).
  lines.push('const __app = createGeneratedApp({');
  lines.push('  islands: __islandMap,');
  lines.push(`  appShellPlan: ${quoteGeneratedJavaScriptValue(desc.appShell, 2)},`);
  lines.push(`  locales: ${quoteGeneratedJavaScriptValue(desc.i18n?.locales ?? [])},`);
  lines.push('  navSections: [],');
  lines.push('  headerNav: [],');
  lines.push(
    `  defaultLocale: ${quoteGeneratedJavaScriptValue(desc.i18n?.defaultLocale ?? 'en')},`,
  );
  lines.push(
    `  devClientScriptSrc: import.meta.env.DEV && ${
      quoteGeneratedJavaScriptValue(hasClientEntry)
    } ? import.meta.env.BASE_URL + 'client/islands/client.js' : null,`,
  );
  lines.push(
    `  pageHandlerPaths: ${quoteGeneratedJavaScriptValue(desc.pageRoutes.map((r) => r.path))},`,
  );
  if (desc.fetchMiddleware?.length) {
    lines.push('  fetchMiddleware: [');
    for (const varName of fetchMiddlewareVars) {
      lines.push(`    ${varName}.default,`);
    }
    lines.push('  ],');
  }
  if (desc.pageRoutes.length > 0) {
    lines.push('  pageRuntime: {');
    for (const configLine of adapter.runtimeSeam().pageRuntimeLines) {
      lines.push(`    ${configLine}`);
    }
    lines.push(
      `    ssrRenderableTags: ${
        quoteGeneratedJavaScriptValue([
          ...desc.ssrAdmissionPlan.renderableTags,
          ...desc.staticComponents.map((component) => component.tagName),
        ])
      },`,
    );
    lines.push('  },');
  }
  lines.push('});');
  lines.push('');
  // --- Factory bindings: the names the emitted wiring below calls ---
  lines.push('const {');
  lines.push('  app,');
  if (desc.pageRoutes.length > 0) {
    lines.push('  ssr: __ssr,');
    lines.push('  pageProps: __pageProps,');
    lines.push('  pageErrorProps: __pageErrorProps,');
    lines.push('  statusHtml: __statusHtml,');
    lines.push('  resolveAppShell: __resolveAppShell,');
    lines.push('  renderAppShell: __renderAppShell,');
  }
  lines.push('  pageHandlers: __pageHandlers,');
  if (desc.apiRoutes.length > 0) {
    lines.push('  apiRouteRecords: __apiRouteRecords,');
  }
  lines.push('  methodNotAllowed: __methodNotAllowed,');
  lines.push('  actionBodyLimit: __actionBodyLimit,');
  lines.push('  registerSsrComponent: __registerSsrComponent,');
  lines.push('  clientScriptDescriptors: __clientScriptDescriptors,');
  lines.push('  locales: __locales,');
  lines.push('  getDefaultLocale: __getDefaultLocale,');
  lines.push('} = __app;');
  lines.push('');
  // The internal composition bridge (never user-visible): the WinterCG route
  // middleware from @openelement/router/http is the dialect-free public
  // contract, while the generated handlers below keep their internal Hono
  // dialect. The per-request Hono context is bridged by request identity —
  // one WeakMap entry per dispatch, no cross-request leakage.
  lines.push(
    'const { contexts: __honoContexts, asFetchHandler: __asFetchHandler, asFetchMiddleware: __asFetchMiddleware } = __app.hono;',
  );
  lines.push('');
  lines.push('export const __setRequestTimeClientScript = __app.setRequestTimeClientScript;');
  lines.push('');

  // --- Register page components in SSR customElements registry ---
  {
    lines.push('// Idempotent customElements.define for SSR (dev + SSG)');
    lines.push(
      '// #952/#1339: the define wrapper, the registration-ownership map, and the',
    );
    lines.push(
      '// fail-closed conflict rule are the imported registry guard',
    );
    lines.push(
      '// (@openelement/router/server-runtime — security.ts); the marker constants it',
    );
    lines.push(
      '// reads are protocol values pinned by registry-marker-drift.test.ts.',
    );
    lines.push('');
    // #952: entry-side registration ownership tracking. Since #960
    // (registration decoupling) a definePage route's page class registration
    // is decoupled from the module's tagName export; since #1276 (B1.3-F1) the
    // registered tag resolves from the compiled Part Program
    // (__resolvePageTag), with the path-derived tag as fallback. Compiled
    // modules never self-register, so the entry owns every registration. The ownership
    // guard still covers dev re-evaluation — overwriting a fresh
    // self-registered class with the entry's page class would recurse when
    // its compiled program emits the same tag. The entry therefore only
    // overwrites registrations it made itself.
    for (const route of desc.pageRoutes) {
      const tagNameExpr = pageRouteTagExpr(route.varName, route.tagName);
      lines.push(
        `try { __registerSsrComponent(${tagNameExpr}, ${route.varName}.default); } catch (err) { console.error('[ssg] Failed to register route custom element ${tagNameExpr}:', err); throw err; }`,
      );
    }
    for (const shellModule of appShellModuleList) {
      lines.push(
        `try { __registerSsrComponent(${
          quoteGeneratedJavaScriptValue(shellModule.tagName)
        }, ${shellModule.varName}.default); } catch (err) { console.error('[ssg] Failed to register app shell custom element ${
          quoteGeneratedJavaScriptValue(shellModule.tagName)
        }:', err); throw err; }`,
      );
    }
    for (const component of staticComponentModules) {
      lines.push(
        `try { __registerSsrComponent(${
          quoteGeneratedJavaScriptValue(component.tagName)
        }, ${component.varName}.default); } catch (err) { console.error('[ssg] Failed to register static component <${component.tagName}>:', err); throw err; }`,
      );
    }
    lines.push('');
  }

  // --- Register island components in SSR customElements registry ---
  const ssrRenderableTags = new Set(ssrAdmissionPlan.renderableTags);
  const ssrIslands = desc.islands.filter((island) => ssrRenderableTags.has(island.tagName));
  for (const island of ssrIslands) {
    const varName = `__island_${island.tagName.replace(/-/g, '_')}`;
    lines.push(`import * as ${varName} from ${quoteGeneratedJavaScriptValue(island.modulePath)}`);
  }
  for (const island of ssrIslands) {
    const varName = `__island_${island.tagName.replace(/-/g, '_')}`;
    const componentVar = `__island_component_${island.tagName.replace(/-/g, '_')}`;
    const componentExport = island.exportName
      ? `?.[${quoteGeneratedJavaScriptValue(island.exportName)}]`
      : '?.default';
    lines.push(`const ${componentVar} = ${varName}${componentExport}`);
    lines.push(
      `if (${componentVar}) {`,
    );
    lines.push(
      `  try { __registerSsrComponent(${
        quoteGeneratedJavaScriptValue(island.tagName)
      }, ${componentVar}); } catch (err) { console.error('[ssg] Failed to register island custom element <${island.tagName}>:', err); throw err; }`,
    );
    lines.push(`}`);
  }
  lines.push('');

  // --- Startup stream guards (ADR-0160 rule a) ---
  // The adapter-selected assertion is imported from
  // @openelement/router/server-runtime; the entry emits only the per-route
  // call sites. A stream declaration that has no matching compiled route
  // manifest/program fails the entry at load, not at request time.
  if (desc.pageRoutes.length > 0) {
    for (const route of desc.pageRoutes) {
      lines.push(
        `__assertStreamRoute(${route.varName}, ${quoteGeneratedJavaScriptValue(route.path)}, ${
          quoteGeneratedJavaScriptValue(route.filePath)
        }, ${
          route.streamManifest
            ? `__streamManifests[${quoteGeneratedJavaScriptValue(route.path)}]`
            : 'undefined'
        });`,
      );
    }
    lines.push('');
  }

  // --- App middleware ---
  for (const mw of desc.middleware) {
    renderMiddleware(lines, mw);
  }

  // --- Middleware scopes (v0.3.0: _middleware.ts files) ---
  // Authors export the dialect-free WinterCG shape (request, next) =>
  // Promise<Response>; the entry adapts it into the Hono chain in place.
  for (const mwScope of desc.middlewareScopes) {
    lines.push(`// Middleware scope: ${mwScope.scope} (${mwScope.importPath})`);
    lines.push(
      `app.use(${
        quoteGeneratedJavaScriptValue(mwScope.scope === '/' ? '/*' : `${mwScope.scope}/*`)
      }, (c, next) => ${mwScope.varName}.default(c.req.raw, async () => { await next(); return c.res; }))`,
    );
    lines.push('');
  }

  // --- API routes ---
  for (const route of desc.apiRoutes) {
    renderApiRoute(lines, route);
  }

  // --- Page routes ---
  const docConfig = {
    title: desc.document.title,
    lang: desc.document.lang,
    headExtras: desc.document.headExtras,
    allowHeadExtrasScripts: desc.document.allowHeadExtrasScripts,
  };
  for (const route of desc.pageRoutes) {
    renderPageRoute(lines, route, desc.renderers, docConfig, desc.isSSG, desc.renderer);
  }

  // --- Action POST handlers ---
  for (const route of desc.pageRoutes) {
    renderActionRoute(lines, route, desc.renderers, docConfig, desc.isSSG, desc.renderer);
  }

  // --- Shared dispatch: the WinterCG route middleware over the populated
  // handler records (the composition must follow the page/action emissions —
  // createRouteMiddleware reads each record at call time); the 405/Allow
  // responder is the factory-bound dispatch module (#572, ADR-0160 rule a). ---
  lines.push(`const __routeMiddleware = __createRouteMiddleware([`);
  if (desc.apiRoutes.length > 0) {
    // Method-keyed API records dispatch ahead of pages (the API section used
    // to mount before the page catch-all; the RouteTable keeps that order).
    lines.push(`  ...__apiRouteRecords,`);
  }
  for (const route of desc.pageRoutes) {
    lines.push(
      `  { id: ${quoteGeneratedJavaScriptValue(route.filePath)}, path: ${
        quoteGeneratedJavaScriptValue(route.path)
      }, handlers: __pageHandlers[${quoteGeneratedJavaScriptValue(route.path)}] },`,
    );
  }
  lines.push(`], { methodNotAllowed: __methodNotAllowed });`);
  lines.push(
    `app.all('*', (c, next) => { __honoContexts.set(c.req.raw, c); return __routeMiddleware(c.req.raw, async () => { await next(); return c.res; }); });`,
  );
  lines.push('');

  // --- Styled 404 (#923): unmatched paths render the /404 page ---
  const notFoundPage = desc.pageRoutes.find((r) => r.path === '/404');
  if (notFoundPage) {
    renderNotFoundRoute(lines, notFoundPage, desc.renderers, docConfig, desc.isSSG);
  }

  // --- Exports: the consumer contract names are the factory results ---
  lines.push('// Handler contract: the factory composed the fetch-middleware onion');
  lines.push('// (#858) around app.fetch — every runtime (dev server, start CLI, e2e');
  lines.push('// fixture server, Nitro production entry) shares one composed handler.');
  lines.push('export const openElementHandler = __app.handler;');
  if (desc.fetchMiddleware?.length) {
    lines.push('');
    // The dev server (@hono/vite-dev-server) reads this named export instead of
    // the default Hono app when middleware.use is configured (see plugin.ts).
    lines.push('export const openElementDevFetch = __app.devFetch;');
  }
  lines.push('');
  lines.push('export const openElementRuntimeAdapter = __app.runtimeAdapter;');
  lines.push('');
  lines.push('export default app');

  // --- SSG section ---
  const ssgSection = renderSsgSection(desc);
  if (ssgSection) {
    lines.push(ssgSection);
  }

  return lines.join('\n');
}
