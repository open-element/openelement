/**
 * @openelement/router - Build plugin
 * openElement Architecture (K·I·S·S): Knowledge · Isolated · Semantic · Static
 * Build produces only static files (K+S), Islands are the only JS (I).
 * API Routes (S - Serverless extension) deploy separately.
 *
 * closeBundle writes metadata to ctx, then triggers Phase 2/3.
 * No globalThis bridge - ctx stays in createOpenPlugin() closure scope throughout.
 */

import { existsSync } from '../internal/host-path.ts';
import type { Plugin, ResolvedConfig } from 'vite';
import type { FrameworkOptions } from './internal/protocol/framework.ts';
import type { SsgBehaviorOptions } from './internal/protocol/ssg.ts';
import type { OpenElementBuildContext } from './build-context.ts';
import { join } from '../internal/host-path.ts';
import { createLogger } from '@openelement/element';
import { cleanSsrArtifacts, postProcessClientIslandBuild } from './internal/ssg/index.ts';
import {
  collectBuildArtifacts,
  createProductionBuildPlan,
  writeBuildEvidence,
} from './build-plan.ts';
import { DEFAULT_OUT_DIR } from './internal/paths.ts';

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
  const manifestRaw = await Deno.readTextFile(manifestPath);
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
 * (0.42.0-alpha.1). dist/server/index.js imports this module and
 * hands the URL to the SSR entry (__setRequestTimeClientScript), which
 * embeds the same island client script into request-time HTML at render time
 * that the static pipeline injects post-build. No-op for pure-static builds
 * (no request-time server entry was emitted).
 */
export function writeRequestTimeClientScript(
  ctx: OpenElementBuildContext,
  scriptSrc: string,
): void {
  const root = ctx.phase3.root || Deno.cwd();
  const outDir = ctx.phase3.outDir || DEFAULT_OUT_DIR;
  const serverIndex = join(root, outDir, 'server', 'index.js');
  if (!existsSync(serverIndex)) return;
  Deno.writeTextFileSync(
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

      // Phase 3 (SSG) runs before Phase 2 (client bundle).
      // SSG only needs Phase 1 - it renders HTML from the SSR bundle.
      // Phase 2 runs last because client chunks have content hashes that
      // don't affect HTML content, and injection is a post-processing step.
      ctx.markComplete(1);
      ctx.buildPlan = createProductionBuildPlan(ctx);

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
          const root = ctx.phase3.root || Deno.cwd();
          const clientManifestPath = join(root, outDir, 'client', '.vite', 'manifest.json');
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
