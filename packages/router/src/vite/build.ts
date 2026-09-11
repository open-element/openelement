/**
 * @openelement/router - Build plugin
 * openElement Architecture (K·I·S·S): Knowledge · Isolated · Semantic · Static
 * Build produces only static files (K+S), Islands are the only JS (I).
 * API Routes (S - Serverless extension) deploy separately.
 *
 * ADR 0011: closeBundle writes metadata to ctx, then triggers Phase 2/3.
 * No globalThis bridge - ctx stays in createOpenPlugin() closure scope throughout.
 */

import type { Plugin, ResolvedConfig } from 'vite';
import type { FrameworkOptions } from './internal/protocol/framework.ts';
import type { SsgBehaviorOptions } from './internal/protocol/ssg.ts';
import type { OpenElementBuildContext } from './build-context.ts';
import { join } from 'node:path';
import { mkdir, open, readFile } from 'node:fs/promises';
import process from 'node:process';
import { createLogger } from '@openelement/element';
import { escapeAttr, escapeHtml } from '@openelement/element';
import { cleanSsrArtifacts, postProcessClientIslandBuild } from './internal/ssg/index.ts';
import { writeRouteManifest } from './route-manifest.ts';
import {
  collectBuildArtifacts,
  createProductionBuildPlan,
  writeBuildEvidence,
} from './build-plan.ts';
import { DEFAULT_OUT_DIR, DEFAULT_ROUTES_DIR } from './internal/paths.ts';

const log = createLogger('build');

/** Phase 2: client island bundle. Shared by the SPA and SSG closeBundle paths. */
async function runClientIslandBuild(ctx: OpenElementBuildContext): Promise<void> {
  log.info('[2/3] Client island build...');
  try {
    const { buildClient } = await import('../cli/build-client.ts');
    await buildClient(ctx);
    ctx.markComplete(2);
    log.info('[2/3] Client island build - complete');
  } catch (error) {
    log.error(`[2/3] Client island build - FAILED: ${error}`);
    throw error;
  }
}

export async function readClientEntryFromManifest(manifestPath: string): Promise<string> {
  const manifestRaw = await readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestRaw);
  for (const [src, entry] of Object.entries(manifest) as [string, { file?: string }][]) {
    if (
      (src.includes('open-client-entry') || src.includes('virtual:open-client')) && entry.file
    ) {
      return entry.file;
    }
  }
  throw new Error(`Client manifest exists but no open-client-entry was found: ${manifestPath}`);
}

/**
 * Write the island client entry URL for the request-time server entry
 * (0.42.0-alpha.1 / ADR-0120). dist/server/index.js imports this module to
 * inject the same island client script into request-time HTML that the
 * static pipeline injects post-build. No-op for pure-static builds (no
 * request-time server entry was emitted).
 */
export async function writeRequestTimeClientScript(
  ctx: OpenElementBuildContext,
  scriptSrc: string,
): Promise<void> {
  const root = ctx.phase3.root || process.cwd();
  const outDir = ctx.phase3.outDir || DEFAULT_OUT_DIR;
  const serverIndex = join(root, outDir, 'server', 'index.js');
  const { existsSync, writeFileSync } = await import('node:fs');
  if (!existsSync(serverIndex)) return;
  writeFileSync(
    join(root, outDir, 'server', 'client-script.js'),
    `export const clientScriptSrc = ${JSON.stringify(scriptSrc)};\n`,
  );
  log.info(`Request-time client script recorded: ${scriptSrc}`);
}

/** Vite plugin: writes build metadata to ctx, then runs Phase 2 + Phase 3 */
export function buildPlugin(
  options: FrameworkOptions & { allowHeadExtrasScripts?: boolean; ssg?: SsgBehaviorOptions } = {},
  ctx?: OpenElementBuildContext,
): Plugin {
  let config: ResolvedConfig;

  return {
    name: 'open:build',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    async closeBundle() {
      // Only run in build mode (not dev)
      if (config.command !== 'build') return;

      if (!ctx) {
        log.warn('open:build skipped Phase 2/3 because no OpenElementBuildContext was provided.');
        return;
      }

      // Serialize SSR noExternal patterns (RegExp -> marker objects)
      const ssrNoExternal = ((options.ssr?.noExternal ||
        (config.ssr as { noExternal?: (string | RegExp)[] } | undefined)?.noExternal) || [])
        .map((item) => {
          if (item instanceof RegExp) {
            return { __type: 'RegExp', source: item.source, flags: item.flags };
          }
          return item;
        });

      // --- Write to OpenElementBuildContext ----------
      ctx.populatePhase3(
        options,
        config,
        ssrNoExternal as (string | { __type: 'RegExp'; source: string; flags: string })[],
      );

      const totalIslands = (ctx.phase1.islandTagNames?.length || 0) +
        (ctx.phase1.packageIslandDecls?.length || 0);

      log.info('Phase 1 complete - SSR bundle and metadata written to build context');

      // ADR 0023: Phase 3 (SSG) runs before Phase 2 (client bundle).
      // SSG only needs Phase 1 - it renders HTML from the SSR bundle.
      // Phase 2 runs last because client chunks have content hashes that
      // don't affect HTML content, and injection is a post-processing step.
      ctx.markComplete(1);
      ctx.buildPlan = createProductionBuildPlan(ctx);

      // SPA mode: skip Phase 3 SSG, generate SPA shell + route manifest
      if (ctx.options.mode === 'spa') {
        const root = ctx.phase3.root || process.cwd();
        const outDirName = ctx.phase3.outDir || DEFAULT_OUT_DIR;
        const absOutDir = join(root, outDirName);
        const htmlLang = escapeAttr(ctx.phase3.html?.lang ?? 'en');
        const htmlTitle = escapeHtml(ctx.phase3.html?.title ?? 'openElement App');

        const indexPath = join(absOutDir, 'index.html');

        // Generate a fallback SPA shell only when Vite did not emit an HTML
        // entry. Apps with their own index.html (for example desktop shells
        // with a custom client entry) keep the real Vite output.
        const html = `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8">
  <title>${htmlTitle}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    console.info('[openElement] SPA fallback shell loaded. Provide an app index.html for a bundled client entry.');
  </script>
</body>
</html>`;

        await mkdir(absOutDir, { recursive: true });
        try {
          const handle = await open(indexPath, 'wx');
          try {
            await handle.writeFile(html, { encoding: 'utf-8' });
          } finally {
            await handle.close();
          }
          log.info('SPA shell written to index.html');
        } catch (error) {
          if (
            error instanceof Error &&
            (error as Error & { code?: string }).code === 'EEXIST'
          ) {
            log.info('SPA shell preserved from Vite output');
          } else {
            throw error;
          }
        }

        // Generate route manifest for client-side routing
        const absRoutesDir = join(root, ctx.phase3.routesDir || DEFAULT_ROUTES_DIR);
        const routeCount = await writeRouteManifest({
          routesDir: absRoutesDir,
          outDir: absOutDir,
        });
        log.info(`Route manifest written (${routeCount} page route(s))`);

        // Phase 2: Client island bundle (only if islands exist). Unlike the
        // SSG path below this intentionally skips the hasEnhancedForms check
        // (#569): in SPA mode form submission is intercepted by the SPA
        // bootstrap's own client entry, so the zero-island enhancement entry
        // would never be loaded.
        if (totalIslands > 0) {
          await runClientIslandBuild(ctx);
        }

        log.info('SPA build complete.');
        return;
      }

      log.info('[3/3] Static site generation...');
      try {
        const { buildSSG } = await import('../cli/build-ssg.ts');
        await buildSSG({
          routes: ctx.phase1.cachedRoutes,
          islandFiles: ctx.phase1.islandFiles,
          islandTagNames: ctx.phase1.islandTagNames,
          islandMeta: ctx.phase1.islandMeta,
          staticComponents: ctx.phase1.staticComponents,
          packageManifests: ctx.phase1.packageManifests,
          cemClassifications: ctx.phase1.cemClassifications,
          foreignTags: ctx.phase1.foreignTags,
          dynamicRouteFailure: options.ssg?.dynamicRouteFailure,
        }, ctx);
        ctx.markComplete(3);
        log.info('[3/3] Static site generation - complete');
      } catch (error) {
        log.error(`[3/3] Static site generation - FAILED: ${error}`);
        throw error;
      }

      // Phase 2: Client island bundle (only if islands exist — or enhanced
      // forms, #569: an island-free app with data-open-enhance forms still
      // needs the client entry for the enhancement layer)
      const hasEnhancedForms = (ctx.phase1.cachedRoutes ?? []).some((route) =>
        route.type === 'page' && route.hasEnhancedForms === true
      );
      if (totalIslands > 0 || hasEnhancedForms) {
        await runClientIslandBuild(ctx);
      }

      // -- Inject client script (only runs if Phase 2 completed) --
      // Phase 2's manifest.json tells us the client chunk URLs to inject
      // into the already-rendered HTML pages.
      if (ctx.isComplete(2)) {
        try {
          const outDir = ctx.phase3.outDir || DEFAULT_OUT_DIR;
          const root = ctx.phase3.root || process.cwd();
          const clientManifestPath = join(root, outDir, 'client', '.vite', 'manifest.json');
          const { existsSync } = await import('node:fs');
          if (existsSync(clientManifestPath)) {
            const clientEntry = await readClientEntryFromManifest(clientManifestPath);
            const base = ctx.phase3.base || '/';
            const scriptSrc = `${base}client/${clientEntry}`;
            await postProcessClientIslandBuild(ctx, scriptSrc);
            await writeRequestTimeClientScript(ctx, scriptSrc);
            log.info(`Client script injected: ${scriptSrc}`);
          }
        } catch (error) {
          log.error(`Failed to inject client script: ${error}`);
          throw error;
        }
      } else {
        log.info('No Phase 2 - client script injection skipped');
      }

      // -- Clean Phase 1 SSR artifacts from public dist (v0.14.10) --
      try {
        await cleanSsrArtifacts(ctx);
      } catch (error) {
        log.warn(`Failed to clean SSR artifacts: ${error}`);
      }

      log.info('Build complete.');
      ctx.buildArtifacts = collectBuildArtifacts(ctx.buildPlan);
      writeBuildEvidence(ctx.buildPlan, ctx.buildArtifacts);
      if (!ctx.buildArtifacts.success) {
        throw new Error(`BuildPlan failed: ${ctx.buildArtifacts.errors.join('; ')}`);
      }
    },
  };
}
