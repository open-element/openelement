/**
 * The generated-sheet emitter (alpha15 stage 2B) — the ONE emission path for
 * every stylesheet an engine GENERATES as text, as opposed to a CSS module
 * Vite's own pipeline compiles.
 *
 * Why a provider needs this at all: Vite's CSS pipeline only compiles
 * `.css`-typed modules in its graph, and a generated sheet must become a real
 * `CSSStyleSheet` object in the browser (a shadow root adopts it; a light root
 * adopts it on the document) rather than a document-level `<style>` Vite's dev
 * injector would create. The framework therefore owns emission end to end:
 * content-addressed file name, `emitFile`, `generateBundle` placeholder
 * resolution, and the fetch adapter module whose default export is this
 * sheet's `CSSStyleSheet`.
 *
 * Extracted from the Tailwind component-sheet plugin, which is now one call
 * site of it; the UnoCSS provider is the other, with two sheets (document and
 * components) through the same machinery. Nothing provider-specific lives
 * here: a sheet is a compile function returning CSS text.
 *
 * `url()` TARGETS. An engine's compiler rebases `url()` against the entry's
 * directory (a file on disk), not against the asset this build emits, so a
 * compiled sheet's relative target is a project-relative path no browser can
 * resolve from the emitted sheet's location. The rebase below replaces each
 * such target with a deterministic placeholder carrying the referenced file's
 * content digest and emits the referenced bytes as an asset of this build;
 * `generateBundle` resolves the placeholder to the emitted asset's own URL
 * through Vite's own file-name mapping (`getFileName`) and the one URL rule
 * every emitted sheet uses (`cssAssetUrl`).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'pathe';
import type { Plugin } from 'vite';
import { cssAssetUrl, fetchSheetAdapterModule, styleAssetFileName } from './style-assets.ts';

/** Placeholder prefix a rebased `url()` target carries. */
const URL_PLACEHOLDER_PREFIX = '__OE_COMPONENT_URL__';
/** The same placeholder in the emitted CSS text (digest-keyed). */
const URL_PLACEHOLDER_RE = /url\(\s*(['"]?)__OE_COMPONENT_URL__([0-9a-f]{64})\1\s*\)/g;
/** One (possibly quoted) `url()` target of a compiled sheet. */
const URL_REFERENCE_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** The emit half of the plugin context the rebase needs. */
interface SheetEmitContext {
  /** Emit the bytes a rebased `url()` target addresses (named, hashed by Vite). */
  emitFile(file: { type: 'asset'; name: string; source: Uint8Array }): string;
  /** Emit the sheet itself under its own content address. */
  emitFile(file: { type: 'asset'; fileName: string; source: string }): string;
}

function contentDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * A target the engine rebased to a project-relative file path: anything not
 * already self-contained (data URL, fragment, absolute URL/path) and not a
 * scheme URL. Only those are resolved against the compile base; the rest are
 * left exactly as the engine wrote them.
 */
function isFileUrlTarget(target: string): boolean {
  return (
    target !== '' &&
    !target.startsWith('data:') &&
    !target.startsWith('#') &&
    !target.startsWith('/') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}

/**
 * Replace every relative `url()` target with a deterministic placeholder
 * carrying the referenced file's content digest, and emit the referenced
 * bytes as an asset of this build. The digest keeps the sheet's file name a
 * faithful content address (two different referenced assets can never produce
 * one sheet name, and no emission-order fact leaks into the name) and is what
 * the `generateBundle` half resolves to the emitted asset's own file name.
 *
 * Emitting the bytes here — rather than borrowing an asset Vite's document
 * pipeline happened to emit for the same file — is what makes the reference
 * total: a font below `assetsInlineLimit` is a data URL in the document sheet
 * and has no emitted asset to borrow, yet the component sheet must still
 * address it.
 */
function rebaseSheetUrls(
  context: SheetEmitContext,
  entryBase: string,
  css: string,
  assetReferences: Map<string, string>,
): string {
  return css.replace(URL_REFERENCE_RE, (whole, quote: string, target: string) => {
    if (!isFileUrlTarget(target)) return whole;
    let file: string;
    let bytes: Uint8Array;
    try {
      file = resolve(entryBase, decodeURIComponent(target));
      bytes = readFileSync(file);
    } catch {
      // Not a readable file (an unresolved specifier, a query string, a
      // malformed escape): not a target this rebase owns, so it is left
      // exactly as the engine wrote it.
      return whole;
    }
    const digest = contentDigest(bytes);
    if (!assetReferences.has(digest)) {
      assetReferences.set(
        digest,
        context.emitFile({ type: 'asset', name: basename(file), source: bytes }),
      );
    }
    return `url(${quote}${URL_PLACEHOLDER_PREFIX}${digest}${quote})`;
  });
}

/**
 * One sheet this build generates: the compile function, the module identity
 * the generated client entry imports, and the record the build reads back.
 */
export interface GeneratedSheet {
  /** The import specifier the generated client entry uses (`virtual:…`). */
  readonly specifier: string;
  /** The `\0`-virtual graph id behind that specifier. */
  readonly graphId: string;
  /**
   * Compile the sheet text. An empty string means "this build has no such
   * sheet" (no admitted candidate): no asset is emitted and the adapter
   * module stays resolvable, without handing out a sheet that never existed.
   */
  compile(): Promise<string>;
  /** Where the build records the emitted file name (undefined ⇒ no sheet). */
  readonly record: SheetFileNameRecord;
  /** The directory the sheet's `url()` targets resolve against. */
  readonly urlBase: string;
  /** Extra comment lines for the generated adapter module. */
  readonly adapterComments?: readonly string[];
}

/** The mutable record a {@linkcode GeneratedSheet} writes its emission into. */
export interface SheetFileNameRecord {
  /** The emitted, content-addressed asset file name (`assets/<hash>.css`). */
  fileName: string | undefined;
}

/**
 * The build plugin for a set of generated sheets.
 *
 * The emission is a BUILD concern, not a module-graph concern: a sheet is
 * consumed by the SSR/DSD link channel even when the generated entry never
 * imports its adapter (the island-free CSS-only shape, defect D), and the
 * asset's name is its own content hash, so a second emission would be the
 * same file under the same name. Each sheet is emitted once, from whichever
 * consumer runs first, so the adapter module and the declared link point at
 * one resource.
 */
export function generatedSheetsPlugin(sheets: readonly GeneratedSheet[]): Plugin {
  const compiled = new Map<string, Promise<string>>();
  /** The emitted asset of every rebased `url()` target, keyed by content digest. */
  const assetReferences = new Map<string, Map<string, string>>();
  /** Each sheet's one emission. */
  const sheetReferenceIds = new Map<string, string>();
  const referencesOf = (sheet: GeneratedSheet): Map<string, string> => {
    let map = assetReferences.get(sheet.specifier);
    if (map === undefined) {
      map = new Map();
      assetReferences.set(sheet.specifier, map);
    }
    return map;
  };
  const emittedFileName = (sheet: GeneratedSheet): string | undefined => sheet.record.fileName;

  const emitSheet = async (
    context: SheetEmitContext,
    sheet: GeneratedSheet,
  ): Promise<string | undefined> => {
    const existing = sheetReferenceIds.get(sheet.specifier);
    if (existing !== undefined) return existing;
    let text = compiled.get(sheet.specifier);
    if (text === undefined) {
      text = sheet.compile();
      compiled.set(sheet.specifier, text);
    }
    // Read the candidates NOW, never at plugin construction: the build's
    // discovery pass registers them in its own `buildStart`, which runs before
    // this hook — the ordering defect B depends on. No candidates: no sheet.
    const css = rebaseSheetUrls(context, sheet.urlBase, await text, referencesOf(sheet));
    if (css.trim() === '') return undefined;
    const fileName = styleAssetFileName(css);
    sheet.record.fileName = fileName;
    const referenceId = context.emitFile({ type: 'asset', fileName, source: css });
    sheetReferenceIds.set(sheet.specifier, referenceId);
    return referenceId;
  };

  return {
    name: 'open:generated-sheets',
    enforce: 'pre',
    resolveId(id) {
      const sheet = sheets.find((candidate) => candidate.specifier === id);
      return sheet === undefined ? null : sheet.graphId;
    },
    async buildStart() {
      for (const sheet of sheets) await emitSheet(this, sheet);
    },
    async load(id) {
      const sheet = sheets.find((candidate) => candidate.graphId === id);
      if (sheet === undefined) return null;
      const referenceId = await emitSheet(this, sheet);
      // A graph that imports the adapter with no admitted candidate (every
      // candidate module left the graph between the entry's generation and the
      // module load): an empty module keeps the import resolvable without
      // handing out a sheet that was never emitted.
      if (referenceId === undefined) return 'export default undefined;\n';
      return fetchSheetAdapterModule(referenceId, sheet.adapterComments);
    },
    /**
     * Resolve every digest placeholder to the emitted asset's own URL —
     * through Vite's own file-name mapping (`getFileName`), the same API the
     * style-edge placeholder pass uses, so the framework never spells a hashed
     * name itself.
     */
    generateBundle(_options, bundle) {
      for (const sheet of sheets) {
        const references = assetReferences.get(sheet.specifier);
        const fileName = emittedFileName(sheet);
        if (references === undefined || references.size === 0 || fileName === undefined) continue;
        const output = bundle[fileName];
        if (output === undefined || output.type !== 'asset') continue;
        const base = this.environment.config.base;
        const source =
          typeof output.source === 'string'
            ? output.source
            : Buffer.from(output.source).toString('utf8');
        output.source = source.replace(
          URL_PLACEHOLDER_RE,
          (_whole, quote: string, digest: string) => {
            const referenceId = references.get(digest);
            if (referenceId === undefined) {
              // Unreachable by construction: the rebase records the reference
              // of every digest it stamps into the placeholder.
              throw new Error(
                `[style-provider] the generated sheet carries an unresolved url() ` +
                  `placeholder (digest ${digest}); the rebased reference map lost its emission`,
              );
            }
            return `url(${quote}${cssAssetUrl(base, fileName, this.getFileName(referenceId))}${quote})`;
          },
        );
      }
    },
  };
}

/** The `\0`-virtual graph id for one provider sheet (JS-typed by construction). */
export function generatedSheetGraphId(suffix: string): string {
  return `\0oe-generated-sheet-${suffix}.js`;
}

/** The compile base of a provider's generated entries (the `.openElement` identity dir). */
export function generatedSheetBase(root: string): string {
  return join(root, '.openElement');
}
