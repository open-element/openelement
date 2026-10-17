/**
 * The style-edge intercept (#1558; the #1553 protocol after the file-based
 * authoring retirement). The router client build is the sole owner of the
 * emitted `.css` artifact: `emitFile`, content hash, file name, manifest
 * mapping and the sheet adapter handed back to the module graph (the
 * three-owner seam split's middle owner — the compiler only requests, the
 * runtime only adopts).
 *
 * The compiled-element transform registers every authored `.css` import edge
 * of a compiled module in element's style-edge registry, keyed by the module
 * id the resolver lands on. This plugin intercepts those edges at
 * `enforce: 'pre'` — before vite's CSS plugin, which would serve a shadow
 * component's sheet as a document-level channel it can never reach shadow
 * trees through. A `.css` import from a module with no registered edges is a
 * plain app stylesheet and passes through untouched; a `.css` import from a
 * tracked module with no edge entry is a defect and fails closed.
 *
 * The sheet's text lives in exactly one place — the authored file (P6), read
 * through ONE processing path for every half: Vite's own CSS pipeline (its
 * `?inline` CSS module — `@import` dependencies expanded, `url()` targets
 * emitted and rewritten, the project's PostCSS chain applied), plus the one
 * scope decision. The client build emits those bytes content-hashed (resolving
 * Vite's asset placeholders in `generateBundle`), the SSR build declares the
 * emitted URL, and the dev server serves the same processed bytes from a real
 * `text/css` resource. There is no second copy of the text anywhere in the
 * protocol, so there is nothing to reconcile.
 *
 * The graph id handed to the bundler is a `\0`-virtual id whose encoded key
 * carries no path shape and whose terminal suffix is `.js` — never the
 * `.css` id itself: the toolchain infers the module type from the id's
 * extension suffix, and a `.css`-suffixed id is processed as a CSS module —
 * the load result is ignored and the build fails with MISSING_EXPORT
 * (reproduced on vite 8.0.16 / rolldown 1.0.3; `moduleType` on the resolveId
 * result does not override it). See the GRAPH_ID_PREFIX doc for the chunking
 * side of the same fact.
 *
 * Adapter forms — one decision, recorded with its evidence:
 *
 * - FETCH (emitted today): `fetch()` + `CSSStyleSheet.replace()`, guarded by
 *   top-level await so the sheet is fully parsed before any importing island
 *   module evaluates (module-evaluation ordering; a
 *   rejected fetch/replace fails the importing module too — fail closed).
 * - NATIVE (`import ... with { type: 'css' }`): implemented as the other
 *   emission, selected when {@linkcode NATIVE_CSS_MODULE_SCRIPTS} is true.
 *
 * The capability verdict is a build-toolchain fact, not a runtime probe: the
 * adapter is bundled, so a runtime check cannot choose between two build-time
 * module shapes. The verdict on record is negative twice over — rolldown
 * 1.0.3 hard-fails the native form at MISSING_EXPORT
 * and Safari has no CSS module scripts through Safari 27 (#1553 App. C),
 * so even a bundler-capable native form would not cover the delivered fleet.
 * Retirement condition (P5): when a toolchain both bundles the native form
 * and the fleet supports it, flip the verdict and delete the fetch emission —
 * the adapter form is a capability probe, not a permanent architecture.
 *
 * Neither adapter ever touches `document.head`: the sheet travels to its
 * consumer as a stylesheet object (a shadow root adopts it, a light root
 * adopts it on the document — alpha15 S lane S-C1.2), and a document-head
 * sink is not a delivery form of this protocol at all.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Plugin, ViteDevServer } from 'vite';
import {
  type ClassCandidateRegistry,
  compileElementModule,
  compileServerComponentIfAdmitted,
  readCompiledArtifactStyles,
  getStyleRequest,
  hasStyleImporter,
  lightRootScopeTag,
  type RegisteredStyleRequest,
  registerStyleEdges,
  stableModuleId,
  styleRequestModuleId,
  styleRequestsForImporter,
} from '@openelement/compiler';
import { ISLAND_ADMISSION } from '@openelement/protocol/island-admission';
import { createServerComponentSourceResolver } from './server-component-host.ts';
import { walkModuleGraph } from './module-graph-walk.ts';
import {
  registerArtifactCandidates,
  registerCandidatesFromCompiled,
} from './collect-shadow-candidates.ts';
import { findBuildWorkspaceRoot } from '../workspace-alias.ts';
import {
  STYLE_SHEET_LIVE,
  STYLE_SHEET_READY,
  STYLE_SHEET_URL,
} from '@openelement/protocol/style-sheet';
import { buildError, ClientBuildErrorCode } from '../../internal/error-codes.ts';
import { scopeLightRootCss } from './light-css-scope.ts';
import { dirname as posixDirname, relative as posixRelative } from 'pathe';
import { owningPackageName, packageNameAt } from './package-identity.ts';

/**
 * The `\0`-virtual graph id prefix. The registry key rides base64url-encoded
 * (terminal `.js` appended): the bundler infers the module type from the id's
 * extension suffix, and the client build's island chunk-grouping rules match
 * on path segments (`/<islandsDir>/`) — a raw-key graph id would be typed as
 * a CSS module (load result ignored, MISSING_EXPORT) and grouped into a
 * nonsense `<sheet>.css` chunk. The encoding makes the graph id path-free and
 * JS-typed while the key round-trips exactly.
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
  /** SHA-256 hex of the emitted bytes — the manifest's content address. */
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
 * granularity vs cache reuse stays #1548's product decision;
 * the protocol only guarantees the cache key is the content.
 */
export function styleAssetFileName(source: string): string {
  return `assets/${styleAssetHash(source).slice(0, HASH_SLICE)}.css`;
}

/** The virtual graph id for one style edge (module doc: why the encoding). */
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
 * The fetch adapter module for one emitted asset.
 *
 * Default export: the `CSSStyleSheet` for this sheet, created synchronously so
 * a compiled class can bind it in `static styles` without waiting — the class
 * export then leaves the asynchronous module-evaluation chain that delays it
 * behind this asset (the WebKit overlapping-evaluation race, KR-2). The rules
 * land through `replace()` afterwards, and readiness is recorded on the sheet
 * under the protocol's {@linkcode STYLE_SHEET_READY} key so the element runtime
 * can hand the styles to connected roots and gate SSR fallback removal.
 *
 * The URL comes from `import.meta.ROLLUP_FILE_URL_<referenceId>` — the bundler
 * rewrites it to the final hashed asset URL relative to the importing chunk, so
 * the adapter never hardcodes the output layout.
 */
export function fetchSheetAdapterModule(
  referenceId: string,
  comments: readonly string[] = [],
): string {
  return [
    '// <generated by open:style-assets — island style sheet adapter; do not edit>',
    ...comments,
    "// Fetch adapter: the default export is this sheet's CSSStyleSheet, created",
    '// synchronously. Rules arrive through replace(); readiness is recorded under',
    `// the protocol's "${STYLE_SHEET_READY}" key for the element runtime. Never`,
    '// document.head: a document-level node cannot reach shadow trees.',
    `const sheetUrl = import.meta.ROLLUP_FILE_URL_${referenceId};`,
    'const sheet = new CSSStyleSheet();',
    'const ready = fetch(sheetUrl)',
    '  .then((response) => {',
    '    if (!response.ok) {',
    `      throw new Error('[openElement] island style asset request failed with ' + response.status + ': ' + sheetUrl);`,
    '    }',
    '    return response.text();',
    '  })',
    '  .then((css) => sheet.replace(css));',
    '// Observed without conversion: this catch only prevents an unhandled',
    '// rejection before a root consumes the promise. The stored promise keeps its',
    '// rejected state, so a consumer that awaits it still sees the failure.',
    'void ready.catch(() => {});',
    `sheet['${STYLE_SHEET_READY}'] = ready;`,
    '// The external identity of this sheet: a root whose SSR/DSD markup',
    '// references this URL keeps that declarative link as the delivery and does',
    '// not adopt this constructable copy (alpha15 S lane) — one stylesheet',
    '// resource, one delivery, no duplicate application.',
    `sheet['${STYLE_SHEET_URL}'] = sheetUrl;`,
    'export default sheet;',
    '',
  ].join('\n');
}

/**
 * The native CSS-module-script adapter for one emitted asset (form 1): the
 * browser's own CSS module machinery provides the sheet, zero
 * framework code. Inert on the current toolchain — the capability verdict in
 * the module doc keeps this generator out of every real build until the
 * verdict flips.
 */
export function nativeSheetAdapterModule(urlExpression: string): string {
  return [
    '// <generated by open:style-assets — island style sheet adapter; do not edit>',
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
 * The URL-only sheet shim: the sheet carries the resource's identity and no
 * rules, because the rules are delivered by the resource itself (a declared
 * `<link>`, the browser's own parse). Both server halves use it — the SSR
 * build for an edge whose asset the client build emitted, and the dev server
 * for every edge (its delivery is the dev resource endpoint).
 */
function urlOnlySheetAdapterModule(href: string, comments: readonly string[]): string {
  return [
    '// <generated by open:style-assets — SSR style sheet adapter; do not edit>',
    ...comments,
    "import { StyleSheet } from '@openelement/element';",
    `const sheet = new StyleSheet();`,
    `sheet['${STYLE_SHEET_URL}'] = ${JSON.stringify(href)};`,
    'export default sheet;',
    '',
  ].join('\n');
}

/**
 * The dev resource URL of one authored style edge (alpha15 S lane, S-C1.3).
 *
 * Dev has no emitted asset, so the edge's own endpoint takes its place: a
 * framework-controlled path under the dev server's `.openElement` namespace,
 * carrying the CONFIGURED base (a non-root base keeps working — the URL is
 * what the SSR link and the adapter both use) and an opaque digest of the
 * registry key (the authored path is never exposed, and the scope identity —
 * which rides that key — cannot collide with another edge's).
 *
 * No version segment: the endpoint owns its response and serves fresh bytes
 * per request (`no-store`), and the sheet object is the live copy an edit
 * re-fills (see {@linkcode devSheetAdapterModule}). A versioned URL would
 * additionally churn the declared link's href, which the claim's expected
 * resource set is built from.
 */
export function devAuthoredStyleUrl(base: string, registryKey: string): string {
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  return `${cleanBase}.openElement/authored-css.${devStyleDigest(registryKey)}.css`;
}

/** The opaque, deterministic resource id of one style edge. */
export function devStyleDigest(registryKey: string): string {
  return styleAssetHash(registryKey).slice(0, HASH_SLICE + 4);
}

/** The dev resource path suffix the dev server's middleware answers. */
const DEV_AUTHORED_STYLE_PATH = /(?:^|\/)\.openElement\/authored-css\.([0-9a-f]{16})\.css$/;

/** The digest a request path names, or undefined for a foreign path. */
export function devAuthoredStyleDigestOfPath(path: string): string | undefined {
  return DEV_AUTHORED_STYLE_PATH.exec(path)?.[1];
}

/**
 * The generated dev adapter for one authored edge (S-C1.3): the module carries
 * the resource URL and nothing else — no rule text, no selector, no
 * `replaceSync` of embedded CSS.
 *
 * The sheet object is held per realm AND per edge identity
 * (`globalThis.__openElementDevStyleSheets`), so an HMR re-evaluation of this
 * module re-fills the SAME object instead of handing the roots a reference
 * they would never adopt; `replace()` then re-renders every root that holds
 * it. The holder is keyed by the edge's digest rather than by URL, so it
 * survives a URL-form change and two documents of one realm share the sheet
 * they can legally share (a sheet constructed in another realm would be
 * rejected by `adoptedStyleSheets`).
 */
export function devSheetAdapterModule(options: { url: string; identity: string }): string {
  return [
    '// <generated by open:style-assets-dev — dev authored style sheet adapter; do not edit>',
    '// The authored rules live in a real dev resource; this module carries only its',
    '// URL. One CSSStyleSheet per edge, held per realm so an HMR re-evaluation',
    '// UPDATES the same object (every root holding it re-renders) instead of',
    '// handing out a stale reference. fetch() + replace(): no DOM node, ever.',
    `const sheetUrl = ${JSON.stringify(options.url)};`,
    `const sheetId = ${JSON.stringify(options.identity)};`,
    'const holder = (globalThis.__openElementDevStyleSheets ??= new Map());',
    'let entry = holder.get(sheetId);',
    'if (entry === undefined) {',
    '  entry = { sheet: new CSSStyleSheet(), revision: 0 };',
    '  holder.set(sheetId, entry);',
    '}',
    '// One revision per evaluation: an edit that lands while an earlier fetch is',
    '// still in flight must never overwrite the newer bytes (out-of-order',
    '// settlements would otherwise apply a stale sheet).',
    'entry.revision += 1;',
    'const revision = entry.revision;',
    'const sheet = entry.sheet;',
    "const ready = fetch(sheetUrl, { headers: { accept: 'text/css,*/*;q=0.1' } })",
    '  .then((response) => {',
    '    if (!response.ok) {',
    `      throw new Error('[openElement] dev style sheet request failed with ' + response.status + ': ' + sheetUrl);`,
    '    }',
    '    return response.text();',
    '  })',
    '  .then((css) => (revision === entry.revision ? sheet.replace(css) : undefined));',
    '// Observed without conversion: the stored promise keeps its rejected state.',
    'void ready.catch(() => {});',
    `sheet['${STYLE_SHEET_READY}'] = ready;`,
    `sheet['${STYLE_SHEET_URL}'] = sheetUrl;`,
    `// The dev resource is LIVE: the adopted object is the copy an edit reaches.`,
    `sheet['${STYLE_SHEET_LIVE}'] = true;`,
    'export default sheet;',
    'if (import.meta.hot) import.meta.hot.accept(() => { /* re-evaluated: the fetch above re-fills the same sheet object */ });',
    '',
  ].join('\n');
}

/**
 * The CSS text of Vite's `?inline` CSS module — the documented "import a CSS
 * file as a string" form, whose default export is the sheet text AFTER the
 * project's CSS pipeline ran it (the project's PostCSS chain, `@import`
 * dependencies resolved, `url()` references rewritten to dev URLs).
 *
 * Reusing that pipeline is what keeps a relative asset reference working from
 * a virtual resource URL, and keeps it working IDENTICALLY in both deliveries:
 * a rewritten `url('/app/x.png')` resolves the same from a `<link>` (relative
 * to the stylesheet) and from a constructed sheet (relative to the document).
 * The module shape is asserted, never guessed — anything else fails the
 * request closed instead of serving unrelated text as a stylesheet.
 */
export function inlineCssModuleText(code: string, file: string): string {
  // The default export is the module's FIRST statement; anything a later
  // transform appends after it is not the sheet. The literal is matched as a
  // JSON string (escapes included), so the closing quote is the first
  // unescaped one — never "the last quote in the module".
  const match = /^export default ("(?:[^"\\]|\\.)*")/m.exec(code);
  if (match === null) {
    throw buildError(
      ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
      `Vite's ?inline CSS module for ${file} did not have the expected ` +
        `"export default <css text>" shape (got ${JSON.stringify(code.slice(0, 160))}), ` +
        'so the dev resource cannot serve it as a stylesheet',
    );
  }
  return JSON.parse(match[1]!) as string;
}

/**
 * The intercept's resolve half, shared by every channel (client build, SSR
 * build, dev). A relative `.css` import from a tracked module answers with
 * the edge's graph id; anything else passes through untouched. Fail closed:
 * a tracked importer whose `.css` edge carries no registry entry is a defect
 * (the compiled-element transform registers every edge it admits), and an
 * importer-less `.css` source is never an authored module edge.
 */
function styleEdgeResolveId(this: unknown, source: string, importer?: string): string | null {
  if (!source.endsWith('.css') || !importer) return null;
  if (!hasStyleImporter(importer)) return null;
  const registryKey = styleRequestModuleId(importer, source);
  if (!getStyleRequest(registryKey)) {
    throw buildError(
      ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
      `Style edge "${source}" from ${importer} carries no registry entry — the ` +
        'compiled-element transform registers every `.css` edge it admits, so a tracked ' +
        'importer with an unregistered edge is a defect. The intercept never re-inlines',
    );
  }
  return styleAssetGraphId(registryKey);
}

/**
 * The authored sheet's text as VITE's CSS pipeline produces it for this build
 * (S-C1.3 follow-up).
 *
 * A component sheet is not a document stylesheet: its bytes are consumed as an
 * emitted asset AND as the text a constructed `CSSStyleSheet` parses, so a
 * relative `url()` or an `@import` left in them resolves against the asset's
 * own location instead of the authoring file's. Vite's `?inline` CSS module is
 * the toolchain's documented form of "this file's CSS as a string" — the
 * project's PostCSS chain, `@import` dependencies expanded, relative `url()`
 * references emitted as content-addressed assets (or inlined under the
 * configured `assetsInlineLimit`) and rewritten — and it is the SAME seam the
 * dev resource endpoint reads, so dev and production serve one CSS semantics
 * from one processing path rather than two.
 *
 * The build reaches it through the plugin context (`load` +
 * `getModuleInfo`): Vite's dev server exposes the same module through
 * `environment.transformRequest`, which a build has no equivalent of. The
 * module is loaded, never imported — nothing in the bundle carries CSS text.
 */
interface SheetProcessingContext {
  load(options: { id: string }): Promise<unknown>;
  getModuleInfo(id: string): { code?: string | null } | null;
}

async function readEdgeCss(
  context: SheetProcessingContext,
  request: RegisteredStyleRequest,
): Promise<string> {
  const moduleId = `${request.file}?inline`;
  await context.load({ id: moduleId });
  const code = context.getModuleInfo(moduleId)?.code;
  if (typeof code !== 'string') {
    throw buildError(
      ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
      `Vite produced no ?inline CSS module for the style edge's sheet ${request.file}`,
    );
  }
  return processedEdgeCss(request, code);
}

/**
 * The authored sheet's own bytes with the scope decision applied — the SSR
 * build's text shim (no client asset exists, so there is no URL to declare).
 * It deliberately keeps Vite out of the SSR build: a server build's `url()`
 * rewriting describes the SERVER output, and this text is parsed by the
 * document/constructed-sheet consumers, so the authored spelling is the only
 * correct one. External resource coverage for URL-less sheets is #1609's
 * scope, not this seam's.
 */
async function readAuthoredEdgeCss(request: RegisteredStyleRequest): Promise<string> {
  try {
    return scopeEdgeCss(request, await readFile(request.file, 'utf8'));
  } catch (cause) {
    throw buildError(
      ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
      `The style edge's sheet file ${request.file} cannot be read — authored .css files are ` +
        `the protocol's only byte source (reason: ${(cause as Error).message})`,
      { cause: cause as Error },
    );
  }
}

/**
 * One edge's serving bytes from Vite's `?inline` CSS module code — the same
 * extraction for both access paths (a build's plugin context, the dev
 * server's `transformRequest`), so the scope decision and the CSS processing
 * have exactly one spelling per half.
 */
function processedEdgeCss(request: RegisteredStyleRequest, inlineCode: string): string {
  return scopeEdgeCss(request, inlineCssModuleText(inlineCode, request.file));
}

/**
 * One edge's serving bytes from an already-obtained authored text. The scope
 * decision lives here alone, so every half of the protocol — the emitted
 * asset, the SSR text shim, the dev resource endpoint — applies the same
 * boundary to whatever bytes it serves (S-C1.2, S-C1.3).
 */
function scopeEdgeCss(request: RegisteredStyleRequest, authored: string): string {
  return request.scopeTag === undefined ? authored : scopeLightRootCss(request.scopeTag, authored);
}

/**
 * The client-build plugin: intercepts style edges, emits the real `.css`
 * asset (content-addressed from the edge's serving bytes — Vite's own
 * processing of the authored file, see {@linkcode readEdgeCss}), records each
 * emission into `records` for the client asset manifest's `styles` field, and
 * hands the sheet adapter back to the module graph.
 */
export interface StyleAssetEmission {
  /** The Vite plugin (the graph's normal path). */
  readonly plugin: Plugin;
  /**
   * Emit one registered edge's asset through this build's ONE emission state
   * (S-C1.4). The server-rendered discovery pass calls this directly instead of
   * awaiting the virtual style module's own `load` hook: that nesting is the
   * reentrant load Rolldown documents as a deadlock hazard, and for a packed
   * sheet it never settled — leaving records and assets absent while the build
   * advanced and the SSR phase failed closed.
   *
   * `context` must be a plugin context, not the plugin object: the `?inline`
   * read and `emitFile` both belong to the calling hook's context.
   */
  emit(
    context: StyleAssetEmitContext,
    request: RegisteredStyleRequest,
  ): Promise<{ css: string; fileName: string; referenceId: string }>;
}

/** The plugin-context surface the shared emission needs. */
export interface StyleAssetEmitContext {
  load(options: { id: string }): Promise<unknown>;
  getModuleInfo(id: string): { code?: string | null } | null;
  emitFile(file: { type: 'asset'; fileName: string; source: string }): string;
}

export const clientStyleAssetPlugin: (
  records: Map<string, StyleAssetRecord>,
) => Plugin & Pick<StyleAssetEmission, 'emit'> = (records) => {
  // Emission dedup keyed by the content-addressed file name: identical sheet
  // bytes from several islands emit ONE asset; every adapter rewrites the
  // same file-URL reference to the same hashed URL (reproduced on
  // rolldown 1.0.3: one referenceId interpolates correctly in each module).
  const emitted = new Map<string, string>();
  return {
    name: 'open:style-assets',
    enforce: 'pre',
    resolveId: styleEdgeResolveId,
    async load(id) {
      const registryKey = styleAssetRegistryKey(id);
      if (registryKey === undefined) return null;
      const request = getStyleRequest(registryKey);
      if (!request) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
          `Resolved style module ${id} carries no registry entry — the edge ` +
            'disappeared between resolution and load',
        );
      }
      // One emission operation, shared with the discovery pass (below).
      const { referenceId } = await emitStyleAsset(this, request, records, emitted);
      if (sheetAdapterForm() === 'native-css-module') {
        return nativeSheetAdapterModule(`import.meta.ROLLUP_FILE_URL_${referenceId}`);
      }
      return fetchSheetAdapterModule(referenceId);
    },
    emit: (context: StyleAssetEmitContext, request: RegisteredStyleRequest) =>
      emitStyleAsset(context, request, records, emitted),

    /**
     * Vite's CSS processing emits the files a sheet references (an image, a
     * font) and leaves its own `__VITE_ASSET__<referenceId>__` placeholder in
     * the text. Vite resolves those placeholders for the CSS it generates per
     * chunk; an asset this protocol emits is outside that pass, so the same
     * resolution runs here — with the same public API Vite uses
     * (`getFileName`: the bundler's own file-name mapping, never a second
     * hashing algorithm) and the same base rule Vite applies to CSS assets.
     *
     * The placeholder embeds the referenced file's own content hash, so the
     * sheet's file name (computed from the pre-resolution text) stays a
     * faithful content address: two different referenced assets can never
     * produce one sheet name.
     */
    generateBundle(_options, bundle) {
      const base = this.environment.config.base;
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'asset' || !fileName.endsWith('.css')) continue;
        const css =
          typeof output.source === 'string'
            ? output.source
            : Buffer.from(output.source).toString('utf8');
        if (!css.includes(ASSET_PLACEHOLDER_PREFIX)) continue;
        output.source = css.replace(
          assetPlaceholderRE,
          (_match, referenceId: string, postfix = '') =>
            encodeURI(cssAssetUrl(base, fileName, this.getFileName(referenceId) + postfix)),
        );
      }
    },
  };
};

/**
 * The server-rendered graph's roots (S-C1.4): the module FILES the discovery
 * walk starts from, plus the module SPECIFIERS the generated SSR entry imports
 * for its islands. A specifier resolves through the bundler — the same
 * resolution the entry's own import gets — so a seed can never name a different
 * module than the SSR build bundles.
 */
export interface ServerRenderedSeeds {
  readonly files: readonly string[];
  readonly specifiers: readonly string[];
}

/**
 * The server-rendered style-edge pass (S-C1.4, #1609).
 *
 * The client build's graph contains the islands and only the islands, so a
 * Page, Layout or component that the server renders alone never entered it —
 * and neither did the authored `.css` edge it declares. The build already knows
 * the SERVER-rendered graph's roots (the route/page/layout sources, and the
 * island modules the generated SSR entry imports); this pass walks their static
 * module graph through the bundler's own resolver (`walkModuleGraph`: relative,
 * `#imports`, alias and package export paths alike), asks the compiler for each
 * module's admission facts, and loads every registered edge through
 * `clientStyleAssetPlugin` — the same plugin instance, Vite CSS processing,
 * content address, manifest record and adapters an island's sheet gets, in the
 * same client build. Modules are read, never imported: no server-only
 * JavaScript reaches a client bundle.
 */
export function serverRenderedStyleEdgesPlugin(
  seeds: ServerRenderedSeeds,
  emission: Pick<StyleAssetEmission, 'emit'>,
  candidates: ClassCandidateRegistry,
  /**
   * The packages this app ADMITTED (the scanned manifests — explicit and
   * scan-derived alike). The discovery pass uses them for one thing: telling an
   * app that a component package it merely IMPORTS is not delivered. Under the
   * AUTO admission default the scan owns that reporting (it knows the derived
   * set and the manifest-less owners directly), so `admissionMode` 'auto'
   * silences this walk-based report; 'manual' keeps it verbatim.
   */
  admittedPackages: readonly string[] = [],
  /**
   * The module texts this walk read, offered to a provider that extracts
   * candidates from source (alpha15 stage 2B). The walk already reads every
   * module to ask the compiler for its facts, so the map costs no extra read:
   * it is the SAME fact, published for the engine that needs it. Omit it when
   * the selected engine's integration owns its own source detection (Tailwind).
   */
  sources?: Map<string, string>,
  /**
   * The admission mode the scan resolved (`packageIslands`, default 'auto'):
   * 'auto' silences the walk-based unadmitted-package report in favor of the
   * scan's own diagnostics; 'manual' keeps the report.
   */
  admissionMode: 'auto' | 'manual' = 'auto',
  /**
   * The admitted static component tags (alpha15 server lane): the walk's
   * server function component compile routes nested compiled hosts through
   * `__ssr` for exactly this set.
   */
  serverComponentTags: readonly string[] = [],
): Plugin {
  let admitted = false;
  let edges: Map<string, RegisteredStyleRequest> | undefined;
  /**
   * The Vite build's resolved root, recorded by this plugin's own
   * `configResolved` — the workspace-root search below must start from the
   * build's root, not from the process working directory (a build launched
   * from elsewhere than its root would otherwise bound the workspace wrong).
   */
  let resolvedRoot: string | undefined;
  return {
    name: 'open:server-rendered-style-edges',
    enforce: 'pre',
    apply: 'build',
    configResolved(config) {
      resolvedRoot = config.root;
    },
    // The DISCOVERY phase runs in buildStart, which is why this plugin is
    // mounted BEFORE every consumer of its facts: the compiler facts it
    // registers — the authored `.css` edges AND the statically admitted class
    // candidates (defect B) — must be complete before the component stylesheet
    // compiles, and that happens in another plugin's buildStart.
    async buildStart() {
      if (admitted) return;
      admitted = true;
      edges = await discoverServerRenderedModules.call(
        this,
        seeds,
        candidates,
        new Set(admittedPackages),
        sources,
        resolvedRoot,
        admissionMode,
        serverComponentTags,
      );
    },
    // The module-LOADING phase: reaching a sheet's text through Vite's `?inline`
    // CSS module is only possible while the toolchain is loading modules (a
    // build's plugin context has no transform-phase equivalent). The emission
    // runs once, at the first module the graph asks for, from the facts the
    // discovery above registered.
    async load() {
      if (edges === undefined) return null;
      const discovered = edges;
      edges = undefined;
      await emitServerRenderedEdges.call(this, discovered, emission);
      return null;
    },
  };
}

/**
 * The DISCOVERY half: resolve the seeds through this build's own resolver, walk
 * their static module graph once, and register every module's compiler facts —
 * the authored `.css` edges and the statically admitted class candidates —
 * into the build's registries. Returns the edge facts the emission half needs.
 */
async function discoverServerRenderedModules(
  this: {
    resolve(
      specifier: string,
      importer?: string,
    ): Promise<{ id: string; external?: boolean | 'absolute' | 'relative' } | null>;
    info(message: string): void;
    warn(message: string): void;
  },
  seeds: ServerRenderedSeeds,
  candidates: ClassCandidateRegistry,
  admittedPackages: ReadonlySet<string>,
  sources?: Map<string, string>,
  /** The Vite build's resolved root (the plugin's `configResolved`); the process working directory only stands in when absent. */
  root?: string,
  /** The admission mode the scan resolved; 'auto' owns the reporting, so the walk stays silent. */
  admissionMode: 'auto' | 'manual' = 'auto',
  /** The admitted static component tags the server function component lane routes through `__ssr`. */
  serverComponentTags: readonly string[] = [],
): Promise<Map<string, RegisteredStyleRequest>> {
  const roots = [...seeds.files];
  for (const specifier of seeds.specifiers) {
    // The island modules the SSR entry imports, resolved exactly as that
    // import resolves. A specifier the resolver cannot answer is left to the
    // SSR build's own failure: it imports the same specifier.
    let resolved: { id: string; external?: boolean | 'absolute' | 'relative' } | null;
    try {
      resolved = await this.resolve(specifier);
    } catch {
      continue;
    }
    if (resolved === null || resolved.external === true) continue;
    roots.push(resolved.id.split('?', 1)[0]!);
  }
  if (roots.length === 0) {
    // Reported through the build's own channel, like every other boundary of
    // this pass: a build with no route, layout or SSR-renderable island module
    // emits no sheet, and saying so is the difference between a diagnosis and
    // a silent no-op.
    this.warn(
      'Server-rendered style discovery found no module roots (no route, layout or ' +
        'SSR-renderable island module); no stylesheet edge was emitted.',
    );
    return new Map();
  }
  const effectiveRoot = root ?? process.cwd();
  const workspaceRoot = findBuildWorkspaceRoot(effectiveRoot) ?? undefined;
  const serverComponentResolver = createServerComponentSourceResolver({
    root: effectiveRoot,
    workspaceRoot,
  });
  const walk = await walkModuleGraph(this, roots);
  if (walk.truncated) {
    this.warn(
      'Server-rendered module discovery stopped at its module bound; some server-only ' +
        'sheets may not be emitted (reported, never silent).',
    );
  }
  /** The compiled ELEMENT modules the walk reached, package ones included. */
  const elementFiles: string[] = [];
  for (const file of walk.files) {
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    // The text this walk just read is published for a provider that extracts
    // candidates from source. Absence stays authoritative: a module that left
    // the graph drops its entry, so an edited or deleted file cannot leave
    // stale tokens in the next compile.
    sources?.set(file, source);
    let compiled;
    try {
      compiled = compileElementModule(source, stableModuleId(file, effectiveRoot, workspaceRoot), {
        staticSidecars: [ISLAND_ADMISSION],
      });
    } catch {
      continue;
    }
    if (compiled !== null) {
      registerStyleEdges(file, compiled.styleRequests ?? [], lightRootScopeTag(compiled.program));
      // The same compile carries the module's statically admitted class
      // candidates (defect B): the component stylesheet consumes them, and this
      // walk is the discovery that covers every specifier form the bundler
      // understands — relative, `#imports`, alias, package exports.
      registerCandidatesFromCompiled(file, compiled, candidates);
      elementFiles.push(file);
      continue;
    }
    // The server function component lane (alpha15): a route module carrying
    // an exported JSX-returning function compiles into `__h`/`__t`/`__ssr`
    // constructors. Its class candidates are LIGHT facts (no element class,
    // no shadow root), and its style EDGES are honestly skipped — a function
    // page owns no element class to hang the DSD `<link>` on, and a
    // registered edge with no consumer would emit an orphan CSS asset.
    const serverCompiled = compileServerComponentIfAdmitted(
      source,
      stableModuleId(file, effectiveRoot, workspaceRoot),
      {
        resolveModule: (specifier) => serverComponentResolver(specifier, file) ?? undefined,
        compiledTags: serverComponentTags,
      },
    );
    if (serverCompiled !== null) {
      candidates.register(file, serverCompiled.classCandidates ?? [], { shadow: false });
      continue;
    }
    // A SHIPPED (already compiled) module — a package consumed from node_modules
    // — has no authored grammar left to compile, but its `.css` edges are the
    // same edges: recovered through the same read the build-time transform uses
    // and registered through the same writer.
    const artifact = readCompiledArtifactStyles(source, file);
    if (artifact === undefined) {
      // Not a compiled artifact either: the module carries no class candidates,
      // and registering that absence keeps a deleted class from surviving an
      // edit (defect C).
      registerArtifactCandidates(source, file, candidates);
      continue;
    }
    registerStyleEdges(file, artifact.requests, artifact.scopeTag);
    registerArtifactCandidates(source, file, candidates);
    elementFiles.push(file);
  }
  reportUnadmittedComponentPackages.call(
    this,
    elementFiles,
    admittedPackages,
    effectiveRoot,
    admissionMode,
  );
  // The registered request objects themselves — never a re-derived key. The
  // previous form rebuilt each edge's graph id and decoded it back through
  // `getStyleRequest`, a round-trip that does not hold for every registry key
  // (11 starter sheets failed it: `NO REQUEST`), so their assets were never
  // emitted and the SSR phase failed closed. The registry already gave us the
  // requests; use them, keyed by their canonical module id.
  const edges = new Map<string, RegisteredStyleRequest>();
  for (const file of walk.files) {
    for (const request of styleRequestsForImporter(file)) {
      edges.set(request.moduleId, request);
    }
  }
  this.info(
    `Server-rendered discovery walked ${walk.files.length} module(s) and declared ${edges.size} ` +
      'stylesheet edge(s) for emission',
  );
  return edges;
}

/**
 * Tell the app that a component package it merely IMPORTS is not admitted.
 *
 * `packageIslands` is the admission channel: it is what makes a package's
 * declarations (SSR/DSD delivery, the style link, the declared Tailwind
 * requirement) part of the build. An ordinary import still reaches the
 * package's modules — the resolver walk finds them and emits their authored
 * sheets — but nothing renders them as components, so the app gets an unknown
 * element, no DSD, no stylesheet link, and (at best) an orphan CSS asset. The two
 * deliveries are not the same, and this is the boundary that says so out loud.
 *
 * A warning, never a failure: importing a package module is legal in its own
 * right (a shared helper, a type, an application that styles the raw tag), and
 * only the app can know which it meant. Under AUTO admission the scan owns the
 * reporting (a derived package is admitted, a manifest-less one is reported
 * there), so the walk keeps its mouth shut — this report is the manual-mode
 * boundary.
 */
function reportUnadmittedComponentPackages(
  this: { warn(message: string): void; info(message: string): void },
  elementFiles: readonly string[],
  admittedPackages: ReadonlySet<string>,
  root: string,
  mode: 'auto' | 'manual',
): void {
  if (mode === 'auto') return;
  const appPackageName = packageNameAt(root);
  const offenders = new Set<string>();
  for (const file of elementFiles) {
    const packageName = owningPackageName(file);
    // The application's OWN component: the nearest package.json is the app's
    // own manifest. This is a PACKAGE-IDENTITY test, never a path test — a
    // dependency installed under `node_modules/` inside the project root is a
    // package like any other (the ordinary `npm install` layout, the pnpm
    // store layout, and a workspace link all resolve to the dependency's own
    // name). An app manifest with no `name` cannot make the identification, so
    // the path test is the conservative fallback there.
    if (appPackageName === undefined) {
      const rootPrefix = root.endsWith('/') ? root : `${root}/`;
      if (file.startsWith(rootPrefix)) continue;
    } else if (packageName === undefined || packageName === appPackageName) {
      continue;
    }
    if (packageName === undefined || admittedPackages.has(packageName)) continue;
    offenders.add(packageName);
  }
  for (const packageName of [...offenders].sort()) {
    this.warn(
      `The component package "${packageName}" is imported by this app but not admitted: its ` +
        'components render as unknown elements (no declarative shadow root, no stylesheet link), ' +
        `and any Tailwind requirement it declares is not compiled. Add "${packageName}" to ` +
        '`packageIslands` in openelement.config.ts to admit its declarations.',
    );
  }
}

/**
 * The EMISSION half: emit every discovered edge through the build's ONE
 * emission state. It needs the module-loading phase (a `?inline` load per
 * sheet), which is why it is the pass's `load` hook and not part of discovery.
 * Never by awaiting the virtual module's own `load` hook, which nests one load
 * inside another (the cycle that left packed sheets unemitted) — the await
 * happens inside this hook, so the work is owned by the build rather than
 * detached from it.
 */
async function emitServerRenderedEdges(
  this: { load(options: { id: string }): Promise<unknown> },
  edges: Map<string, RegisteredStyleRequest>,
  emission: Pick<StyleAssetEmission, 'emit'>,
): Promise<void> {
  for (const request of edges.values()) {
    await emission.emit(this as unknown as StyleAssetEmitContext, request);
  }
}

/**
 * Emit one registered edge's asset through the build's ONE emission state.
 *
 * Mechanical extraction of what the virtual style module's `load` hook always
 * did: process the sheet through Vite's CSS pipeline, derive the canonical
 * identity, compute the content-addressed file name, deduplicate, emit through
 * the same owner and record it in the same styles map. Two callers share it —
 * the graph path and the server-rendered discovery pass — so there is still one
 * emitter, one hash, one dedup map and one manifest.
 */
async function emitStyleAsset(
  context: StyleAssetEmitContext,
  request: RegisteredStyleRequest,
  records: Map<string, StyleAssetRecord>,
  emitted: Map<string, string>,
): Promise<{ css: string; fileName: string; referenceId: string }> {
  const css = await readEdgeCss(context, request);
  const hash = styleAssetHash(css);
  const fileName = styleAssetFileName(css);
  records.set(request.moduleId, { fileName, hash });
  let referenceId = emitted.get(fileName);
  if (referenceId === undefined) {
    referenceId = context.emitFile({ type: 'asset', fileName, source: css });
    emitted.set(fileName, referenceId);
  }
  return { css, fileName, referenceId };
}

/** Whether `candidate` lives inside `root` (the project whose sheets this build owns). */
function withinRoot(candidate: string, root: string): boolean {
  const base = root.endsWith('/') ? root : `${root}/`;
  return candidate === root || candidate.startsWith(base);
}

/** Vite's asset reference placeholder, as its CSS text carries it. */
const ASSET_PLACEHOLDER_PREFIX = '__VITE_ASSET__';
const assetPlaceholderRE = /__VITE_ASSET__([\w$]+)__(?:\$_(.*?)__)?/g;

/**
 * The URL a CSS asset gives a file the build emitted, following Vite's own CSS
 * rule: a base-absolute URL under an absolute base (the client build's
 * `/client/`), and a path relative to the CSS asset when the base is relative.
 *
 * Shared with the Tailwind component sheet's `url()` rebase (tailwind.ts): a
 * sheet emitted outside Vite's CSS graph still addresses the files that graph
 * emitted, and the URL rule has exactly one spelling for both emitters.
 */
export function cssAssetUrl(base: string, cssFileName: string, emittedFileName: string): string {
  if (base === '' || base === './') {
    const relative = posixRelative(posixDirname(cssFileName), emittedFileName);
    return relative.startsWith('.') ? relative : `./${relative}`;
  }
  return `${base.endsWith('/') ? base : `${base}/`}${emittedFileName}`;
}

/**
 * The SSR-build plugin: serves the server half of the protocol. The sheet
 * adapter embeds the authored file's bytes — the same bytes the client build
 * emitted content-hashed — so the DSD `<style data-oe-static-styles>` text
 * and the client sheet cannot drift: one file, one fact (P6).
 * `StyleSheet` is element's cross-realm constructor: the SSR shim parses the
 * rules the serializer reads back through `cssRules` (collectStaticStyleCss),
 * exactly the legacy path's text channel.
 */
export function serverStyleAssetPlugin(options?: {
  /**
   * The client build's emitted sheet files, keyed by registry key (the sheet
   * file's resolved path). When an edge's asset was emitted, the server shim
   * carries its URL instead of the sheet text (S5-C): the DSD template then
   * declares the authored stylesheet as an external `<link>`, exactly like the
   * generated utility sheet — one delivery for one resource, no framework CSS
   * text in the SSR markup.
   */
  files?: ReadonlyMap<string, string>;
  /** The build's normalized public base, used to join the emitted file name. */
  base?: string;
}): Plugin {
  return {
    name: 'open:style-assets-ssr',
    enforce: 'pre',
    resolveId: styleEdgeResolveId,
    async load(id) {
      const registryKey = styleAssetRegistryKey(id);
      if (registryKey === undefined) return null;
      const request = getStyleRequest(registryKey);
      if (!request) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
          `Resolved style module ${id} carries no registry entry — the edge ` +
            'disappeared between resolution and load',
        );
      }
      const emitted = options?.files?.get(registryKey);
      if (emitted !== undefined) {
        const href = `${options?.base ?? '/'}client/${emitted}`;
        return urlOnlySheetAdapterModule(href, [
          '// Server half of the style edge protocol: the sheet is declared as the',
          "// client build's emitted asset — one resource, one delivery — so the DSD",
          '// template carries a parser-visible `<link>` and never inlines the CSS.',
        ]);
      }
      // A registered FILE edge with no emitted asset (S-C1.4, #1609). Every
      // URL-addressable sheet the client build can reach is emitted, so this is
      // either a sheet that build could not process or a defect of discovery.
      // It is never answered by inlining an in-root component's CSS: the render
      // fails closed with a stable, actionable diagnostic.
      if (withinRoot(request.file, this.environment.config.root)) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
          `The server-rendered style edge ${request.file} has no emitted asset: the client ` +
            'build must emit every URL-addressable authored sheet (island or server-only) ' +
            'before the SSR build declares it. Discovery walks the server-rendered sources ' +
            'through the bundler resolver, so an in-root sheet reported here is a defect of ' +
            'that walk or of the module itself — never a reason to inline CSS.',
        );
      }
      // Out-of-root (package) sheets that never entered a client graph are the
      // one remaining class this build cannot emit: reported, never silent.
      this.warn(
        `Style sheet ${request.file} is outside the project root and no client build emitted ` +
          'it (a package component no client graph contains); its authored text is inlined for ' +
          'this render. Give the owning package a client entry (packageIslands) to externalize it.',
      );
      const text = await readAuthoredEdgeCss(request);
      return [
        '// <generated by open:style-assets — SSR style sheet adapter; do not edit>',
        '// Server half of the style edge protocol: the sheet text is the .css bytes',
        "// this build emits — the authored file's own bytes for a shadow root, its",
        '// build-time `@scope` projection for a light root — so the server-rendered',
        '// style text and the adopted client sheet cannot drift.',
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
 * The dev plugin: the same fail-closed intercept, serving the SAME facts the
 * builds serve — from a real resource instead of from the module (S-C1.3).
 *
 * Every authored edge becomes one `text/css` endpoint on the dev server
 * (`{@linkcode devAuthoredStyleUrl}`). The bytes it answers are Vite's own
 * processing of the authored file (`?inline`: the project's PostCSS chain,
 * `@import` dependencies resolved, `url()` rewritten to dev URLs) with the
 * S-C1.2 scope transform applied when the edge is a light root — one pipeline,
 * two delivery modes, no separate dev CSS compiler.
 *
 * The two halves then follow the existing protocol:
 *
 *   - the client half gets an adapter carrying the resource URL and nothing
 *     else (`{@linkcode devSheetAdapterModule}`): `fetch()` + `replace()` into
 *     one realm-held, per-edge sheet object, flagged live so a root adopts the
 *     copy an HMR edit re-fills;
 *   - the server half gets the URL-only shim, so the DSD template and the
 *     document head declare the resource as a parser-visible `<link>` and no
 *     authored CSS text is generated into the markup — the same delivery shape
 *     production uses.
 *
 * Failures are explicit: an unknown resource id answers 404, an edge whose
 * bytes cannot be produced answers 500, and the adapter's rejected `fetch`
 * surfaces through the element runtime's `OE_STYLES_SHEET_LOAD_FAILED` report.
 * There is no fallback that inlines the CSS.
 */
export function devStyleAssetPlugin(): Plugin {
  /** Resource digest → the edge's registry key (the middleware's index). */
  const resourceEdges = new Map<string, string>();
  let base = '/';
  return {
    name: 'open:style-assets-dev',
    apply: 'serve',
    enforce: 'pre',
    configResolved(config) {
      base = config.base ?? '/';
    },
    resolveId: styleEdgeResolveId,
    load(id) {
      const registryKey = styleAssetRegistryKey(id);
      if (registryKey === undefined) return null;
      const request = getStyleRequest(registryKey);
      if (!request) {
        throw buildError(
          ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
          `Resolved style module ${id} carries no registry entry — the edge ` +
            'disappeared between resolution and load',
        );
      }
      const url = devAuthoredStyleUrl(base, registryKey);
      const digest = devStyleDigest(registryKey);
      // The index is written by both halves: the server half registers it
      // while rendering (before any client can request the URL the markup
      // declares), the client half on the adapter's own load.
      resourceEdges.set(digest, registryKey);
      const environmentName = (this as { environment?: { name?: string } }).environment?.name;
      if (environmentName !== 'client') {
        return urlOnlySheetAdapterModule(url, [
          '// Server half of the dev style edge protocol: the sheet is declared by',
          '// the dev resource endpoint this URL names, so the DSD template and the',
          '// document head carry a parser-visible `<link>` and no inline CSS.',
        ]);
      }
      return devSheetAdapterModule({ url, identity: digest });
    },
    configureServer(server: ViteDevServer) {
      // The resource's own endpoint. Registered before Vite's internal
      // middlewares, so neither the module graph nor Vite's CSS plugin ever
      // sees this URL — the response is a stylesheet, never a module and never
      // a style-injecting script.
      server.middlewares.use(async (request, response, next) => {
        const path = (request.url ?? '').split('?', 1)[0];
        if (path === undefined) {
          next();
          return;
        }
        const digest = devAuthoredStyleDigestOfPath(path);
        if (digest === undefined) {
          next();
          return;
        }
        const registryKey = resourceEdges.get(digest);
        const edge = registryKey === undefined ? undefined : getStyleRequest(registryKey);
        if (edge === undefined) {
          response.statusCode = 404;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end(
            '[openElement] unknown dev style resource — every authored edge is ' +
              'registered by the compiled-element transform before its resource is requested',
          );
          return;
        }
        try {
          const inline = await server.environments.client.transformRequest(`${edge.file}?inline`);
          if (inline === null) {
            throw buildError(
              ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED,
              `Vite produced no ?inline CSS module for the style edge's sheet ${edge.file}`,
            );
          }
          const css = processedEdgeCss(edge, inline.code);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/css; charset=utf-8');
          // The endpoint owns its response and the sheet is the live copy an
          // edit re-fills: the browser must never serve a stale sheet.
          response.setHeader('Cache-Control', 'no-store');
          response.end(css);
        } catch (error) {
          response.statusCode = 500;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end(
            `[openElement] dev style resource failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      });
    },
  };
}
