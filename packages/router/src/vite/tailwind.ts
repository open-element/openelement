/**
 * @openelement/router/vite - the Tailwind CSS entry (alpha15 S lane).
 *
 * OpenElement is not a Tailwind implementation. The official
 * `@tailwindcss/vite` plugin owns candidate detection, `@theme` compilation,
 * utility generation and CSS optimization; Vite's own CSS pipeline owns
 * emission (the content-hashed `.css` asset and every `url()` asset the
 * sources reference, base-rewritten, deduplicated and manifested). What the
 * router owns is the framework-facing half of the contract, and nothing more:
 *
 * 1. The app declares its style sources (`tailwind: { theme: [...] }` in
 *    `openelement.config.ts`; package CSS specifiers or app-relative paths).
 * 2. {@linkcode renderTailwindEntry} renders ONE standard CSS entry from
 *    them — `@import 'tailwindcss'` plus one `@import` per source — served as
 *    a virtual module whose id is a real path inside the project root
 *    ({@linkcode tailwindEntryPath}). The path is the module's identity: the
 *    peer derives its `@import`/`url()` resolution base from the id's
 *    directory exactly as it would for a file on disk, while the candidate
 *    scan base stays the project root, so app classes are detected without a
 *    framework-owned scanner.
 * 3. The official plugin runs inside the framework's own build graphs. The
 *    Phase 2 client build mounts the peer directly
 *    ({@linkcode tailwindPlugins}) and is the sole emitter of the document
 *    stylesheet; the dev server mounts it through
 *    {@linkcode devTailwindPlugin}'s hook proxy, because Vite 8 flattens user
 *    plugins before the `config` hook runs and a plugin list cannot be
 *    extended from this side.
 * 4. The router links the emitted stylesheet in every document head — the
 *    Phase 3 SSG output, the request-time server artifact and the dev render
 *    alike — through the framework's one structured stylesheet channel.
 *
 * Retired with this module's introduction (the pre-S preset): the inner Vite
 * build, the staging directory, the compiled-bundle asset copy and `url()`
 * rewrite, the `@layer components` text extraction, the regex `@scope` face,
 * DSD link injection, the full-inline prohibition and the HTML
 * post-processing pass. Every one of those responsibilities is already owned
 * by the official pipeline or by the existing stylesheet channel, and none is
 * re-created here.
 *
 * OFF stays OFF: with no `tailwind` key nothing resolves, no peer is loaded,
 * no module is generated, and the head artifact is byte-identical to a
 * preset-less render.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'pathe';
import type { Plugin } from 'vite';
import { PresetErrorCode, buildError } from '../internal/error-codes.ts';
import { generatedSheetBase, generatedSheetsPlugin } from './internal/generated-sheets.ts';

/**
 * The project-relative path of the virtual entry module. A real-looking path
 * inside the project root is load-bearing: the peer resolves every `@import`
 * and every relative `url()` against the id's directory.
 */
export const TAILWIND_ENTRY_PATH = '.openElement/tailwind.css' as const;

/** The resolved preset options: the declared style sources, in order. */
export interface ResolvedTailwindOptions {
  /**
   * The sources the entry `@import`s after Tailwind itself: package CSS
   * specifiers (`@openelement/ui/theme.css`) or app-relative paths. Their
   * `@theme` blocks, `@import`s and `url()` references compile through the
   * official plugin like any other Tailwind CSS source.
   */
  readonly theme: readonly string[];
  /**
   * WHOSE document the entry is: `true` when the application declared it
   * (`tailwind: true | { theme }`), `false` when an admitted package
   * declaration enabled it (automatic mode, `tailwind: undefined`).
   *
   * The single thing it decides is the DOCUMENT RESET. `@import 'tailwindcss'`
   * carries preflight, and an application that turned the entry on is resetting
   * its own document — that is the pre-S-lane behavior and it stays. In
   * automatic mode the entry is the REDUCED form instead: the theme layer the
   * declared roles come from, the declared sources, and the utilities layer a
   * light-root component's class tokens need. "A package's component needs the
   * compile" says nothing about the application's `h1` margins, its list
   * markers or its native form controls, and a component library that quietly
   * reset every consumer's document would be a framework defect, not a feature.
   *
   * Utilities are NOT a separate switch: a light-root component's classes have
   * no other delivery channel than the document sheet, so they are on whenever
   * the pipeline is on. The reset is the one fact the application owns.
   */
  readonly documentReset: boolean;
}

/** The absolute path of the virtual entry module (its module identity). */
export function tailwindEntryPath(root: string): string {
  return join(root, TAILWIND_ENTRY_PATH);
}

/** The entry's public URL — what the dev document head links. */
export function tailwindEntryUrl(base: string): string {
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  return `${cleanBase}${TAILWIND_ENTRY_PATH}`;
}

/**
 * The virtual entry's module id for one request/build id in either spelling
 * (the absolute module path, or the root-relative URL a document `<link>` and
 * a browser refresh ask the dev server for). The `?query`/`#hash` suffix
 * rides along verbatim so Vite's cache-busting stamps stay exactly as Vite
 * serves them. `undefined` for every id that is not this entry.
 */
export function tailwindEntryModuleId(root: string, id: string): string | undefined {
  const file = tailwindEntryPath(root);
  const suffixAt = id.search(/[?#]/);
  const bare = suffixAt === -1 ? id : id.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? '' : id.slice(suffixAt);
  if (bare === file) return file + suffix;
  // Root-relative URL form ('/' + TAILWIND_ENTRY_PATH; Vite normalizes
  // request ids to POSIX separators before the plugin pipeline).
  if (bare.startsWith('/') && join(root, bare.slice(1)) === file) return file + suffix;
  return undefined;
}

/**
 * Whether one declared style source is a package specifier rather than an
 * app-relative path.
 *
 * A scoped or subpath-import specifier (`@openelement/ui/theme.css`,
 * `#site-ui/tokens.css`) can only be a package reference, and a `./`/`../`/
 * `/` spelling can only be a path. The remaining ambiguity is a bare word
 * path: `app/styles/theme.css` (the documented app-relative form) and
 * `tailwindcss/theme.css` (the Tailwind theme source a consumer may import)
 * are lexically identical. It is resolved by the filesystem: a source that
 * exists under the app root IS the app file; anything else passes through to
 * the compiler as a specifier, which then fails closed with its own
 * unresolved-import diagnostic if the name is wrong.
 */
export function isPackageStyleSource(root: string, source: string): boolean {
  if (source.startsWith('@') || source.startsWith('#')) return true;
  if (source.startsWith('.') || source.startsWith('/') || isAbsolute(source)) return false;
  return !existsSync(resolve(root, source));
}

/**
 * Resolve one declared source to the specifier the entry's `@import` must
 * carry. Package specifiers pass through untouched. App-relative paths resolve
 * against the app root — the stated contract of `TailwindOptions.theme`
 * ("app-relative paths") — and become the relative path from the entry's own
 * directory, which is the only base its `@import` resolves from. Absolute
 * paths are rewritten relative on that same base.
 */
export function resolveTailwindSource(root: string, source: string): string {
  if (isPackageStyleSource(root, source)) return source;
  const absolute = isAbsolute(source) ? source : resolve(root, source);
  // pathe normalizes to `/` separators, so the emitted @import is portable.
  return relative(join(root, '.openElement'), absolute);
}

/**
 * The entry's CSS text: Tailwind, then the declared sources in declaration
 * order, as ordinary `@import`s.
 *
 * Two shapes, one fact apart ({@linkcode ResolvedTailwindOptions.documentReset}):
 *
 * - **Application-declared** (`tailwind: true | { theme }`): `@import
 *   'tailwindcss'` — the theme layer, preflight, and the utilities layer, in
 *   the official package's own order. The application is styling its own
 *   document, so it gets the reset it asked for.
 * - **Automatic** (an admitted package declaration enabled the pipeline):
 *   the REDUCED entry — `tailwindcss/theme.css`, the declared sources,
 *   `tailwindcss/utilities.css`. Same theme layer, same utilities, **no
 *   preflight**: a package's compilation requirement must not restyle the
 *   host document's headings, margins or native form controls. This is the
 *   same reduced shape the component (shadow) entry uses, for the same reason.
 *
 * The one policy the generated entry carries is its first line: a declared
 * source is a Tailwind source (its `@theme` blocks compile against the theme
 * Tailwind installs), and the framework does not filter or reinterpret it.
 */
export function renderTailwindEntry(root: string, options: ResolvedTailwindOptions): string {
  const lines = [
    '/* generated by @openelement/router — the Tailwind CSS entry; do not edit */',
    ...(options.documentReset
      ? ["@import 'tailwindcss';"]
      : [
          '/* reduced entry: an admitted package requirement enabled the compile, so the',
          '   document reset (preflight) is deliberately absent. */',
          "@import 'tailwindcss/theme.css';",
        ]),
  ];
  for (const source of options.theme) {
    lines.push(`@import '${resolveTailwindSource(root, source)}';`);
  }
  if (!options.documentReset) lines.push("@import 'tailwindcss/utilities.css';");
  return lines.join('\n') + '\n';
}

/**
 * The Vite plugins of the official Tailwind integration, resolved lazily so
 * the router stays installable without it (optional peer). Fails closed with
 * a coded error when the peer is missing — a Tailwind-enabled build never
 * silently skips Tailwind.
 */
export async function tailwindPlugins(): Promise<Plugin[]> {
  let tailwindModule: { default: (options?: unknown) => Plugin[] };
  try {
    tailwindModule = (await import('@tailwindcss/vite')) as typeof tailwindModule;
  } catch (cause) {
    throw buildError(
      PresetErrorCode.TAILWIND_UNRESOLVABLE,
      '[tailwind] the tailwind option is enabled but @tailwindcss/vite is not resolvable. ' +
        'Install it alongside tailwindcss (4.3.x line; the v3-lts line is forbidden): ' +
        '`@tailwindcss/vite` is an optional peer of @openelement/router.',
      { cause: cause instanceof Error ? cause : undefined },
    );
  }
  return tailwindModule.default();
}

/**
 * The virtual entry module — the build half of the entry contract. The client
 * build's generated entry imports {@linkcode tailwindEntryPath}; this plugin
 * answers that id with the generated CSS, and the official peer (mounted
 * beside it) compiles it.
 */
export function tailwindEntryPlugin(root: string, options: ResolvedTailwindOptions): Plugin {
  return {
    name: 'open:tailwind-entry',
    enforce: 'pre',
    resolveId(id) {
      return tailwindEntryModuleId(root, id);
    },
    load(id) {
      if (tailwindEntryModuleId(root, id) !== id) return null;
      return renderTailwindEntry(root, options);
    },
  };
}

// ─── The component stylesheet (alpha15 S lane, requirements 1 and 2) ────────

/**
 * The component stylesheet's virtual entry path. A sibling of the document
 * entry, under the same `.openElement/` identity directory, so both entries
 * resolve their `@import`s from the same base and the peer compiles them the
 * same way.
 */
export const COMPONENT_SHEET_PATH = '.openElement/tailwind-components.css' as const;

/** The absolute path of the component stylesheet's virtual entry module. */
export function componentStyleEntryPath(root: string): string {
  return join(root, COMPONENT_SHEET_PATH);
}

/** Escape one candidate for a double-quoted `@source inline(…)` string. */
function escapeInlineCandidate(candidate: string): string {
  return candidate.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * The component stylesheet entry: the theme layer (Tailwind's scale plus the
 * app's declared `@theme` roles, which resolve through `:host` inside shadow
 * trees), the utilities layer, and one explicit candidate admission per
 * statically collected class token.
 *
 * It is a REDUCED entry, not `@import 'tailwindcss'`: preflight is deliberately
 * absent — a reset inside a component's own shadow tree would change every
 * existing component's rendering — and the theme layer is tree-shaken to the
 * variables the admitted utilities reference. The candidate list comes from
 * the compiler's registry — every admitted candidate, because a light-root
 * class can render inside a shadow tree — never from a framework-owned
 * scanner: the official compiler owns candidate syntax and utility generation.
 */
export function renderComponentUtilitiesEntry(
  root: string,
  options: ResolvedTailwindOptions,
  candidates: readonly string[],
): string {
  const lines = [
    '/* generated by @openelement/router — the component stylesheet entry; do not edit */',
    "@import 'tailwindcss/theme.css';",
  ];
  for (const source of options.theme) {
    lines.push(`@import '${resolveTailwindSource(root, source)}';`);
  }
  lines.push("@import 'tailwindcss/utilities.css';");
  for (const candidate of candidates) {
    lines.push(`@source inline("${escapeInlineCandidate(candidate)}");`);
  }
  return lines.join('\n') + '\n';
}

/** What the component stylesheet plugin records for the build. */
export interface ComponentStyleSheetRecord {
  /** The emitted, content-addressed asset file name (`assets/<hash>.css`). */
  fileName: string | undefined;
}

/**
 * The component stylesheet's build half: ONE generated sheet of this build,
 * compiled from the admitted shadow candidates by the official compiler.
 *
 * Why the official compiler API instead of a CSS module in the build graph:
 * the peer only compiles `.css`-typed modules, and Vite's own CSS pipeline then
 * owns their output — it attaches the CSS to the importing chunk, which would
 * merge this sheet with the document stylesheet and cannot hand back the
 * constructable sheet the shadow roots need. Compiling through the peer's own
 * compiler (`@tailwindcss/node`, resolved from the installed peer — the same
 * package, same version, same option set the peer passes) keeps the ONE
 * official compiler while the framework's existing generated-sheet emitter
 * (`generatedSheetsPlugin`) owns emission: content-addressed file name,
 * `emitFile`, fetch adapter, `url()` rebase.
 *
 * Nothing here interprets Tailwind: the entry text is a standard `@import`
 * list plus `@source inline(…)` candidate admissions, and every CSS decision is
 * the official compiler's.
 */
export function componentStyleSheetPlugin(
  root: string,
  options: ResolvedTailwindOptions,
  candidates: () => readonly string[],
  record: ComponentStyleSheetRecord,
): Plugin {
  return generatedSheetsPlugin([
    {
      specifier: COMPONENT_SHEET_SPECIFIER,
      graphId: COMPONENT_SHEET_GRAPH_ID,
      urlBase: generatedSheetBase(root),
      record,
      adapterComments: [
        '// The shared component stylesheet: the utilities the admitted shadow-root',
        '// class candidates compile to. One sheet per realm, held by the generated',
        '// client entry so every shadow root adopts the same CSSStyleSheet object.',
      ],
      compile: async () => {
        // Read the candidates NOW, never at plugin construction: the build's
        // discovery pass registers them in its own `buildStart`, which runs
        // before this hook — the ordering defect B depends on. No candidates:
        // no sheet (the registry is the build's own, so "none" means none for
        // THIS build).
        const admitted = candidates();
        if (admitted.length === 0) return '';
        return await compileComponentStyleSheet(root, options, admitted);
      },
    },
  ]);
}

/** The specifier the generated client entry imports; the plugin's own id. */
export const COMPONENT_SHEET_SPECIFIER = 'virtual:open-tailwind-components' as const;

/** The `\0`-virtual graph id behind the specifier (JS-typed by construction). */
const COMPONENT_SHEET_GRAPH_ID = '\0oe-tailwind-components.js';

/** The official compiler's `compile()` contract (the shape this module consumes). */
interface OfficialCompiler {
  readonly build: (candidates: string[]) => string;
}

/**
 * Resolve and compile the component stylesheet through the OFFICIAL Tailwind
 * compiler, loaded from the installed peer's own dependency tree — a nested
 * build would duplicate the framework's emission, and a hand-written CSS
 * transform would replace the compiler. Fails closed with the entry seam's
 * coded error when either the peer or its compiler is missing.
 */
export async function compileComponentStyleSheet(
  root: string,
  options: ResolvedTailwindOptions,
  candidates: readonly string[],
): Promise<string> {
  const { compile } = await loadOfficialCompiler();
  const entryPath = join(root, COMPONENT_SHEET_PATH);
  const compiler = (await compile(renderComponentUtilitiesEntry(root, options, candidates), {
    // The virtual entry's directory is the resolution base for its `@import`s
    // — the same base the document entry uses — and the URL-rewrite root.
    base: join(root, '.openElement'),
    from: entryPath,
    onDependency: () => {},
    shouldRewriteUrls: true,
  })) as OfficialCompiler;
  return compiler.build([...candidates]);
}

/** Load the official compiler module through the peer's own resolution. */
async function loadOfficialCompiler(): Promise<{
  compile: (css: string, options: Record<string, unknown>) => Promise<OfficialCompiler>;
}> {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  let peerEntry: string;
  try {
    peerEntry = await import.meta.resolve('@tailwindcss/vite');
  } catch (cause) {
    throw buildError(
      PresetErrorCode.TAILWIND_UNRESOLVABLE,
      '[tailwind] the component stylesheet needs the @tailwindcss/vite peer to resolve its ' +
        'official compiler, but the peer is not resolvable.',
      { cause: cause instanceof Error ? cause : undefined },
    );
  }
  const require = createRequire(peerEntry);
  let compilerEntry: string;
  try {
    compilerEntry = require.resolve('@tailwindcss/node');
  } catch (cause) {
    throw buildError(
      PresetErrorCode.TAILWIND_UNRESOLVABLE,
      '[tailwind] the @tailwindcss/vite peer is installed but its official compiler ' +
        '(@tailwindcss/node) cannot be resolved from it.',
      { cause: cause instanceof Error ? cause : undefined },
    );
  }
  return (await import(pathToFileURL(compilerEntry).href)) as never;
}
