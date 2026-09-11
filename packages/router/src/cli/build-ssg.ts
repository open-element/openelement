/**
 * @openelement/router - CLI: SSG Build
 *
 * SSG rendering + post-processing.
 * Builds a self-contained SSR bundle via viteBuild(ssr:true, noExternal),
 * then imports it to render all pages to static HTML, and post-processes
 * island paths.
 *
 * ADR 0011: This module exports buildSSG() only - it is called from
 * closeBundle() in open:build plugin. No longer a standalone CLI entry.
 * ctx parameter is required (no globalThis fallback).
 *
 * Usage:
 *   deno task build  (unified entry - runs all 3 phases)
 */

import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { normalizePath } from 'vite';
import process from 'node:process';
import type {
  CompatibilityClassification,
  FrameworkOptions,
  HydrationStrategy,
  OpenElementPackageManifest,
  RouteEntry,
} from '../vite/internal/protocol/framework.ts';
import type {
  EntryDescriptor,
  IslandDecl,
  StaticComponentDecl,
} from '../vite/internal/protocol/ssg.ts';
import type { OpenElementBuildContext } from '../vite/build-context.ts';
import {
  buildEntryDescriptor,
  fileToTagName,
  renderEntry,
  scanIslandMeta,
  scanIslands,
  scanRoutes,
  scanStaticComponents,
  ssgRender,
} from '../vite/internal/ssg/index.ts';
import { SsrRenderError } from '@openelement/element/build-utils';
import { createLogger, formatError } from '@openelement/element';
import { createSsgRenderEvidence } from './ssg-render.ts';
import { createNpmSpecifierPlugin } from '../vite/npm-specifier-plugin.ts';
import { mdxPlugin } from '../vite/plugin-mdx.ts';
import { quoteGeneratedJavaScriptValue } from '../vite/internal/ssg/codegen-literals.ts';
import {
  generateCustomElementsPolyfill,
  generateSsrPolyfillBanner,
} from '../vite/internal/ssg/index.ts';
import { compiledElementPlugin } from '@openelement/element/compiler';
import { normalizeViteAliases } from '../vite/alias-utils.ts';
import {
  CHUNK_SIZE_WARNING_LIMIT_KB,
  DEFAULT_ISLANDS_DIR,
  DEFAULT_OUT_DIR,
  DEFAULT_ROUTES_DIR,
} from '../vite/internal/paths.ts';

const log = createLogger('build-ssg');

/**
 * #1339: @lit-labs/ssr's install-global-dom-shim feature-probes CSS module
 * support with `await import('data:text/css;base64,...')` (register-css-hook.js).
 * Rolldown refuses to bundle CSS data URLs, which would fail the lit SSG
 * bundle. Resolve data: specifiers to an empty stub module instead: the probe
 * then reports "supported" and skips its node:module hook registration —
 * irrelevant here, since no lit fixture page imports CSS modules.
 */
function litSsrDataUrlStubPlugin(): import('vite').Plugin {
  const STUB_ID = '\0open:lit-ssr-data-url-stub';
  return {
    name: 'open:lit-ssr-data-url-stub',
    enforce: 'pre',
    resolveId(id) {
      if (id.startsWith('data:')) return STUB_ID;
      return null;
    },
    load(id) {
      if (id === STUB_ID) return 'export default undefined;';
      return null;
    },
  };
}

/**
 * file:// URL for the dynamic import of the built SSR bundle (issue #1220,
 * M13). pathToFileURL percent-encodes spaces, `#`, `?`, and non-ASCII bytes
 * and handles Windows drive letters; string concatenation mis-resolved such
 * project paths. Same correct usage as internal/static-serve.ts.
 */
export function ssrBundleImportUrl(ssrBundlePath: string): string {
  return pathToFileURL(ssrBundlePath).href;
}

const VIRTUAL_SSG_ENTRY_ID = 'virtual:open-ssg-entry';
const RESOLVED_SSG_ENTRY_ID = '\0' + VIRTUAL_SSG_ENTRY_ID;
interface BuildSSGOptions {
  root?: string;
  outDir?: string;
  routesDir?: string;
  islandsDir?: string;
  middleware?: FrameworkOptions['middleware'];
  islandTagNames?: string[];
  /** Phase 1 discoveries reused by the production BuildPlan path. */
  routes?: RouteEntry[];
  islandFiles?: string[];
  islandMeta?: Record<string, Partial<import('../vite/internal/protocol/ssg.ts').IslandDecl>>;
  staticComponents?: StaticComponentDecl[];
  packageManifests?: OpenElementPackageManifest[];
  /** CEM-derived compatibility classifications from Phase 1 auto-detection. */
  cemClassifications?: CompatibilityClassification[];
  /** #979: foreign WC tags discovered in page/island JSX (Phase 1). */
  foreignTags?: string[];
  /** @security Injected as raw HTML without sanitization */
  headExtras?: string;
  allowHeadExtrasScripts?: boolean;
  html?: { lang?: string; title?: string };
  appShell?: FrameworkOptions['appShell'];
  layouts?: FrameworkOptions['layouts'];
  upgradeStrategy?: HydrationStrategy;
  /** Page renderer (Beta.2.2, #1339). Defaults to ctx.options.renderer. */
  renderer?: 'native' | 'lit';
  resolveAlias?: Record<string, string> | import('vite').Alias[];
  base?: string;
  /**
   * View Transitions API configuration.
   * When true (default), injects <meta name="view-transition" content="same-origin">
   * into all HTML files for smooth cross-page animations in MPA navigation.
   * Set to false to disable.
   * @default true
   */
  viewTransition?: boolean;
  /**
   * Speculation Rules API configuration.
   * Enables browser prefetch/prerender of pages before the user navigates.
   * Can be a boolean (true = auto-generate from routes) or explicit rules.
   */
  speculation?: boolean | import('../vite/internal/protocol/ssg.ts').SpeculationRulesOptions;
  /**
   * Policy for dynamic-route render failures during SSG.
   * See SsgRenderOptions.dynamicRouteFailure. Defaults to 'fail'.
   */
  dynamicRouteFailure?: 'fail' | 'warn';
}

/** Resolved inputs for the SSG entry descriptor (Phase 1 discoveries + Phase 3 options). */
interface SsgEntryDescriptorInputs {
  routes: RouteEntry[];
  routesDir: string;
  islandsDir: string;
  middleware?: FrameworkOptions['middleware'];
  islandTagNames: string[];
  islandFiles: string[];
  islandMeta: Record<string, Partial<IslandDecl>>;
  staticComponents: StaticComponentDecl[];
  packageManifests: OpenElementPackageManifest[];
  cemClassifications: CompatibilityClassification[];
  /** #979: foreign WC tags from the Phase 1 scan (defaults to none). */
  foreignTags?: string[];
  /** @security Injected as raw HTML without sanitization */
  headExtras?: string;
  allowHeadExtrasScripts?: boolean;
  html?: { lang?: string; title?: string };
  upgradeStrategy: HydrationStrategy;
  appShell?: FrameworkOptions['appShell'];
  layouts?: FrameworkOptions['layouts'];
  /** Page renderer (Beta.2.2, #1339) — threaded from FrameworkOptions. */
  renderer?: 'native' | 'lit';
}

/**
 * Build the SSG entry descriptor and sync its SSR admission plan into ctx.
 *
 * Single descriptor instantiation (alpha.17 B1): the admission plan and the
 * emitted SSG entry code come from the same descriptor, and
 * ctx.phase1.ssrAdmissionPlan is synced from it so the render evidence
 * (createSsgRenderEvidence) reads the same plan the SSG entry was generated
 * from.
 *
 * alpha.18 (R2-H2): inputs.cemClassifications must carry the Phase 1 CEM
 * classifications. Without them the SSG admission plan falls back to the
 * conservative package default (client-only) for CEM 'ssr-capable' islands,
 * diverging from the dev/SSR entry and corrupting the synced plan + evidence.
 */
export function buildSsgEntryDescriptor(
  inputs: SsgEntryDescriptorInputs,
  ctx: OpenElementBuildContext,
): EntryDescriptor {
  const descriptor = buildEntryDescriptor(inputs.routes, {
    routesDir: inputs.routesDir,
    islandsDir: inputs.islandsDir,
    middleware: inputs.middleware,
    ssg: true,
    islandTagNames: inputs.islandTagNames,
    islandFiles: inputs.islandFiles,
    islandMeta: inputs.islandMeta,
    staticComponents: inputs.staticComponents,
    packageManifests: inputs.packageManifests,
    cemClassifications: inputs.cemClassifications,
    foreignTags: inputs.foreignTags || [],
    headExtras: inputs.headExtras,
    allowHeadExtrasScripts: inputs.allowHeadExtrasScripts,
    html: inputs.html,
    upgradeStrategy: inputs.upgradeStrategy,
    appShell: inputs.appShell,
    layouts: inputs.layouts,
    renderer: inputs.renderer,
  });
  ctx.phase1.ssrAdmissionPlan = descriptor.ssrAdmissionPlan;
  return descriptor;
}

async function buildSSG(
  options: BuildSSGOptions = {},
  ctx: OpenElementBuildContext,
): Promise<void> {
  const root = options.root || ctx.phase3.root || process.cwd();
  const outDir = options.outDir || ctx.phase3.outDir || DEFAULT_OUT_DIR;
  const routesDir = options.routesDir || ctx.phase3.routesDir || DEFAULT_ROUTES_DIR;
  const islandsDir = options.islandsDir || ctx.phase3.islandsDir || DEFAULT_ISLANDS_DIR;
  const appShell = options.appShell ?? ctx.phase3.appShell;
  const layouts = options.layouts ?? ctx.phase3.layouts;
  const renderer = options.renderer ?? ctx.options.renderer ?? 'native';

  // Read island metadata from ctx (ADR 0010: no .openElement/ fallback)
  const islandTagNames = options.islandTagNames || ctx.phase1.islandTagNames || [];
  const islandMeta = options.islandMeta || ctx.phase1.islandMeta || {};
  const packageManifests = options.packageManifests || ctx.phase1.packageManifests || [];
  const metadataResolveAlias = options.resolveAlias ||
    (ctx.phase1.userResolveAlias as Record<string, string> | import('vite').Alias[] | undefined);

  // Read options from ctx
  if (!options.headExtras) options.headExtras = ctx.phase3.headExtras || undefined;
  if (options.allowHeadExtrasScripts === undefined) {
    options.allowHeadExtrasScripts = ctx.phase3.allowHeadExtrasScripts;
  }
  if (!options.html) options.html = ctx.phase3.html || undefined;
  if (!options.middleware) options.middleware = ctx.phase3.middleware || undefined;
  if (!options.upgradeStrategy) options.upgradeStrategy = ctx.phase3.upgradeStrategy;
  if (!options.base) options.base = ctx.phase3.base;
  if (options.viewTransition === undefined) options.viewTransition = ctx.phase3.viewTransition;
  if (!options.speculation) options.speculation = ctx.phase3.speculation || undefined;

  // Generate SSG entry code (all statically imported — no cycle with the
  // internal/ssg barrel, #847).
  const routes = options.routes ?? await scanRoutes(routesDir);
  const staticComponents = options.staticComponents ?? await scanStaticComponents({
    root,
    routesDir,
    islandsDir,
    routes,
  });

  const islandsRoot = join(root, islandsDir);
  const ssgIslandFiles = options.islandFiles ?? await scanIslands(islandsRoot);
  const ssgIslandTagNames = islandTagNames.length > 0
    ? islandTagNames
    : ssgIslandFiles.map((f) => fileToTagName(f));
  const ssgIslandMeta: Record<string, Partial<IslandDecl>> = Object.keys(islandMeta).length > 0
    ? islandMeta
    : await scanIslandMeta(islandsRoot, ssgIslandFiles);
  // Single descriptor instantiation (alpha.17 B1): the SSR admission plan and
  // the emitted SSG entry code come from the same descriptor. Previously the
  // plan was built without middleware/html/upgradeStrategy and diverged from
  // the descriptor used for rendering.
  // alpha.18 (R2-H2): cemClassifications come from Phase 1 (plugin.ts
  // buildStart auto-detection) so the SSG plan matches the dev/SSR plan.
  const ssgDescriptor = buildSsgEntryDescriptor({
    routes,
    routesDir,
    islandsDir,
    middleware: options.middleware,
    islandTagNames: ssgIslandTagNames,
    islandFiles: ssgIslandFiles,
    islandMeta: ssgIslandMeta,
    staticComponents,
    packageManifests,
    cemClassifications: options.cemClassifications || ctx.phase1.cemClassifications || [],
    // #979: foreign tags come from the same Phase 1 scan so the SSG plan
    // matches the dev/SSR plan (single descriptor instantiation, alpha.17 B1).
    foreignTags: options.foreignTags || ctx.phase1.foreignTags || [],
    headExtras: options.headExtras,
    allowHeadExtrasScripts: options.allowHeadExtrasScripts,
    html: options.html,
    upgradeStrategy: options.upgradeStrategy || 'idle',
    appShell,
    layouts,
    renderer,
  }, ctx);

  // #1339: the native banner imports StyleSheet from @openelement/element;
  // the lit DOM shim (first entry import, entry-orchestrator.ts) provides
  // CSSStyleSheet itself, so the lit entry needs no polyfill banner.
  const ssgEntryCode = (renderer === 'lit' ? '' : generateSsrPolyfillBanner() + '\n') +
    renderEntry(ssgDescriptor);
  // Deno import map resolution handles bare specifiers (e.g. @acme/components/open-callout)
  // via the createDenoImportMapPlugin added to the Phase 3 viteBuild plugins below.

  try {
    const { build: viteBuild } = await import('vite');

    // Handle alias - prefer CLI options, then ctx from Phase 1
    const alias = metadataResolveAlias;
    const viteResolveAlias = normalizeViteAliases(alias, root);

    // Build the self-contained SSR bundle (ADR 0008 Phase C)
    // Replaces createServer() + ssrLoadModule() with viteBuild + import().
    // noExternal ensures all dependencies are inlined into a single bundle,
    // so module-level variables (Phase B) are shared across the entire graph.
    const ssrOutDir = join(root, outDir, 'server');
    log.info(`Building SSR bundle -> ${ssrOutDir}`);
    // v0.21: client-only islands get stub modules — collect the normalized
    // module ids and the filePath -> tagName map in one pass (#847).
    const clientOnlyIslandIds = new Set<string>();
    const clientOnlyTagMap = new Map<string, string>();
    for (const [tag, meta] of Object.entries(ssgIslandMeta)) {
      if (meta.ssr !== false) continue;
      const file = ssgIslandFiles[ssgIslandTagNames.indexOf(tag)];
      if (!file) continue;
      const moduleId = normalizePath(resolve(root, islandsDir, file));
      clientOnlyIslandIds.add(moduleId);
      clientOnlyTagMap.set(moduleId, tag);
    }

    // v0.21 SOP-004: Conflict detection: same tag must not be both SSR and client:only.
    const ssrTags = new Set(
      Object.entries(ssgIslandMeta)
        .filter(([, meta]) => meta.ssr !== false)
        .map(([tag]) => tag),
    );
    const conflictTags = [...clientOnlyTagMap.values()].filter((t) => ssrTags.has(t));
    if (conflictTags.length > 0) {
      throw new Error(
        `[openElement] SSR+client:only conflict detected for tags: ${conflictTags.join(', ')}. ` +
          'A tag cannot be both SSR-capable and client:only on the same page.',
      );
    }

    await viteBuild({
      configFile: false,
      root,
      logLevel: 'error',
      // The SSR bundle is a build-time artifact, not a deployable tree:
      // copying public/ into dist/server would duplicate every static asset
      // under /server/ (observed in www: CNAME, favicon, search-index).
      publicDir: false,
      build: {
        ssr: true,
        outDir: ssrOutDir,
        chunkSizeWarningLimit: CHUNK_SIZE_WARNING_LIMIT_KB,
        rollupOptions: {
          input: { entry: VIRTUAL_SSG_ENTRY_ID },
          // Suppress IMPORT_IS_UNDEFINED for optional route-module exports;
          // the generated code uses typeof checks which correctly handle
          // undefined exports.
          onwarn(warning, warn) {
            if (warning.code === 'IMPORT_IS_UNDEFINED') return;
            warn(warning);
          },
          output: {
            format: 'esm',
            // ADR-0044: customElements polyfill must run before ESM imports.
            // Uses Map-backed define()/get(); renderDsdByName() looks up
            // components via customElements.get(tagName) during SSG rendering.
            // SOP-016: HTMLElement stub is self-contained in @openelement/element/dsd-element.ts.
            // #1339: the lit renderer installs the @lit-labs/ssr DOM shim as
            // the entry's first import instead; the Map stub must not exist
            // (the shim's installWindowOnGlobal only fills missing globals).
            banner: renderer === 'lit' ? '' : generateCustomElementsPolyfill(),
          },
        },
      },
      // The generated SSR entry is a portable deployment artifact. Bundle all
      // runtime dependencies so Node, Deno, Workers and Nitro never inherit
      // the build machine's import map or `npm:` URL semantics.
      ssr: { noExternal: true },
      // ADR 0008 Phase A: Inject headExtras via define instead of .openElement/head-extras.html
      // The generated entry code uses __HEAD_EXTRAS__ which gets replaced
      // at build time. This avoids the Vite SSR AsyncFunction syntax errors
      // that large inline strings (with backticks/${}) cause.
      define: options.headExtras
        ? { __HEAD_EXTRAS__: JSON.stringify(options.headExtras) }
        : { __HEAD_EXTRAS__: '""' },
      esbuild: {
        // ADR-0057: JSX automatic runtime, same reason as build-client.ts.
        // SSG build also processes .tsx island files for SSR rendering.
        jsx: 'automatic',
        jsxImportSource: '@openelement/element',
        tsconfigRaw: {
          compilerOptions: {
            useDefineForClassFields: false,
          },
        },
      },
      plugins: [
        // MDX route support must mirror the outer plugin list (plugin.ts),
        // otherwise .mdx routes fail Phase 3 parse (esbuild treats them as JS).
        // The routesDir keeps the compiled page tag aligned with the
        // path-derived registration tag the entry uses. The MDX transform
        // emits the compiled page module source, so it must run BEFORE the
        // compiler (both are enforce:'pre'; array order decides).
        mdxPlugin({ routesDir }),
        ...(renderer === 'lit' ? [litSsrDataUrlStubPlugin()] : []),
        // Keep SSR lowering identical to the outer Vite and client builds;
        // this inline build has its own plugin list.
        compiledElementPlugin(),
        // ADR 0010: Virtual SSG entry module
        // Replaces .openElement/.openElement-ssg-entry.ts file write
        {
          name: 'open:virtual-ssg-entry',
          resolveId(id) {
            if (id === VIRTUAL_SSG_ENTRY_ID) return RESOLVED_SSG_ENTRY_ID;
          },
          load(id) {
            if (id === RESOLVED_SSG_ENTRY_ID) return ssgEntryCode;
          },
        },
        createNpmSpecifierPlugin(),
        {
          name: 'open:ssg-client-only-island-stubs',
          enforce: 'pre',
          load(id) {
            const normalized = normalizePath(id.split('?')[0]);
            if (!clientOnlyIslandIds.has(normalized)) return;
            const tagName = clientOnlyTagMap.get(normalized) || 'open-client-only-stub';
            // Client-only stub marker uses an unbranded attribute.
            // SSR outputs <tag-name data-client-only="true"></tag-name>
            // Client runtime imports the real module and upgrades the element.
            return [
              `import { defineIslandConfig } from '@openelement/router';`,
              `export const tagName = ${quoteGeneratedJavaScriptValue(tagName)};`,
              'export const openElement = defineIslandConfig({ ssr: false });',
              `export default class OpenClientOnlyStub extends HTMLElement {
  connectedCallback() {
    if (!this.hasAttribute('data-client-only')) {
      this.setAttribute('data-client-only', 'true');
    }
  }
}`,
            ].join('\n');
          },
        },
      ],
      resolve: {
        preserveSymlinks: false,
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        ...(viteResolveAlias ? { alias: viteResolveAlias } : {}),
      },
    });
    log.info('SSR bundle built successfully');

    // Load the SSR bundle and run SSG rendering pipeline
    const ssrBundlePath = resolve(ssrOutDir, 'entry.js');
    const module = await import(ssrBundleImportUrl(ssrBundlePath)) as Record<string, unknown>;

    if (!module.default) {
      throw new SsrRenderError('virtual:open-ssg-entry', new Error('Failed to load Hono app'));
    }

    // Delegate to shared ssgRender() - zero Vite dependency from this point
    await ssgRender(
      module as Parameters<typeof ssgRender>[0],
      {
        root,
        outDir,
        base: options.base || '/',
        headExtras: options.headExtras,
        html: options.html,
        middleware: options.middleware,
        islandTagNames: ssgIslandTagNames,
        viewTransition: options.viewTransition,
        speculation: options.speculation as boolean | Record<string, unknown> | undefined,
        dynamicRouteFailure: options.dynamicRouteFailure,
      },
      createSsgRenderEvidence(ctx),
    );

    // #953: the SSR bundle in dist/server is a build-time-only artifact.
    // ssgRender() adds the request-time entry (dist/server/index.js) only
    // when the project declares renderIntent 'dynamic' routes; for a
    // pure-static project nothing under dist/server is deployable, so remove
    // the directory instead of shipping the server bundle to static hosting.
    if (!existsSync(join(ssrOutDir, 'index.js'))) {
      await rm(ssrOutDir, { recursive: true, force: true });
      log.info('Pure-static build: removed build-time SSR bundle (dist/server)');
    }

    log.info('Static site generated -> ' + join(root, outDir));
  } catch (err) {
    const cause = err instanceof Error ? err : new Error(formatError(err));
    throw new SsrRenderError('SSG pipeline', cause);
  }
}

export { buildSSG };
