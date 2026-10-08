/**
 * @openelement/router/vite - Tailwind preset (alpha9 C2, #1505).
 *
 * An OPT-IN build-layer delivery over the Vite seam: `@tailwindcss/vite`
 * (the 4.3.x line; the v3-lts line is forbidden) compiles the app's declared
 * style sources into one bundle emitted as a build asset, and the SSG output
 * references that asset with `<link rel="stylesheet">` instead of inlining
 * the sheet. Default state is OFF: an app that never passes `tailwind` gets
 * byte-identical builds to a preset-less pipeline — no plugin, no layer
 * wrapping, no links. Since the C5 twin removal, OFF also means no ui value
 * emission anywhere: @openelement/ui carries no embedded scale values (its
 * theme-tokens twin is deleted), so a preset-less consumer supplies its own
 * role table (@openelement/ui's CUSTOMIZATION.md, "Value delivery").
 *
 * Two seams, both active ONLY while the preset is enabled (issue #1505):
 *
 * 1. `@layer components` opt-in — the bundle is compiled into the declared
 *    cascade order `@layer theme, base, components, utilities` (theme sources
 *    land in the `theme` layer through their `@theme` blocks, component
 *    sources are wrapped in `@layer components`). One compiled bundle, two
 *    faces: the plain output serves shadow-root adoption (the DSD `<link>`),
 *    and a second asset re-seats the component face per host tag with
 *    `@scope` for light-DOM adoption (the light equivalent of
 *    adoptedStyleSheets, mirroring the runtime's scopeCompiledLightCss
 *    shape at the build layer).
 *
 * 2. DSD link-not-inline — globally registered style reaches the document
 *    and every DSD shadow template as `<link rel="stylesheet">` (browser
 *    cache dedupes one asset across pages and shadow roots); only
 *    per-component styles stay inline (`<style data-oe-static-styles>`).
 *    The full-inline `styleText()` delivery of the global sheet is
 *    explicitly forbidden while the preset is active: a rendered page that
 *    still carries the compiled bundle as an inline `<style>` fails the
 *    build with `OE_PRESET_GLOBAL_SHEET_INLINE_FORBIDDEN` instead of
 *    shipping both deliveries.
 *
 * Module placement: everything here lives in the Vite build layer. The
 * router's request path (index/http/model/router/nitro-mount) never imports
 * a Tailwind symbol — the preset's only runtime artifact is the emitted CSS
 * asset and the `<link>` tags the SSG output carries.
 *
 * Dev-mode delivery (#1582, alpha.12): the build-side seams above left dev
 * with NO token delivery at all — `tailwind.theme` was read only by
 * `closeBundle`, so `pnpm dev` served pages whose `var(--paper/--brand/…)`
 * all resolved empty (the authored `@theme` block is an unknown at-rule to
 * the browser, and the aliases seated on it stay empty until the sheet passes
 * through the Tailwind compile). The dev half lives in `dev-tailwind.ts`: it
 * mounts the same lazily-resolved `@tailwindcss/vite` peer into the DEV css
 * channel and serves the SAME staged entry (`renderTailwindPresetEntry`) as a
 * module, so dev and build consume one compiled fact. The two channels are
 * mutually exclusive by `apply`: the dev plugin is `apply: 'serve'` and the
 * build delivery stays `closeBundle`-only, so no artifact can carry both, and
 * with the `tailwind` key absent neither channel exists (OFF stays OFF: no
 * peer load, no staging write, no head fragment).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { basename, join } from 'pathe';
import type { Plugin, ResolvedConfig } from 'vite';
import { PresetErrorCode, buildError } from '../internal/error-codes.ts';
import { createLogger } from '@openelement/element';

const log = createLogger('router-vite:tailwind-preset');

/** The declared cascade order the bundle compiles into (seam 1). */
export const TAILWIND_LAYER_ORDER = '@layer theme, base, components, utilities;' as const;

/** The emitted bundle asset names, under the build's `assets/` directory. */
export const TAILWIND_BUNDLE_ASSET = 'open-tailwind.css' as const;
/** The emitted `@scope` light-DOM face asset, under `assets/`. */
export const TAILWIND_SCOPE_ASSET = 'open-tailwind.scope.css' as const;

/** Options for the opt-in Tailwind preset. `tailwind: true` uses every default. */
export interface TailwindPresetOptions {
  /**
   * Style sources compiled into the bundle's `theme` layer: package CSS
   * specifiers (`@openelement/ui/theme.css`) or app-relative paths. Their
   * `@theme` blocks (and any Tailwind utilities they reference) compile
   * through `@tailwindcss/vite`.
   */
  theme?: string[];
  /**
   * Style sources wrapped into `@layer components` — the component-facing
   * token/recipe layer. Also the source of the `@scope` light-DOM face.
   */
  components?: string[];
  /**
   * Host tags the `@scope` light-DOM face is emitted for (one `@scope (tag)`
   * block per tag carrying the components layer). Empty/absent skips the
   * face. Package-island apps derive this from the package manifest.
   */
  scopeTags?: string[];
  /**
   * Whether the bundle link is also injected into every DSD shadow template
   * (seam 2's shadow adoption). Default `false`: the compiled claim requires
   * the DSD template's children to equal the Part Program's own nodes (the
   * @openelement/element compiled-claim walk fails closed on any injected
   * node), so the exact-claim default leaves the shadow templates untouched.
   * The head link alone still reaches every shadow tree, because CSS custom
   * properties — the theme layer's entire delivery — inherit across the
   * shadow boundary. Set `true` only for consumers whose compiled elements
   * do not claim their SSR shadow DOM exactly.
   */
  injectDsdLinks?: boolean;
}

/** Normalize `tailwind: true` / object / undefined into resolved options. */
export function resolveTailwindPresetOptions(
  option: boolean | TailwindPresetOptions | undefined,
): TailwindPresetOptions | undefined {
  if (!option) return undefined;
  if (option === true) return {};
  return option;
}

/**
 * The Vite plugins the preset adds to the outer pipeline: the
 * `@tailwindcss/vite` plugin, resolved lazily so the router stays installable
 * without it (optional peer). Fails closed with a coded error when the peer
 * is missing — a preset-enabled build never silently skips Tailwind.
 */
export async function tailwindPresetPlugins(): Promise<Plugin[]> {
  let tailwindModule: { default: (options?: unknown) => Plugin[] };
  try {
    tailwindModule = (await import('@tailwindcss/vite')) as typeof tailwindModule;
  } catch (cause) {
    throw buildError(
      PresetErrorCode.TAILWIND_UNRESOLVABLE,
      '[tailwind-preset] the preset is enabled but @tailwindcss/vite is not resolvable. ' +
        'Install it alongside tailwindcss (4.3.x line; the v3-lts line is forbidden): ' +
        '`@tailwindcss/vite` is an optional peer of @openelement/router.',
      { cause: cause instanceof Error ? cause : undefined },
    );
  }
  return tailwindModule.default();
}

/**
 * The bundle entry the preset compiles: the declared cascade order, then
 * Tailwind itself, then the app's declared theme and component sources.
 * Written next to the app root as a staged, build-time-only input.
 */
export function renderTailwindPresetEntry(options: TailwindPresetOptions): string {
  const lines = [
    '/* generated by the @openelement/router tailwind preset (#1505) — do not edit */',
    TAILWIND_LAYER_ORDER,
    "@import 'tailwindcss';",
  ];
  for (const source of options.theme ?? []) {
    lines.push(`@import '${source}';`);
  }
  for (const source of options.components ?? []) {
    lines.push(`@import '${source}' layer(components);`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Rewrite a component-face stylesheet for light-DOM adoption: shadow-only
 * selectors become their light equivalents and the block is scoped to one
 * host tag. Build-layer mirror of the runtime's scopeCompiledLightCss
 * contract (element keeps the runtime instance; this copy serves the SSG
 * asset where no element runtime runs).
 */
export function scopePresetComponentCss(tag: string, css: string): string {
  if (css.trim() === '') return '';
  const scoped = css
    .replace(/:host\(([^)]*)\)/g, ':scope:is($1)')
    .replace(/:host(?![\w-])/g, ':scope')
    .replace(/::slotted\(([^)]*)\)/g, 'slot > :is($1)');
  return `@scope (${tag}) {\n${scoped}\n}`;
}

/** The `@scope` light-DOM face: one block per declared host tag. */
export function renderTailwindScopeFace(
  options: TailwindPresetOptions,
  componentsCss: string,
): string {
  const tags = options.scopeTags ?? [];
  if (tags.length === 0 || componentsCss.trim() === '') return '';
  const header =
    '/* generated by the @openelement/router tailwind preset (#1505) — light-DOM face */\n';
  return (
    header +
    tags
      .map((tag) => scopePresetComponentCss(tag, componentsCss))
      .filter(Boolean)
      .join('\n')
  );
}

interface BundleBuildInput {
  /** App root (the Vite project root). */
  root: string;
  /** The build's output directory (dist), absolute. */
  outDir: string;
  /** Resolved options. */
  options: TailwindPresetOptions;
  /** The SSG output's public base, for the emitted link hrefs. */
  base: string;
}

/** What one preset bundle compile produced (assets, hrefs, compiled text). */
export interface TailwindBundleResult {
  /** Absolute path of the compiled bundle asset. */
  bundlePath: string;
  /** Absolute path of the `@scope` face asset, when emitted. */
  scopePath?: string;
  /** Public hrefs for the emitted assets (base-joined). */
  bundleHref: string;
  scopeHref?: string;
  /** The compiled bundle text (the full-inline prohibition's signature). */
  bundleCss: string;
}

function joinBase(base: string, asset: string): string {
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  return `${cleanBase}assets/${asset}`;
}

/** Url targets that never name an emitted asset file (the #1535 guard's exemptions). */
const NON_FILE_URL = /^(?:data:|#|https?:\/\/|\/\/)/;

/** `url(...)` occurrences, split into the quote and the target path. */
const URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

interface EmittedFile {
  type: string;
  fileName: string;
}

/**
 * Copy the compile's emitted assets (everything but the entry chunk and the
 * bundle itself) into the build's `assets/` directory under their emitted
 * `assets/[name]-[hash][extname]` names, and return the reference map the
 * url() rewrite keys on: the staged reference form and the bare file name
 * both resolve to the shipped name.
 */
function shipEmittedAssets(
  emitted: readonly EmittedFile[],
  stagingDir: string,
  assetsDir: string,
): Map<string, string> {
  const shipped = new Map<string, string>();
  for (const entry of emitted) {
    if (entry.type !== 'asset' || entry.fileName === TAILWIND_BUNDLE_ASSET) continue;
    const finalName = basename(entry.fileName);
    copyFileSync(join(stagingDir, entry.fileName), join(assetsDir, finalName));
    shipped.set(finalName, finalName);
    shipped.set(entry.fileName, finalName);
  }
  return shipped;
}

/** Rewrite the bundle's url() references to the shipped asset file names. */
function rewriteUrlTargets(css: string, shipped: ReadonlyMap<string, string>): string {
  return css.replace(URL_PATTERN, (match, quote: string, target: string) => {
    const finalName = shipped.get(target) ?? shipped.get(target.replace(/^\/+/, ''));
    return finalName === undefined ? match : `url(${quote}${finalName}${quote})`;
  });
}

/**
 * The #1535 drift guard: after the copy and rewrite, every file url the
 * shipped CSS carries must resolve to a file in the shipped assets directory
 * (or be a data URI, a fragment reference, or an absolute http(s) url). A
 * compile-emitted reference that the copy missed means a silently missing
 * font or background at the consumer — fail the build instead.
 */
function assertAllUrlsShipped(css: string, assetsDir: string): void {
  for (const match of css.matchAll(URL_PATTERN)) {
    const target = match[2];
    if (NON_FILE_URL.test(target)) continue;
    if (existsSync(join(assetsDir, target.replace(/^\/+/, '')))) continue;
    throw buildError(
      PresetErrorCode.BUNDLE_COMPILE_FAILED,
      `[tailwind-preset] the compiled bundle references "${target}" but the build's ` +
        'assets/ directory does not contain that file — the url() asset the declared ' +
        'sources reference would silently drop from the delivered preset. The compile ' +
        'must emit every url() asset and the preset must copy it next to the bundle.',
    );
  }
}

/**
 * Compile the preset bundle through a dedicated inner Vite build whose CSS
 * pipeline carries the `@tailwindcss/vite` plugin, and write the compiled
 * output (plus the `@scope` face) into the build's `assets/` directory. The
 * outer pipeline's plugin list stays untouched (openElement() is sync and the
 * Tailwind peer resolves dynamically), so OFF and ON differ only in this
 * closeBundle-stage delivery. Deterministic by construction: the entry is
 * generated text and the sources are app-declared files.
 */
export async function buildTailwindPresetBundle(
  input: BundleBuildInput,
): Promise<TailwindBundleResult> {
  const { root, outDir, options } = input;
  const stagingDir = join(root, '.openElement', 'tailwind-preset');
  mkdirSync(stagingDir, { recursive: true });
  const entryPath = join(stagingDir, 'entry.css');
  writeFileSync(entryPath, renderTailwindPresetEntry(options), 'utf8');

  const plugins = await tailwindPresetPlugins();
  const { build: viteBuild } = await import('vite');
  let built: Awaited<ReturnType<typeof viteBuild>>;
  try {
    built = await viteBuild({
      configFile: false,
      root,
      logLevel: 'error',
      publicDir: false,
      plugins,
      build: {
        write: true,
        emptyOutDir: true,
        outDir: stagingDir,
        minify: false,
        modulePreload: false,
        rollupOptions: {
          input: { 'open-tailwind': entryPath },
          output: {
            // Deterministic asset names: the seam's link emission and the
            // byte-verification both read these exact paths. The bundle keeps
            // its fixed name; every other emitted asset (the url() files the
            // declared sources reference, #1535) takes the standard hashed
            // name under assets/ — a fixed name here would collide with the
            // bundle's and silently rename one of the two.
            entryFileNames: 'open-tailwind.js',
            assetFileNames(assetInfo) {
              return assetInfo.names.includes(TAILWIND_BUNDLE_ASSET)
                ? TAILWIND_BUNDLE_ASSET
                : 'assets/[name]-[hash][extname]';
            },
          },
        },
      },
    });
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    throw buildError(
      PresetErrorCode.BUNDLE_COMPILE_FAILED,
      `[tailwind-preset] the bundle compile failed: ${error.message}`,
      { cause: error },
    );
  }
  // The build runs with watch off, so the watcher arm of vite's return type
  // is unreachable — fail loudly rather than skip the asset delivery below.
  if (!('output' in built)) {
    throw buildError(
      PresetErrorCode.BUNDLE_COMPILE_FAILED,
      '[tailwind-preset] the bundle compile returned a watcher instead of build output',
    );
  }
  const emitted = built.output;

  const bundlePath = join(stagingDir, TAILWIND_BUNDLE_ASSET);
  if (!existsSync(bundlePath)) {
    throw buildError(
      PresetErrorCode.BUNDLE_COMPILE_FAILED,
      `[tailwind-preset] the compile emitted no ${TAILWIND_BUNDLE_ASSET} asset`,
    );
  }

  // The compile emitted every url() asset the declared sources reference
  // (fonts, SVG backgrounds) next to the bundle. Ship them into the build's
  // assets/ directory and rewrite the bundle's url() references to the
  // shipped names — the sibling-relative form resolves against the asset's
  // own URL, so it survives any `base`. Without this copy the references
  // would name build-time-only staging files (#1535). The copy is a guarded
  // one (P6): the assertion below fails the build when the shipped CSS still
  // names a file the copy did not deliver. (Retiring the staging round-trip
  // altogether is ADR-0163's structural lane, not this repair.)
  const assetsDir = join(outDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const shipped = shipEmittedAssets(emitted, stagingDir, assetsDir);

  // The compile consumes the entry's explicit layer-order statement and emits
  // the layers as ordered blocks instead. The seam's contract keeps the
  // declaration in the artifact — prepending it re-asserts the same order the
  // blocks below establish (idempotent for the cascade).
  const bundleCss = `${TAILWIND_LAYER_ORDER}\n${rewriteUrlTargets(readFileSync(bundlePath, 'utf8'), shipped)}`;
  assertAllUrlsShipped(bundleCss, assetsDir);

  // The components layer text feeds the @scope face. Extract it from the
  // compiled output: everything the compile placed inside
  // `@layer components { ... }` (the entry wraps exactly the declared
  // component sources there).
  const componentsCss = extractLayerComponents(bundleCss);

  writeFileSync(join(assetsDir, TAILWIND_BUNDLE_ASSET), bundleCss, 'utf8');

  let scopePath: string | undefined;
  let scopeHref: string | undefined;
  const scopeCss = renderTailwindScopeFace(options, componentsCss);
  if (scopeCss !== '') {
    scopePath = join(outDir, 'assets', TAILWIND_SCOPE_ASSET);
    writeFileSync(scopePath, scopeCss, 'utf8');
    scopeHref = joinBase(input.base, TAILWIND_SCOPE_ASSET);
  }

  return {
    bundlePath: join(outDir, 'assets', TAILWIND_BUNDLE_ASSET),
    scopePath,
    bundleHref: joinBase(input.base, TAILWIND_BUNDLE_ASSET),
    scopeHref,
    bundleCss,
  };
}

/**
 * Extract the compiled `@layer components { ... }` body — the block the
 * entry's component sources compiled into. Balanced-brace scan (strings and
 * comments in the component sources are preserved by the compile, so the
 * scan mirrors the compiler's own nesting handling).
 */
export function extractLayerComponents(css: string): string {
  const marker = '@layer components';
  const start = css.indexOf(marker);
  if (start === -1) return '';
  // A bare layer statement (`@layer components;` — what the compile emits
  // when no component source exists, #1536) never opens a block. Stop at the
  // first `;` or `@` after the marker; otherwise the brace scan below falls
  // into the next layer's opening brace and returns that body as components.
  let open = -1;
  for (let index = start + marker.length; index < css.length; index++) {
    const char = css[index];
    if (char === '{') {
      open = index;
      break;
    }
    if (char === ';' || char === '@') return '';
  }
  if (open === -1) return '';
  let depth = 0;
  let quote: '"' | "'" | undefined;
  let comment = false;
  for (let index = open; index < css.length; index++) {
    const char = css[index];
    const next = css[index + 1];
    if (comment) {
      if (char === '*' && next === '/') {
        comment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '/' && next === '*') {
      comment = true;
      index++;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  return '';
}

/**
 * Inject the preset's `<link rel="stylesheet">` emission into one rendered
 * page (seam 2): one link in `<head>` (document adoption) and — only when
 * the app opts in via {@linkcode TailwindPresetOptions.injectDsdLinks} —
 * one link inside every DSD shadow template's content (shadow adoption,
 * deduped by the browser cache across every page and shadow root).
 *
 * The placement is a contract, not a style choice: the compiled element
 * runtime's existing-DOM claim (@openelement/element claim.ts) walks the
 * shadow template's children exactly as the Part Program lists them —
 * leading, interposed, AND trailing extras are structural drift (the walk
 * ends in an exact `consumed === childNodes.length` check). The DSD-template
 * link is therefore OPT-IN (`injectDsdLinks: true`): the theme layer is
 * custom properties, which inherit across the shadow boundary from the head
 * link, so a claiming site — the default compiled surface — loses nothing
 * by skipping the shadow injection (surfaced by the first real preset-on
 * site, alpha9 C4 #1507, and now the preset's default).
 */
export function injectPresetLinks(
  html: string,
  bundleHref: string,
  scopeHref?: string,
  injectDsdLinks = false,
): string {
  const links = [`<link rel="stylesheet" href="${bundleHref}" />`];
  if (scopeHref) links.push(`<link rel="stylesheet" href="${scopeHref}" />`);
  const linkHtml = links.join('');
  let output = html;
  if (injectDsdLinks) {
    // DSD templates first, so the head link lands outside any template. Every
    // template open (DSD or not) is stacked in document order, and each close
    // pops its own open: a DSD template's close takes the link right before
    // it, so nested shadow hosts each carry their own (cache-deduped) link.
    let built = '';
    let cursor = 0;
    interface TemplateEvent {
      position: number;
      kind: 'open' | 'close';
      dsd: boolean;
    }
    const events: TemplateEvent[] = [];
    for (const match of html.matchAll(/<template\b[^>]*>/gi)) {
      events.push({
        position: match.index,
        kind: 'open',
        dsd: /shadowrootmode=(?:"open"|"closed")/i.test(match[0]),
      });
    }
    for (const match of html.matchAll(/<\/template\s*>/gi)) {
      events.push({ position: match.index, kind: 'close', dsd: false });
    }
    events.sort((left, right) => left.position - right.position);
    const dsdStack: boolean[] = [];
    for (const event of events) {
      if (event.kind === 'open') {
        dsdStack.push(event.dsd);
        continue;
      }
      if (dsdStack.pop()) {
        built += html.slice(cursor, event.position) + linkHtml;
        cursor = event.position;
      }
    }
    built += html.slice(cursor);
    output = built;
  }
  const headMatch = output.match(/<head(\s[^>]*)?>/i);
  if (headMatch && headMatch.index !== undefined) {
    const headEnd = headMatch.index + headMatch[0].length;
    output = output.slice(0, headEnd) + `\n  ${linkHtml}` + output.slice(headEnd);
  }
  return output;
}

/**
 * The full-inline prohibition (seam 2): the compiled bundle text must not
 * appear as an inline `<style>` in the rendered output. The compiled bundle
 * is long by construction (it carries the whole theme layer), so the check
 * anchors on the bundle's own token declarations: a page `<style>` block
 * containing a third of the bundle's custom-property declarations is the
 * full sheet, not a legitimate page style.
 */
export function assertNoGlobalSheetInline(html: string, bundleCss: string, file: string): void {
  const bundleNames = new Set([...bundleCss.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
  if (bundleNames.size === 0) return;
  const threshold = Math.ceil(bundleNames.size / 3);
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
    const body = match[1];
    // Per-component static styles are declared inline by design; only a
    // block carrying the bundle's own declaration set is the full sheet.
    const declared = [...body.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].filter((m) =>
      bundleNames.has(m[1]),
    ).length;
    if (declared >= threshold) {
      throw buildError(
        PresetErrorCode.GLOBAL_SHEET_INLINE_FORBIDDEN,
        `[tailwind-preset] ${file} fully inlines the global sheet (styleText delivery, ` +
          `${declared}/${bundleNames.size} bundle declarations in one <style> block). While the ` +
          'tailwind preset is enabled the global sheet ships as the linked bundle asset only — ' +
          'drop the inline head injection (inject.headFragments <style>) and let the preset ' +
          'emit the <link>.',
      );
    }
  }
}

/**
 * Apply the preset's SSG post-processing: compile the bundle, then walk the
 * rendered HTML files injecting the links and enforcing the prohibition.
 * Called from the build plugin's closeBundle after Phase 3 (the SSG render)
 * has written the pages — build-layer only, no request-path involvement.
 */
export async function applyTailwindPreset(
  options: TailwindPresetOptions,
  config: ResolvedConfig,
  outDir: string,
): Promise<TailwindBundleResult> {
  const { visitHtmlFiles } = await import('./internal/html-files.ts');
  const root = config.root ?? process.cwd();
  const result = await buildTailwindPresetBundle({
    root,
    outDir,
    options,
    base: config.base ?? '/',
  });

  let visited = 0;
  visitHtmlFiles(outDir, (html, fullPath) => {
    visited++;
    assertNoGlobalSheetInline(html, result.bundleCss, fullPath);
    return injectPresetLinks(
      html,
      result.bundleHref,
      result.scopeHref,
      options.injectDsdLinks === true,
    );
  });
  log.info(
    `tailwind preset: bundle linked into ${visited} page(s)` +
      (options.injectDsdLinks === true ? ' (+DSD shadow links)' : ' (head only)') +
      (result.scopeHref ? ` (+@scope face ${TAILWIND_SCOPE_ASSET})` : ''),
  );
  return result;
}
