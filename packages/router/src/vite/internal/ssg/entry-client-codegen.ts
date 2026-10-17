/** Client island entry emission; browser runtime wiring only. */
import process from 'node:process';
import { ACTION_FETCH_HEADER, IDLE_FALLBACK_TIMEOUT_MS } from '@openelement/element';
import { stableModuleId } from '@openelement/compiler';
import { runtimeModulePath } from '../runtime-module-path.ts';
import { findBuildWorkspaceRoot } from '../../workspace-alias.ts';
import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';
import { selectRendererAdapter } from './renderer-adapter.ts';
import {
  type AdmittedClientIslandEntry,
  type AdmittedIslandModuleSpecifier,
  validateClientIslandEntry,
  VIRTUAL_RUNTIME_SPECIFIERS,
} from './entry-generators.ts';
import type { ClientIslandDeliveryEntry, ClientIslandDeliveryInput } from './delivery.ts';

// Machine-independent identity for the generated error copy: the workspace
// anchor keeps absolute build paths out of the shipped client bundle.
const WORKSPACE_ROOT = findBuildWorkspaceRoot(process.cwd()) ?? undefined;

/**
 * One island's activation factory.
 *
 * Native renderer (B2): the island chunk import and the element runtime's
 * dynamic import start TOGETHER, and the element definition waits for both.
 * The island chunk statically imports the same runtime chunk, so the two
 * signals resolve from the same module; waiting here is what installs the
 * runtime's document services (pre-upgrade capture, deep fragment
 * navigation) BEFORE `customElements.define` upgrades an existing host,
 * while the island chunk itself still downloads in parallel. The runtime is
 * only ever requested through `__loadElementRuntime`, so a page that
 * activates no island never fetches it.
 *
 * Lit renderer (#1339): the entry is element-free by design, so the factory
 * keeps the plain dynamic import.
 */
function islandImportFactory(
  modulePath: AdmittedIslandModuleSpecifier,
  tagName: string,
  exportName?: string,
  renderer: 'native' | 'lit' = 'native',
): string {
  const nameLiteral = exportName ? quoteGeneratedJavaScriptValue(exportName) : 'undefined';
  const tagLiteral = quoteGeneratedJavaScriptValue(tagName);
  // Error copy uses a stable, machine-independent module identity; the import
  // specifier above stays absolute for the bundler.
  const errorLiteral = quoteGeneratedJavaScriptValue(
    `[openElement] Capability module ${stableModuleId(
      modulePath,
      undefined,
      WORKSPACE_ROOT,
    )} did not export a constructor for ${tagName}`,
  );
  // #1339 lit: after definition the island is a hydration ROOT — its page
  // host is never client-registered, so no parent hydrate() will remove the
  // SSR defer-hydration marker. Lifting it here runs lit-element-hydrate-
  // support's deferred connectedCallback and the island adopts its DSD root.
  const lift = renderer === 'lit' ? ` __liftDeferHydration(document, ${tagLiteral});` : '';
  const define = `var _name = ${nameLiteral}; var Ctor = _name ? mod[_name] : mod.default; if (typeof Ctor !== 'function') throw new Error(${errorLiteral}); if (!customElements.get(${tagLiteral})) customElements.define(${tagLiteral}, Ctor);${lift} return mod;`;
  if (renderer === 'lit') {
    return `() => import(${quoteGeneratedJavaScriptValue(modulePath)}).then(function(mod) { ${define} })`;
  }
  return `function () {
    var __island = import(${quoteGeneratedJavaScriptValue(modulePath)});
    return Promise.all([__island, __loadElementRuntime()]).then(function (__loaded) {
      var mod = __loaded[0];
      ${define}
    });
  }`;
}

interface NormalizedClientIsland extends AdmittedClientIslandEntry {
  tagName: string;
}

/** JavaScript single-quoted literal used in the media-query evidence. */
function quoteSingle(value: string): string {
  return `'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')}'`;
}

/** Expand one capability declaration into its one-to-many element names. */
function expandClientIslandEntries(
  entries: readonly ClientIslandDeliveryInput[],
): NormalizedClientIsland[] {
  const expanded: NormalizedClientIsland[] = [];
  const seen = new Map<string, NormalizedClientIsland>();

  for (const input of entries) {
    const admitted = validateClientIslandEntry(input);
    const delivery = admitted as AdmittedClientIslandEntry & ClientIslandDeliveryEntry;
    const tags =
      delivery.tags && delivery.tags.length > 0
        ? delivery.tags
        : delivery.tagNames && delivery.tagNames.length > 0
          ? delivery.tagNames
          : [admitted.tagName];

    for (const tagName of tags) {
      const item: NormalizedClientIsland = {
        ...admitted,
        tagName,
        ...(delivery.exportNames?.[tagName] ? { exportName: delivery.exportNames[tagName] } : {}),
      };
      const prior = seen.get(tagName);
      if (prior) {
        if (
          prior.modulePath !== item.modulePath ||
          prior.strategy !== item.strategy ||
          prior.media !== item.media ||
          prior.exportName !== item.exportName
        ) {
          throw new Error(`Conflicting island capability declarations for ${tagName}`);
        }
        continue;
      }
      seen.set(tagName, item);
      expanded.push(item);
    }
  }
  return expanded;
}

interface ActivationGroup {
  entries: NormalizedClientIsland[];
  modulePath: AdmittedIslandModuleSpecifier;
}

function activationGroupKey(entry: NormalizedClientIsland): string {
  return `${entry.modulePath}\u0000${entry.strategy}\u0000${entry.media ?? ''}`;
}

function sharedActivationFactory(
  group: ActivationGroup,
  index: number,
  renderer: 'native' | 'lit' = 'native',
): string {
  const promise = `__activation${index}Promise`;
  const factory = `__activation${index}`;
  const importExpression =
    renderer === 'lit'
      ? `import(${quoteGeneratedJavaScriptValue(group.modulePath)})`
      : `Promise.all([import(${quoteGeneratedJavaScriptValue(
          group.modulePath,
        )}), __loadElementRuntime()])`;
  const lines = [
    `var ${promise};`,
    `var ${factory} = function() {`,
    `  if (!${promise}) ${promise} = ${importExpression}.then(function(__loaded) {`,
  ];
  if (renderer !== 'lit') lines.push('    var mod = __loaded[0];');
  else lines.push('    var mod = __loaded;');
  group.entries.forEach((entry, entryIndex) => {
    const ctor = `__Ctor${index}_${entryIndex}`;
    const value = entry.exportName
      ? `mod[${quoteGeneratedJavaScriptValue(entry.exportName)}]`
      : 'mod.default';
    const errorLiteral = quoteGeneratedJavaScriptValue(
      `[openElement] Capability module ${stableModuleId(
        group.modulePath,
        undefined,
        WORKSPACE_ROOT,
      )} did not export a constructor for ${entry.tagName}`,
    );
    lines.push(`    var ${ctor} = ${value};`);
    lines.push(`    if (typeof ${ctor} !== 'function') throw new Error(${errorLiteral});`);
    lines.push(
      `    if (!customElements.get(${quoteGeneratedJavaScriptValue(
        entry.tagName,
      )})) customElements.define(${quoteGeneratedJavaScriptValue(entry.tagName)}, ${ctor});`,
    );
    if (renderer === 'lit') {
      // #1339: see islandImportFactory — lift defer-hydration on hydration roots.
      lines.push(
        `    __liftDeferHydration(document, ${quoteGeneratedJavaScriptValue(entry.tagName)});`,
      );
    }
  });
  lines.push('    return mod;');
  lines.push('  });');
  lines.push(`  return ${promise};`);
  lines.push('};');
  return lines.join('\n');
}

/**
 * Whether any island this page can upgrade may hydrate server-rendered DOM
 * (#1416). The generated entry imports `@openelement/element` when it can, and
 * `@openelement/element/client-only` (same surface, no hydration executor) when it
 * cannot — a page whose every island is client-only never needs the ~9 KB of
 * claim machinery.
 *
 * Deliberately conservative, per the #1416 ruling: client-only entry only when
 * no island declares `ssr` or `dsd` true. An island that says nothing is
 * treated as able to hydrate (the compiler's own default for a native island
 * with DSD), and `strategy === 'only'` is the one shape that proves
 * client-only on its own — `resolveIslandSsrDsd` forces both flags off for
 * `hydrate: 'only'`, so those entries carry explicit `false`s. Any doubt
 * resolves to the full entry: the cost of a wrong guess in that direction is
 * 9 KB, and in the other direction a broken hydration.
 */
function pageCanHydrateServerDom(islands: readonly NormalizedClientIsland[]): boolean {
  return islands.some(
    (island) => island.strategy !== 'only' && (island.ssr !== false || island.dsd !== false),
  );
}

/**
 * The narrow runtime-surface module the generated entry loads through its
 * dynamic `import()` (B2), on the same two predicates as before — the #1416
 * claim split plus the #1548 blocks split:
 *
 * - claim axis (#1416): `canHydrateServerDom` — `false` proves every island is
 *   client-only and the runtime graph drops the compiled hydration executor
 *   (`./client-only`);
 * - blocks axis (#1548): `includeBlocksRuntime` — `false` records the island
 *   blocks scan's proof that no admitted island module lowers a conditional
 *   or list Block, and the runtime graph drops the compiled when/each
 *   builders (`./no-blocks`, or `./base` when both axes drop).
 *
 * Both defaults keep the full runtime: the claim default is "any island can
 * hydrate", the blocks default is "the scan did not run or proved nothing".
 *
 * WHY A WRAPPER MODULE, NOT THE ALREADY-SELECTED ENTRY SPECIFIER: the entry
 * must reach the runtime through a dynamic `import()`, and a dynamic import
 * RESOLVES TO A NAMESPACE OBJECT — opaque to the bundler's tree-shaking. So
 * `import('@openelement/element')` (or any of `./client-only`, `./base`,
 * `./no-blocks`) keeps that entry's WHOLE public surface in the client graph,
 * server-only renderers included. Measured on the canonical starter probe:
 * the shared `element-runtime-<hash>.js` chunk grows 86 KB raw / 27 KB gzip →
 * 124 KB raw / 39 KB gzip, i.e. +38 KB raw / +12 KB gzip on every page that
 * ever loads the runtime, for exports this entry never calls. Re-exporting
 * exactly the three bindings the entry calls, from a real module, restores
 * the tree-shaking the old static import got — while the edge into that
 * module stays dynamic, so island-free pages still fetch nothing.
 *
 * Three wrappers, not one: the element entry's install side effects are
 * exactly what the two-axis selector chooses, so the specifier inside the
 * wrapper must be fixed per row. `element-services-full.ts` re-exports from
 * `@openelement/element`, and the client build's #1548 blocks alias rewrites
 * that bare specifier to `no-blocks` for the whole graph when the scan proved
 * no Block Parts — one wrapper therefore covers both blocks-present and
 * blocks-absent rows of the hydrate axis. The all-client-only axis needs its
 * own specifiers (`./client-only`, `./base`), which that alias never rewrites
 * (it is anchored to the bare specifier), so those rows get their own
 * wrappers. A fourth wrapper would only restate what the alias already does.
 *
 * The wrapper MODULE resolves through {@linkcode runtimeModulePath}, the same
 * source-else-staged-JS rule the scheduler/enhance virtual specifiers use, so
 * a packed install gets the staged `.js` sibling — but the SPECIFIER the entry
 * carries is a stable virtual id (see
 * {@linkcode ELEMENT_SERVICES_RUNTIME_SPECIFIERS}), never a filesystem path:
 * the entry is itself a virtual module, so an absolute path would bake the
 * build machine's checkout layout into the emitted bytes (the same app built
 * in two checkouts produced different client entries, leaked the local
 * filesystem layout into build output and made content-hash caching
 * path-dependent), and a relative path would resolve against the Vite ROOT,
 * not against the router package.
 */
export function elementServicesSpecifier(
  canHydrateServerDom: boolean,
  includeBlocksRuntime: boolean,
): string {
  if (!canHydrateServerDom) {
    return includeBlocksRuntime
      ? ELEMENT_SERVICES_RUNTIME_SPECIFIERS.clientOnly
      : ELEMENT_SERVICES_RUNTIME_SPECIFIERS.base;
  }
  return ELEMENT_SERVICES_RUNTIME_SPECIFIERS.full;
}

/**
 * The machine-independent virtual specifiers the generated client entry uses
 * to reach the `element-services-*` wrappers above.
 *
 * The generated entry is a virtual module (`\0virtual:open-client-entry` in
 * both hosts), so it has no directory a relative specifier could resolve
 * against, and an absolute path made the emitted bytes depend on the build
 * machine's checkout root. A stable id keeps the entry text identical on every
 * machine; the two client-entry hosts map it back to the real module through
 * {@linkcode resolveElementServicesRuntimeModule}, exactly as they already do
 * for the scheduler/enhance runtime specifiers.
 *
 * The ids share the `virtual:open-client-runtime/` namespace and keep the
 * wrapper's file name (`.ts` tail included), so a reader of the emitted entry
 * still sees which surface it loads and the wrapper keeps one name across the
 * virtual id, the source file and the staged `.js` sibling.
 */
export const ELEMENT_SERVICES_RUNTIME_SPECIFIERS = {
  full: 'virtual:open-client-runtime/element-services-full.ts',
  clientOnly: 'virtual:open-client-runtime/element-services-client-only.ts',
  base: 'virtual:open-client-runtime/element-services-base.ts',
} as const;

/**
 * Resolve one {@linkcode ELEMENT_SERVICES_RUNTIME_SPECIFIERS} id to the real
 * wrapper module, or null when the id is not one of ours. Both client-entry
 * hosts call this from their `resolveId` hook — `cli/build-client.ts` for the
 * built entry, `vite/dev-island-client.ts` for the dev entry — so the
 * specifier the generated entry carries has exactly one resolution rule.
 *
 * The literals stay LITERAL: the vp-pack guard extracts the consumer-side
 * path-consumed module set from literal `runtimeModulePath` arguments
 * (tools/lib/vp-pack.test.ts), and these wrappers are reached only through the
 * generated entry's import STRING — no pack module edge exists, so a computed
 * argument would drop them from the router tarball and the package would ship
 * a client entry importing modules it does not contain (the B2 pack
 * regression).
 */
export function resolveElementServicesRuntimeModule(id: string): string | null {
  switch (id) {
    case ELEMENT_SERVICES_RUNTIME_SPECIFIERS.full:
      return runtimeModulePath('./ssg/element-services-full.ts');
    case ELEMENT_SERVICES_RUNTIME_SPECIFIERS.clientOnly:
      return runtimeModulePath('./ssg/element-services-client-only.ts');
    case ELEMENT_SERVICES_RUNTIME_SPECIFIERS.base:
      return runtimeModulePath('./ssg/element-services-base.ts');
    default:
      return null;
  }
}

interface GenerateClientEntryOptions {
  /**
   * True when any page route carries data-open-enhance (#569): emit the form
   * enhancement layer even with zero islands, so enhanced forms are not
   * silently left as plain no-JS posts.
   */
  enhancedForms?: boolean;
  /**
   * Page renderer fork (Beta.2.2, #1339). 'lit' installs the lit hydration
   * support module FIRST (it must evaluate before any LitElement definition
   * so DSD roots are adopted, not re-rendered) and drops the
   * @openelement/element imports: createLogger is replaced by a tiny inline
   * logger, and ensurePreHydrationClickCapture/ensureDeepFragmentNavigation
   * are Native-claim helpers bound to the compiled kernel's DSD upgrade —
   * lit DSD adoption is owned by lit-element-hydrate-support instead. The
   * island scheduler and enhance client are import-free and stay unchanged.
   */
  renderer?: 'native' | 'lit';
  /**
   * Whether the page's element entry installs the compiled when/each Block
   * builders (#1548). Defaults to true — the full runtime. `false` is the
   * island blocks scan's proof (`islandsMightUseBlocks` === false) that no
   * admitted island module lowers a Block Part; the entry then drops the
   * builders (`./no-blocks`, or `./base` when the page is also all
   * client-only). Any doubt keeps the builders: a wrong `false` breaks every
   * when/each Part with a fail-closed runtime error, a wrong `true` costs
   * only bytes.
   */
  includeBlocksRuntime?: boolean;
  /**
   * The document stylesheet module the entry statically imports (the Tailwind
   * entry, alpha15 S lane): its presence puts the CSS into this build's graph
   * so the official pipeline compiles it and Vite emits the content-hashed
   * `.css` asset. The import has no runtime effect — Vite extracts it — so it
   * is emitted even when the entry carries no islands.
   */
  styleEntry?: string;
  /**
   * The component stylesheet's adapter module (alpha15 S lane): when present,
   * the entry imports the fetch adapter and registers the sheet globally
   * (`OpenElement.registerGlobalStyles`) once the element runtime has loaded,
   * so every compiled shadow root adopts it through the style scope.
   * Components whose DSD already references the emitted asset keep that
   * declarative link instead — the runtime skips the adopted copy for a
   * link-delivered root, so one resource has one delivery.
   * Native renderer only: the lit entry is element-free by design (#1339).
   */
  utilitySheet?: string;
}

/**
 * Does the generated client entry need the element runtime at all?
 *
 * The island-free entry shapes (zero client JS, and the CSS-only entry a
 * Tailwind-enabled app without islands or enhanced forms generates) import the
 * document stylesheet and nothing else — no runtime module is reachable from
 * them. This is the ONE place that fact is decided: the generator below selects
 * the island-free branch with it, and the client build's element-runtime chunk
 * guard consumes it instead of inferring a runtime requirement from the
 * emission shape (defect D). A `hydrate: 'none'` island is SSR-only and never
 * enters the client bundle, so it does not require the runtime either.
 *
 * "Needs" is a graph fact, not an evaluation-order fact: since B2 the native
 * entry reaches the runtime through a dynamic import only, so the runtime
 * chunk still exists in the emitted graph (and the guard still validates its
 * layout) while an island-free entry never requests it at runtime.
 *
 * The lit renderer's entry is element-free by design (#1339); that is a
 * separate, renderer-level fact the build already owns.
 */
export function clientEntryNeedsElementRuntime(
  islands: readonly ClientIslandDeliveryInput[],
  options: GenerateClientEntryOptions = {},
): boolean {
  if (options.enhancedForms === true) return true;
  return expandClientIslandEntries(islands).some((island) => island.strategy !== 'none');
}

export function generateClientEntry(
  islands: readonly ClientIslandDeliveryInput[],
  options: GenerateClientEntryOptions = {},
): string {
  const allIslands = expandClientIslandEntries(islands);
  // hydrate:'none' islands SSR-only — they never enter the client bundle
  const admittedIslands = allIslands.filter((i) => i.strategy !== 'none');
  // The document stylesheet import rides every entry shape, including the
  // island-free ones: the CSS asset is the whole reason a style-only client
  // build exists (alpha15 S lane).
  const styleImport =
    options.styleEntry === undefined
      ? ''
      : `import ${quoteGeneratedJavaScriptValue(options.styleEntry)};\n`;

  // The island-free shapes (clientEntryNeedsElementRuntime owns the decision):
  // the document stylesheet import is the only import they carry.
  if (!clientEntryNeedsElementRuntime(islands, options)) {
    if (styleImport !== '') {
      return `// openElement Client Entry - no client islands; the document stylesheet only\n${styleImport}`;
    }
    if (allIslands.length > 0) {
      return '// openElement Client Entry - All islands are hydrate:none (SSR-only), zero client JS\n';
    }
    return '// openElement Client Entry - No islands detected, zero client JS needed\n';
  }

  const lit = selectRendererAdapter(options.renderer).hydration === 'lit-adoption';
  // The component stylesheet's registration rides the native entry only: the
  // lit entry is element-free by design (#1339), and its DSD-delivered link
  // still styles server-rendered lit shadow trees.
  const nativeUtilitySheet = lit || options.utilitySheet === undefined ? '' : options.utilitySheet;
  // Lit hydration is owned by lit-element-hydrate-support, not by the compiled
  // claim, so the element package's hydration executor is never part of a lit
  // client bundle: that entry already keeps its element imports minimal and
  // the subpath choice below is a native-renderer concern.
  const canHydrateServerDom = pageCanHydrateServerDom(admittedIslands);
  // #1548: the blocks axis defaults to installed; only the scan's proof of
  // absence drops the builders (see includeBlocksRuntime above).
  const includeBlocksRuntime = options.includeBlocksRuntime !== false;
  const groupsByKey = new Map<string, ActivationGroup>();
  for (const entry of admittedIslands) {
    const key = activationGroupKey(entry);
    const group = groupsByKey.get(key);
    if (group) group.entries.push(entry);
    else groupsByKey.set(key, { entries: [entry], modulePath: entry.modulePath });
  }
  const groups = [...groupsByKey.values()];
  const activationLines: string[] = [];
  const groupFactories = new Map<ActivationGroup, string>();
  groups.forEach((group, index) => {
    if (group.entries.length > 1) {
      activationLines.push(sharedActivationFactory(group, index, lit ? 'lit' : 'native'));
      groupFactories.set(group, `__activation${index}`);
    }
  });
  const islandMap = admittedIslands
    .map((entry) => {
      const group = groups.find((candidate) => candidate.entries.includes(entry));
      const factory = group && groupFactories.get(group);
      return `  ${quoteGeneratedJavaScriptValue(entry.tagName)}: ${
        factory ||
        islandImportFactory(
          entry.modulePath,
          entry.tagName,
          entry.exportName,
          lit ? 'lit' : 'native',
        )
      }`;
    })
    .join(',\n');

  const tags = admittedIslands.map((i) => quoteGeneratedJavaScriptValue(i.tagName)).join(', ');
  const loadTags = admittedIslands
    .filter((i) => i.strategy === 'load')
    .map((i) => quoteGeneratedJavaScriptValue(i.tagName))
    .join(', ');
  const visibleTags = admittedIslands
    .filter((i) => i.strategy === 'visible')
    .map((i) => quoteGeneratedJavaScriptValue(i.tagName))
    .join(', ');
  const idleTags = admittedIslands
    .filter((i) => i.strategy === 'idle')
    .map((i) => quoteGeneratedJavaScriptValue(i.tagName))
    .join(', ');
  const onlyTags = admittedIslands
    .filter((i) => i.strategy === 'only')
    .map((i) => quoteGeneratedJavaScriptValue(i.tagName))
    .join(', ');
  const mediaEntries = admittedIslands.filter((i) => i.strategy === 'media');
  const mediaTags = mediaEntries.map((i) => quoteSingle(i.tagName)).join(', ');
  const mediaQueries = mediaEntries
    .map(
      (i) =>
        `    ${quoteGeneratedJavaScriptValue(
          i.tagName,
        )}: typeof window.matchMedia === 'function' ? window.matchMedia(${quoteSingle(i.media!)}) : null`,
    )
    .join(',\n');

  const headerComment = lit
    ? `// openElement Client Entry (load/idle/visible/media/only) — LIT renderer (#1339)
// lit-element-hydrate-support is the FIRST import: it patches LitElement so
// server-rendered DSD shadow roots are ADOPTED on definition instead of being
// re-rendered. This module never imports @openelement/element: the native
// claim helpers (ensurePreHydrationClickCapture, ensureDeepFragmentNavigation)
// belong to the compiled kernel's DSD upgrade and do not apply to lit
// hydration; the logger is inlined to keep the bundle element-free.
// Island scheduling and form enhancement are import-free runtimes shared
// unchanged with the native renderer.`
    : `// openElement Client Entry (load/idle/visible/media/only)
// load islands import immediately.
// idle islands import during browser idle time.
// visible islands import when their host enters the viewport.
// media islands import when their declared media query matches.
// only islands are client-only and import immediately (no DSD/SSR).
// A tag activates only when THIS page carries a host for it — the runtime
// form of the per-page island manifest (an island the page never reaches is
// never fetched, B2).
// Zero DOM interaction - safe with DSD rendering.
//
// #606: island-scheduler.ts is the single owner of strategy scheduling
// (island modules register on evaluation). #868: both runtimes are
// real modules bundled via the virtual:open-client-runtime specifiers — the
// entry only wires them, there is no inline string copy.`;

  // The entry's logger is INLINE, not `createLogger` from
  // `@openelement/element/logger` (B2/#1544). The logger leaf carries no
  // runtime kernel, but it is a module under the element package root — the
  // exact root the #1544 grouping rule homes in `element-runtime-<hash>.js` —
  // so a static import of it put the ENTIRE shared runtime chunk back into
  // every page's static graph, zero-island pages included (measured: the
  // zero-island entry statically imported element-runtime-<hash>.js and
  // downloaded its 86 KB raw / 27 KB gzip). Nothing in the entry may
  // statically import from the element package. The lit entry inlined the
  // same logger for the same element-free reason (#1339).
  const loggerBlock = `var log = {
  info: function () { if (typeof console !== 'undefined') console.info.apply(console, ['[openElement]'].concat([].slice.call(arguments))); },
  warn: function () { if (typeof console !== 'undefined') console.warn.apply(console, ['[openElement]'].concat([].slice.call(arguments))); },
  error: function () { if (typeof console !== 'undefined') console.error.apply(console, ['[openElement]'].concat([].slice.call(arguments))); },
  debug: function () {},
};`;

  // #1544/B2: the element runtime is NOT in the native entry's static import
  // graph. A page whose island manifest is empty must not download the
  // runtime it never uses; the runtime — and the document-level services it
  // owns (pre-upgrade click capture, deep fragment navigation, the framework
  // component stylesheet's registration) — arrives through the dynamic import
  // below when the first island actually starts hydrating. Island activation
  // chains on this promise (see the island factories), so the capture is
  // installed BEFORE any island module defines its element and upgrades an
  // existing host, while island chunks still download in parallel.
  // Island-bearing pages keep their warm start through the build's per-page
  // `<link rel="modulepreload">` projection of the island manifest.
  const runtimeLoader = `var __elementRuntimePromise = null;
var __loadElementRuntime = function () {
  if (!__elementRuntimePromise) {
    __elementRuntimePromise = import('${elementServicesSpecifier(
      canHydrateServerDom,
      includeBlocksRuntime,
    )}').then(function (__runtime) {
      __runtime.ensureDeepFragmentNavigation();
      __runtime.ensurePreHydrationClickCapture(document, __tags);${
        nativeUtilitySheet === ''
          ? ''
          : `
      // The framework component stylesheet (alpha15 S lane): one shared sheet
      // for every compiled shadow root whose classes were statically admitted.
      // The style scope adopts it on connect; a root whose DSD already carries
      // the declarative link for this asset keeps that link instead — one
      // resource, one delivery.
      __runtime.OpenElement.registerGlobalStyles([__oeUtilitySheet]);`
      }
      return __runtime;
    });
  }
  return __elementRuntimePromise;
};`;

  const schedulerImport = `import { createIslandScheduler as __schedule } from '${VIRTUAL_RUNTIME_SPECIFIERS.scheduler}';`;
  const enhanceImport =
    options.enhancedForms === true
      ? `import { createEnhanceClient } from '${VIRTUAL_RUNTIME_SPECIFIERS.enhance}';\n`
      : '';
  const importsBlock = lit
    ? `import '@lit-labs/ssr-client/lit-element-hydrate-support.js';
${schedulerImport}
${enhanceImport}
${loggerBlock}

// #1339: lit islands are hydration ROOTS. lit-ssr marks custom elements
// nested in a parent template with defer-hydration, which lit-html's
// hydrate() lifts while hydrating the parent — but page hosts are never
// client-registered (mirroring the native renderer), so no parent hydration
// exists for islands. Lifting the marker immediately after definition runs
// lit-element-hydrate-support's deferred connectedCallback, and the island's
// first update adopts its DSD shadow root (hydrate, never re-render).
// Deep, shadow-root-aware: islands live inside page DSD roots (#562).
var __liftDeferHydration = function (root, tag) {
  var visit = function (scope) {
    scope.querySelectorAll(tag).forEach(function (el) {
      if (el.hasAttribute('defer-hydration')) el.removeAttribute('defer-hydration');
    });
    scope.querySelectorAll('*').forEach(function (el) {
      if (el.shadowRoot) visit(el.shadowRoot);
    });
  };
  visit(root);
};`
    : `${schedulerImport}
${enhanceImport}
${loggerBlock}

${runtimeLoader}`;

  return `${headerComment}

${styleImport}${
    nativeUtilitySheet === ''
      ? ''
      : `import __oeUtilitySheet from ${quoteGeneratedJavaScriptValue(nativeUtilitySheet)};
`
  }${importsBlock}

var __map = {
${islandMap}
};
var __tags = [${tags}];
${
  options.enhancedForms === true
    ? `// B2: the form-enhancement layer is a document-level enhancement that uses
// the element runtime's services (pre-upgrade capture, deep fragment
// navigation), so its presence is a genuine trigger for the lazy runtime
// import — a page with enhanced forms but no islands still gets the runtime.
__loadElementRuntime();
`
    : ''
}
${activationLines.length > 0 ? `\n${activationLines.join('\n\n')}\n` : ''}

var __scheduler = __schedule({
  log: log,
  win: window,
  doc: document,
  map: __map,
  idleFallbackTimeoutMs: ${IDLE_FALLBACK_TIMEOUT_MS},
  strategies: {
    load: [${loadTags}],
    idle: [${idleTags}],
    visible: [${visibleTags}],
    media: [${mediaTags}],
    only: [${onlyTags}],
  },
${mediaEntries.length > 0 ? `  mediaQueries: {\n${mediaQueries}\n  },\n` : ''}
${
  options.enhancedForms === true
    ? `  // #584: late-hydrating islands create their shadow roots after the
  // ready-time scan; rescan so enhanced forms inside them are heard.
  onIslandLoaded: function () { __enhance.scanSubmitRoots(document); },`
    : '  // #597: no enhance layer — no submit-root rescan after island loads.\n  onIslandLoaded: null,'
}
});

${
  options.enhancedForms === true
    ? `// Form enhancement:
// forms marked data-open-enhance submit via fetch and the returned document
// is morphed into the live tree — INSIDE the page element's shadow root,
// which is where page content lives under DSD. Without JavaScript the same
// form is a native POST (303/422 HTML), so behavior degrades to the browser
// by construction. Runtime: enhance-client.ts (bundled via #868).
var __enhance = createEnhanceClient({
  log: log,
  tags: __tags,
  actionHeader: ${quoteGeneratedJavaScriptValue(ACTION_FETCH_HEADER)},
  win: window,
  doc: document,
  observeVisible: ${
    lit
      ? `function () {
    // Module loading is one-shot; new SSR hosts arrive after every morph.
    // Only admitted, already-loaded tags may resume Lit hydration here.
    __tags.forEach(function (tag) {
      if (customElements.get(tag)) __liftDeferHydration(document, tag);
    });
    __scheduler.observeVisible();
  }`
      : '__scheduler.observeVisible'
  },
});
`
    : '// No data-open-enhance forms: the form enhancement layer is omitted (#569 complement),\n// keeping the client bundle free of morph and popstate code.'
}
`;
}
