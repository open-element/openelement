/**
 * Router tooling internal SSG render pipeline.
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

import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'pathe';
import type {
  RouteInfoEntry,
  SsgPageOutput,
  SsgRenderEvidence,
  SsgRenderOptions,
  SsgRenderSummary,
  SsrBundle,
} from '@openelement/protocol/ssg';
import {
  EMPTY_CLIENT_ASSET_MANIFEST,
  serializeClientAssetsModule,
} from '@openelement/protocol/client-assets';
import { createLogger } from '@openelement/element';
import { expandDynamicRoutes, expandI18nLocales } from './ssg-dynamic.ts';
import { findHtmlFiles, renderRequestTimeServerModule } from './ssg-helpers.ts';
import { formatJson, normalizeSeparators } from '@openelement/element/build-utils';
import { buildError, SsgRenderErrorCode } from '../../../internal/error-codes.ts';
import { SSG_PRERENDER_ENV_KEY } from '../server-runtime/response-channel.ts';
import { DEFAULT_OUT_DIR } from './../paths.ts';

const log = createLogger('ssg-render');

/**
 * The generated server app surface the static generator drives (#1560):
 * the WinterCG dispatch and the fn-form mounts (page-discovery exclusion).
 */
interface SsgDispatchApp {
  routes?: ReadonlyArray<{ method: string; path: string }>;
  fetch: (request: Request, env?: Record<string, unknown>) => Promise<Response>;
}

/** File-name extension mapping for prerendered content types (toSSG parity). */
const PRERENDER_EXTENSION_MAP: Readonly<Record<string, string>> = {
  'text/html': 'html',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'application/atom+xml': 'xml',
  'application/rss+xml': 'xml',
  'application/yaml': 'yaml',
};

/**
 * The output path for one prerendered route, byte-compatible with the
 * naming the toSSG pass produced (the clean-URL postprocess below still
 * converts flat `about.html` outputs to `about/index.html`):
 * `/` -> `index.<ext>`, `/p/` -> `p/index.<ext>`, `/p` -> `p.<ext>`,
 * `/p.<ext>` stays flat.
 */
function prerenderFilePath(routePath: string, outDir: string, mimeType: string): string {
  const baseType = mimeType.split(';', 1)[0].trim();
  const extension =
    PRERENDER_EXTENSION_MAP[baseType] ?? (baseType === 'text/plain' ? 'txt' : 'html');
  let filePath: string;
  if (routePath.endsWith(`.${extension}`)) filePath = join(outDir, routePath);
  else if (routePath === '/') filePath = join(outDir, `index.${extension}`);
  else if (routePath.endsWith('/')) filePath = join(outDir, routePath, `index.${extension}`);
  else filePath = join(outDir, `${routePath}.${extension}`);
  // Traversal guard: the resolved file must stay inside the output dir.
  const resolved = join(outDir, relative(outDir, filePath));
  if (relative(outDir, resolved).startsWith('..')) {
    throw buildError(
      SsgRenderErrorCode.PRERENDER_PATH_ESCAPED,
      `Prerender path escapes the output directory: ${routePath}`,
    );
  }
  return filePath;
}

/**
 * Drives one prerender request per target path through the app's WinterCG
 * dispatch and writes the 200 responses to disk. Sequential by design:
 * rendering is CPU-bound in-process, and a deterministic order keeps
 * build logs reproducible (the replaced toSSG pass interleaved two at a
 * time; output bytes are unaffected).
 */
async function prerenderStaticPages(
  app: SsgDispatchApp,
  targets: readonly string[],
  outputDir: string,
  hooks: {
    onRequestTimeExcluded(path: string): boolean;
    onNon200(path: string, status: number): void;
    onError(error: unknown): void;
  },
): Promise<string[]> {
  const ssgEnv = { [SSG_PRERENDER_ENV_KEY]: true } as Record<string, unknown>;
  const files: string[] = [];
  const madeDirs = new Set<string>();
  for (const path of targets) {
    if (hooks.onRequestTimeExcluded(path)) continue;
    const response = await app.fetch(
      new Request('http://localhost' + path, { method: 'GET' }),
      ssgEnv,
    );
    if (response.status !== 200) {
      hooks.onNon200(path, response.status);
      continue;
    }
    const mimeType = response.headers.get('Content-Type')?.split(';')[0] || 'text/plain';
    const filePath = prerenderFilePath(path, outputDir, mimeType);
    const dirPath = dirname(filePath);
    if (dirPath && !madeDirs.has(dirPath)) {
      await mkdir(dirPath, { recursive: true });
      madeDirs.add(dirPath);
    }
    const contentType = response.headers.get('Content-Type') ?? '';
    let content: string | Uint8Array;
    try {
      content =
        contentType.includes('text') || contentType.includes('json')
          ? await response.text()
          : new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      hooks.onError(
        new Error(
          `Error processing response: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ),
      );
      continue;
    }
    if (typeof content === 'string') await writeFile(filePath, content, 'utf8');
    else await writeFile(filePath, content);
    files.push(filePath);
  }
  return files;
}

// ─── Core render pipeline ──────────────────────────────────────

export async function ssgRender(
  module: SsrBundle,
  options: SsgRenderOptions,
  evidence: SsgRenderEvidence = {},
): Promise<SsgRenderSummary> {
  const root = options.root || process.cwd();
  const outDir = options.outDir || DEFAULT_OUT_DIR;

  // ── Dynamic route expansion via bundle.getStaticPaths() ──────
  const routeInfo: RouteInfoEntry[] = module.routeInfo ?? [];
  if (!module.routeInfo || !Array.isArray(module.routeInfo)) {
    throw buildError(
      SsgRenderErrorCode.ROUTE_INFO_MISSING,
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
    throw buildError(
      SsgRenderErrorCode.ROUTE_INFO_EMPTY,
      '[openElement] SSG failed: routeInfo is empty. No routes were exported by the SSR bundle.',
    );
  }

  // ── Request-time route partition ──
  // renderIntent.mode was inert metadata before this line: 'dynamic' routes
  // are no longer prerendered — they are served at request time by the
  // generated server entry and recorded in server-manifest.json.
  // A page may be hybrid — static GET
  // prerendered below plus a request-time action POST. HTTP admits both on
  // one path; only 'dynamic' routes leave the prerender set.
  const requestTimeRoutes = routeInfo.filter((r) => r.rendering === 'dynamic');

  const dynamicRoutes = routeInfo.filter((r) => r.isDynamic && r.rendering !== 'dynamic');
  log.info(
    `Routes: ${routeInfo.length} total` +
      (dynamicRoutes.length > 0
        ? ` (${dynamicRoutes.length} dynamic: ${dynamicRoutes.map((r) => r.path).join(', ')})`
        : ''),
  );

  await expandDynamicRoutes(dynamicRoutes, renderRoute, getStaticPaths, options, root, outDir);

  // ── Main SSG through the internal static generator (#1560) ──────
  // The entry's default export is the WinterCG app; the generator drives
  // app.fetch per eligible static path — the same dispatch every runtime
  // serves, so the prerendered bytes carry the same middleware semantics.

  const outputDir = join(root, outDir);
  const app = module.default as SsgDispatchApp | undefined;
  if (!app || typeof app.fetch !== 'function') {
    throw buildError(
      SsgRenderErrorCode.APP_MISSING,
      'SSR bundle loaded but no dispatchable server app found (no default export)',
    );
  }

  // The generator (like the toSSG pass it replaces) silently drops every
  // non-200 response, so static-route 404/500/redirect pages would vanish
  // without a trace. Record them here and surface them in the build summary.
  const staticNon200: Array<{ path: string; status: number }> = [];
  const warnings: string[] = [];
  // #1325: the unified entry serves pages behind a single wildcard route
  // middleware, so the app's own route list no longer enumerates pages.
  // Project eligible static pages from canonical routeInfo — matching and
  // rendering still run through the real app.fetch (unified dispatcher).
  const eligibleStaticPaths = routeInfo
    .filter((r) => r.rendering !== 'dynamic' && !r.isDynamic)
    .map((r) => r.path);
  // Host fn-form API mounts coexisting on the app suppress the canonical GET
  // entry at the same path — letting a page at an API path prerender would
  // bypass the API handler (review, #1343 parity). The wildcard route
  // middleware itself is not a host route.
  const hostMountPaths = new Set(
    (app.routes ?? []).filter((r) => r.path !== '*' && r.path !== '/*').map((r) => r.path),
  );
  // Request-time routes are excluded from prerendering (eligibleStaticPaths
  // already projects them out; the check keeps the invariant local).
  const requestTimePaths = new Set(requestTimeRoutes.map((r) => r.path));
  const prerenderTargets = eligibleStaticPaths.filter(
    (path) => !hostMountPaths.has(path) && !requestTimePaths.has(path),
  );

  await prerenderStaticPages(app, prerenderTargets, outputDir, {
    onRequestTimeExcluded: (path) => requestTimePaths.has(path),
    onNon200: (path, status) => staticNon200.push({ path, status }),
    onError: (error) => {
      throw error;
    },
  });

  // Emit the request-time server artifacts when any route needs the server at
  // request time: a 'dynamic' route (GET + POST) or any page with an action
  // (POST only — its static GET stays on the prerendered artifact, and the
  // dispatcher admits every non-GET/HEAD method by method, not by path). A
  // pure-static project (no actions, no dynamic routes) keeps an unchanged
  // output tree (freeze regression rule).
  const actionRoutes = routeInfo.filter((r) => r.hasAction === true);
  if (requestTimeRoutes.length > 0 || actionRoutes.length > 0) {
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
    writeFileSync(join(serverDir, 'server-manifest.json'), formatJson(serverManifest), 'utf8');
    writeFileSync(
      join(serverDir, 'index.js'),
      // Admission predicate derivation (#1215): only the route paths reach the
      // generated module — params/precedence stay with the canonical entry.
      renderRequestTimeServerModule(requestTimeRoutes.map((r) => ({ path: r.path }))),
    );
    // Placeholder: Phase 2's client asset manifest overwrites this with the
    // real record when the project ships a client bundle (build.ts
    // writeRequestTimeClientAssets). Structured data only — no injection
    // logic (#1471).
    writeFileSync(
      join(serverDir, 'client-assets.js'),
      serializeClientAssetsModule(EMPTY_CLIENT_ASSET_MANIFEST),
      'utf8',
    );
    // Local preview is served by the start CLI from TypeScript source
    // (the node:http fetch server over the shared fetch handler); production
    // deploys go through the Nitro mount. No second production server is
    // generated.
    // index.js/entry.js are ESM .js files; mark the server dir as ESM.
    writeFileSync(join(serverDir, 'package.json'), '{ "type": "module" }\n', 'utf8');
    log.info(
      `Request-time server -> ${join(serverDir, 'index.js')} ` +
        `(${requestTimeRoutes.length} request-time route(s)` +
        (requestTimeRoutes.length > 0
          ? `: ${requestTimeRoutes.map((r) => r.path).join(', ')}`
          : '') +
        `; ${actionRoutes.length} action route(s))`,
    );
  }

  // #600: only non-200 for known page routes (in routeInfo) fail the build.
  // API routes registered on the generated app are not page routes — their non-200
  // status does not mean missing content. The same routeInfo-filter avoids
  // hard-coding path conventions such as /api/.
  const pagePaths = new Set(routeInfo.map((r) => r.path));
  const pageNon200 = staticNon200.filter((r) => pagePaths.has(r.path));
  if (pageNon200.length > 0) {
    const detail = pageNon200.map((e) => `${e.path} -> ${e.status}`).join(', ');
    log.error(
      `Static route non-200 results: ${pageNon200.length} page(s) dropped (not written): ${detail}`,
    );
    throw buildError(
      SsgRenderErrorCode.STATIC_NON_200,
      `SSG failed: ${pageNon200.length} static route(s) returned non-200 ` +
        `(pages not written): ${detail}`,
    );
  }

  // ── Post-processing ─────────────────────────────────────────

  // Convert flat HTML files to clean URLs: about.html -> about/index.html
  const allHtmlFiles = findHtmlFiles(outputDir);
  for (const filePath of allHtmlFiles) {
    const rel = relative(outputDir, filePath);
    if (rel.endsWith('index.html') || rel === '404.html' || rel.endsWith('/404.html')) continue;
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

  // Rename 404/index.html -> 404.html for GitHub Pages — at the root and for
  // every locale-prefixed copy (i18n expansion writes those after the static
  // pass), so a locale error document is never served as a 200 directory page
  // (status fidelity).
  const rename404Dir = (dir: string, label: string) => {
    const index = join(dir, '404', 'index.html');
    if (!existsSync(index)) return;
    const html = join(dir, '404.html');
    if (existsSync(html)) {
      log.warn('404.html already exists in output dir - removing before rename');
      rmSync(html);
    }
    renameSync(index, html);
    const dir404 = join(dir, '404');
    if (existsSync(dir404)) {
      rmSync(dir404, { recursive: true });
    }
    log.info(`404 page -> ${label}404.html (GitHub Pages)`);
  };
  rename404Dir(outputDir, 'dist/');
  // Zero-page runs (dynamic-only routes without getStaticPaths, warn-policy
  // failures, empty path sets) never create the outDir — the walk is skipped
  // rather than fabricating an empty tree (pure-static output stays frozen).
  if (existsSync(outputDir)) {
    for (const entry of readdirSync(outputDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        rename404Dir(join(outputDir, entry.name), `dist/${entry.name}/`);
      }
    }
  }

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
    const specOpts =
      typeof options.speculation === 'boolean'
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
    budget: evidence.manifestBudget,
  });

  return { staticNon200, warnings };
}
