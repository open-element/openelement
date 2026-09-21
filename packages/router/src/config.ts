/**
 * @openelement/router - `openelement.config.ts` user configuration surface
 * (#1411 / D12, alpha.3).
 *
 * The framework options have exactly one home. In a generated app that home is
 * `openelement.config.ts`; the file is OPTIONAL and near-empty by default, and
 * every option it omits is provided by a file convention:
 *
 *   - design tokens: `app/styles/tokens.css` (inlined into the document head)
 *   - app shell:     `app/islands/app-shell.tsx` (auto-registered, deletable)
 *   - site title:    the `name` field of `package.json`
 *
 * Conflict rule (fail-closed, design principles P6): framework options have
 * exactly ONE home. Passing framework options inline to `openElement()` while a
 * non-empty config file exists is a hard error, never a silent merge.
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

/** Convention path for the design-token stylesheet. */
export const CONVENTION_TOKENS_PATH = 'app/styles/tokens.css';

/** Convention path for the auto-registered application shell. */
export const CONVENTION_APP_SHELL_PATH = 'app/islands/app-shell.tsx';

/** The tag name the convention shell is registered under. */
export const CONVENTION_APP_SHELL_TAG = 'app-shell';

/** The site-title convention source (the package.json `name` field). */
export const CONVENTION_PACKAGE_JSON = 'package.json';

/** Overrides accepted by an `openelement.config.ts` file (unknown keys fail closed). */
export interface OpenElementUserConfig {
  /** Page renderer. Omit to keep the compiled native renderer. */
  renderer?: 'native' | 'lit';
  /**
   * Application shell. `false` opts out of the `app/islands/app-shell.tsx`
   * convention; an object registers the named module. `tagName` is derived
   * from the import's basename, so it is not part of the surface.
   */
  appShell?: false | {
    import: string;
    props?: Record<string, unknown>;
  };
  /** Document head channel. */
  head?: {
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
  };
  /** Stylesheet channel. */
  styles?: {
    /** Token stylesheet path; defaults to the `app/styles/tokens.css` convention. */
    tokens?: string;
  };
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
 * reject).
 */
export const OPEN_ELEMENT_CONFIG_KEYS: readonly string[] = [
  'renderer',
  'appShell',
  'head',
  'styles',
  'middleware',
];

const HEAD_KEYS: readonly string[] = ['title', 'description', 'lang', 'favicon', 'ogImage'];
const APP_SHELL_KEYS: readonly string[] = ['import', 'props'];
const STYLES_KEYS: readonly string[] = ['tokens'];
const MIDDLEWARE_KEYS: readonly string[] = ['corsOrigin'];

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

  const { renderer, appShell, head, styles, middleware } = value;
  if (renderer !== undefined && renderer !== 'native' && renderer !== 'lit') {
    throw typeError('renderer', `'native' or 'lit'`, renderer);
  }

  if (appShell !== undefined && appShell !== false) {
    if (!isPlainObject(appShell)) throw typeError('appShell', 'false or an object', appShell);
    assertKnownKeys(appShell, 'appShell', APP_SHELL_KEYS);
    assertStringKey('appShell.import', appShell.import);
    if (appShell.props !== undefined && !isPlainObject(appShell.props)) {
      throw typeError('appShell.props', 'an object', appShell.props);
    }
  }

  if (head !== undefined) {
    if (!isPlainObject(head)) throw typeError('head', 'an object', head);
    assertKnownKeys(head, 'head', HEAD_KEYS);
    for (const key of HEAD_KEYS) {
      const entry = head[key];
      if (entry !== undefined) assertStringKey(`head.${key}`, entry);
    }
  }

  if (styles !== undefined) {
    if (!isPlainObject(styles)) throw typeError('styles', 'an object', styles);
    assertKnownKeys(styles, 'styles', STYLES_KEYS);
    if (styles.tokens !== undefined) assertStringKey('styles.tokens', styles.tokens);
  }

  if (middleware !== undefined) {
    if (!isPlainObject(middleware)) throw typeError('middleware', 'an object', middleware);
    assertKnownKeys(middleware, 'middleware', MIDDLEWARE_KEYS);
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
