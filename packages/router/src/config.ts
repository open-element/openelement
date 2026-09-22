/**
 * @openelement/router - `openelement.config.ts` user configuration surface
 * (#1411 / D12, alpha.3; extended in alpha.4 by the config-schema review).
 *
 * The framework options have exactly one home. In a generated app that home is
 * `openelement.config.ts`; the file is OPTIONAL and near-empty by default, and
 * every option it omits is provided by a file convention:
 *
 *   - design tokens: `app/styles/tokens.css` (inlined into the document head)
 *   - app shell:     `app/islands/app-shell.tsx` (auto-registered, deletable)
 *   - site title:    the `name` field of `package.json`
 *   - document head: `app/head.tsx` (structural head content, see below)
 *
 * Conflict rule (fail-closed, design principles P6): framework options have
 * exactly ONE home. Passing framework options inline to `openElement()` while a
 * non-empty config file exists is a hard error, never a silent merge.
 *
 * ## `dirs` — where the conventions resolve
 *
 * `dirs` moves the framework's source roots. The tokens.css and app-shell.tsx
 * conventions FOLLOW the move: they resolve under the SHARED base directory of
 * the three configured roots — their longest common leading path — so
 *
 *   dirs: { routes: 'src/routes', islands: 'src/islands', components: 'src/components' }
 *
 * resolves the conventions as `src/styles/tokens.css` and
 * `src/islands/app-shell.tsx` (and, for a site that keeps one, `src/data/...`).
 * A partial override that leaves the three roots without a shared leading
 * segment (`dirs: { routes: 'src/pages' }` against the default `app/islands`
 * and `app/components`) moves only the overridden root and leaves the
 * conventions at their defaults — the shared base is then `app`, exactly as
 * when `dirs` is omitted. `dirs` never changes the Vite root: the project root
 * stays the process cwd, and every path stays project-root relative.
 *
 * ## Channels that are NOT part of this surface
 *
 * `inject` (framework options' raw HTML channel) is deliberately absent: raw
 * markup has no home in the config file. Head content is expressed through the
 * structured `head` channel below and through the `app/head.tsx` convention,
 * and the framework option that names an SSR externalization list
 * (`ssr.noExternal`) is derived by the loader from `packageIslands` instead of
 * being configurable — an unknown key is rejected with the accepted-key list.
 *
 * This module is part of the runtime/public surface: it imports no host APIs
 * (no Deno, no Node, no Vite) so an app config file can import `defineConfig`
 * from `@openelement/router` in any host. File reading and the actual loading
 * live in the host-tooling loader (src/vite/app-config.ts).
 */

// `@openelement/element/authoring` is the kernel-free leaf: importing the
// package root barrel here would pull the Native runtime kernel into the
// config surface and break the Lit server entry's kernel-free boundary
// (lit-graph-boundary.test.ts).
import { OpenElementError } from '@openelement/element/authoring';

/** Canonical config-file name, resolved in the project root. */
export const OPEN_ELEMENT_CONFIG_FILE = 'openelement.config.ts';

/** Default route directory (`app/routes`), the `dirs.routes` default. */
export const CONVENTION_ROUTES_DIR = 'app/routes';

/** Default island directory (`app/islands`), the `dirs.islands` default. */
export const CONVENTION_ISLANDS_DIR = 'app/islands';

/** Default component directory (`app/components`), the `dirs.components` default. */
export const CONVENTION_COMPONENTS_DIR = 'app/components';

/**
 * Default convention base: the directory the tokens/app-shell/data conventions
 * resolve under when `dirs` is omitted (or has no shared leading segment).
 */
export const CONVENTION_BASE_DIR = 'app';

/** Convention-relative suffix of the design-token stylesheet. */
export const CONVENTION_STYLES_SUFFIX = 'styles/tokens.css';

/** Convention-relative suffix of the auto-registered application shell. */
export const CONVENTION_APP_SHELL_SUFFIX = 'islands/app-shell.tsx';

/** Convention-relative suffix of the structural document-head module. */
export const CONVENTION_HEAD_SUFFIX = 'head.tsx';

/** Convention path for the design-token stylesheet. */
export const CONVENTION_TOKENS_PATH = `${CONVENTION_BASE_DIR}/${CONVENTION_STYLES_SUFFIX}`;

/** Convention path for the auto-registered application shell. */
export const CONVENTION_APP_SHELL_PATH = `${CONVENTION_BASE_DIR}/${CONVENTION_APP_SHELL_SUFFIX}`;

/** Convention path for the structural document-head module (`app/head.tsx`). */
export const CONVENTION_HEAD_PATH = `${CONVENTION_BASE_DIR}/${CONVENTION_HEAD_SUFFIX}`;

/** The tag name the convention shell is registered under. */
export const CONVENTION_APP_SHELL_TAG = 'app-shell';

/** The site-title convention source (the package.json `name` field). */
export const CONVENTION_PACKAGE_JSON = 'package.json';

/** One structured `<script src>` descriptor accepted by `head.scripts`. */
export interface OpenElementHeadScript {
  /** Script URL: absolute, or site-root relative (`/prism-init.js`). */
  src: string;
  /** Emit `defer`; leave unset for a parser-blocking external script. */
  defer?: boolean;
  /** `crossorigin` attribute value, e.g. `anonymous`. */
  crossOrigin?: string;
  /** Subresource-integrity digest for the script. */
  integrity?: string;
}

/**
 * The document-head channel. Structured only: every entry serializes through
 * the framework's URL/attribute validators, so a raw HTML string has no way in.
 * Structural head content that is not expressible here (font preloads, icons,
 * feed links, inline CSS) belongs in the `app/head.tsx` convention instead.
 */
export interface OpenElementHeadConfig {
  /** Document title; defaults to the package.json `name`. */
  title?: string;
  /** `<meta name="description">` + `og:description`. */
  description?: string;
  /** `<html lang>`; defaults to `en`. */
  lang?: string;
  /** Site-root-relative favicon path, emitted as `<link rel="icon">`. */
  favicon?: string;
  /** `og:image` URL. Absolute (crawlable) or site-root-relative. */
  ogImage?: string;
  /** External stylesheets linked into `<head>`. */
  stylesheets?: string[];
  /** External scripts emitted into `<head>`; inline code is not accepted here. */
  scripts?: OpenElementHeadScript[];
}

/** Locale configuration for a locale-prefixed build. */
export interface OpenElementI18nConfig {
  /** Every locale the build emits, default locale included. */
  locales: string[];
  /** The locale served at the unprefixed root. */
  defaultLocale: string;
}

/** Source roots; see the `dirs` section of the module doc comment. */
export interface OpenElementDirsConfig {
  /** Route directory. Defaults to `app/routes`. */
  routes?: string;
  /** Island directory. Defaults to `app/islands`. */
  islands?: string;
  /** Component directory. Defaults to `app/components`. */
  components?: string;
}

/** Build-output switches. */
export interface OpenElementBuildConfig {
  /**
   * Advisory per-entry manifest budgets in KB, e.g.
   * `{ islandKB: 100, totalJsKB: 300 }`.
   */
  manifestBudget?: Record<string, number>;
}

/** Overrides accepted by an `openelement.config.ts` file (unknown keys fail closed). */
export interface OpenElementUserConfig {
  /** Page renderer. Omit to keep the compiled native renderer. */
  renderer?: 'native' | 'lit';
  /** Source roots; moves the tokens/app-shell/head conventions with them. */
  dirs?: OpenElementDirsConfig;
  /**
   * Application shell. `false` opts out of the `app-shell.tsx` convention; an
   * object registers the named module. `tagName` is derived from the import's
   * basename, so it is not part of the surface.
   */
  appShell?: false | {
    import: string;
    props?: Record<string, unknown>;
  };
  /**
   * Extra package names whose island modules the build admits (e.g.
   * `['@openelement/ui']`). The loader folds this list into the SSR
   * externalization list the bundler needs, so a package listed here is
   * bundled rather than imported at run time; there is no separate
   * `ssr.noExternal` key.
   */
  packageIslands?: string[];
  /** Document head channel (structured entries only). */
  head?: OpenElementHeadConfig;
  /** Stylesheet channel. */
  styles?: {
    /** Token stylesheet path; defaults to the `styles/tokens.css` convention. */
    tokens?: string;
  };
  /** Locale-prefixed build configuration. */
  i18n?: OpenElementI18nConfig;
  /**
   * Client-navigation View Transitions. Boolean for now; an object form
   * (per-transition types) is a possible future widening of this key.
   */
  viewTransition?: boolean;
  /**
   * Speculation Rules emission. Boolean for now: `true` uses the framework
   * route-derived defaults, `false` emits none. An object form (explicit
   * prerender/prefetch lists, exclusions, eagerness) is a possible future
   * widening of this key.
   */
  speculation?: boolean;
  /** Build-output switches. */
  build?: OpenElementBuildConfig;
  /** Built-in middleware channel. */
  middleware?: {
    /** CORS allowlist; omitted means localhost-only reflection (production warning). */
    corsOrigin?: string | string[];
  };
}

/** `defineConfig()` — identity helper that pins the config file's shape. */
export function defineConfig(config: OpenElementUserConfig): OpenElementUserConfig {
  return config;
}

/**
 * The exact accepted key set, used by the fail-closed unknown-key check and by
 * the error message (the message must name the accepted surface, never just
 * reject). The nested arrays below are this module's single copy of the
 * sub-key surfaces; the host-tooling loader imports them instead of restating
 * them.
 */
export const OPEN_ELEMENT_CONFIG_KEYS: readonly string[] = [
  'renderer',
  'dirs',
  'appShell',
  'packageIslands',
  'head',
  'styles',
  'i18n',
  'viewTransition',
  'speculation',
  'build',
  'middleware',
];

/** Accepted keys inside `head`. */
export const OPEN_ELEMENT_HEAD_KEYS: readonly string[] = [
  'title',
  'description',
  'lang',
  'favicon',
  'ogImage',
  'stylesheets',
  'scripts',
];

/** Keys of one `head.scripts` entry. */
export const OPEN_ELEMENT_HEAD_SCRIPT_KEYS: readonly string[] = [
  'src',
  'defer',
  'crossOrigin',
  'integrity',
];

/** Head keys that carry a plain string value. */
export const OPEN_ELEMENT_HEAD_STRING_KEYS: readonly string[] = [
  'title',
  'description',
  'lang',
  'favicon',
  'ogImage',
];

/** Accepted keys inside `dirs`. */
export const OPEN_ELEMENT_DIRS_KEYS: readonly string[] = ['routes', 'islands', 'components'];

/** Accepted keys inside `appShell`. */
export const OPEN_ELEMENT_APP_SHELL_KEYS: readonly string[] = ['import', 'props'];

/** Accepted keys inside `styles`. */
export const OPEN_ELEMENT_STYLES_KEYS: readonly string[] = ['tokens'];

/** Accepted keys inside `i18n`. */
export const OPEN_ELEMENT_I18N_KEYS: readonly string[] = ['locales', 'defaultLocale'];

/** Accepted keys inside `build`. */
export const OPEN_ELEMENT_BUILD_KEYS: readonly string[] = ['manifestBudget'];

/** Accepted keys inside `middleware`. */
export const OPEN_ELEMENT_MIDDLEWARE_KEYS: readonly string[] = ['corsOrigin'];

function configError(message: string, code: string): OpenElementError {
  return new OpenElementError(`[openElement] ${message}`, {
    code,
    severity: 'error',
    phase: 'build',
    recoverable: false,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKeyError(
  key: string,
  owner: string,
  accepted: readonly string[],
): OpenElementError {
  return configError(
    `Unknown ${owner} key "${key}" in ${OPEN_ELEMENT_CONFIG_FILE} (OEC config schema). ` +
      `Accepted keys: ${
        accepted.join(', ')
      }. Remove the key or move the option to a supported one.`,
    'CONFIG_UNKNOWN_KEY',
  );
}

function typeError(key: string, expected: string, actual: unknown): OpenElementError {
  const seen = actual === null ? 'null' : Array.isArray(actual) ? 'array' : typeof actual;
  return configError(
    `${OPEN_ELEMENT_CONFIG_FILE} key "${key}" must be ${expected}; got ${seen}.`,
    'CONFIG_INVALID',
  );
}

function assertKnownKeys(
  value: Record<string, unknown>,
  owner: string,
  accepted: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!accepted.includes(key)) throw unknownKeyError(key, owner, accepted);
  }
}

function assertStringKey(key: string, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw typeError(key, 'a non-empty string', value);
  }
}

function assertBooleanKey(key: string, value: unknown): void {
  if (typeof value !== 'boolean') throw typeError(key, 'a boolean', value);
}

function assertStringArray(key: string, value: unknown): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw typeError(key, 'an array of strings', value);
  }
}

/**
 * Validate one config-file export. Throws {@linkcode OpenElementError} with
 * `CONFIG_UNKNOWN_KEY` / `CONFIG_INVALID`; returns nothing, so validation can
 * never be skipped by ignoring a return value.
 */
export function assertValidUserConfig(value: unknown): asserts value is OpenElementUserConfig {
  if (!isPlainObject(value)) {
    throw configError(
      `${OPEN_ELEMENT_CONFIG_FILE} must default-export a config object ` +
        `(use defineConfig({ ... }) from '@openelement/router'); got ${
          value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value
        }.`,
      'CONFIG_INVALID',
    );
  }
  assertKnownKeys(value, 'top-level', OPEN_ELEMENT_CONFIG_KEYS);

  const {
    renderer,
    dirs,
    appShell,
    packageIslands,
    head,
    styles,
    i18n,
    viewTransition,
    speculation,
    build,
    middleware,
  } = value;
  if (renderer !== undefined && renderer !== 'native' && renderer !== 'lit') {
    throw typeError('renderer', `'native' or 'lit'`, renderer);
  }

  if (dirs !== undefined) {
    if (!isPlainObject(dirs)) throw typeError('dirs', 'an object', dirs);
    assertKnownKeys(dirs, 'dirs', OPEN_ELEMENT_DIRS_KEYS);
    for (const key of OPEN_ELEMENT_DIRS_KEYS) {
      if (dirs[key] !== undefined) assertStringKey(`dirs.${key}`, dirs[key]);
    }
  }

  if (appShell !== undefined && appShell !== false) {
    if (!isPlainObject(appShell)) throw typeError('appShell', 'false or an object', appShell);
    assertKnownKeys(appShell, 'appShell', OPEN_ELEMENT_APP_SHELL_KEYS);
    assertStringKey('appShell.import', appShell.import);
    if (appShell.props !== undefined && !isPlainObject(appShell.props)) {
      throw typeError('appShell.props', 'an object', appShell.props);
    }
  }

  if (packageIslands !== undefined) {
    assertStringArray('packageIslands', packageIslands);
  }

  if (head !== undefined) {
    if (!isPlainObject(head)) throw typeError('head', 'an object', head);
    assertKnownKeys(head, 'head', OPEN_ELEMENT_HEAD_KEYS);
    for (const key of OPEN_ELEMENT_HEAD_STRING_KEYS) {
      const entry = head[key];
      if (entry !== undefined) assertStringKey(`head.${key}`, entry);
    }
    if (head.stylesheets !== undefined) {
      assertStringArray('head.stylesheets', head.stylesheets);
    }
    if (head.scripts !== undefined) {
      if (!Array.isArray(head.scripts)) {
        throw typeError('head.scripts', 'an array of script descriptors', head.scripts);
      }
      for (const [index, script] of head.scripts.entries()) {
        if (!isPlainObject(script)) {
          throw typeError(`head.scripts[${index}]`, 'an object', script);
        }
        assertKnownKeys(script, `head.scripts[${index}]`, OPEN_ELEMENT_HEAD_SCRIPT_KEYS);
        assertStringKey(`head.scripts[${index}].src`, script.src);
        if (script.defer !== undefined) {
          assertBooleanKey(`head.scripts[${index}].defer`, script.defer);
        }
        if (script.crossOrigin !== undefined) {
          assertStringKey(`head.scripts[${index}].crossOrigin`, script.crossOrigin);
        }
        if (script.integrity !== undefined) {
          assertStringKey(`head.scripts[${index}].integrity`, script.integrity);
        }
      }
    }
  }

  if (styles !== undefined) {
    if (!isPlainObject(styles)) throw typeError('styles', 'an object', styles);
    assertKnownKeys(styles, 'styles', OPEN_ELEMENT_STYLES_KEYS);
    if (styles.tokens !== undefined) assertStringKey('styles.tokens', styles.tokens);
  }

  if (i18n !== undefined) {
    if (!isPlainObject(i18n)) throw typeError('i18n', 'an object', i18n);
    assertKnownKeys(i18n, 'i18n', OPEN_ELEMENT_I18N_KEYS);
    assertStringArray('i18n.locales', i18n.locales);
    assertStringKey('i18n.defaultLocale', i18n.defaultLocale);
  }

  // `viewTransition` and `speculation` widen from boolean to object with the
  // feature that needs it; accepting an object today would let a config that
  // no build reads pass validation.
  if (viewTransition !== undefined) assertBooleanKey('viewTransition', viewTransition);
  if (speculation !== undefined) assertBooleanKey('speculation', speculation);

  if (build !== undefined) {
    if (!isPlainObject(build)) throw typeError('build', 'an object', build);
    assertKnownKeys(build, 'build', OPEN_ELEMENT_BUILD_KEYS);
    const { manifestBudget } = build;
    if (manifestBudget !== undefined) {
      if (!isPlainObject(manifestBudget)) {
        throw typeError('build.manifestBudget', 'an object of numbers', manifestBudget);
      }
      for (const [key, entry] of Object.entries(manifestBudget)) {
        if (typeof entry !== 'number' || !Number.isFinite(entry)) {
          throw typeError(`build.manifestBudget.${key}`, 'a finite number', entry);
        }
      }
    }
  }

  if (middleware !== undefined) {
    if (!isPlainObject(middleware)) throw typeError('middleware', 'an object', middleware);
    assertKnownKeys(middleware, 'middleware', OPEN_ELEMENT_MIDDLEWARE_KEYS);
    const { corsOrigin } = middleware;
    if (corsOrigin !== undefined) {
      const ok = typeof corsOrigin === 'string' ||
        (Array.isArray(corsOrigin) && corsOrigin.every((origin) => typeof origin === 'string'));
      if (!ok) {
        throw typeError('middleware.corsOrigin', 'a string or an array of strings', corsOrigin);
      }
    }
  }
}

/** True when a config-file export carries at least one override. */
export function hasUserConfigEntries(config: OpenElementUserConfig): boolean {
  return Object.keys(config).length > 0;
}

/**
 * True when an inline `openElement()` argument carries at least one framework
 * option (`undefined` values do not count: a caller may forward a sparse
 * options object). Used for the one-home conflict rule.
 */
export function hasInlineFrameworkOptions(options: Record<string, unknown> | undefined): boolean {
  if (!options) return false;
  return Object.values(options).some((value) => value !== undefined);
}

/**
 * The framework-options conflict (P6): a non-empty config file and inline
 * options cannot both define framework behavior — that is exactly the
 * "framework options have two homes" state the config file exists to remove.
 */
export function frameworkOptionsConflict(): OpenElementError {
  return configError(
    `Framework options have two homes: ${OPEN_ELEMENT_CONFIG_FILE} exists and carries options, ` +
      `and openElement(...) received inline framework options. Keep ONE home — move every ` +
      `framework option into ${OPEN_ELEMENT_CONFIG_FILE} and call openElement() with no ` +
      `arguments, or delete the file and keep them inline. Silent merging is rejected by design.`,
    'CONFIG_CONFLICT',
  );
}

/** Derive the shell tag name from its module basename (`app-shell.tsx` -> `app-shell`). */
export function tagNameFromModule(importPath: string): string {
  const base = importPath.split('/').pop() ?? importPath;
  const withoutExtension = base.replace(/\.(tsx|ts|jsx|js)$/u, '');
  return withoutExtension
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^a-zA-Z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
}

/**
 * Resolve `dirs` to the three absolute-in-project roots the scanner reads.
 * Omitted entries take the documented defaults.
 */
export function resolveDirs(dirs: OpenElementDirsConfig | undefined): {
  routes: string;
  islands: string;
  components: string;
  /** The shared leading directory the file conventions resolve under. */
  base: string;
} {
  const routes = stripTrailingSlash(dirs?.routes ?? CONVENTION_ROUTES_DIR);
  const islands = stripTrailingSlash(dirs?.islands ?? CONVENTION_ISLANDS_DIR);
  const components = stripTrailingSlash(dirs?.components ?? CONVENTION_COMPONENTS_DIR);
  return { routes, islands, components, base: conventionBaseDir([routes, islands, components]) };
}

function stripTrailingSlash(path: string): string {
  return path.replace(/\/+$/u, '');
}

/**
 * The shared leading path of every configured root. Falls back to
 * {@linkcode CONVENTION_BASE_DIR} (`app`) when the roots share no leading
 * segment: the conventions then keep their defaults while the overridden
 * roots move, which is the documented partial-override behavior.
 */
function conventionBaseDir(roots: readonly string[]): string {
  const segments = roots.map((root) => root.split('/').filter(Boolean));
  const first = segments[0] ?? [];
  const shared: string[] = [];
  for (let index = 0; index < first.length; index++) {
    const segment = first[index];
    if (segments.every((parts) => parts[index] === segment)) shared.push(segment);
    else break;
  }
  return shared.length > 0 ? shared.join('/') : CONVENTION_BASE_DIR;
}

/** The token stylesheet convention path for a resolved `dirs` block. */
export function conventionTokensPath(base: string): string {
  return `${base}/${CONVENTION_STYLES_SUFFIX}`;
}

/** The app-shell convention path for a resolved `dirs` block. */
export function conventionAppShellPath(base: string): string {
  return `${base}/${CONVENTION_APP_SHELL_SUFFIX}`;
}

/** The structural document-head convention path for a resolved `dirs` block. */
export function conventionHeadPath(base: string): string {
  return `${base}/${CONVENTION_HEAD_SUFFIX}`;
}
