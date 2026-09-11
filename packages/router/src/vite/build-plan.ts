import { join, relative } from 'node:path';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { BuildArtifacts, BuildPlan } from './internal/protocol/ssg.ts';
import type { OpenElementBuildContext } from './build-context.ts';
import { fsPathToModuleSpecifier } from './internal/ssg/module-specifier.ts';
import { resolveIslandHydrate } from './internal/ssg/island-scanner.ts';
import { formatJson, normalizeSeparators } from '@openelement/element/build-utils';
import { formatError } from '@openelement/element';
import { DEFAULT_OUT_DIR, OPEN_ELEMENT_DIR } from './internal/paths.ts';
import { walkFileEntries } from './internal/html-files.ts';

export function createProductionBuildPlan(ctx: OpenElementBuildContext): BuildPlan {
  const root = ctx.phase3.root;
  return {
    options: ctx.options,
    routes: ctx.phase1.cachedRoutes
      .filter((route) => route.type === 'page' || route.type === 'api')
      .map((route) => ({
        kind: route.type as 'page' | 'api',
        path: route.path,
        filePath: route.filePath,
        importPath: route.filePath,
        tagName: route.tagName,
        paramNames: route.params,
      })),
    islands: [
      ...ctx.phase1.islandTagNames.map((tagName, index) => ({
        tagName,
        // #460: join() emits drive-letter backslash paths on Windows; convert
        // to a Vite-resolvable specifier (root-relative or /@fs/).
        modulePath: fsPathToModuleSpecifier(
          join(root, ctx.phase3.islandsDir, ctx.phase1.islandFiles[index] ?? ''),
          root,
        ),
        hydrate: resolveIslandHydrate(
          ctx.phase1.islandMeta[tagName]?.hydrate,
          ctx.options.island?.upgradeStrategy,
        ),
        ssr: ctx.phase1.islandMeta[tagName]?.ssr,
        source: 'local' as const,
      })),
      ...ctx.phase1.packageIslandDecls.map((island) => ({
        tagName: island.tagName,
        modulePath: island.modulePath,
        hydrate: island.hydrate,
        ssr: island.ssr,
        source: 'package' as const,
      })),
      ...ctx.phase1.compilerBehaviorDecls.map((island) => ({
        tagName: island.tagName,
        modulePath: island.modulePath,
        hydrate: island.hydrate,
        ssr: island.ssr,
        source: 'nested' as const,
      })),
    ],
    output: {
      root,
      outDir: ctx.phase3.outDir,
      base: ctx.phase3.base,
      spa: ctx.options.mode === 'spa',
    },
    i18n: ctx.plugins.i18nOptions
      ? {
        locales: ctx.plugins.i18nOptions.locales,
        defaultLocale: ctx.plugins.i18nOptions.defaultLocale,
      }
      : undefined,
    packageIslands: { packages: ctx.options.packageIslands ?? [] },
  };
}

// #710: single shared walker — deterministic order, dotfiles skipped.
function files(root: string): string[] {
  // Missing output dirs must surface as typed build-failure evidence (see
  // collectBuildArtifacts), not as an empty artifact set: the shared walker
  // tolerates missing dirs, so probe with a plain readdirSync first to throw
  // the native ENOENT.
  readdirSync(root);
  return walkFileEntries(root).map((entry) => entry.absolutePath);
}

/**
 * Request-time route evidence for the build manifest, derived from the
 * emitted dist/server/server-manifest.json (0.42.0-alpha.1 / ADR-0120).
 * Returns {} for pure-static builds so their evidence shape is unchanged.
 */
function readRequestTimeRouteEvidence(outputDir: string): { requestTimeRoutes?: string[] } {
  try {
    const manifest = JSON.parse(
      readFileSync(join(outputDir, 'server', 'server-manifest.json'), 'utf8'),
    ) as { requestTimeRoutes?: Array<{ path?: unknown }> };
    const paths = (manifest.requestTimeRoutes ?? [])
      .map((route) => route.path)
      .filter((path): path is string => typeof path === 'string');
    return paths.length > 0 ? { requestTimeRoutes: paths } : {};
  } catch {
    return {};
  }
}

export function collectBuildArtifacts(plan: BuildPlan): BuildArtifacts {
  const root = plan.output.root ?? (typeof Deno !== 'undefined' ? Deno.cwd() : process.cwd());
  const outputDir = join(root, plan.output.outDir ?? DEFAULT_OUT_DIR);
  try {
    const emitted = files(outputDir);
    const pages = emitted.filter((path) => path.endsWith('.html')).map((path) => ({
      path: '/' +
        normalizeSeparators(relative(outputDir, path)).replace(/(?:\/index)?\.html$/, ''),
      html: readFileSync(path, 'utf8'),
      errors: [],
    }));
    const clientAssets = emitted.filter((path) => /\.(?:js|css)$/.test(path)).map((path) => ({
      fileName: normalizeSeparators(relative(outputDir, path)),
      source: readFileSync(path),
      sizeBytes: statSync(path).size,
    }));
    return {
      pages,
      manifest: {
        routes: plan.routes.map((route) => ({
          kind: route.kind,
          path: route.path,
          tagName: route.tagName,
          isDynamic: (route.paramNames?.length ?? 0) > 0,
        })),
        islands: plan.islands,
        ...readRequestTimeRouteEvidence(outputDir),
      },
      clientAssets,
      warnings: [],
      errors: [],
      success: true,
    };
  } catch (error) {
    return {
      pages: [],
      manifest: { routes: [], islands: plan.islands },
      clientAssets: [],
      warnings: [],
      errors: [formatError(error)],
      success: false,
    };
  }
}

export function writeBuildEvidence(plan: BuildPlan, artifacts: BuildArtifacts): void {
  const root = plan.output.root ?? (typeof Deno !== 'undefined' ? Deno.cwd() : process.cwd());
  const evidence = {
    success: artifacts.success,
    pages: artifacts.pages.map(({ path, errors }) => ({ path, errors })),
    manifest: artifacts.manifest,
    clientAssets: artifacts.clientAssets.map(({ fileName, sizeBytes }) => ({
      fileName,
      sizeBytes,
    })),
    warnings: artifacts.warnings,
    errors: artifacts.errors,
  };
  // The evidence dir may not exist on a clean checkout (nothing else creates
  // it since the route-types generation step was removed in #741). Write
  // first; only on ENOENT create the dir and retry once. The lazy path keeps
  // writeFileSync the single fs call on the common path and avoids node:fs
  // mkdirSync in Deno-free shims (build-plan tests hide globalThis.Deno).
  const evidencePath = join(root, OPEN_ELEMENT_DIR, 'build-artifacts.json');
  try {
    writeFileSync(evidencePath, formatJson(evidence));
  } catch (error) {
    if ((error as { code?: unknown })?.code !== 'ENOENT') throw error;
    mkdirSync(join(root, OPEN_ELEMENT_DIR), { recursive: true });
    writeFileSync(evidencePath, formatJson(evidence));
  }
}
