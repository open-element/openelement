/**
 * The island style asset protocol's intercepting plugin (ADR-0164, #1553
 * production lane). The router client build is the sole owner of the emitted
 * `.css` artifact: `emitFile`, content hash, file name, manifest mapping and
 * the sheet adapter handed back to the module graph (the three-owner seam
 * split's middle owner — the compiler only requests, the runtime only
 * adopts).
 *
 * The compiled-element transform (activated with `styleAssetProtocol`) turns
 * an admitted island `static styles` into an import of a reserved-suffix
 * sibling (`./<tag>.oe-style.css`) and registers the request's CSS payload in
 * element's style-request registry under the module id the resolver lands on.
 * This plugin intercepts that request at `enforce: 'pre'` — before vite's CSS
 * plugin, which would otherwise fail the resolution (the file does not exist)
 * or, worse, re-inline the sheet. A registry miss fails closed: there is no
 * path where a style request is served by anything but this plugin.
 *
 * The graph id handed to the bundler is a `\0`-virtual id whose encoded key
 * carries no path shape and whose terminal suffix is `.js` — never the
 * `.oe-style.css` key itself: the toolchain infers the module type from the
 * id's extension suffix, and a `.css`-suffixed id is processed as a CSS
 * module — the load result is ignored and the build fails with MISSING_EXPORT
 * (reproduced on vite 8.0.16 / rolldown 1.0.3; `moduleType` on the resolveId
 * result does not override it). See the GRAPH_ID_PREFIX doc for the chunking
 * side of the same fact.
 *
 * Adapter forms (ADR-0164 §3) — one decision, recorded with its evidence:
 *
 * - FETCH (emitted today): `fetch()` + `CSSStyleSheet.replace()`, guarded by
 *   top-level await so the sheet is fully parsed before any importing island
 *   module evaluates (module-evaluation ordering, ADR-0164 Appendix D; a
 *   rejected fetch/replace fails the importing module too — fail closed).
 * - NATIVE (`import ... with { type: 'css' }`): implemented as the other
 *   emission, selected when {@linkcode NATIVE_CSS_MODULE_SCRIPTS} is true.
 *
 * The capability verdict is a build-toolchain fact, not a runtime probe: the
 * adapter is bundled, so a runtime check cannot choose between two build-time
 * module shapes. The verdict on record is negative twice over — rolldown
 * 1.0.3 hard-fails the native form at MISSING_EXPORT (ADR-0164 Appendix A)
 * and Safari has no CSS module scripts through Safari 27 (Appendix C), so
 * even a bundler-capable native form would not cover the delivered fleet.
 * Retirement condition (P5): when a toolchain both bundles the native form
 * and the fleet supports it, flip the verdict and delete the fetch emission —
 * the adapter form is a capability probe, not a permanent architecture.
 *
 * Neither adapter ever touches `document.head`: shadow-component CSS cannot
 * reach shadow trees from a document-level node, so a document-head sink is
 * not a delivery form of this protocol at all.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'pathe';
import type { Plugin } from 'vite';
import { getStyleRequest, styleRequestModuleId } from '@openelement/element/compiler';
import { buildError, ClientBuildErrorCode } from '../../internal/error-codes.ts';

/** The reserved request suffix the compiled-element transform emits. */
export const STYLE_REQUEST_SUFFIX = '.oe-style.css';

/**
 * The `\0`-virtual graph id prefix. The registry key rides base64url-encoded
 * (terminal `.js` appended): the bundler infers the module type from the id's
 * extension suffix, and the client build's island chunk-grouping rules match
 * on path segments (`/<islandsDir>/`) — a raw-key graph id would be typed as
 * a CSS module (load result ignored, MISSING_EXPORT) and grouped into a
 * nonsense `island-<tag>.oe-style.css` chunk. The encoding makes the graph id
 * path-free and JS-typed while the key round-trips exactly.
 */
const GRAPH_ID_PREFIX = '\0oe-style-asset:';

/**
 * The toolchain capability verdict behind the adapter form (module doc:
 * evidence and retirement condition). `false` — every build emits the fetch
 * adapter.
 */
export const NATIVE_CSS_MODULE_SCRIPTS = false;

/** The sheet-adapter form this build emits. */
export type SheetAdapterForm = 'fetch' | 'native-css-module';

/** Length of the content-hash slice carried in the emitted file name. */
const HASH_SLICE = 12;

/** One emitted style asset, recorded by the client build for downstream joins. */
export interface StyleAssetRecord {
  /** The emitted file name, dist/client-relative (`assets/<hash>.css`). */
  readonly fileName: string;
  /** SHA-256 hex of the emitted bytes — the hash the SSR read reconciles. */
  readonly hash: string;
}

/** SHA-256 hex of one asset's bytes (the manifest-recorded form). */
export function styleAssetHash(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

/**
 * The emitted asset's file name: content-addressed, deterministic. Islands
 * carrying the same sheet bytes share one asset — identical names fold in the
 * emitter (deduplicated per build below) and in the manifest's `styles` URL
 * set, so multi-island reuse is the same hashed bytes, not copies. Pruning
 * granularity vs cache reuse stays #1548's product decision (ADR-0164 §6);
 * the protocol only guarantees the cache key is the content.
 */
export function styleAssetFileName(source: string): string {
  return `assets/${styleAssetHash(source).slice(0, HASH_SLICE)}.css`;
}

/** The virtual graph id for one style request (module doc: why the encoding). */
export function styleAssetGraphId(registryKey: string): string {
  return `${GRAPH_ID_PREFIX}${Buffer.from(registryKey, 'utf8').toString('base64url')}.js`;
}

/** The registry key encoded in a graph id, or undefined for foreign ids. */
export function styleAssetRegistryKey(graphId: string): string | undefined {
  if (!graphId.startsWith(GRAPH_ID_PREFIX) || !graphId.endsWith('.js')) return undefined;
  try {
    return Buffer.from(graphId.slice(GRAPH_ID_PREFIX.length, -'.js'.length), 'base64url').toString(
      'utf8',
    );
  } catch {
    return undefined;
  }
}

/**
 * The fetch adapter module for one emitted asset. Default export: the
 * `CSSStyleSheet`, ready before any importer evaluates (TLA). The URL comes
 * from `import.meta.ROLLUP_FILE_URL_<referenceId>` — the bundler rewrites it
 * to the final hashed asset URL relative to the importing chunk, so the
 * adapter never hardcodes the output layout.
 */
export function fetchSheetAdapterModule(referenceId: string): string {
  return [
    '// <generated by open:style-assets — island style sheet adapter (ADR-0164); do not edit>',
    '// Fetch adapter: default export is the CSSStyleSheet for this sheet,',
    '// replaced from the emitted .css asset before any importer evaluates',
    '// (top-level await). Never document.head: a document-level node cannot',
    '// reach shadow trees.',
    `const sheetUrl = import.meta.ROLLUP_FILE_URL_${referenceId};`,
    'const response = await fetch(sheetUrl);',
    'if (!response.ok) {',
    `  throw new Error('[openElement] island style asset request failed with ' + response.status + ': ' + sheetUrl);`,
    '}',
    'const sheet = new CSSStyleSheet();',
    'await sheet.replace(await response.text());',
    'export default sheet;',
    '',
  ].join('\n');
}

/**
 * The native CSS-module-script adapter for one emitted asset (ADR-0164 §3
 * form 1): the browser's own CSS module machinery provides the sheet, zero
 * framework code. Inert on the current toolchain — the capability verdict in
 * the module doc keeps this generator out of every real build until the
 * verdict flips.
 */
export function nativeSheetAdapterModule(urlExpression: string): string {
  return [
    '// <generated by open:style-assets — island style sheet adapter (ADR-0164); do not edit>',
    '// Native CSS module script adapter: the browser parses the emitted asset;',
    '// no framework code runs.',
    `import sheet from ${urlExpression} with { type: 'css' };`,
    'export default sheet;',
    '',
  ].join('\n');
}

/** The adapter emission for the recorded capability verdict. */
export function sheetAdapterForm(): SheetAdapterForm {
  return NATIVE_CSS_MODULE_SCRIPTS ? 'native-css-module' : 'fetch';
}

/**
 * The inline sheet adapter: the sheet text rides the module. Dev server and
 * dev SSR have no emitted asset to fetch and no size or zero-inline contract,
 * so the text inlines there (element's cross-realm StyleSheet is the native
 * CSSStyleSheet in the browser and the SSR shim in Node — one module serves
 * both dev channels). Retirement condition (P5): when the native
 * CSS-module-script verdict flips, or dev learns to serve protocol assets
 * over HTTP, the dev channel collapses into the production adapter form and
 * this generator is deleted with the same verdict.
 */
export function inlineSheetAdapterModule(css: string): string {
  return [
    '// <generated by open:style-assets — dev island style sheet adapter (ADR-0164); do not edit>',
    '// Dev adapter: the sheet text rides the module (no emitted asset to fetch);',
    '// the production adapters fetch the real .css asset instead.',
    "import { StyleSheet } from '@openelement/element';",
    'const sheet = new StyleSheet();',
    `sheet.replaceSync(${JSON.stringify(css)});`,
    'export default sheet;',
    '',
  ].join('\n');
}

/**
 * The client-build plugin: intercepts style requests, emits the real `.css`
 * asset (byte-verbatim from the registry — the DSD text and the runtime
 * `CSSStyleSheet.replace` text both derive from these bytes), records each
 * emission into `records` for the client asset manifest's `styles` field and
 * the Phase 3 SSR read, and hands the sheet adapter back to the module graph.
 */
export function clientStyleAssetPlugin(records: Map<string, StyleAssetRecord>): Plugin {
  // Emission dedup keyed by the content-addressed file name: identical sheet
  // bytes from several islands emit ONE asset; every adapter rewrites the
  // same file-URL reference to the same hashed URL (reproduced on
  // rolldown 1.0.3: one referenceId interpolates correctly in each module).
  const emitted = new Map<string, string>();
  return {
    name: 'open:style-assets',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!source.endsWith(STYLE_REQUEST_SUFFIX)) return null;
      if (!importer) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
          `Style request "${source}" has no importer module — the reserved suffix is only ` +
            'emitted by the compiled-element transform, never authored by hand',
        );
      }
      const registryKey = styleRequestModuleId(importer, source);
      const request = getStyleRequest(registryKey);
      if (!request) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
          `Style request "${source}" from ${importer} carries no registered payload — the ` +
            'compiled-element transform must register the request before its import resolves. ' +
            'A hand-written import of the reserved suffix has no payload channel and fails here',
        );
      }
      return styleAssetGraphId(registryKey);
    },
    load(id) {
      const registryKey = styleAssetRegistryKey(id);
      if (registryKey === undefined) return null;
      const request = getStyleRequest(registryKey);
      if (!request) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
          `Resolved style module ${id} carries no registered payload — the registry entry ` +
            'disappeared between resolution and load',
        );
      }
      const hash = styleAssetHash(request.css);
      const fileName = styleAssetFileName(request.css);
      records.set(registryKey, { fileName, hash });
      // Both forms consume the same emitted asset; the verdict selects only
      // the adapter module handed back to the graph.
      let referenceId = emitted.get(fileName);
      if (referenceId === undefined) {
        referenceId = this.emitFile({ type: 'asset', fileName, source: request.css });
        emitted.set(fileName, referenceId);
      }
      if (sheetAdapterForm() === 'native-css-module') {
        return nativeSheetAdapterModule(`import.meta.ROLLUP_FILE_URL_${referenceId}`);
      }
      return fetchSheetAdapterModule(referenceId);
    },
  };
}

/**
 * The SSR-build plugin: serves the server half of the protocol. The sheet
 * adapter embeds the bytes of the SAME emitted asset the client build shipped
 * — read from dist/client and hash-checked against the client build's record,
 * so the DSD `<style data-oe-static-styles>` text and the client sheet cannot
 * drift (a stale dist fails the build instead of shipping a second fact).
 * `StyleSheet` is element's cross-realm constructor: the SSR shim parses the
 * rules the serializer reads back through `cssRules` (collectStaticStyleCss),
 * exactly the legacy path's text channel.
 */
export function serverStyleAssetPlugin(options: {
  /** The client build's emission records (ctx.styleAssets). */
  styleAssets: ReadonlyMap<string, StyleAssetRecord>;
  /** The client build's output directory (dist/client). */
  clientOutDir: string;
}): Plugin {
  const { styleAssets, clientOutDir } = options;
  return {
    name: 'open:style-assets-ssr',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!source.endsWith(STYLE_REQUEST_SUFFIX)) return null;
      if (!importer) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
          `Style request "${source}" has no importer module — the reserved suffix is only ` +
            'emitted by the compiled-element transform, never authored by hand',
        );
      }
      const registryKey = styleRequestModuleId(importer, source);
      if (!getStyleRequest(registryKey)) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
          `Style request "${source}" from ${importer} carries no registered payload — the ` +
            'compiled-element transform must register the request before its import resolves',
        );
      }
      return styleAssetGraphId(registryKey);
    },
    async load(id) {
      const registryKey = styleAssetRegistryKey(id);
      if (registryKey === undefined) return null;
      const record = styleAssets.get(registryKey);
      if (!record) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_UNMAPPED,
          `Style request ${registryKey} has no client-build emission record — the SSR build ` +
            'reads the DSD CSS text from the same .css asset the client build emitted ' +
            '(ADR-0164), and Phase 2 recorded none. Run the client build before the SSR build',
        );
      }
      const assetPath = join(clientOutDir, record.fileName);
      let text: string;
      try {
        text = await readFile(assetPath, 'utf8');
      } catch (cause) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_UNMAPPED,
          `The client-build style asset ${assetPath} cannot be read — the SSR build embeds the ` +
            `DSD text from that emitted asset and refuses a second fact (reason: ` +
            `${(cause as Error).message})`,
          { cause: cause as Error },
        );
      }
      const hash = styleAssetHash(text);
      if (hash !== record.hash) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_HASH_MISMATCH,
          `The client-build style asset ${assetPath} no longer matches the hash the client ` +
            'build recorded for it (recorded ' +
            record.hash.slice(0, HASH_SLICE) +
            ', read ' +
            hash.slice(0, HASH_SLICE) +
            ') — a stale or rewritten dist/client. The DSD text ' +
            'must be the same bytes the client sheet serves; rebuild the client build',
        );
      }
      return [
        '// <generated by open:style-assets — SSR style sheet adapter (ADR-0164); do not edit>',
        '// Server half of the style asset protocol: the sheet text is the emitted .css',
        "// asset's own bytes (hash-checked against the client build's record), so the",
        '// DSD output and the adopted client sheet cannot drift.',
        "import { StyleSheet } from '@openelement/element';",
        `const sheet = new StyleSheet();`,
        `sheet.replaceSync(${JSON.stringify(text)});`,
        'export default sheet;',
        '',
      ].join('\n');
    },
  };
}

/**
 * The dev plugin: same fail-closed intercept, inline adapter. The dev
 * transform pipeline runs the compiled-element transform (protocol
 * activated) before the island module's import resolves, so the registry
 * entry exists; the adapter rides the module (see inlineSheetAdapterModule).
 * Dev keeps the graph ids identical to the build's, so dev and prod exercise
 * the same seam shape.
 */
export function devStyleAssetPlugin(): Plugin {
  return {
    name: 'open:style-assets-dev',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!source.endsWith(STYLE_REQUEST_SUFFIX)) return null;
      if (!importer) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
          `Style request "${source}" has no importer module — the reserved suffix is only ` +
            'emitted by the compiled-element transform, never authored by hand',
        );
      }
      const registryKey = styleRequestModuleId(importer, source);
      const request = getStyleRequest(registryKey);
      if (!request) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
          `Style request "${source}" from ${importer} carries no registered payload — the ` +
            'compiled-element transform must register the request before its import resolves',
        );
      }
      return styleAssetGraphId(registryKey);
    },
    load(id) {
      const registryKey = styleAssetRegistryKey(id);
      if (registryKey === undefined) return null;
      const request = getStyleRequest(registryKey);
      if (!request) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
          `Resolved style module ${id} carries no registered payload — the registry entry ` +
            'disappeared between resolution and load',
        );
      }
      return inlineSheetAdapterModule(request.css);
    },
  };
}
