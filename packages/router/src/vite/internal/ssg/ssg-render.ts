/**
 * Router tooling internal SSG render pipeline (ADR 0022).
 *
 * Shared SSG rendering logic used by cli/build-ssg.ts (Vite inline mode,
 * called from closeBundle).
 *
 * This module has zero Vite dependency - it only needs the SSR bundle module.
 *
 * Thin orchestrator that imports focused sub-modules for:
 *   - Dynamic route expansion (ssg-dynamic.ts)
 *   - i18n locale expansion (ssg-dynamic.ts)
 *   - Utility helpers (ssg-helpers.ts)
 */

import { join } from 'node:path';
import { cwd } from 'node:process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type {
  RouteInfoEntry,
  SsgPageOutput,
  SsgRenderEvidence,
  SsgRenderOptions,
  SsgRenderSummary,
  SsrBundle,
} from '../protocol/ssg.ts';
import { createLogger } from '@openelement/element';
import { expandDynamicRoutes, expandI18nLocales } from './ssg-dynamic.ts';
import {
  findHtmlFiles,
  renderRequestTimeServerModule,
  renderStandaloneServerModule,
} from './ssg-helpers.ts';
import { formatJson, normalizeSeparators } from '@openelement/element/build-utils';
import { DEFAULT_OUT_DIR } from './../paths.ts';

const log = createLogger('ssg-render');

/**
 * Minimal Hono app surface consumed by hono/ssg toSSG():
 * routes for route discovery, fetch for the per-route info request, and
 * request for the per-page content fetch.
 */
interface SsgHonoApp {
  routes: Array<{ method: string; handler: unknown; path: string }>;
  fetch: (request: Request, ...args: unknown[]) => Promise<Response>;
  request: (input: string | URL | Request, ...args: unknown[]) => Promise<Response>;
}

// ─── Core render pipeline ──────────────────────────────────────

export async function ssgRender(
  module: SsrBundle,
  options: SsgRenderOptions,
  evidence: SsgRenderEvidence = {},
): Promise<SsgRenderSummary> {
  const root = options.root || cwd();
  const outDir = options.outDir || DEFAULT_OUT_DIR;

  // ── Dynamic route expansion via bundle.getStaticPaths() ──────
  const routeInfo: RouteInfoEntry[] = module.routeInfo ?? [];
  if (!module.routeInfo || !Array.isArray(module.routeInfo)) {
    throw new Error(
      'SSR bundle does not export routeInfo; SSG cannot generate routes.',
    );
  }
  const renderRoute = module.renderRoute as
    | ((path: string, opts?: Record<string, unknown>) => Promise<SsgPageOutput>)
    | undefined;
  const getStaticPaths = module.getStaticPaths as
    | ((path: string) => Promise<Array<Record<string, string>>>)
    | undefined;

  if (routeInfo.length === 0) {
    throw new Error(
      '[openElement] SSG failed: routeInfo is empty. No routes were exported by the SSR bundle.',
    );
  }

  // ── Request-time route partition (0.42.0-alpha.1, ADR-0120) ──
  // renderIntent.mode was inert metadata before this line: 'dynamic' routes
  // are no longer prerendered — they are served at request time by the
  // generated server entry and recorded in server-manifest.json.
  const requestTimeRoutes = routeInfo.filter((r) => r.rendering === 'dynamic');
  const prerenderViolations = routeInfo.filter((r) =>
    r.hasAction === true && r.rendering !== 'dynamic'
  );
  if (prerenderViolations.length > 0) {
    throw new Error(
      '[openElement] Pages with actions cannot be prerendered (ADR-0120): ' +
        prerenderViolations.map((r) => r.path).join(', ') +
        `. Set renderIntent: { mode: 'dynamic' } on ${
          prerenderViolations.length === 1 ? 'this route' : 'these routes'
        }.`,
    );
  }

  const dynamicRoutes = routeInfo.filter((r) => r.isDynamic && r.rendering !== 'dynamic');
  log.info(
    `Routes: ${routeInfo.length} total` +
      (dynamicRoutes.length > 0
        ? ` (${dynamicRoutes.length} dynamic: ${dynamicRoutes.map((r) => r.path).join(', ')})`
        : ''),
  );

  await expandDynamicRoutes(
    dynamicRoutes,
    renderRoute,
    getStaticPaths,
    options,
    root,
    outDir,
  );

  // ── Main SSG via Hono's toSSG() ────────────────────────────
  const { toSSG } = await import('hono/ssg');
  const nodeFs = await import('node:fs/promises');
  const nodePath = await import('node:path');

  const fsModule = {
    writeFile: async (path: string, data: string | Uint8Array) => {
      const dir = nodePath.dirname(path);
      await nodeFs.mkdir(dir, { recursive: true });
      await nodeFs.writeFile(path, data);
    },
    mkdir: async (path: string) => {
      await nodeFs.mkdir(path, { recursive: true });
    },
    isDirectory: async (path: string) => {
      try {
        return (await nodeFs.stat(path)).isDirectory();
      } catch {
        return false;
      }
    },
  };

  const outputDir = join(root, outDir);
  const app = module.default as SsgHonoApp | undefined;
  if (!app) {
    throw new Error(
      'SSR bundle loaded but no Hono app found (no default export)',
    );
  }

  // alpha.18 (R2-H3): hono/ssg's defaultPlugin silently drops every non-200
  // response, so static-route 404/500/redirect pages used to vanish without a
  // trace. Record them through a request wrapper (the afterResponseHook does
  // not receive the request path) and surface them in the build summary.
  const staticNon200: Array<{ path: string; status: number }> = [];
  const warnings: string[] = [];
  // Beta.2.1 (#1325): the unified entry serves pages behind a single
  // app.all('*', dispatcher), so app.routes no longer enumerates pages and
  // hono/ssg discovers nothing. Project eligible static pages from canonical
  // routeInfo for DISCOVERY ONLY — matching/rendering still runs through the
  // real app.fetch/request (unified dispatcher). The dummy handler is never
  // executed; its arity only keeps hono's isMiddleware filter from dropping
  // the enumerated path. Host routes coexisting on the app are preserved
  // as-is; the wildcard dispatcher itself is not a discoverable page.
  const eligibleStaticPaths = routeInfo
    .filter((r) => r.rendering !== 'dynamic' && !r.isDynamic)
    .map((r) => r.path);
  const preservedHostRoutes = (app.routes ?? []).filter(
    (r) => r.path !== '*' && r.path !== '/*',
  );
  // Dedupe only against host entries hono/ssg would itself discover
  // (filterStaticGenerateRoutes: method GET/ALL, non-middleware handler).
  // An exact-path middleware (`app.use('/about', …)`, method ALL, arity 2) or
  // a method-only host registration (POST/…) is filtered out of SSG discovery
  // by hono — letting it suppress the canonical GET entry silently dropped the
  // page from the build while the build reported success (review, #1343).
  const preservedPaths = new Set(
    preservedHostRoutes
      .filter((r) =>
        (r.method === 'GET' || r.method === 'ALL') &&
        typeof r.handler === 'function' && r.handler.length <= 1
      )
      .map((r) => r.path),
  );
  const discoveryHandler = () => {};
  const discoveryRoutes = [
    ...preservedHostRoutes,
    ...eligibleStaticPaths
      .filter((p) => !preservedPaths.has(p))
      .map((path) => ({ method: 'GET', handler: discoveryHandler, path })),
  ];
  const recordingApp: SsgHonoApp = {
    routes: discoveryRoutes,
    fetch: (request, ...args) => app.fetch(request, ...args),
    request: async (input, ...args) => {
      const response = await app.request(input, ...args);
      if (response.status !== 200) {
        const url = input instanceof Request ? input.url : new URL(input, 'http://localhost').href;
        staticNon200.push({ path: new URL(url).pathname, status: response.status });
      }
      return response;
    },
  };

  // Request-time routes are excluded from prerendering: hono/ssg skips a
  // route when the beforeRequestHook returns false.
  const requestTimePaths = new Set(requestTimeRoutes.map((r) => r.path));
  const result = await toSSG(recordingApp as never, fsModule, {
    dir: outputDir,
    beforeRequestHook: (request: Request) => {
      const path = new URL(request.url).pathname;
      return requestTimePaths.has(path) ? false : request;
    },
  });

  if (!result.success) throw result.error;

  // Emit the request-time server artifacts only when such routes exist, so a
  // pure-static project's output tree is unchanged (freeze regression rule).
  if (requestTimeRoutes.length > 0) {
    const serverDir = join(outputDir, 'server');
    mkdirSync(serverDir, { recursive: true });
    const serverManifest = {
      version: 1,
      requestTimeRoutes: requestTimeRoutes.map((r) => ({
        path: r.path,
        filePath: r.filePath,
        paramNames: r.paramNames,
        hasAction: r.hasAction === true,
      })),
    };
    writeFileSync(
      join(serverDir, 'server-manifest.json'),
      formatJson(serverManifest),
      'utf-8',
    );
    writeFileSync(
      join(serverDir, 'index.js'),
      // Admission predicate derivation (#1215): only the route paths reach the
      // generated module — params/precedence stay with the canonical entry.
      renderRequestTimeServerModule(
        requestTimeRoutes.map((r) => ({ path: r.path })),
      ),
      'utf-8',
    );
    // Placeholder: Phase 2 overwrites this with the real island client entry
    // URL when the project has islands (build.ts writeRequestTimeClientScript).
    writeFileSync(
      join(serverDir, 'client-script.js'),
      `export const clientScriptSrc = '';\n`,
      'utf-8',
    );
    // #959: standalone server entry so the built output runs without the
    // CLI or a hand-written Nitro bootstrap.
    writeFileSync(
      join(serverDir, 'serve.mjs'),
      renderStandaloneServerModule(),
      'utf-8',
    );
    // #969: index.js/entry.js are ESM .js files, and Node.js has no
    // module-syntax detection before v20.19/v22.12 — without this marker
    // `node dist/server/index.js` dies with a misleading SyntaxError.
    writeFileSync(
      join(serverDir, 'package.json'),
      '{ "type": "module" }\n',
      'utf-8',
    );
    log.info(
      `Request-time server -> ${join(serverDir, 'index.js')} ` +
        `(${requestTimeRoutes.length} route(s): ${
          requestTimeRoutes.map((r) => r.path).join(', ')
        })`,
    );
    log.info(
      `Standalone server -> ${join(serverDir, 'serve.mjs')} (run: node dist/server/serve.mjs)`,
    );
  }

  // #600: only non-200 for known page routes (in routeInfo) fail the build.
  // API routes registered on the Hono app are not page routes — their non-200
  // status does not mean missing content. The same routeInfo-filter avoids
  // hard-coding path conventions such as /api/.
  const pagePaths = new Set(routeInfo.map((r) => r.path));
  const pageNon200 = staticNon200.filter((r) => pagePaths.has(r.path));
  if (pageNon200.length > 0) {
    const detail = pageNon200.map((e) => `${e.path} -> ${e.status}`).join(', ');
    log.error(
      `Static route non-200 results: ${pageNon200.length} page(s) dropped (not written): ${detail}`,
    );
    throw new Error(
      `SSG failed: ${pageNon200.length} static route(s) returned non-200 ` +
        `(pages not written): ${detail}`,
    );
  }

  // ── Post-processing ─────────────────────────────────────────

  // Rename 404/index.html -> 404.html for GitHub Pages
  const _404Dir = join(outputDir, '404');
  const _404Html = join(outputDir, '404.html');
  const _404Index = join(_404Dir, 'index.html');
  if (existsSync(_404Index)) {
    if (existsSync(_404Html)) {
      log.warn(
        '404.html already exists in output dir - removing before rename',
      );
      rmSync(_404Html, { force: true });
    }
    renameSync(_404Index, _404Html);
    if (existsSync(_404Dir)) {
      rmSync(_404Dir, { recursive: true, force: true });
    }
    log.info('404 page -> dist/404.html (GitHub Pages)');
  }

  // Convert flat HTML files to clean URLs: about.html -> about/index.html
  const allHtmlFiles = findHtmlFiles(outputDir);
  for (const filePath of allHtmlFiles) {
    const rel = nodePath.relative(outputDir, filePath);
    if (rel.endsWith('index.html') || rel === '404.html') continue;
    const baseName = rel.replace(/\.html$/, '');
    const urlBaseName = normalizeSeparators(baseName);
    const dirPath = join(outputDir, baseName);
    const indexPath = join(dirPath, 'index.html');
    // #956: an existing directory is not a conflict — /blog coexists with the
    // /blog/<article> pages under it. Skipping on the directory left index
    // routes flat (blog.html), which dropped them from the sitemap. Only an
    // existing index.html is a real clash.
    if (existsSync(indexPath)) continue;
    mkdirSync(dirPath, { recursive: true });
    renameSync(filePath, indexPath);
    log.info(`Clean URL: /${urlBaseName} -> ${urlBaseName}/index.html`);
  }

  log.info(`Static site generated -> ${outputDir}`);

  // ── i18n locale expansion (if ctx available) ────────────────
  // Request-time routes render per request in every locale; they are not
  // prerendered per locale either.
  await expandI18nLocales(
    evidence,
    renderRoute,
    routeInfo.filter((r) => r.rendering !== 'dynamic'),
    getStaticPaths,
    options,
    root,
    outDir,
  );

  // ── Post-processing modules ─────────────────────────────────
  const {
    injectCspMeta,
    injectViewTransitionMeta,
    injectSpeculationRules,
    buildSpeculationRulesJson,
  } = await import('./postprocess.ts');

  if (options.viewTransition !== false) {
    injectViewTransitionMeta(outputDir);
    log.info('View Transitions meta tag injected');
  }

  if (options.speculation) {
    const specOpts = typeof options.speculation === 'boolean'
      ? {}
      : (options.speculation as Record<string, unknown>);
    const rulesJson = buildSpeculationRulesJson(
      specOpts,
      routeInfo.map((r) => ({ path: r.path, type: 'page' as const })),
    );
    if (rulesJson) {
      injectSpeculationRules(outputDir, rulesJson);
      log.info('Speculation Rules injected');
    }
  }

  const cspPolicy = options.middleware?.csp?.policy;
  if (cspPolicy) {
    injectCspMeta(
      outputDir,
      cspPolicy,
      options.middleware?.csp?.reportOnly || false,
      options.middleware?.csp?.nonce || false,
    );
    log.info('CSP meta tag injected');
  }

  // ── Build manifest (via ctx) ───────────────────────────────
  await evidence.onPrintBuildManifest?.({
    root,
    outDir,
    phase: 3,
    headExtras: options.headExtras,
  });

  return { staticNon200, warnings };
}
