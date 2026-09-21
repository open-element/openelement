/**
 * @openelement/router - `openelement.config.ts` loader (host tooling, #1411).
 *
 * One resolution path, three consumers:
 *   - the Vite plugin (src/vite/plugin.ts) — loads the file through Vite's own
 *     TS config loader, so dev, `cli/build` and the SSG phases all read the
 *     same options object;
 *   - `cli/build` — reaches the same code through the plugin it configures;
 *   - `cli/start` — reads the file directly (a dynamic import, never a Vite
 *     config bundle) so a deployed app can be served without Vite.
 *
 * This module deliberately does NOT import Vite: only the plugin path hands in
 * an already-loaded module. File conventions (`app/styles/tokens.css`,
 * `app/islands/app-shell.tsx`, the package.json `name`) are resolved here so
 * every consumer agrees on what "configured" means.
 */

import type { FrameworkOptions } from './framework.ts';
import { existsSync } from '../internal/host-path.ts';
import { join } from '../internal/host-path.ts';
import { toFileUrl } from '../internal/host-path.ts';
import { escapeAttr } from '@openelement/element/html';
import { OpenElementError } from '@openelement/element/authoring';
import {
  assertValidUserConfig,
  CONVENTION_APP_SHELL_PATH,
  CONVENTION_APP_SHELL_TAG,
  CONVENTION_PACKAGE_JSON,
  CONVENTION_TOKENS_PATH,
  frameworkOptionsConflict,
  hasInlineFrameworkOptions,
  hasUserConfigEntries,
  OPEN_ELEMENT_CONFIG_FILE,
  type OpenElementUserConfig,
  tagNameFromModule,
} from '../config.ts';

/** A file convention that supplied options for this resolution. */
export interface ConventionUse {
  /** Project-relative convention path. */
  path: string;
  /** What the convention provided. */
  provides: 'tokens' | 'appShell' | 'title';
}

/** Resolution result handed back to the consumers. */
export interface ResolvedAppConfig {
  /** Framework options after the config file and the file conventions. */
  options: FrameworkOptions;
  /** Absolute config-file path, or null when the app has no config file. */
  configFile: string | null;
  /** Conventions that contributed (empty when every option was explicit). */
  conventions: ConventionUse[];
}

export interface ResolveAppConfigInput {
  /** Absolute project root. */
  root: string;
  /** Absolute config-file path, or null when absent. */
  configFile: string | null;
  /** The config-file default export (already imported by the caller). */
  importedConfig?: unknown;
  /** Framework options the caller passed inline (already default-filled). */
  inlineOptions?: Record<string, unknown>;
  /**
   * Whether the caller supplied any framework option inline. Stated by the
   * caller because default-filled options (openPipeline) are not user input.
   */
  inlineOptionsPresent?: boolean;
}

/** Absolute path of the app config file when the project has one. */
export function detectAppConfigFile(root: string): string | null {
  const candidate = join(root, OPEN_ELEMENT_CONFIG_FILE);
  return existsSync(candidate) ? candidate : null;
}

/**
 * Import the config file through the host runtime (Deno's native TS support in
 * both the repo and the starter). The cache-busting query makes a dev-server
 * edit observable; the Vite plugin path uses Vite's loader instead, which does
 * its own invalidation.
 */
export async function importAppConfigModule(filePath: string): Promise<unknown> {
  const module = await import(`${toFileUrl(filePath)}?t=${Date.now()}`) as { default?: unknown };
  if (module.default === undefined) {
    throw new OpenElementError(
      `[openElement] ${OPEN_ELEMENT_CONFIG_FILE} must default-export a config object: ` +
        `export default defineConfig({ ... }).`,
      { code: 'CONFIG_INVALID', severity: 'error', phase: 'build', recoverable: false },
    );
  }
  return module.default;
}

/**
 * One token-stylesheet fragment; the file's own trailing newline is kept once.
 * No marker attribute: the head-safety validator only admits media/nonce/title
 * on <style> and rejects anything else, which is the correct fail-closed
 * default to stay inside.
 */
function tokensFragmentFor(css: string): string {
  return `<style>\n${css.replace(/\s*$/u, '')}\n</style>`;
}

function readTextFileIfPresent(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return Deno.readTextFileSync(path);
  } catch (error) {
    throw new OpenElementError(
      `[openElement] Could not read ${path}: ${error instanceof Error ? error.message : error}`,
      { code: 'CONFIG_INVALID', severity: 'error', phase: 'build', recoverable: false },
    );
  }
}

function packageName(root: string): string | null {
  const raw = readTextFileIfPresent(join(root, CONVENTION_PACKAGE_JSON));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === 'string' && parsed.name.length > 0 ? parsed.name : null;
  } catch {
    // A malformed package.json is owned by the package manager, not by the
    // title convention: fall back to the next source instead of failing here.
    return null;
  }
}

/** Serialize one `<meta>` tag with escaped attribute values. */
function metaTag(attrs: Record<string, string>): string {
  const serialized = Object.entries(attrs)
    .map(([name, value]) => `${escapeAttr(name)}="${escapeAttr(value)}"`)
    .join(' ');
  return `<meta ${serialized}>`;
}

/**
 * Document-head channel: favicon link plus the site-level Open Graph tags.
 * Page-level head data (title/description/canonical per route) is resolved by
 * the Document seam and emitted ahead of these fragments, so a page's own
 * `og:*` meta always wins for crawlers.
 */
function headFragmentsFor(input: {
  head: NonNullable<OpenElementUserConfig['head']> | undefined;
  title: string | null;
}): string[] {
  const { head, title } = input;
  if (!head) return [];
  const fragments: string[] = [];
  if (head.favicon) {
    fragments.push(`<link rel="icon" href="${escapeAttr(head.favicon)}">`);
  }
  const ogTitle = title;
  if (ogTitle) {
    fragments.push(metaTag({ property: 'og:title', content: ogTitle }));
    fragments.push(metaTag({ property: 'og:site_name', content: ogTitle }));
  }
  if (head.description) {
    fragments.push(metaTag({ property: 'og:description', content: head.description }));
  }
  if (ogTitle || head.description) {
    fragments.push(metaTag({ property: 'og:type', content: 'website' }));
  }
  if (head.ogImage) {
    fragments.push(metaTag({ property: 'og:image', content: head.ogImage }));
    fragments.push(metaTag({ name: 'twitter:card', content: 'summary_large_image' }));
  }
  return fragments;
}

/**
 * Resolve framework options from the config file, the file conventions, and the
 * caller's inline options. Throws fail-closed on the one-home conflict, on an
 * unknown/invalid config key, and on an explicitly configured token stylesheet
 * that does not exist.
 */
export function resolveAppConfig(input: ResolveAppConfigInput): ResolvedAppConfig {
  const { root, configFile } = input;
  const inline = input.inlineOptions ?? {};
  const inlinePresent = input.inlineOptionsPresent ?? hasInlineFrameworkOptions(inline);
  const conventions: ConventionUse[] = [];

  let fileConfig: OpenElementUserConfig | undefined;
  if (configFile !== null) {
    assertValidUserConfig(input.importedConfig);
    fileConfig = input.importedConfig;
    if (hasUserConfigEntries(fileConfig) && inlinePresent) {
      throw frameworkOptionsConflict();
    }
  }
  const overrides: OpenElementUserConfig = fileConfig && hasUserConfigEntries(fileConfig)
    ? fileConfig
    : {};

  const inlineHtml = (inline['html'] ?? undefined) as FrameworkOptions['html'];
  const inlineInject = (inline['inject'] ?? undefined) as FrameworkOptions['inject'];
  const inlineAppShell = inline['appShell'] as FrameworkOptions['appShell'];

  // --- app shell: override > inline > convention ---
  let appShell: FrameworkOptions['appShell'];
  if (overrides.appShell === false) {
    appShell = false;
  } else if (overrides.appShell) {
    appShell = {
      tagName: tagNameFromModule(overrides.appShell.import),
      import: overrides.appShell.import,
      props: overrides.appShell.props ?? {},
    };
  } else if (inlineAppShell !== undefined) {
    appShell = inlineAppShell;
  } else {
    const conventionPath = join(root, CONVENTION_APP_SHELL_PATH);
    if (existsSync(conventionPath)) {
      appShell = {
        tagName: CONVENTION_APP_SHELL_TAG,
        import: `./${CONVENTION_APP_SHELL_PATH}`,
        props: {},
      };
      conventions.push({ path: CONVENTION_APP_SHELL_PATH, provides: 'appShell' });
    }
  }

  // --- title: override > inline html.title > package.json name ---
  const configTitle = overrides.head?.title;
  const inlineTitle = typeof inlineHtml?.title === 'string' ? inlineHtml.title : undefined;
  let title = configTitle ?? inlineTitle ?? null;
  if (title === null) {
    const name = packageName(root);
    if (name !== null) {
      title = name;
      conventions.push({ path: CONVENTION_PACKAGE_JSON, provides: 'title' });
    }
  }

  // --- token stylesheet: override > convention ---
  const tokenSource = overrides.styles?.tokens ?? CONVENTION_TOKENS_PATH;
  let tokensFragment: string | undefined;
  if (overrides.styles?.tokens !== undefined) {
    const css = readTextFileIfPresent(join(root, tokenSource));
    if (css === null) {
      throw new OpenElementError(
        `[openElement] ${OPEN_ELEMENT_CONFIG_FILE} styles.tokens points at "${tokenSource}", ` +
          `but that file does not exist in ${root}. Create it or remove the override.`,
        { code: 'CONFIG_INVALID', severity: 'error', phase: 'build', recoverable: false },
      );
    }
    tokensFragment = tokensFragmentFor(css);
  } else {
    const css = readTextFileIfPresent(join(root, CONVENTION_TOKENS_PATH));
    if (css !== null) {
      tokensFragment = tokensFragmentFor(css);
      conventions.push({ path: CONVENTION_TOKENS_PATH, provides: 'tokens' });
    }
  }

  const headFragments = [
    ...(tokensFragment === undefined ? [] : [tokensFragment]),
    ...headFragmentsFor({ head: overrides.head, title }),
  ];

  // Only defined keys are returned: the caller applies this on top of its own
  // resolved options (directory defaults are owned by the caller).
  const options: FrameworkOptions = {};
  if (overrides.renderer !== undefined) options.renderer = overrides.renderer;
  if (appShell !== undefined) options.appShell = appShell;
  const inlineLang = typeof inlineHtml?.lang === 'string' ? inlineHtml.lang : undefined;
  const lang = overrides.head?.lang ?? inlineLang;
  if (title !== null || lang !== undefined) {
    options.html = {
      ...(title === null ? {} : { title }),
      ...(lang === undefined ? {} : { lang }),
    };
  }
  const corsOrigin = overrides.middleware?.corsOrigin;
  const inlineMiddleware = (inline['middleware'] ?? undefined) as FrameworkOptions['middleware'];
  if (corsOrigin !== undefined || inlineMiddleware !== undefined) {
    options.middleware = {
      ...inlineMiddleware,
      ...(corsOrigin === undefined ? {} : { corsOrigin }),
    };
  }
  const inlineFragments = inlineInject?.headFragments ?? [];
  if (headFragments.length > 0 || inlineInject !== undefined) {
    options.inject = {
      ...inlineInject,
      headFragments: [...inlineFragments, ...headFragments],
    };
  }

  return {
    options,
    configFile,
    // Resolution order is an implementation detail; the reported list is
    // sorted so logs/tests are deterministic.
    conventions: conventions.toSorted((a, b) => a.path.localeCompare(b.path)),
  };
}
