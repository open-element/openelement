/** Adapter-owned framework, build, content, and routing contracts. */
import type { FrameworkOptions as ElementFrameworkOptions } from '@openelement/element';
import type { CriticalAssetsOptions } from './internal/ssg/critical-assets.ts';

export type {
  AppShellConfig,
  CompatibilityClassification,
  CompatibilityTier,
  ComponentLayer,
  HydrationStrategy,
  RenderError,
  RouteEntry,
  SpecialFileType,
  SsrAdmissionDecision,
} from '@openelement/element';

/**
 * Adapter options extend Element options with build-only delivery
 * declarations. The element package remains unaware of Vite/SSG policy.
 */
export type FrameworkOptions = ElementFrameworkOptions & {
  criticalAssets?: CriticalAssetsOptions;
  critical?: CriticalAssetsOptions;
};

/** Blog options stored in the adapter build context. */
export interface OpenElementBlogOptions {
  contentDir?: string;
  basePath?: string;
}

/** Navigation section produced by the adapter content pipeline. */
export interface OpenElementNavSection {
  section: string;
  items: Array<{ path: string; label: string; order?: number }>;
}

/** One header navigation link (href + label) in the generated site nav. */
export interface OpenElementHeaderNavLink {
  href: string;
  label: string;
}

/** Locale options carried through the build context to the i18n integration. */
export interface OpenElementI18nContextOptions {
  locales: string[];
  defaultLocale: string;
  [key: string]: unknown;
}

/** Minimal build-context contract available to adapter sub-plugins. */
export interface OpenElementBuildContextLike {
  plugins: {
    blogOptions: OpenElementBlogOptions | null;
    navSections: OpenElementNavSection[];
    headerNav: OpenElementHeaderNavLink[];
    sitemapOptions: Record<string, unknown> | null;
    i18nOptions: OpenElementI18nContextOptions | null;
    [key: string]: unknown;
  };
  registerPlugin(name: string, instance: unknown): void;
}

export type { OpenElementPackageManifest } from '@openelement/element';

// Build-side extensions are adapter-owned: Element remains unaware of
// Vite/SSG delivery and critical-path decisions.
export type { IslandDeliveryStrategy } from './internal/ssg/delivery.ts';
export type {
  CriticalAssetsOptions,
  CriticalAssetsResult,
  CriticalFontAsset,
  CriticalInlineScriptAsset,
  CriticalStyleAsset,
} from './internal/ssg/critical-assets.ts';
