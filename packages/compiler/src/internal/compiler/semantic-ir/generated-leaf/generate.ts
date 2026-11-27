/** Coordinate code generation for a validated function-component module. */

import {
  type CompiledElementSourceMap,
  type EmissionSegment,
  SourceMapSegmentBuilder,
} from '../../semantic-core/source-map.ts';
import { type IrDiagnostic } from '../types.ts';
import ts from 'typescript';
import {
  type FunctionModelModule,
  type FunctionModelImport,
} from '../../semantic-core/function-frontend.ts';
import {
  type ExpressionPlacement,
  type ModuleImportContext,
  importContexts,
  fragmentLineCount,
} from './emission.ts';
import { findMountCycle, moduleUsesContext, planRetention } from './instance-emission.ts';
import { moduleUsesSharedClaimCursor, collectStaticClassCandidates } from './structure.ts';
import { emitComponent } from './component-emission.ts';
import { CLAIM_ACTIVATION } from './claim-emission.ts';

export type { ExpressionPlacement } from './emission.ts';
export { collectStaticClassCandidates } from './structure.ts';

/** Compiler-private runtime entry the emitted module imports from. */
// M11-3: the generated leaf imports its primitives from the CLOSED leaf entry,
// never from the `internal/compiled/runtime` facade. The facade re-exports the
// generic executor's three endpoints and their kernels, so importing it put the
// whole executor in every generated island chunk (measured at M10-P1: one
// 64-module `element-runtime-<hash>.js` reachable from all eight www islands).
// The leaf entry re-exports the same symbols from their ORIGIN modules and
// nothing else; see its module doc for why each import site matters.
export const GENERATED_LEAF_RUNTIME_SPECIFIER =
  '@openelement/element/internal/compiled/leaf-runtime';

const RUNTIME_IMPORTS = [
  'assertSafeUrlAttribute',
  'attributeValueOf',
  'bindSignalWrites',
  'createRecipe',
  'displayValue',
  'insertRecipe',
  'removeNodes',
] as const;

/**
 * Runtime symbols a generated module imports only when it uses them. The
 * predicate reads the emitted body, so a new emission site cannot forget to
 * register its import (the symbol is named in the call it emits).
 */
const OPTIONAL_RUNTIME_IMPORTS: readonly {
  readonly symbol: string;
  readonly predicate: (body: string, usesClaimRecipe: boolean, usesDirectory: boolean) => boolean;
}[] = [
  { symbol: 'claimRecipe', predicate: (_body, usesClaimRecipe) => usesClaimRecipe },
  { symbol: 'leafClaimMismatch', predicate: (body) => body.includes('leafClaimMismatch(') },
  { symbol: 'leafRuntimeError', predicate: (body) => body.includes('leafRuntimeError(') },
  {
    symbol: 'selectOptionSelected',
    predicate: (body) => body.includes('selectOptionSelected('),
  },
  {
    symbol: 'selectOptionValue',
    predicate: (body) => body.includes('selectOptionValue('),
  },
  // alpha16 nested-expansion: the emitted producer routes every custom-element
  // tag through this ONE helper, which asks the render's host to expand it.
  { symbol: 'nestedHost', predicate: (body) => body.includes('nestedHost(') },
  // Keyed-list placement (each blocks): the emitted sync tail names this ONE
  // helper, whose LIS rule leaves the stable chain untouched and moves exactly
  // the displaced entries.
  { symbol: 'reconcileEachEntries', predicate: (body) => body.includes('reconcileEachEntries(') },
  // ADR-0183 D-4: a root-owned binding declared in the retained setup factory
  // (a `signal`/`computed` resource) and the SSR producer's per-render copy are
  // the only emitters of these calls.
  { symbol: 'signal', predicate: (body) => body.includes('= signal((') },
  { symbol: 'computed', predicate: (body) => body.includes('= computed(') },
  {
    symbol: 'assertElementInHtmlNamespace',
    predicate: (body) => body.includes('assertElementInHtmlNamespace('),
  },
  {
    symbol: 'assertElementInNamespace',
    predicate: (body) => body.includes('assertElementInNamespace('),
  },
  {
    symbol: 'assertStaticAttributeSeed',
    predicate: (body) => body.includes('assertStaticAttributeSeed('),
  },
  // alpha16 nested-expansion, claim half: a dash tag's seed is checked through
  // the host-aware assertion (runtime-only child attributes are not the parent's
  // seed), and a childless host's expanded light interior is consumed opaquely
  // instead of walked.
  {
    symbol: 'assertNestedHostStaticAttributeSeed',
    predicate: (body) => body.includes('assertNestedHostStaticAttributeSeed('),
  },
  {
    symbol: 'isExpandedLightRootHost',
    predicate: (body) => body.includes('isExpandedLightRootHost('),
  },
  { symbol: 'emitComment', predicate: (body) => body.includes('emitComment(') },
  { symbol: 'escapeAttrValue', predicate: (body) => body.includes('escapeAttrValue(') },
  { symbol: 'escapeText', predicate: (body) => body.includes('escapeText(') },
  { symbol: 'rangeMarker', predicate: (body) => body.includes('rangeMarker(') },
  { symbol: 'MARKERS', predicate: (body) => body.includes('MARKERS.') },
  { symbol: 'markerText', predicate: (body) => body.includes('markerText(') },
  {
    symbol: 'assertTextSlotMarker',
    predicate: (body) => body.includes('assertTextSlotMarker('),
  },
  {
    symbol: 'textSlotMarker',
    predicate: (body) => body.includes('textSlotMarker('),
  },
  {
    symbol: 'slotAnchorMarker',
    predicate: (body) => body.includes('slotAnchorMarker('),
  },
  {
    symbol: 'assertWhenAnchor',
    predicate: (body) => body.includes('assertWhenAnchor('),
  },
  {
    symbol: 'assertWhenEndMarker',
    predicate: (body) => body.includes('assertWhenEndMarker('),
  },
  {
    symbol: 'isWhenEndMarker',
    predicate: (body) => body.includes('isWhenEndMarker('),
  },
  {
    symbol: 'assertEachAnchor',
    predicate: (body) => body.includes('assertEachAnchor('),
  },
  {
    symbol: 'assertEachEndMarker',
    predicate: (body) => body.includes('assertEachEndMarker('),
  },
  {
    symbol: 'parseEntryKeyMarker',
    predicate: (body) => body.includes('parseEntryKeyMarker('),
  },
  {
    symbol: 'readEntryKeyMarker',
    predicate: (body) => body.includes('readEntryKeyMarker('),
  },
  {
    symbol: 'entrySeedMismatch',
    predicate: (body) => body.includes('entrySeedMismatch('),
  },
  {
    symbol: 'entryKeyMarker',
    predicate: (body) => body.includes('entryKeyMarker('),
  },
  {
    symbol: 'encodeListKey',
    predicate: (body) => body.includes('encodeListKey('),
  },
  {
    symbol: 'tryEncodeListKey',
    predicate: (body) => body.includes('tryEncodeListKey('),
  },
  {
    symbol: 'runUntracked',
    predicate: (body) => body.includes('runUntracked('),
  },
  // `16b-EB`: the update-phase isolation contract. Registered by the same body
  // predicate, so a module without an `onError` handler never imports it.
  {
    symbol: 'guardUpdate',
    predicate: (body) => body.includes('guardUpdate('),
  },
  {
    symbol: 'claimStaticSiblingRange',
    predicate: (_body, _usesClaimRecipe, usesDirectory) => usesDirectory,
  },
  {
    symbol: 'openStaticSiblingDirectory',
    predicate: (_body, _usesClaimRecipe, usesDirectory) => usesDirectory,
  },
  // 16b-LC retained-child depth-1 nested retention: the root pass bracket, the ref-site
  // retain/release and the R1–R6 structural release text name these runtime
  // functions, so the same body predicate registers their imports.
  {
    symbol: 'retainChildInstance',
    predicate: (body) => body.includes('retainChildInstance('),
  },
  {
    symbol: 'releaseChildInstance',
    predicate: (body) => body.includes('releaseChildInstance('),
  },
  {
    symbol: 'releaseUnderStructuralScope',
    predicate: (body) => body.includes('releaseUnderStructuralScope('),
  },
  {
    symbol: 'beginInstancePass',
    predicate: (body) => body.includes('beginInstancePass('),
  },
  {
    symbol: 'endInstancePass',
    predicate: (body) => body.includes('endInstancePass('),
  },
  {
    // 16b-LC depth >= 2: a retained body that retains its own children joins the
    // root attempt's transaction token and never commits.
    symbol: 'joinInstancePass',
    predicate: (body) => body.includes('joinInstancePass('),
  },
  // `16b-CTX` SERVER side: the per-render owner scope a producer creates when it
  // is the module root of the render. Registered by the body predicate like the
  // other optional symbols, so a module that never renders a context consumer
  // does not import it (and keeps its graph and bytes).
  {
    symbol: 'createRenderContextScope',
    predicate: (body) => body.includes('createRenderContextScope('),
  },
];

export interface GeneratedLeafModule {
  /** Emitted ESM module; `null` when any diagnostic was emitted (fail closed). */
  readonly module: string | null;
  /**
   * End-to-end Source Map v3 for the emitted module (M05b). `null` unless the
   * caller supplies the authored source text (required for `sourcesContent`).
   */
  readonly sourceMap: CompiledElementSourceMap | null;
  /** Placement ledger for every lowered expression in the emitted module. */
  readonly placements: readonly ExpressionPlacement[];
  /**
   * T3 / 16b-LC-1: the module-local ROOT setup factory name the generator
   * actually emitted (`__oe_rootInstance`), or null when no factory exists.
   * It is produced by the SAME root-setup decision that writes the declaration,
   * so the generated-element emitter appends the descriptor's `createInstance`
   * row from this fact instead of scanning the emitted text (no second
   * authority, no regex re-derivation). Return-only build metadata: it never
   * changes the module bytes, and a hostless leaf always reports null.
   */
  readonly rootInstanceFactory: string | null;
  /** Host runtime support required by the emitted recipes and their setup. */
  readonly hostFeatures: {
    readonly context: boolean;
    readonly ledger: boolean;
    readonly rootClaim: boolean;
  } | null;
  /** Host `bindings` names the module reads (signals/computeds/functions). */
  readonly requiredBindings: readonly string[];
  /** Host `props` names the module reads. */
  readonly requiredProps: readonly string[];
  /** True when the module subscribes to `host.propsChanged` (tracked props). */
  readonly requiresPropsChanged: boolean;
  readonly diagnostics: readonly IrDiagnostic[];
  /**
   * The module's admitted STATIC class tokens (deletion prerequisite P-1): the
   * component stylesheet's candidate set. Empty when every class channel is
   * dynamic or the module declares none, which is the pre-P-1 answer for the
   * generated lane and stays byte-neutral.
   */
  readonly classCandidates: readonly string[];
}

/** Fail-closed parse check of the emitted module text (no execution). */
function parsesAsModule(text: string): boolean {
  const source = ts.createSourceFile(
    'generated-leaf.js',
    text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const parseDiagnostics = (source as unknown as { parseDiagnostics?: readonly unknown[] })
    .parseDiagnostics;
  return (parseDiagnostics ?? []).length === 0;
}

/**
 * Emit the generated leaf module for one M03 `FunctionModelModule`.
 * Deterministic for the same model/registry; unsupported shapes fail closed.
 */
/** The import table of one module, with the used entries recorded during emit. */
function createImportContext(module: FunctionModelModule): ModuleImportContext {
  const byLocal = new Map<string, FunctionModelImport>();
  for (const entry of module.imports ?? []) {
    // A duplicate local spelling is a TypeScript error in the authored module;
    // the first declaration wins here so the emitted text always parses.
    if (!byLocal.has(entry.local)) byLocal.set(entry.local, entry);
  }
  return { byLocal, used: new Map() };
}

/** One re-emitted static import, verbatim in form and specifier. */
function emitAuthoredImport(entry: FunctionModelImport): string {
  const from = JSON.stringify(entry.specifier);
  switch (entry.form) {
    case 'default':
      return `import ${entry.local} from ${from};`;
    case 'namespace':
      return `import * as ${entry.local} from ${from};`;
    default:
      return entry.imported === entry.local
        ? `import { ${entry.local} } from ${from};`
        : `import { ${entry.imported} as ${entry.local} } from ${from};`;
  }
}

export function generateLeafModule(
  module: FunctionModelModule,
  options: {
    readonly authoredSource?: string;
    /**
     * T3 / 16b-LC-1 compiler-private root marker: the name of the component
     * whose local setup snapshots become a retained `__oe_rootInstance(owner,
     * host)` factory instead of per-mount/claim evaluation. It is the ROOT
     * component name the generated-element emitter already resolved; it is
     * never author syntax, never a host site fact and never a package export.
     * Omitted (hostless leaf, direct leaf tests) keeps today's bytes exactly,
     * and a root with no setup snapshot also emits no factory.
     */
    readonly rootInstance?: string;
    /**
     * M09-2e / #1803 compiler-private claim-prefix marker, widened by F16: `true`
     * when this module has a DSD template root (every shadow descriptor), so its
     * claimed content can be prefixed with canonical marked stylesheet links —
     * its own declared sheets, and a nested LIGHT child's sheets the runtime
     * lifted into this template. The ROOT claim (either form: the general cursor
     * walk or the M07b directory consumer) then skips exactly that leading
     * marked <link> run — borrowed server DOM, never deleted, re-written or
     * duplicated. A LIGHT root has no template and keeps the pre-slice claim
     * bytes.
     */
    readonly claimStyleLinkPrefix?: boolean;
    /**
     * Compiler-private LIGHT-root marker: `true` when the generated element this
     * module becomes has a LIGHT descriptor root (or an absent root, which the
     * shell defaults to light). The light-root root component then emits a
     * `oe:s:` / `oe:/s:` anchor pair inside each `<slot>` element so the
     * serializer can substitute caller children into exactly that slot without
     * pattern-matching markup.
     *
     * Omitted (hostless leaf modules, shadow roots, every pre-slice caller)
     * emits today's bytes exactly: no anchor, no runtime import.
     */
    readonly lightRoot?: boolean;
  } = {},
): GeneratedLeafModule {
  const records = new Map(module.expressions.expressions.map((record) => [record.id, record]));
  if (module.components.length === 0) {
    return {
      module: null,
      sourceMap: null,
      placements: [],
      rootInstanceFactory: null,
      hostFeatures: null,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      classCandidates: [],
      diagnostics: [
        {
          severity: 'error',
          code: 'OEIR_LEAF_MISSING_COMPONENT',
          message: 'the module has no function component to generate',
          span: { file: module.file, start: 0, end: 0, line: 1, column: 1 },
          origin: 'module',
        },
      ],
    };
  }
  const componentByName = new Map(
    module.components.map((component) => [component.name, component] as const),
  );
  // The module's static imports are admitted as DIRECT references: every
  // component shares one context, and the used entries are re-emitted in the
  // module header. A model without an import table keeps today's bytes.
  const importContext = createImportContext(module);
  for (const component of module.components) importContexts.set(component, importContext);
  const cycle = findMountCycle(module);
  if (cycle !== null) {
    return {
      module: null,
      sourceMap: null,
      placements: [],
      rootInstanceFactory: null,
      hostFeatures: null,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      classCandidates: [],
      diagnostics: [cycle],
    };
  }
  const chunks: string[] = [];
  const diagnostics: IrDiagnostic[] = [];
  const requiredBindings = new Set<string>();
  const requiredProps = new Set<string>();
  const segments: EmissionSegment[] = [];
  const placements: ExpressionPlacement[] = [];
  let requiresPropsChanged = false;
  let usesStaticSiblingDirectoryConsumer = false;
  let usesClaimRecipe = false;
  let usesLeafClaimMismatch = false;
  let rootClaim = false;
  // T3 / 16b-LC-1: the root setup factory emitted by the component chunk (at
  // most one component is the root), reported from the SAME decision that
  // wrote the declaration. Null on every failure path and without the option.
  let rootInstanceFactory: string | null = null;
  const sharedClaimCursor = moduleUsesSharedClaimCursor(module, componentByName);
  // 16b-LC retained-child: one module-level retention plan decides every body mode and
  // every retained site before emission (monotone fixpoint over the emitted
  // references + the two whole-module guards). Null means "emit today's bytes".
  const retention = planRetention(module, componentByName, records, options.rootInstance);
  for (const component of module.components) {
    const emitted = emitComponent(
      module.file,
      component,
      records,
      componentByName,
      sharedClaimCursor,
      options.rootInstance,
      retention,
      options.claimStyleLinkPrefix === true,
      // Only the ROOT component of a light-root generated element emits slot
      // anchors: a nested/child component in the same module is a separate host
      // whose root kind is its own descriptor's, and the leaf generator has no
      // fact for it. Restricting the gate to `options.rootInstance` keeps the
      // anchor exactly where the serializer can consume it and leaves every
      // other component's bytes untouched.
      options.lightRoot === true && component.name === options.rootInstance,
    );
    diagnostics.push(...emitted.diagnostics);
    if (emitted.diagnostics.length > 0) continue;
    rootInstanceFactory ??= emitted.rootInstanceFactory;
    if (component.name === options.rootInstance) rootClaim = emitted.hasClaim === true;
    for (const name of emitted.requiredBindings) requiredBindings.add(name);
    for (const name of emitted.requiredProps) requiredProps.add(name);
    requiresPropsChanged ||= emitted.requiresPropsChanged;
    usesStaticSiblingDirectoryConsumer ||= emitted.usesStaticSiblingDirectoryConsumer === true;
    usesClaimRecipe ||= emitted.usesClaimRecipe === true;
    usesLeafClaimMismatch ||= emitted.usesLeafClaimMismatch === true;
    // Component chunks are concatenated in module order: rebase this component's
    // segment/placement lines onto the lines already emitted before it.
    const lineOffset = fragmentLineCount(chunks);
    segments.push(
      ...emitted.segments.map((segment) => ({
        ...segment,
        generatedLine: segment.generatedLine + lineOffset,
      })),
    );
    placements.push(
      ...emitted.placements.map((placement) => ({
        ...placement,
        generatedLine: placement.generatedLine + lineOffset,
      })),
    );
    chunks.push(...emitted.lines);
  }
  if (diagnostics.length > 0) {
    return {
      module: null,
      sourceMap: null,
      placements: [...placements],
      // No module exists, so no declaration exists: keep the invariant
      // "non-null exactly when the factory was emitted".
      rootInstanceFactory: null,
      hostFeatures: null,
      // A refused module contributes no candidates (nothing shipped to style).
      classCandidates: [],
      requiredBindings: [...requiredBindings].sort(),
      requiredProps: [...requiredProps].sort(),
      requiresPropsChanged,
      diagnostics,
    };
  }
  const body = chunks.join('\n');
  const runtimeImports: string[] = [...RUNTIME_IMPORTS];
  for (const optional of OPTIONAL_RUNTIME_IMPORTS) {
    if (optional.predicate(body, usesClaimRecipe, usesStaticSiblingDirectoryConsumer)) {
      runtimeImports.push(optional.symbol);
    }
  }
  if (runtimeImports.length !== RUNTIME_IMPORTS.length) runtimeImports.sort();
  const authoredImports = [...importContext.used.values()]
    .sort((left, right) =>
      left.specifier === right.specifier
        ? left.imported < right.imported
          ? -1
          : left.imported > right.imported
            ? 1
            : 0
        : left.specifier < right.specifier
          ? -1
          : 1,
    )
    .map(emitAuthoredImport);
  const headerLines = [
    '// <generated by openelement M07a leaf-claim (mount M06b2a); do not edit>',
    `import { ${runtimeImports.join(', ')} } from ${JSON.stringify(GENERATED_LEAF_RUNTIME_SPECIFIER)};`,
    ...authoredImports,
    '',
  ];
  if (sharedClaimCursor) {
    headerLines.push('let __oe_claimCursor = null;', `let ${CLAIM_ACTIVATION} = null;`, '');
  }
  const text = [...headerLines, ...chunks].join('\n');
  if (!parsesAsModule(text)) {
    return {
      module: null,
      sourceMap: null,
      placements: [...placements],
      rootInstanceFactory: null,
      hostFeatures: null,
      classCandidates: [],
      requiredBindings: [...requiredBindings].sort(),
      requiredProps: [...requiredProps].sort(),
      requiresPropsChanged,
      diagnostics: [
        {
          severity: 'error',
          code: 'OEIR_LEAF_INVALID_ARTIFACT',
          message: 'the emitted module does not parse as JavaScript',
          span: { file: module.file, start: 0, end: 0, line: 1, column: 1 },
          origin: 'module',
        },
      ],
    };
  }
  const headerShift = headerLines.length;
  const moduleSegments = segments.map((segment) => ({
    ...segment,
    generatedLine: segment.generatedLine + headerShift,
  }));
  const modulePlacements = placements.map((placement) => ({
    ...placement,
    generatedLine: placement.generatedLine + headerShift,
  }));
  let sourceMap: CompiledElementSourceMap | null = null;
  if (options.authoredSource !== undefined) {
    const builder = new SourceMapSegmentBuilder();
    for (const segment of moduleSegments) builder.add(segment);
    sourceMap = builder.build(module.file, options.authoredSource);
  }
  return {
    module: text,
    sourceMap,
    placements: modulePlacements,
    rootInstanceFactory,
    hostFeatures: {
      context: moduleUsesContext({ componentByName }),
      ledger: runtimeImports.includes('beginInstancePass'),
      rootClaim,
    },
    requiredBindings: [...requiredBindings].sort(),
    requiredProps: [...requiredProps].sort(),
    requiresPropsChanged,
    classCandidates: collectStaticClassCandidates(module),
    diagnostics: [],
  };
}
