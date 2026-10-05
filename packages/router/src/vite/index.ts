/**
 * @openelement/router/vite - Vite build orchestration for OpenElement apps.
 *
 * Provides the `openPipeline()` Vite plugin that handles:
 * - Route scanning and virtual Hono entry generation
 * - Dev server integration via @hono/vite-dev-server
 * - Island marking transform
 * - SSG build pipeline (Phase 1/2/3)
 * - Core subpath resolution
 *
 * Runtime code (renderDsd, escapeHtml, etc.) lives in @openelement/element;
 * the island authoring helper (defineIslandConfig) is exported from the
 * @openelement/router root entry.
 * This package only contains Vite-specific build orchestration.
 *
 * Module layout: head-injection.ts (HTML fragment validation & serialization)
 * and plugin.ts (internal plugin factory used by openPipeline) carry the
 * implementation; this file is the openPipeline()/buildApp() entry.
 */

// Primary public API
import { build as viteBuild, type InlineConfig, type Plugin } from 'vite';
import type { FrameworkOptions } from './framework.ts';
import { createOpenPlugin } from './plugin.ts';
import { DEFAULT_COMPONENTS_DIR, DEFAULT_ISLANDS_DIR, DEFAULT_ROUTES_DIR } from './paths.ts';

/** Options for the low-level {@linkcode openPipeline} Vite plugin pipeline. */
export interface OpenPipelineConfig {
  /** Build/dev mode. 'ssg' (default) enables SSR dev server + static generation. */
  mode?: 'ssg';
  routes?: { dir?: string };
  output?: { outDir?: string };
  island?: { dir?: string; upgradeStrategy?: string };
  viewTransition?: boolean;
  headExtras?: string;
}

/** Low-level Vite plugin pipeline: SSR dev server, SSG and islands without the content/i18n conveniences of `openElement()`. */
export function openPipeline(config: OpenPipelineConfig = {}): Plugin[] {
  const options: FrameworkOptions = {
    mode: config.mode,
    routesDir: config.routes?.dir || DEFAULT_ROUTES_DIR,
    islandsDir: config.island?.dir || DEFAULT_ISLANDS_DIR,
    componentsDir: DEFAULT_COMPONENTS_DIR,
    viewTransition: config.viewTransition ?? true,
    headExtras: config.headExtras,
    island: config.island as FrameworkOptions['island'],
    build: config.output as FrameworkOptions['build'],
  };
  // #1411: `options` above is default-filled, so it cannot answer whether the
  // CALLER passed framework options — `config` is the caller's own object.
  const inlineOptionsPresent = Object.values(config).some((value) => value !== undefined);
  return createOpenPlugin(options, undefined, { inlineOptionsPresent });
}

/**
 * Build an OpenElement application through the supported adapter boundary.
 *
 * Consumers configure the adapter in `vite.config.ts`; this function owns the
 * invocation so CLI callers do not need to know the adapter's internal build
 * phases or Vite plugin ordering.
 */
export async function buildApp(config: InlineConfig = {}): Promise<unknown> {
  return await viteBuild({ configLoader: 'native', ...config });
}

export { openElement, type OpenElementOptions } from './app-vite.ts';

export type {
  FrameworkOptions,
  OpenElementBlogOptions,
  OpenElementBuildContextLike,
  OpenElementHeaderNavLink,
  OpenElementI18nContextOptions,
  OpenElementI18nOptions,
  OpenElementNavSection,
} from './framework.ts';

// Build context
export { OpenElementBuildContext } from './build-context.ts';

// Build manifest
export type { ArtifactInfo, BuildManifest } from './build-manifest.ts';

// Protocol type re-exports
export type { SpeculationRulesOptions, SsgBehaviorOptions } from './internal/protocol/ssg.ts';

// Head injection (public helpers)
export { buildHeadExtras } from './head-injection.ts';
export type { HeadExtrasResult } from './head-injection.ts';

// MDX integration
export { mdxPlugin } from './plugin-mdx.ts';
export type { OpenMdxPluginOptions } from './plugin-mdx.ts';

// Tailwind preset (alpha9 C2 #1505): opt-in build-layer seams
export {
  TAILWIND_BUNDLE_ASSET,
  TAILWIND_LAYER_ORDER,
  TAILWIND_SCOPE_ASSET,
  applyTailwindPreset,
  renderTailwindPresetEntry,
  renderTailwindScopeFace,
  resolveTailwindPresetOptions,
  scopePresetComponentCss,
} from './preset-tailwind.ts';
export type { TailwindBundleResult, TailwindPresetOptions } from './preset-tailwind.ts';

// Default export
export { openPipeline as default };
