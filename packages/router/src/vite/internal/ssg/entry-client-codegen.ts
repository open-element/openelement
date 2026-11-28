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
import { VITE_PRELOAD_HELPER_ID } from '../vite-helper-chunk.ts';
import { ISLAND_ACTIVATION_PREFIX } from './document-island-catalogue.ts';
import type { ClientIslandDeliveryEntry, ClientIslandDeliveryInput } from './delivery.ts';

// Machine-independent identity for the generated error copy: the workspace
// anchor keeps absolute build paths out of the shipped client bundle.
const WORKSPACE_ROOT = findBuildWorkspaceRootOrUndefined(process.cwd());

/** Select only the declared constructor so unused module exports can be dropped. */
function islandDefinition(
  modulePath: AdmittedIslandModuleSpecifier,
  tagName: string,
  exportName: string | undefined,
  attachDevLiveStyles: boolean,
): string {
  const tag = quoteGeneratedJavaScriptValue(tagName);
  const constructor = exportName
    ? `mod[${quoteGeneratedJavaScriptValue(exportName)}]`
    : 'mod.default';
  const error = quoteGeneratedJavaScriptValue(
    `[openElement] Capability module ${stableModuleId(
      modulePath,
      undefined,
      WORKSPACE_ROOT,
    )} did not export a constructor for ${tagName}`,
  );
  const devStyles = attachDevLiveStyles ? ` __oeAttachDevLiveStyles(Ctor, ${tag});` : '';
  // A native module may have registered its own element while evaluating.
  return `if (!customElements.get(${tag})) { var Ctor = ${constructor}; if (typeof Ctor !== 'function') throw new Error(${error});${devStyles} customElements.define(${tag}, Ctor); }`;
}

function islandImportFactory(
  entry: AdmittedClientIslandEntry,
  attachDevLiveStyles: boolean,
): string {
  return `function () {
    return import(${quoteGeneratedJavaScriptValue(entry.modulePath)}).then(function (mod) {
      ${islandDefinition(entry.modulePath, entry.tagName, entry.exportName, attachDevLiveStyles)}
    });
  }`;
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

/** Describe both declarations when the same tag has conflicting delivery facts. */
function describeClientIslandDeclaration(entry: AdmittedClientIslandEntry): string {
  const source = entry.isPackage ? 'package' : 'local';
  return (
    `${source} declaration ` +
    `(module ${entry.modulePath}, strategy ${entry.strategy}, ` +
    `media ${entry.media ?? 'none'}, export ${entry.exportName ?? 'default'})`
  );
}

/** Expand one capability declaration into its one-to-many element names. */
function expandClientIslandEntries(
  entries: readonly ClientIslandDeliveryInput[],
): AdmittedClientIslandEntry[] {
  const expanded: AdmittedClientIslandEntry[] = [];
  const seen = new Map<string, AdmittedClientIslandEntry>();

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
      const item: AdmittedClientIslandEntry = {
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
  entries: AdmittedClientIslandEntry[];
  modulePath: AdmittedIslandModuleSpecifier;
}

function activationGroupKey(entry: AdmittedClientIslandEntry): string {
  return `${entry.modulePath}\u0000${entry.strategy}\u0000${entry.media ?? ''}`;
}

function sharedActivationFactory(
  group: ActivationGroup,
  index: number,
  devLiveTags: ReadonlySet<string>,
): string {
  const promise = `__activation${index}Promise`;
  // The map can reference a grouped factory before its declaration.
  const registration = group.entries.map((entry) =>
    islandDefinition(
      group.modulePath,
      entry.tagName,
      entry.exportName,
      devLiveTags.has(entry.tagName),
    ),
  );
  return [
    `var ${promise};`,
    `function __activation${index}() {`,
    `  if (!${promise}) ${promise} = import(${quoteGeneratedJavaScriptValue(group.modulePath)}).then(function(mod) {`,
    ...registration.map((define) => `    ${define}`),
    '  });',
    `  return ${promise};`,
    '}',
  ].join('\n');
}

export const DOCUMENT_ISLANDS_RUNTIME_SPECIFIER = 'virtual:open-client-runtime/document-islands.ts';

export const REGISTER_ISLAND_RUNTIME_SPECIFIER = 'virtual:open-client-register-island';

export const registerIslandRuntime = `export function register(tag, getConstructor) {
  if (customElements.get(tag)) return;
  const Ctor = getConstructor();
  if (typeof Ctor !== 'function') {
    throw new Error('[openElement] Capability module did not export a constructor for ' + tag);
  }
  customElements.define(tag, Ctor);
}`;

/** Preserve each Vite-generated static import edge and its preload behavior. */
export function createIslandActivationModules(islands: readonly ClientIslandDeliveryInput[]) {
  const generated = new Set(
    islands
      .filter((island) => 'generatedLane' in island && island.generatedLane)
      .map((island) => island.modulePath),
  );
  const groups = new Map<string, AdmittedClientIslandEntry[]>();
  for (const entry of expandClientIslandEntries(islands)) {
    if (entry.strategy === 'none') continue;
    const key = activationGroupKey(entry);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  const counts = new Map<string, number>();
  for (const [first] of groups.values()) {
    counts.set(first!.modulePath, (counts.get(first!.modulePath) ?? 0) + 1);
  }
  return new Map(
    [...groups.values()].map((entries) => {
      const first = entries[0]!;
      const single = entries.length === 1;
      const register = entries.map((entry) => {
        const exported = quoteGeneratedJavaScriptValue(entry.exportName ?? 'default');
        const tag = single ? 'tag' : quoteGeneratedJavaScriptValue(entry.tagName);
        return `register(${tag}, () => mod[${exported}])`;
      });
      const direct = generated.has(first.modulePath) && counts.get(first.modulePath) === 1;
      const registerImport = `import { register } from '${REGISTER_ISLAND_RUNTIME_SPECIFIER}';`;
      const path = quoteGeneratedJavaScriptValue(first.modulePath);
      const callback = register.length === 1 ? register[0] : `{ ${register.join('; ')} }`;
      return [
        ISLAND_ACTIVATION_PREFIX + first.tagName,
        {
          modulePath: first.modulePath,
          strategy: first.strategy,
          tags: entries.map((entry) => entry.tagName),
          media: first.media,
          direct,
          code: direct
            ? `${registerImport}
import * as mod from ${path};
export default (${single ? 'tag' : ''}) => ${callback};`
            : `${registerImport}
export default (${single ? 'tag' : ''}) => import(${path}).then((mod) => ${callback});`,
        },
      ] as const;
    }),
  );
}

/** Virtual id and single resolver rule for the eagerly installed document services. */
export const ELEMENT_DOCUMENT_SERVICES_RUNTIME_SPECIFIER =
  'virtual:open-client-runtime/element-document-services.ts';

export function resolveElementDocumentServicesModule(id: string): string | null {
  return id === ELEMENT_DOCUMENT_SERVICES_RUNTIME_SPECIFIER
    ? runtimeModulePath('./ssg/element-document-services.ts')
    : null;
}

/**
 * One generated island's dev live sheets (F16), as the dev client entry
 * receives them: the island's delivery tag and the style-asset graph ids of its
 * declared edges. Dev is the only caller — a build's sheets are emitted,
 * content-addressed assets delivered by a declarative `<link>`, never a live
 * object an edit re-fills.
 */
export interface DevLiveStyleSheetGroup {
  /** The island's delivery tag — the `customElements.define` name it annotates. */
  readonly tagName: string;
  /**
   * The style-edge graph ids, in authored order. The dev style plugin answers
   * each with its live adapter module (a realm-held `CSSStyleSheet` that an HMR
   * re-evaluation `replace()`s in place).
   */
  readonly graphIds: readonly string[];
}

interface GenerateClientEntryOptions {
  /**
   * The app declares enhanced forms (#569). Include the capability even
   * without islands. Each document discovers forms before fetching the runtime.
   */
  enhancedForms?: boolean;
  /** Build/dev callers supply the whole merged client-entry island inventory. */
  specializeScheduler?: boolean;
  /** Production entries take activation descriptors from the current document. */
  responseCatalogue?: boolean;
  /**
   * The document stylesheet module the entry statically imports (the Tailwind
   * entry, alpha15 S lane): its presence puts the CSS into this build's graph
   * so the official pipeline compiles it and Vite emits the content-hashed
   * `.css` asset. The import has no runtime effect — Vite extracts it — so it
   * is emitted even when the entry carries no islands.
   */
  styleEntry?: string;
  /**
   * Dev-only live style sheets (F16). When present, the entry imports each
   * edge's live adapter module and attaches the sheet objects to the island
   * constructor under `__oeDevLiveStyles` immediately before
   * `customElements.define` — the generated shell reads that field off the
   * CONSTRUCTOR (the descriptor is module-local and unreachable from the dev
   * entry) and adopts the objects into a DSD root, so a CSS-only edit can
   * re-fill the sheet the root holds.
   *
   * Production delivers content-addressed build sheets with declarative
   * links and omits this option.
   */
  devLiveStyleSheets?: readonly DevLiveStyleSheetGroup[];
}

/** Whether the application has any client island or form enhancement. */
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

  if (options.responseCatalogue && admittedIslands.length > 0) {
    const imports = [
      `import { startDocumentIslands } from '${DOCUMENT_ISLANDS_RUNTIME_SPECIFIER}';`,
      `import { __vitePreload as preload } from ${quoteGeneratedJavaScriptValue(VITE_PRELOAD_HELPER_ID)};`,
    ];
    if (options.enhancedForms) {
      imports.push(
        `import { observeFormEnhancement } from '${VIRTUAL_RUNTIME_SPECIFIERS.enhance}';`,
      );
    }
    const handlers = [
      ...new Set(
        admittedIslands
          .map((island) => island.strategy)
          .filter((strategy) => strategy === 'visible' || strategy === 'media'),
      ),
    ];
    if (handlers.length > 0) {
      const bindings = handlers.map((strategy) =>
        strategy === 'visible' ? 'installVisibleStrategy' : 'installMediaStrategy',
      );
      imports.push(
        `import { ${bindings.join(', ')} } from '${VIRTUAL_RUNTIME_SPECIFIERS.scheduler}';`,
      );
    }
    const strategies = handlers.map(
      (strategy) => `${strategy}: install${strategy === 'visible' ? 'Visible' : 'Media'}Strategy`,
    );
    return `${styleImport}${imports.join('\n')}\nstartDocumentIslands({
      bootstrapUrl: import.meta.url,
      preload,
      idleFallbackTimeoutMs: ${IDLE_FALLBACK_TIMEOUT_MS},
      strategies: { ${strategies.join(', ')} },
      ${options.enhancedForms ? `actionHeader: ${quoteGeneratedJavaScriptValue(ACTION_FETCH_HEADER)}, observeFormEnhancement,` : ''}
    });`;
  }

  // ── F16 dev live-sheet channel ────────────────────────────────────────────
  // Dev-only AND caller-gated. When the caller supplies no groups (every build
  // emission), every string below is empty and the entry is byte-identical.
  // Groups for tags this page does not admit are dropped BEFORE any import is
  // emitted: an unusable sheet must not cost a module request.
  const devLiveGroups = (options.devLiveStyleSheets ?? []).filter(
    (group) =>
      group.graphIds.length > 0 &&
      admittedIslands.some((island) => island.tagName === group.tagName),
  );
  const devLiveTags = new Set(devLiveGroups.map((group) => group.tagName));
  const devLiveGraphIds = [...new Set(devLiveGroups.flatMap((group) => group.graphIds))];
  const devLiveImportNames = new Map(
    devLiveGraphIds.map((graphId, index) => [graphId, `__oeDevSheet${index}`]),
  );
  const devLiveImports =
    devLiveGraphIds.length === 0
      ? ''
      : devLiveGraphIds
          .map(
            (graphId) =>
              `import ${devLiveImportNames.get(graphId)} from ${quoteGeneratedJavaScriptValue(
                graphId,
              )};\n`,
          )
          .join('');
  // The attachment runs from inside each island factory, immediately before
  // `customElements.define` upgrades a host. `__oeDevLiveStyles` is keyed by
  // tag so one import can serve several tags of one module, and the helper is
  // the ONLY writer of the constructor field the generated shell reads
  // (shell.ts `adoptClientStyles`).
  const devLiveMapAndHelper =
    devLiveGraphIds.length === 0
      ? ''
      : `// F16 dev live-sheet channel: the sheet objects behind these imports are the
// copies a CSS-only edit re-fills in place. Attached to the constructor before
// the tag is defined, so the shell's connect adopts them into the root — even
// an adopted DSD root whose template already declares the same edge as a link.
var __oeDevLiveStyles = {
${devLiveGroups
  .map(
    (group) =>
      `  ${quoteGeneratedJavaScriptValue(group.tagName)}: [${group.graphIds
        .map((graphId) => devLiveImportNames.get(graphId))
        .join(', ')}]`,
  )
  .join(',\n')}
};
var __oeAttachDevLiveStyles = function (Ctor, tag) {
  var __oeStyles = __oeDevLiveStyles[tag];
  if (__oeStyles !== undefined) Ctor.__oeDevLiveStyles = __oeStyles;
};
`;

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
      activationLines.push(sharedActivationFactory(group, index, devLiveTags));
      groupFactories.set(group, `__activation${index}`);
    }
  });
  const islandMap = admittedIslands
    .map((entry) => {
      const group = groupsByKey.get(activationGroupKey(entry));
      const factory = group && groupFactories.get(group);
      return `  ${quoteGeneratedJavaScriptValue(entry.tagName)}: ${
        factory || islandImportFactory(entry, devLiveTags.has(entry.tagName))
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

  // The scheduler and form enhancer share one warning sink. Keeping it
  // inline avoids introducing an import from the island runtime.
  const loggerBlock = `var log = {
  warn: function () { if (typeof console !== 'undefined') console.warn.apply(console, ['[openElement]'].concat([].slice.call(arguments))); },
};`;

  // Only the whole entry's admitted buckets can prove a handler absent.
  // A per-page manifest would miss dynamic or morph-delivered hosts.
  const optionalStrategies = [
    ...(visibleTags ? [['visible', 'installVisibleStrategy']] : []),
    ...(mediaTags ? [['media', 'installMediaStrategy']] : []),
  ];
  const specializeScheduler = options.specializeScheduler === true && optionalStrategies.length < 2;
  const schedulerBindings = specializeScheduler
    ? [
        'createIslandSchedulerWithStrategies as __schedule',
        ...optionalStrategies.map(([, name]) => name),
      ]
    : ['createIslandScheduler as __schedule'];
  const schedulerOptions = specializeScheduler
    ? `, {${optionalStrategies.map(([kind, name]) => ` ${kind}: ${name}`).join(',')}}`
    : '';
  const schedulerImport = `import { ${schedulerBindings.join(', ')} } from '${VIRTUAL_RUNTIME_SPECIFIERS.scheduler}';`;
  // Install the narrow document services before the scheduler starts. Capture
  // sees events before an island upgrades, and DSD fragments resolve even on
  // a document with only server markup or form enhancement.
  const documentServicesImport = `import { ensureDeepFragmentNavigation as __installDeepFragments, ensurePreHydrationClickCapture as __installPreHydrationCapture } from '${ELEMENT_DOCUMENT_SERVICES_RUNTIME_SPECIFIER}';\n`;
  const enhanceImport =
    options.enhancedForms === true
      ? `import { observeFormEnhancement } from '${VIRTUAL_RUNTIME_SPECIFIERS.enhance}';\n`
      : '';
  const importsBlock = `${schedulerImport}
${documentServicesImport}${enhanceImport}
${loggerBlock}`;

  return `${headerComment}

${styleImport}${devLiveImports}${importsBlock}

var __map = {
${islandMap}
};
var __tags = [${tags}];
${devLiveMapAndHelper}__installDeepFragments();
__installPreHydrationCapture(document, __tags);
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
    ? '  onIslandLoaded: function () { __scanEnhancement(); },'
    : '  // #597: no enhance layer — no submit-root rescan after island loads.\n  onIslandLoaded: null,'
}
}${schedulerOptions});

${
  options.enhancedForms === true
    ? `// Load enhancement when a marked form exists in this document.
var __scanEnhancement = observeFormEnhancement({
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
