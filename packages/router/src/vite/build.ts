/**
 * @openelement/router - Build plugin
 * Build produces only static files; islands are the only JS. API routes
 * deploy separately.
 *
 * closeBundle writes metadata to ctx, then triggers Phase 2 (client) and
 * Phase 3 (SSG), in that order (#1471).
 * No globalThis bridge - ctx stays in createOpenPlugin() closure scope throughout.
 */

import { existsSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import type { Plugin, ResolvedConfig } from 'vite';
import type { FrameworkOptions } from './internal/protocol/framework.ts';
import type { SsgBehaviorOptions } from './internal/protocol/ssg.ts';
import type { ClientAssetManifest } from './internal/protocol/client-assets.ts';
import { serializeClientAssetsModule } from './internal/protocol/client-assets.ts';
import type { OpenElementBuildContext } from './build-context.ts';
import { join } from 'pathe';
import { createLogger } from '@openelement/element';
import { cleanSsrArtifacts, postProcessClientIslandBuild } from './internal/ssg/index.ts';
import { applyTailwindPreset, resolveTailwindPresetOptions } from './preset-tailwind.ts';
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
    ctx.clientAssetManifest = await buildClient(ctx);
    ctx.markComplete(2);
    log.info('[2/3] Client island build - complete');
  } catch (error) {
    log.error(`[2/3] Client island build - FAILED: ${error}`);
    throw error;
  }
}

/**
 * Write the structured client asset manifest for the request-time server
 * entry. dist/server/index.js imports the module at startup and hands the
 * client entry URL to the SSR entry (__setRequestTimeClientScript), so
 * request-time HTML embeds the same island client script at render time the
 * SSG render pass embedded into the static pages. The module is pure
 * structured manifest data (#1471) — no injection logic. No-op for
 * pure-static builds (no request-time server entry was emitted).
 */
export function writeRequestTimeClientAssets(
  ctx: OpenElementBuildContext,
  manifest: ClientAssetManifest,
): void {
  const root = ctx.phase3.root || process.cwd();
  const outDir = ctx.phase3.outDir || DEFAULT_OUT_DIR;
  const serverIndex = join(root, outDir, 'server', 'index.js');
  if (!existsSync(serverIndex)) return;
  writeFileSync(
    join(root, outDir, 'server', 'client-assets.js'),
    serializeClientAssetsModule(manifest),
    'utf8',
  );
  log.info(`Request-time client assets recorded: ${manifest.entry}`);
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
      const ssrNoExternal = (
        options.ssr?.noExternal ||
        (config.ssr as { noExternal?: (string | RegExp)[] } | undefined)?.noExternal ||
        []
      ).map((item) => {
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

      const totalIslands =
        (ctx.phase1.islandTagNames?.length || 0) + (ctx.phase1.packageIslandDecls?.length || 0);

      log.info('Phase 1 complete - SSR bundle and metadata written to build context');

      ctx.markComplete(1);
      ctx.buildPlan = createProductionBuildPlan(ctx);

      // Phase 2 (client bundle) runs BEFORE Phase 3 (SSG) (#1471): the SSG
      // render pass and the request-time artifact then carry the final
      // client asset addresses from the Phase 2 build manifest. SSG needs
      // only Phase 1 facts — it renders HTML from the SSR bundle and the
      // Phase 1 metadata in ctx, and buildSSG hands the manifest's entry URL
      // to the SSR bundle so every rendered page embeds the final script
      // tag at document time (#1471, S4b).
      const ssgIslandTagNames = [...(ctx.phase1.islandTagNames ?? [])];
      const ssgIslandFiles = [...(ctx.phase1.islandFiles ?? [])];
      const hasEnhancedForms = (ctx.phase1.cachedRoutes ?? []).some(
        (route) => route.type === 'page' && route.hasEnhancedForms === true,
      );
      if (totalIslands > 0 || hasEnhancedForms) {
        await runClientIslandBuild(ctx);
      }

      log.info('[3/3] Static site generation...');
      try {
        const { buildSSG } = await import('../cli/build-ssg.ts');
        await buildSSG(
          {
            routes: ctx.phase1.cachedRoutes,
            islandTagNames: ssgIslandTagNames,
            islandFiles: ssgIslandFiles,
            islandMeta: ctx.phase1.islandMeta,
            staticComponents: ctx.phase1.staticComponents,
            packageManifests: ctx.phase1.packageManifests,
            cemClassifications: ctx.phase1.cemClassifications,
            foreignTags: ctx.phase1.foreignTags,
            dynamicRouteFailure: options.ssg?.dynamicRouteFailure,
          },
          ctx,
        );
        ctx.markComplete(3);
        log.info('[3/3] Static site generation - complete');
      } catch (error) {
        log.error(`[3/3] Static site generation - FAILED: ${error}`);
        throw error;
      }

      // -- Per-page island manifests + record the request-time asset manifest --
      // Runs after Phase 3: the island manifests post-process the rendered
      // pages, and dist/server/client-assets.js overwrites the placeholder
      // the SSG render wrote. The asset URLs come from the Phase 2 client
      // asset manifest (#1471), keyed by compile-time island identity. The
      // script tags themselves needed no post-processing — the Phase 3
      // render pass embedded them at document time.
      if (ctx.isComplete(2)) {
        try {
          const manifest = ctx.clientAssetManifest;
          if (manifest) {
            await postProcessClientIslandBuild(ctx);
            await writeRequestTimeClientAssets(ctx, manifest);
            log.info(`Client scripts rendered from the asset manifest: ${manifest.entry}`);
          } else {
            log.info('No Phase 2 client asset manifest - island manifests skipped');
          }
        } catch (error) {
          log.error(`Failed to record client assets: ${error}`);
          throw error;
        }
      } else {
        log.info('No Phase 2 - island manifests and client assets skipped');
      }

      // -- Clean Phase 1 SSR artifacts from public dist --
      try {
        await cleanSsrArtifacts(ctx);
      } catch (error) {
        log.warn(`Failed to clean SSR artifacts: ${error}`);
      }

      // -- Tailwind preset (alpha9 C2 #1505, opt-in) --
      // Runs last so the bundle compiles and the link emission sees the final
      // rendered pages. OFF (the default) skips this whole block: the build
      // stays byte-identical to a preset-less pipeline.
      const tailwindOptions = resolveTailwindPresetOptions(options.tailwind);
      if (tailwindOptions) {
        try {
          const presetOutDir = join(
            config.root ?? process.cwd(),
            config.build.outDir || DEFAULT_OUT_DIR,
          );
          await applyTailwindPreset(tailwindOptions, config, presetOutDir);
        } catch (error) {
          log.error(`Tailwind preset FAILED: ${error}`);
          throw error;
        }
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
