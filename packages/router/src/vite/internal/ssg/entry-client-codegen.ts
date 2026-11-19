/** Client island entry emission; browser runtime wiring only. */
import process from 'node:process';
import { ACTION_FETCH_HEADER, IDLE_FALLBACK_TIMEOUT_MS } from '@openelement/element';
import { stableModuleId } from '@openelement/compiler';
import { runtimeModulePath } from '../runtime-module-path.ts';
import { findBuildWorkspaceRootOrUndefined } from '../../workspace-alias.ts';
import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';
import {
  type AdmittedClientIslandEntry,
  type AdmittedIslandModuleSpecifier,
  validateClientIslandEntry,
  VIRTUAL_RUNTIME_SPECIFIERS,
} from './entry-generators.ts';
import type { ClientIslandDeliveryEntry, ClientIslandDeliveryInput } from './delivery.ts';

// Machine-independent identity for the generated error copy: the workspace
// anchor keeps absolute build paths out of the shipped client bundle.
const WORKSPACE_ROOT = findBuildWorkspaceRootOrUndefined(process.cwd());

/**
 * One island's activation factory.
 *
 * B2: the island chunk import and the element runtime's
 * dynamic import start TOGETHER, and the element definition waits for both.
 * The island chunk statically imports the same runtime chunk, so the two
 * signals resolve from the same module; waiting here is what installs the
 * runtime's document services (pre-upgrade capture, deep fragment
 * navigation) BEFORE `customElements.define` upgrades an existing host,
 * while the island chunk itself still downloads in parallel. The runtime is
 * only ever requested through `__loadElementRuntime`, so a page that
 * activates no island never fetches it.
 */
function islandImportFactory(
  modulePath: AdmittedIslandModuleSpecifier,
  tagName: string,
  exportName?: string,
  generatedLane = false,
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
  const define = `var _name = ${nameLiteral}; var Ctor = _name ? mod[_name] : mod.default; if (typeof Ctor !== 'function') throw new Error(${errorLiteral}); if (!customElements.get(${tagLiteral})) customElements.define(${tagLiteral}, Ctor); return mod;`;
  if (generatedLane) {
    // M11-3: a generated Native Custom Element island owns its mount/claim
    // through the compiler-emitted shell; the legacy executor runtime is not a
    // prerequisite for defining it, so the factory never waits for (or loads)
    // that runtime. Class-lane islands keep the B2 runtime-first ordering.
    return `function () {
    return import(${quoteGeneratedJavaScriptValue(modulePath)}).then(function (mod) {
      ${define}
    });
  }`;
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
  /** M11-3 build-only lane fact; absent means the class/executor lane. */
  generatedLane?: true;
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

/**
 * One declaration's normalized identity, for a conflict message that names BOTH
 * sources. The dedup below must never resolve a disagreement by keeping the
 * first declaration silently: the message has to say which two declarations
 * collided and on which side of the generated/class lane each sits, because the
 * lane fact decides whether the activation factory loads the executor runtime.
 */
function describeClientIslandDeclaration(entry: NormalizedClientIsland): string {
  const source = entry.isPackage ? 'package' : 'local';
  const lane = entry.generatedLane === true ? 'generated-lane' : 'class-lane';
  return (
    `${source} ${lane} declaration ` +
    `(module ${entry.modulePath}, strategy ${entry.strategy}, ` +
    `media ${entry.media ?? 'none'}, export ${entry.exportName ?? 'default'})`
  );
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
        ...(delivery.generatedLane === true ? { generatedLane: true as const } : {}),
      };
      const prior = seen.get(tagName);
      if (prior) {
        // M-4b: `generatedLane` is part of the declaration identity, not
        // decoration. It decides whether the factory waits for (and loads) the
        // executor runtime (`islandImportFactory` / `activationGroupKey`), so
        // two declarations that agree on module/strategy/media/export but
        // disagree on the lane are NOT interchangeable. Fail closed and name
        // both sources instead of silently keeping the first one.
        if (
          prior.modulePath !== item.modulePath ||
          prior.strategy !== item.strategy ||
          prior.media !== item.media ||
          prior.exportName !== item.exportName ||
          prior.generatedLane !== item.generatedLane
        ) {
          throw new Error(
            `Conflicting island capability declarations for ${tagName}: ` +
              `${describeClientIslandDeclaration(prior)} vs ${describeClientIslandDeclaration(item)}`,
          );
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
  return `${entry.modulePath}\u0000${entry.strategy}\u0000${entry.media ?? ''}\u0000${
    entry.generatedLane === true ? 'generated' : 'class'
  }`;
}

function sharedActivationFactory(group: ActivationGroup, index: number): string {
  const promise = `__activation${index}Promise`;
  const factory = `__activation${index}`;
  const generatedLane = group.entries.every((entry) => entry.generatedLane === true);
  const importExpression = generatedLane
    ? `import(${quoteGeneratedJavaScriptValue(group.modulePath)})`
    : `Promise.all([import(${quoteGeneratedJavaScriptValue(
        group.modulePath,
      )}), __loadElementRuntime()])`;
  const lines = generatedLane
    ? [
        `var ${promise};`,
        `var ${factory} = function() {`,
        `  if (!${promise}) ${promise} = ${importExpression}.then(function(mod) {`,
      ]
    : [
        `var ${promise};`,
        `var ${factory} = function() {`,
        `  if (!${promise}) ${promise} = ${importExpression}.then(function(__loaded) {`,
        '    var mod = __loaded[0];',
      ];
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
 * The machine-independent virtual specifier for the document-services wrapper
 * ({@linkcode ./element-document-services.ts}), the third narrow element
 * surface beside the lazy `element-services-*` trio above.
 *
 * It exists because the two document-level services the entry installs —
 * deep fragment navigation and the pre-hydration click capture — used to
 * arrive only as a side effect of the LAZY element-runtime import. A page whose
 * islands are all generated-lane emits no such import (M11-3 / the P1 win), so
 * both services stopped being installed there; the deep-fragment regression is
 * the measured consequence. This surface carries the two installers and no
 * executor entry, so a generated-lane page floor can install them without
 * loading the generic Part Program executor.
 *
 * Same resolution rule as the trio: the generated entry is a virtual module,
 * so it carries this stable id and each client-entry host resolves it through
 * {@linkcode resolveElementServicesRuntimeModule}.
 */
export const ELEMENT_DOCUMENT_SERVICES_RUNTIME_SPECIFIER =
  'virtual:open-client-runtime/element-document-services.ts';

/**
 * Resolve one {@linkcode ELEMENT_SERVICES_RUNTIME_SPECIFIERS} id to the real
 * wrapper module, or null when the id is not one of ours. Both client-entry
 * hosts call this from their `resolveId` hook — `cli/build-client.ts` for the
 * built entry, `vite/dev-island-client.ts` for the dev entry — so the
 * specifier the generated entry carries has exactly one resolution rule.
 *
 * The literals stay LITERAL: the release toolchain's vp-pack guard extracts the
 * consumer-side path-consumed module set from literal `runtimeModulePath`
 * arguments, and these wrappers are reached only through the generated entry's
 * import STRING — no pack module edge exists, so a computed argument would drop
 * them from the router tarball and the package would ship a client entry
 * importing modules it does not contain (the B2 pack regression).
 */
export function resolveElementServicesRuntimeModule(id: string): string | null {
  switch (id) {
    case ELEMENT_SERVICES_RUNTIME_SPECIFIERS.full:
      return runtimeModulePath('./ssg/element-services-full.ts');
    case ELEMENT_SERVICES_RUNTIME_SPECIFIERS.clientOnly:
      return runtimeModulePath('./ssg/element-services-client-only.ts');
    case ELEMENT_SERVICES_RUNTIME_SPECIFIERS.base:
      return runtimeModulePath('./ssg/element-services-base.ts');
    case ELEMENT_DOCUMENT_SERVICES_RUNTIME_SPECIFIER:
      return runtimeModulePath('./ssg/element-document-services.ts');
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
   */
  utilitySheet?: string;
}

/**
 * Does the generated client entry need the legacy compiled executor runtime?
 *
 * This is the executor lane question (defect D / M11-3), not the "is there any
 * client JS" question — that one is {@linkcode clientEntryHasClientJs}. A
 * generated Native Custom Element island defines/claims through the
 * compiler-emitted shell, so it does not need the executor runtime; a class-lane
 * island (or the form-enhancement layer) does. The generator emits
 * `__loadElementRuntime`/the element-services dynamic import only when this
 * returns true, and the client build's element-runtime chunk guard consumes the
 * same fact instead of inferring a runtime requirement from the emission shape.
 * A `hydrate: 'none'` island never enters the client bundle at all.
 */
export function clientEntryNeedsElementRuntime(
  islands: readonly ClientIslandDeliveryInput[],
  options: GenerateClientEntryOptions = {},
): boolean {
  if (options.enhancedForms === true) return true;
  // M11-3: an island owned by the generated Native Custom Element lane defines
  // and claims through the compiler-emitted shell, so it is not a reason to
  // load the legacy compiled executor runtime. Any class-lane island (and the
  // form-enhancement layer) still is.
  return expandClientIslandEntries(islands).some(
    (island) => island.strategy !== 'none' && island.generatedLane !== true,
  );
}

/**
 * Does the generated client entry carry any client JavaScript at all? This is
 * a different fact from {@linkcode clientEntryNeedsElementRuntime} (M11-3): a
 * page whose only islands are generated-lane islands has client JS but no
 * executor runtime, so the island-free/style-only shapes must not swallow it.
 */
export function clientEntryHasClientJs(
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

  // The island-free shapes (clientEntryHasClientJs owns the decision): the
  // document stylesheet import is the only import they carry. A generated-lane
  // island still has client JS even though it needs no executor runtime.
  if (!clientEntryHasClientJs(islands, options)) {
    if (styleImport !== '') {
      return `// openElement Client Entry - no client islands; the document stylesheet only\n${styleImport}`;
    }
    if (allIslands.length > 0) {
      return '// openElement Client Entry - All islands are hydrate:none (SSR-only), zero client JS\n';
    }
    return '// openElement Client Entry - No islands detected, zero client JS needed\n';
  }

  const utilitySheetSpecifier = options.utilitySheet ?? '';
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
      activationLines.push(sharedActivationFactory(group, index));
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
          entry.generatedLane === true,
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

  const headerComment = `// openElement Client Entry (load/idle/visible/media/only)
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
  // statically import from the element package.
  const loggerBlock = `var log = {
  info: function () { if (typeof console !== 'undefined') console.info.apply(console, ['[openElement]'].concat([].slice.call(arguments))); },
  warn: function () { if (typeof console !== 'undefined') console.warn.apply(console, ['[openElement]'].concat([].slice.call(arguments))); },
  error: function () { if (typeof console !== 'undefined') console.error.apply(console, ['[openElement]'].concat([].slice.call(arguments))); },
  debug: function () {},
};`;

  // #1544/B2: the element runtime is NOT in the entry's static import
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
  const needsElementRuntime = clientEntryNeedsElementRuntime(islands, options);
  const runtimeLoader = needsElementRuntime
    ? `var __elementRuntimePromise = null;
var __loadElementRuntime = function () {
  if (!__elementRuntimePromise) {
    __elementRuntimePromise = import('${elementServicesSpecifier(
      canHydrateServerDom,
      includeBlocksRuntime,
    )}').then(function (__runtime) {
      __runtime.ensureDeepFragmentNavigation();
      __runtime.ensurePreHydrationClickCapture(document, __tags);${
        utilitySheetSpecifier === ''
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
};`
    : '';

  const schedulerImport = `import { createIslandScheduler as __schedule } from '${VIRTUAL_RUNTIME_SPECIFIERS.scheduler}';`;
  // ── Document services: one installer per emission shape ──────────────────
  //
  // The two document-level services (deep fragment navigation, pre-hydration
  // click capture) must be installed on EVERY client-JS page, and the installer
  // is chosen by whether the entry already fetches the element-runtime chunk:
  //
  //   - `needsElementRuntime` FALSE (every island is generated-lane, M11-3):
  //     no `__loadElementRuntime` exists, so nothing else would ever install
  //     them — that was the measured regression (`#start` never got
  //     `data-open-target`). This shape installs them STATICALLY from the
  //     executor-free `document-services` surface, at entry evaluation, because
  //     a direct load with a `#hash` must scroll into a DSD subtree before any
  //     island activates.
  //   - `needsElementRuntime` TRUE: the lazy `element-services` import below is
  //     the installer, and its `.then()` keeps both calls. It is deliberately
  //     NOT made static here: this shape's emitted bytes are pinned by the ABI
  //     hash in entry-client-codegen/generated-lane.test.ts, and more
  //     importantly `requireEntryStaticGraphFreeOfRuntime` fails the build when
  //     the entry statically reaches the shared runtime chunk — which a static
  //     import from the element package always does, since #1544 groups every
  //     module under that package root into `element-runtime-<hash>.js`. On
  //     this shape the chunk is fetched anyway, so the lazy install costs no
  //     extra bytes and stays the single owner.
  //
  // The condition is exactly the generator's own executor-lane fact, so the
  // two shapes cannot disagree about who installs the services.
  const staticDocumentServices = !needsElementRuntime;
  const documentServicesImport = staticDocumentServices
    ? `import { ensureDeepFragmentNavigation as __installDeepFragments, ensurePreHydrationClickCapture as __installPreHydrationCapture } from '${ELEMENT_DOCUMENT_SERVICES_RUNTIME_SPECIFIER}';\n`
    : '';
  const documentServicesInstall = staticDocumentServices
    ? `// Generated-lane page floor: install the document-level services here, once,
// at entry evaluation. Neither is reachable from the compiler-emitted shell, and
// this entry carries no element-runtime loader — without these two calls
// fragment navigation inside nested shadow roots and the pre-upgrade capture
// simply do not exist on the page. Both installers are idempotent per document
// (an \`installed\` / registry-entry check), so a later module repeating the call
// is a no-op rather than a second listener set.
__installDeepFragments();
__installPreHydrationCapture(document, __tags);
`
    : '';
  const enhanceImport =
    options.enhancedForms === true
      ? `import { createEnhanceClient } from '${VIRTUAL_RUNTIME_SPECIFIERS.enhance}';\n`
      : '';
  const importsBlock = `${schedulerImport}
${documentServicesImport}${enhanceImport}
${loggerBlock}

${runtimeLoader}`;

  return `${headerComment}

${styleImport}${
    utilitySheetSpecifier === ''
      ? ''
      : `import __oeUtilitySheet from ${quoteGeneratedJavaScriptValue(utilitySheetSpecifier)};
`
  }${importsBlock}

var __map = {
${islandMap}
};
var __tags = [${tags}];
${documentServicesInstall}${
    // The call below is safe only because `runtimeLoader` — the definition of
    // `__loadElementRuntime` — is emitted above in importsBlock. The 88bda88bf
    // regression class was a shared block calling a binding that one emission
    // shape did not define; generated-entry-gate.test.ts pins that shape check.
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
  // #604: a definition that lands after the morph repaired nothing at
  // insertion time (no constructor existed yet), so the same WebKit repair
  // runs again here — the moment the element can actually upgrade.
  onIslandLoaded: function () { __enhance.repairUpgrades(document); __enhance.scanSubmitRoots(document); },`
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
  observeVisible: __scheduler.observeVisible,
});
`
    : '// No data-open-enhance forms: the form enhancement layer is omitted (#569 complement),\n// keeping the client bundle free of morph and popstate code.'
}
`;
}
