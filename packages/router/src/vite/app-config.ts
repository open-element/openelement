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
import { conventionAppShellPath } from '../config.ts';
import { conventionHeadPath } from '../config.ts';
import { conventionTokensPath } from '../config.ts';
import { resolveDirs } from '../config.ts';
import { headScriptsToInject } from './head-channel.ts';
import { headStylesheetsToInject } from './head-channel.ts';
import {
  assertValidUserConfig,
  CONVENTION_APP_SHELL_TAG,
  CONVENTION_PACKAGE_JSON,
  frameworkOptionsConflict,
  hasInlineFrameworkOptions,
  hasUserConfigEntries,
  OPEN_ELEMENT_CONFIG_FILE,
  OPEN_ELEMENT_HEAD_KEYS,
  OPEN_ELEMENT_HEAD_STRING_KEYS,
  type OpenElementUserConfig,
  tagNameFromModule,
} from '../config.ts';

/** A file convention that supplied options for this resolution. */
export interface ConventionUse {
  /** Project-relative convention path. */
  path: string;
  /** What the convention provided. */
  provides: 'tokens' | 'appShell' | 'title' | 'head';
}

/** Resolution result handed back to the consumers. */
export interface ResolvedAppConfig {
  /** Framework options after the config file and the file conventions. */
  options: FrameworkOptions;
  /** Absolute config-file path, or null when the app has no config file. */
  configFile: string | null;
  /** Conventions that contributed (empty when every option was explicit). */
  conventions: ConventionUse[];
  /**
   * Project-relative path of the `app/head.tsx` convention, or null when the
   * app has none. The module itself is compiled by the build (head-convention.ts)
   * — this loader only states WHICH file the convention resolved to.
   */
  headConventionFile: string | null;
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

/** The inline framework-options key that was renamed to `head` (see below). */
export const RENAMED_INLINE_HEAD_KEY = 'html';

/**
 * The inline `openElement({ ... })` face spells the document-head channel
 * `head`, exactly like `openelement.config.ts` does. The old inline name `html`
 * had two spellings for one channel; accepting both would let a build read a
 * key the config file rejects, so passing it fails closed and names the
 * replacement.
 *
 * Only the framework-options face is checked here: `FrameworkOptions.html` is
 * the internal transfer shape the resolved options carry, and the low-level
 * `createOpenPlugin()` (not public API) keeps reading it.
 */
export function assertNoRenamedInlineKeys(options: Record<string, unknown> | undefined): void {
  if (!options || options[RENAMED_INLINE_HEAD_KEY] === undefined) return;
  throw new OpenElementError(
    `[openElement] openElement({ ${RENAMED_INLINE_HEAD_KEY}: … }) was renamed: the document-head ` +
      `channel is spelled "head" both inline and in ${OPEN_ELEMENT_CONFIG_FILE}. Move the value ` +
      `to openElement({ head: { title, description, lang, favicon, ogImage, stylesheets, scripts } }) ` +
      `— or, for framework options in a project with a config file, into ` +
      `${OPEN_ELEMENT_CONFIG_FILE} itself and call openElement() with no arguments.`,
    { code: 'CONFIG_RENAMED_KEY', severity: 'error', phase: 'build', recoverable: false },
  );
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
 * The `head` keys this loader turns into the framework's channels. Everything
 * else in {@linkcode OPEN_ELEMENT_HEAD_KEYS} is structure the loader carries
 * through verbatim (title/lang feed the document, scripts/stylesheets feed the
 * structured inject channel), so the two lists together are the whole accepted
 * surface.
 */
const HEAD_KEYS_EMITTED_AS_FRAGMENTS: readonly string[] = ['favicon', 'description', 'ogImage'];

/**
 * Fail closed when the accepted head surface and this loader's handling of it
 * drift apart: a key that config.ts accepts but the loader never reads would be
 * silently ignored — the exact "config that no build reads" failure the
 * fail-closed doctrine rejects. The accepted surface is named in the message so
 * a future addition is a one-line, self-explaining edit instead of a mystery.
 */
function assertHeadSurfaceHandled(): void {
  const handled = new Set([...HEAD_KEYS_EMITTED_AS_FRAGMENTS, ...OPEN_ELEMENT_HEAD_STRING_KEYS]);
  const unhandled = OPEN_ELEMENT_HEAD_KEYS.filter((key) => {
    if (handled.has(key)) return false;
    // Carried through as channels, not as head fragments.
    return key !== 'stylesheets' && key !== 'scripts';
  });
  if (unhandled.length > 0) {
    throw new OpenElementError(
      `[openElement] openelement.config.ts head key(s) ${
        unhandled.join(', ')
      } are accepted by the schema but not read by the loader. Accepted head keys: ${
        OPEN_ELEMENT_HEAD_KEYS.join(', ')
      }. Wire the key into app-config.ts or remove it from the schema.`,
      { code: 'CONFIG_INVALID', severity: 'error', phase: 'build', recoverable: false },
    );
  }
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
  assertHeadSurfaceHandled();
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

  // --- source roots: `dirs` moves the framework's lookups, and the file
  // conventions follow the shared base of the three roots (config.ts).
  const dirs = resolveDirs(overrides.dirs);

  // The head channel has ONE spelling on every face (`head`); the loader reads
  // the config-file block and the inline block through the same translation.
  const inlineHead = inline['head'] as OpenElementUserConfig['head'] | undefined;
  if (inlineHead !== undefined) assertValidUserConfig({ head: inlineHead });
  const headBlock: OpenElementUserConfig['head'] | undefined = overrides.head ?? inlineHead;

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
    const conventionPath = conventionAppShellPath(dirs.base);
    if (existsSync(join(root, conventionPath))) {
      appShell = {
        tagName: CONVENTION_APP_SHELL_TAG,
        import: `./${conventionPath}`,
        props: {},
      };
      conventions.push({ path: conventionPath, provides: 'appShell' });
    }
  }

  // --- title: override > inline head.title > package.json name ---
  let title = headBlock?.title ?? null;
  if (title === null) {
    const name = packageName(root);
    if (name !== null) {
      title = name;
      conventions.push({ path: CONVENTION_PACKAGE_JSON, provides: 'title' });
    }
  }

  // --- token stylesheet: override > convention ---
  const tokenSource = overrides.styles?.tokens ?? conventionTokensPath(dirs.base);
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
    const css = readTextFileIfPresent(join(root, tokenSource));
    if (css !== null) {
      tokensFragment = tokensFragmentFor(css);
      conventions.push({ path: tokenSource, provides: 'tokens' });
    }
  }

  const headFragments = [
    ...(tokensFragment === undefined ? [] : [tokensFragment]),
    ...headFragmentsFor({ head: headBlock, title }),
  ];

  // Only defined keys are returned: the caller applies this on top of its own
  // resolved options (directory defaults are owned by the caller).
  const options: FrameworkOptions = {};
  if (overrides.renderer !== undefined) options.renderer = overrides.renderer;
  // The roots are emitted only when `dirs` was configured: without it the
  // caller's own defaults already are these values, and restating them here
  // would make `resolveAppConfig` look like it owns the directory defaults.
  if (overrides.dirs !== undefined) {
    options.routesDir = dirs.routes;
    options.islandsDir = dirs.islands;
    options.componentsDir = dirs.components;
  }
  if (appShell !== undefined) options.appShell = appShell;
  if (overrides.i18n !== undefined) {
    options.i18n = {
      locales: [...overrides.i18n.locales],
      defaultLocale: overrides.i18n.defaultLocale,
    };
  }
  if (overrides.viewTransition !== undefined) options.viewTransition = overrides.viewTransition;
  if (overrides.speculation !== undefined) options.speculation = overrides.speculation;
  if (overrides.build?.manifestBudget !== undefined) {
    options.build = { ...options.build, manifestBudget: { ...overrides.build.manifestBudget } };
  }
  const lang = headBlock?.lang;
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
  // --- head channel: `head.scripts` / `head.stylesheets` join the structured
  // `inject` channel that owns the one script/link serializer. `packageIslands`
  // additionally becomes the SSR externalization list: a package whose island
  // modules the build admits must be BUNDLED, not imported at run time, and the
  // config surface deliberately has no separate key for that derivation.
  const headScripts = headScriptsToInject(headBlock?.scripts);
  const headStylesheets = headStylesheetsToInject(headBlock?.stylesheets);
  const packageIslands = overrides.packageIslands ?? inline['packageIslands'] as
    | string[]
    | undefined;
  const derivedNoExternal = packageIslands && packageIslands.length > 0
    ? packageIslands
    : undefined;
  const inlineFragments = inlineInject?.headFragments ?? [];
  const inlineScripts = inlineInject?.scripts ?? [];
  const inlineStylesheets = inlineInject?.stylesheets ?? [];
  if (
    headFragments.length > 0 || inlineInject !== undefined ||
    headScripts !== undefined || headStylesheets !== undefined
  ) {
    options.inject = {
      ...inlineInject,
      headFragments: [...inlineFragments, ...headFragments],
      ...(headScripts === undefined ? {} : { scripts: [...inlineScripts, ...headScripts] }),
      ...(headStylesheets === undefined
        ? {}
        : { stylesheets: [...inlineStylesheets, ...headStylesheets] }),
    };
  }
  if (packageIslands !== undefined) options.packageIslands = [...packageIslands];
  if (derivedNoExternal !== undefined) {
    options.ssr = { ...options.ssr, noExternal: [...derivedNoExternal] };
  }

  const headConventionPath = conventionHeadPath(dirs.base);
  const headConventionFile = existsSync(join(root, headConventionPath)) ? headConventionPath : null;
  if (headConventionFile !== null) {
    conventions.push({ path: headConventionFile, provides: 'head' });
  }

  return {
    options,
    configFile,
    // Resolution order is an implementation detail; the reported list is
    // sorted so logs/tests are deterministic.
    conventions: conventions.toSorted((a, b) => a.path.localeCompare(b.path)),
    headConventionFile,
  };
}
