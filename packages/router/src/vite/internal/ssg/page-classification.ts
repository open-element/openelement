/**
 * M11-1 — build-time page-kind classification (the retirement of M01 C07).
 *
 * The router used to answer "is this route's default export a compiled page
 * class or a server function page?" by reading a runtime property on the
 * module's value (`component.__partProgram !== undefined`) inside `definePage`.
 * That is a build-time classification question answered with a runtime
 * module-shape read: it costs a module-shape convention in the ABI (C07's
 * rejected shape), and the reader runs on every route module evaluation —
 * server, SSG and dev.
 *
 * This module is the build time's OWN answer. The route scan already owns the
 * compiler semantic-core facts for each route module (`definePage`,
 * `pageComponentName`/the server-component admission, the compiled-element
 * decorator); this module folds those facts into ONE discriminated
 * `PageKind` and lets the route/page generation consume it:
 *
 * - `class-page` — the compiled page class form. Either the route module
 *   carries the compiled-element decorator itself, or its `definePage(…)`
 *   first argument is an imported page component (the canonical form: the
 *   route module imports the compiled class), or the route is a plain element
 *   route / `.mdx` route (the router generates a compiled class module for
 *   MDX).
 * - `function-page` — the alpha15 server function page form: the route
 *   module's own exported server component function, admitted by the server
 *   component lane (`RouteEntry.functionPage`).
 * - `generated-element-page` — the M09 generated Native Custom Element lane
 *   owns the page component (a local island whose scan identity says the
 *   compiler emitted a generated-element class, not a compiled program class).
 *   The shape is CLASSIFIED but its render path is not part of this slice:
 *   route/page generation fails closed with a coded build refusal instead of
 *   letting the page silently register a class with no Part Program.
 *
 * The fact is additive, never a behavior narrowing. When no owning lane is
 * recorded — an inline/non-identifier `definePage` argument, a name the
 * module scan cannot resolve, a module-local function the server lane
 * declined, a package/alias page component, a plain element route — the
 * classifier returns the LEGACY class-page answer the pre-M11 build already
 * produced. The `GeneratedElement`-owned page kind is classified and refused
 * (it has no wired render path); the only fail-closed ambiguity is a page
 * module that MORE THAN ONE owning lane claims (e.g. a compiled-element
 * decorator module that also declares a local server function page), where
 * the recorded facts genuinely contradict and no legacy answer is faithful.
 *
 * Layer contract:
 * - This module is BUILD ONLY. It reads module facts the scan already
 *   produced (plus one TS parse of the route module to read the `definePage`
 *   argument shape the semantic core does not expose) and returns data; it
 *   never executes the module and never reads a runtime property.
 * - The public protocol types (`RouteEntry`, `PageRouteDecl`) are unchanged:
 *   the fact rides them as build-only metadata through the typed accessors in
 *   this file, exactly like the M11 generated-host identity carrier.
 * - No generated entry byte changes for a class-page-only project: the fact
 *   is consumed by codegen decisions that already existed (function-page
 *   seams) and by the SSG routeInfo field emitted only when a non-class page
 *   exists.
 *
 * The two coded rejections below are router-internal BUILD failures. They are
 * deliberately NOT entries in the public error catalog (`PageErrorCode` /
 * `RouteScanErrorCode`): M11-1 adds no public error surface, and the
 * errors page is generated from the catalog. They are stable strings so a
 * test and a host can still branch on them.
 */

import ts from 'typescript';
import { dirname, join, normalize } from 'pathe';
import type { IslandDecl } from '@openelement/protocol/ssg';
import type { RouteEntry } from '../../framework.ts';
import {
  ownsGeneratedLaneKind,
  readGeneratedElementHost,
} from './generated-element-host-metadata.ts';
import type { PageRouteDecl } from '@openelement/protocol/ssg';
import { buildError } from '../../../internal/error-codes.ts';
import type { GeneratedElementHostIdentity } from './generated-element-host-metadata.ts';

/** The three page shapes the build distinguishes for route/page generation. */
export type PageKind = 'class-page' | 'function-page' | 'generated-element-page';

/**
 * Router-internal coded build rejections (see the module doc: no public
 * catalog entry is added by this slice).
 */
export const PageClassificationCode = {
  /**
   * The page module is claimed by more than one owning lane, or its
   * `definePage` argument shape contradicts the recorded page fact.
   */
  AMBIGUOUS_PAGE_MODULE: 'OE_ROUTE_SCAN_AMBIGUOUS_PAGE_MODULE',
  /**
   * A page whose component is owned by the generated Native Custom Element
   * lane. The shape is classified (never silently treated as a class page),
   * but the generated-element page render path is not wired in this slice.
   */
  GENERATED_ELEMENT_PAGE_UNSUPPORTED: 'OE_ROUTE_SCAN_GENERATED_ELEMENT_PAGE_UNSUPPORTED',
} as const;

/**
 * The `definePage(…)` first-argument shape the scan records for a page
 * module. The semantic core reports the admitted server function page
 * (`pageComponentName`) but not the argument's binding shape, so the build
 * classification parses the default export once to name what it saw.
 */
export type PageArgument =
  /** A declaration in the same module (the function-page form's raw shape). */
  | { readonly kind: 'local'; readonly name: string; readonly binding: 'class' | 'function' }
  /** An import: the specifier is needed to resolve a generated-element island. */
  | { readonly kind: 'import'; readonly name: string; readonly specifier: string }
  /** An inline expression (arrow/function/call/…) — never admitted by the server lane. */
  | { readonly kind: 'inline'; readonly expression: string }
  /** A name that resolves to no declaration or import in this module. */
  | { readonly kind: 'unresolved'; readonly name: string };

/**
 * The build-only page facts the route scan records for one page module.
 * Recorded only for page routes; absent on API/special routes.
 */
export interface PageModuleFacts {
  /** True when the module default-exports the host's page-definition binding (or is `.mdx`). */
  readonly definePage: boolean;
  /** True for a `.mdx` route: the router generates its compiled class module. */
  readonly mdx: boolean;
  /** True when the route module itself carries the canonically bound `@element` decorator. */
  readonly compiledElement: boolean;
  /** The server function page fact (`RouteEntry.functionPage`), when recorded. */
  readonly functionPage: string | undefined;
  /** The `definePage(…)` first-argument shape, when the page-definition call was found. */
  readonly pageArgument: PageArgument | undefined;
}

/** The build-only carrier field the scan adds to one route entry. */
export interface PageModuleCarrier {
  /**
   * Build-only page facts (M11-1). It rides the existing scanned route record
   * so dev and build share one producer; it is not part of the public
   * `RouteEntry` shape.
   */
  readonly pageModule?: PageModuleFacts;
}

/** The compiler-owned facts of one generated-element page (M11-2). */
export interface GeneratedElementPageFact {
  /** The island scan's tag: also the tag the compiler emitted the class + host under. */
  readonly tagName: string;
  /** The island's generated-element lane identity (validated: `producer`). */
  readonly identity: GeneratedElementHostIdentity;
}

/** The build-only carrier field route/page generation adds to one page declaration. */
export interface PageKindCarrier {
  /**
   * Build-only page kind (M11-1). It rides the existing `PageRouteDecl`
   * record; the public protocol type stays unchanged.
   */
  readonly pageKind?: PageKind;
  /**
   * Build-only generated-element page fact (M11-2). Present exactly when
   * `pageKind` is `generated-element-page`; the page tag is a compiler-owned
   * build fact (island tag = emitted class/host tag), never a runtime
   * `__partProgram` read. The public protocol type stays unchanged.
   */
  readonly generatedElementPage?: GeneratedElementPageFact;
}

/** One local island the classification may resolve a page component to. */
export interface LocalPageIsland {
  /** The island file path, islands-dir-relative and POSIX. */
  readonly filePath: string;
  /** The island's tag name, derived by the scan's ONE rule (`fileToTagName`). */
  readonly tagName: string;
  /** The generated-element lane identity kind the island scan recorded, if any. */
  readonly generatedLaneKind: GeneratedElementHostIdentity['kind'] | undefined;
  /**
   * The full compiler-owned host identity (M11-2): the tag's producer name is
   * needed to admit a generated page; the kind alone cannot tell a producer
   * from a missing/light lane.
   */
  readonly generatedElementHost?: GeneratedElementHostIdentity;
}

/** The build context the classifier resolves a page component import against. */
export interface PageClassificationContext {
  readonly routesDir: string;
  readonly islandsDir: string;
  readonly islands: readonly LocalPageIsland[];
  /**
   * Every in-project module that DECLARES a generated component, keyed by the
   * build's stable module id (P-4 fix, 2026-11-21).
   *
   * The islands list above is a PATH-convention view: it can only answer for
   * modules inside `islandsDir`. A page whose component lives anywhere else was
   * therefore classified as a class page while the transform compiled it as a
   * generated element — two lanes, two answers, one module, and SSR failed with
   * PROGRAM_MISSING. This map is the AUTHORED answer (the sidecar's own tag,
   * read once by component-declaration.ts), so classification asks the same
   * question the compiler does: "does this module declare a component?".
   */
  readonly declaredComponents: ReadonlyMap<string, DeclaredPageComponent>;
}

/** One declared generated component the classifier may resolve a page to. */
export interface DeclaredPageComponent {
  /** The tag the sidecar pins (or the scan's derived one). */
  readonly tagName: string;
  /** The generated-element lane identity the compiler resolution reported. */
  readonly identity: GeneratedElementHostIdentity;
}

/** Inputs one build host has for the page-classification context. */
export interface PageClassificationContextInput {
  readonly routesDir: string;
  readonly islandsDir: string;
  readonly islandTagNames: readonly string[];
  readonly islandFiles: readonly string[];
  readonly islandMeta: Readonly<Record<string, Partial<IslandDecl>>>;
  /**
   * The declared-component map the phase-1 scan already produced (module id ->
   * tag) and its compiler-resolved host identities. Optional so a hand-built
   * context keeps the pre-fix behaviour: absent means "only the islands view",
   * which is exactly what a host that never ran the scan has.
   */
  readonly declaredTags?: ReadonlyMap<string, string>;
  readonly declaredHostExports?: ReadonlyMap<string, string>;
  /**
   * Resolve a declared module's compiler host identity. The scan records the
   * PRODUCER NAME; classification needs the full identity (kind + name) to tell a
   * producer from a missing/light lane. Omitted: every declared module is treated
   * as producer-unknown, which the classifier refuses rather than guesses.
   */
  readonly resolveHostIdentity?: (
    moduleId: string,
    tagName: string,
  ) => GeneratedElementHostIdentity;
}

/**
 * Build the ONE page-classification context from the scanned island facts.
 *
 * Two build hosts need it: the entry descriptor (which classifies page routes)
 * and the client build's island reachability walk (which seeds a generated
 * page's island into the client entry). The islands mapping, the
 * `generatedElementHost` re-attachment and the fallback file spelling live here
 * ONCE — a caller must not re-derive them (P6: one source of truth).
 */
export function buildPageClassificationContext(
  input: PageClassificationContextInput,
): PageClassificationContext {
  const declaredComponents = new Map<string, DeclaredPageComponent>();
  for (const [moduleId, tagName] of input.declaredTags ?? []) {
    const identity = input.resolveHostIdentity?.(moduleId, tagName);
    if (identity === undefined) continue;
    declaredComponents.set(moduleId, { tagName, identity });
  }
  return {
    routesDir: input.routesDir,
    islandsDir: input.islandsDir,
    islands: input.islandTagNames.map((tagName, index): LocalPageIsland => {
      const host = readGeneratedElementHost(input.islandMeta[tagName]);
      return {
        filePath: input.islandFiles[index] ?? `${tagName}.tsx`,
        tagName,
        generatedLaneKind: host === undefined ? undefined : host.kind,
        ...(host === undefined ? {} : { generatedElementHost: host }),
      };
    }),
    declaredComponents,
  };
}

/** The classification result: data, never a throw (the consumer owns the verdict). */
export type PageClassification =
  | {
      readonly kind: 'classified';
      readonly pageKind: PageKind;
      /** Present exactly for `generated-element-page` (producer identity). */
      readonly generatedElementPage?: GeneratedElementPageFact;
    }
  /** The generated-element lane owns the page component but cannot render it. */
  | {
      readonly kind: 'unsupported-generated-page';
      readonly islandTag: string;
      readonly laneKind: GeneratedElementHostIdentity['kind'];
    }
  /** More than one owning lane claims the page — the fact is genuinely undecidable. */
  | { readonly kind: 'ambiguous'; readonly reason: string; readonly owners: readonly string[] };

// Mirrors the route scanner's own import-probing list (`IMPORT_EXTENSIONS`);
// the two lists cannot be shared without a module cycle (the scanner imports
// this module), so the bounded probe is stated once here for the page-import
// resolution only.
const PAGE_COMPONENT_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'] as const;

/** Strip one trailing extension for the extensionless-specifier comparison. */
function withoutExtension(path: string): string {
  const index = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return index > slash ? path.slice(0, index) : path;
}

/** Root-relative POSIX spelling without a leading slash (both dirs may be relative or absolute). */
function normalizedPath(value: string): string {
  return normalize(value.replaceAll('\\', '/')).replace(/^\.\//, '');
}

/**
 * The module path of one route file: `routesDir` joined with the route's
 * route-dir-relative file path, POSIX-normalized.
 */
function routeModulePath(routesDir: string, routeFilePath: string): string {
  return normalizedPath(join(routesDir, routeFilePath));
}

/**
 * The declared generated component a `definePage(...)` argument names, resolved
 * by MODULE IDENTITY rather than by islands-dir membership (P-4 fix).
 *
 * The specifier is resolved against the route module's directory to the same
 * project-relative spelling the scan recorded, then looked up in the declared
 * map. A miss falls through to the islands path convention, so a module without a
 * sidecar keeps the pre-fix classification exactly.
 */
function resolveDeclaredComponent(
  specifier: string,
  routePath: string,
  context: PageClassificationContext,
): LocalPageIsland | undefined {
  // A hand-built context (adapter integrations, tests) may predate the declared
  // map; absent means "only the islands view", which is the pre-fix behaviour.
  if (context.declaredComponents === undefined || context.declaredComponents.size === 0) {
    return undefined;
  }
  let base: string;
  if (specifier.startsWith('.')) {
    base = normalizedPath(join(dirname(routePath), specifier));
  } else if (specifier.startsWith('/')) {
    base = normalizedPath(specifier.slice(1));
  } else {
    return undefined;
  }
  const candidates = new Set<string>([base]);
  for (const extension of PAGE_COMPONENT_EXTENSIONS) {
    candidates.add(base + extension);
    candidates.add(`${base}/index${extension}`);
  }
  for (const [moduleId, declared] of context.declaredComponents) {
    if (!candidates.has(moduleId) && !candidates.has(withoutExtension(moduleId))) continue;
    return {
      filePath: moduleId,
      tagName: declared.tagName,
      generatedLaneKind: declared.identity.kind,
      generatedElementHost: declared.identity,
    };
  }
  return undefined;
}

/**
 * The local island a `definePage(ImportedComponent)` argument names, if any.
 *
 * Resolution is deliberately bounded to LOCAL islands: a relative specifier
 * (or a root-relative one) is resolved against the importing route module's
 * directory and matched against the scanned island files by path with the
 * same extension probing the route scanner uses. A package/alias specifier is
 * out of this build-time fact's reach and stays a class-page assumption (the
 * pre-M11 contract); the generated-element page shape is local by
 * construction (`createGeneratedElementSiteResolver` admits `islandsDir`
 * modules only).
 */
function resolveLocalIsland(
  specifier: string,
  routeFilePath: string,
  context: PageClassificationContext,
): LocalPageIsland | undefined {
  const routePath = routeModulePath(context.routesDir, routeFilePath);
  // A registered DECLARED component wins over the path convention (P-4 fix): the
  // island list can only answer for modules inside the islands directory, while a
  // page's component may live anywhere. The declared map is the authored answer
  // and the compiler picks the same module, so classification and transform now
  // agree about what this page IS.
  const byDeclaration = resolveDeclaredComponent(specifier, routePath, context);
  if (byDeclaration !== undefined) return byDeclaration;
  let base: string;
  if (specifier.startsWith('.')) {
    base = normalizedPath(join(dirname(routePath), specifier));
  } else if (specifier.startsWith('/')) {
    base = normalizedPath(specifier.slice(1));
  } else {
    // A package/alias specifier is outside this build-time fact's reach; the
    // generated-element page shape is local by construction.
    return undefined;
  }
  const candidates = new Set<string>([base]);
  for (const extension of PAGE_COMPONENT_EXTENSIONS) {
    candidates.add(base + extension);
    // Extensionless specifiers: the island file may be the index module.
    candidates.add(`${base}/index${extension}`);
  }
  for (const island of context.islands) {
    const islandPath = normalizedPath(join(context.islandsDir, island.filePath));
    if (candidates.has(islandPath) || candidates.has(withoutExtension(islandPath))) {
      return island;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------------- *
 * Route-scan side: record the build-only facts.
 * ------------------------------------------------------------------------- */

/** The compiler semantic-core facts the route scan already computed. */
export interface PageModuleSourceFacts {
  readonly source: string;
  /** The route's routes-dir-relative file path (POSIX). */
  readonly filePath: string;
  readonly definePage: boolean;
  readonly compiledElement: boolean;
  readonly functionPage: string | undefined;
}

/** Describe a `definePage` first argument for the diagnostic reasons. */
function describeExpression(node: ts.Expression): string {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return 'an inline function';
  if (ts.isCallExpression(node)) return 'a call expression';
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return 'a member expression';
  }
  if (ts.isConditionalExpression(node)) return 'a conditional expression';
  return 'a non-identifier expression';
}

/** Resolve one identifier to the module-local declaration or import that binds it. */
function resolvePageArgumentIdentifier(name: string, sourceFile: ts.SourceFile): PageArgument {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return { kind: 'local', name, binding: 'function' };
    }
    if (ts.isClassDeclaration(statement) && statement.name?.text === name) {
      return { kind: 'local', name, binding: 'class' };
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
        const initializer = declaration.initializer;
        if (
          initializer !== undefined &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ) {
          return { kind: 'local', name, binding: 'function' };
        }
        // An arbitrary initializer (class expression included) has no
        // statically known page shape: report it as a local non-function.
        return { kind: 'local', name, binding: 'class' };
      }
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) {
      if (statement.importClause?.name?.text === name) {
        return { kind: 'import', name, specifier: statement.moduleSpecifier.text };
      }
      continue;
    }
    if (ts.isNamespaceImport(bindings)) {
      if (bindings.name.text === name) {
        return { kind: 'import', name, specifier: statement.moduleSpecifier.text };
      }
      continue;
    }
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === name) {
        return { kind: 'import', name, specifier: statement.moduleSpecifier.text };
      }
    }
  }
  return { kind: 'unresolved', name };
}

/**
 * Read the `definePage(…)` first-argument shape out of one route module.
 *
 * Called only when the semantic core already answered `definePage: true`
 * (the page-definition binding authority stays the semantic core); this parse
 * adds the argument binding the `ModuleSemanticFacts` do not carry. It is a
 * bounded, syntax-only parse: no execution, no type-checking, no resolution.
 */
function readPageArgument(source: string, filePath: string): PageArgument | undefined {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  for (const statement of sourceFile.statements) {
    if (!ts.isExportAssignment(statement)) continue;
    if (!ts.isCallExpression(statement.expression)) return undefined;
    const argument = statement.expression.arguments[0];
    if (argument === undefined) return undefined;
    if (ts.isIdentifier(argument)) {
      return resolvePageArgumentIdentifier(argument.text, sourceFile);
    }
    return { kind: 'inline', expression: describeExpression(argument) };
  }
  return undefined;
}

/**
 * Build the build-only page facts for one scanned page route.
 *
 * `.mdx` routes short-circuit to a class page: the router's MDX lowering
 * emits a compiled `@element` class module, so there is no authored
 * `definePage` call to read.
 */
export function buildPageModuleFacts(facts: PageModuleSourceFacts): PageModuleFacts {
  const mdx = /\.mdx(?:[?#]|$)/.test(facts.filePath);
  if (mdx) {
    return {
      definePage: true,
      mdx: true,
      compiledElement: false,
      functionPage: undefined,
      pageArgument: undefined,
    };
  }
  return {
    definePage: facts.definePage,
    mdx: false,
    compiledElement: facts.compiledElement,
    functionPage: facts.functionPage,
    pageArgument: facts.definePage ? readPageArgument(facts.source, facts.filePath) : undefined,
  };
}

/* ------------------------------------------------------------------------- *
 * Generation side: classify one route into a page kind.
 * ------------------------------------------------------------------------- */

/**
 * Classify one page module from its build facts plus the optional resolved
 * generated-element island. Pure: the caller owns the fail-closed verdict.
 */
export function classifyPageModule(
  facts: PageModuleFacts,
  resolvedIsland?: LocalPageIsland,
): PageClassification {
  const owners: string[] = [];
  const kinds = new Set<PageKind>();
  if (facts.compiledElement) {
    owners.push('compiled-element decorator (class lane)');
    kinds.add('class-page');
  }
  if (facts.mdx) {
    owners.push('MDX lowering (router-generated compiled class)');
    kinds.add('class-page');
  }
  if (facts.functionPage !== undefined) {
    owners.push(`server function page "${facts.functionPage}" (server component lane)`);
    kinds.add('function-page');
  }
  if (resolvedIsland !== undefined && ownsGeneratedLaneKind(resolvedIsland.generatedLaneKind)) {
    // M-4a/P6: the owned-kind verdict is the generated-host identity owner's
    // (generated-element-host-metadata.ts). This classifier and the client
    // island entry read that one predicate; neither keeps a kind list.
    owners.push(`generated element <${resolvedIsland.tagName}> (generated-element lane)`);
    kinds.add('generated-element-page');
  }

  if (kinds.size > 1) {
    return {
      kind: 'ambiguous',
      reason: 'more than one page-owning lane claims this module',
      owners,
    };
  }

  if (kinds.size === 1) {
    const pageKind = [...kinds][0];
    if (pageKind === 'generated-element-page' && resolvedIsland?.generatedLaneKind !== undefined) {
      const identity = resolvedIsland.generatedElementHost;
      // M11-2: only the compiler-emitted host producer can render a generated
      // page root. A `missing-producer` / `light-no-producer` lane has no
      // host artifact, so the shape stays a classified-but-unwired refusal
      // (the consumer owns the coded verdict; no silent fallback).
      if (identity?.kind === 'producer') {
        return {
          kind: 'classified',
          pageKind,
          generatedElementPage: { tagName: resolvedIsland.tagName, identity },
        };
      }
      return {
        kind: 'unsupported-generated-page',
        islandTag: resolvedIsland.tagName,
        laneKind: resolvedIsland.generatedLaneKind,
      };
    }
    return { kind: 'classified', pageKind };
  }

  // No owning lane was recorded: the fact is not decisive, so the classifier
  // returns the LEGACY answer instead of narrowing behavior. The canonical
  // class-page forms land here — a definePage over an imported page component
  // (the compiled class module is owned by its own module's transform), a
  // plain element route, an inline/non-identifier definePage argument, a
  // name this module cannot resolve, and a module-local function the server
  // lane declined. The pre-M11 build classified every one of those as a class
  // page, and a more faithful fact is additive evidence, not a new refusal:
  // only a genuinely undecidable fact (two owning lanes, above) or the
  // classified-but-unwired generated-element page form fails closed.
  return { kind: 'classified', pageKind: 'class-page' };
}

/**
 * Read the build-only page facts off one scanned route entry.
 *
 * Returns `undefined` for a route the scan predates (a hand-built descriptor
 * route in a test or an adapter integration): the caller then falls back to
 * the protocol facts it does have.
 */
export function readPageModuleFacts(route: RouteEntry | undefined): PageModuleFacts | undefined {
  return (route as PageModuleCarrier | undefined)?.pageModule;
}

/**
 * Resolve the build-time page kind for one page route, failing closed.
 *
 * The consumer is route/page generation (`buildEntryDescriptor`): the verdict
 * is recorded as build-only metadata on the page declaration and every
 * generated handler/routeInfo branch reads that fact instead of a runtime
 * module-shape check.
 */
/**
 * Resolve the LOCAL generated-element island a page component import points at.
 *
 * Build-only, path-based (the same bounded resolution the classifier uses). The
 * client island reachability walk needs this edge: a generated page route
 * imports its island component as a VALUE (`definePage(ImportedCard)`), so the
 * route source carries no tag string and the island module carries no
 * registration; without this seed the island would never enter the client
 * entry and the SSR DSD would have no class to upgrade it. Shared with the
 * classifier, never a second resolver.
 */
export function resolvePageComponentIsland(
  route: RouteEntry,
  context: PageClassificationContext,
): LocalPageIsland | undefined {
  const facts = (route as RouteEntry & PageModuleCarrier).pageModule;
  const argument = facts?.pageArgument;
  if (argument?.kind !== 'import') return undefined;
  return resolveLocalIsland(argument.specifier, route.filePath, context);
}

/** The build-only verdict for one page route (kind + generated-page facts). */
export interface PageRouteClassification {
  readonly pageKind: PageKind;
  readonly generatedElementPage?: GeneratedElementPageFact;
}

/** Why a generated-element page shape has no renderable host artifact. */
function generatedPageRefusalReason(laneKind: GeneratedElementHostIdentity['kind']): string {
  if (laneKind === 'light-no-producer') {
    return (
      'the component root is light, so the compiler emits no DSD host producer for it; a ' +
      'generated page root needs the compiler-emitted host producer (the light document style ' +
      'plan does not create one). Set root: shadow on the island, render the island inside a ' +
      'compiled @element class page, or move the page to a server function page form.'
    );
  }
  return (
    'the shadow leaf emitted no compiler-owned host producer (no `<Name>__ssr`), so there is no ' +
    'server artifact to render the page root with. Make the component claimable/SSR-capable, ' +
    'render the island inside a compiled @element class page, or move the page to a server ' +
    'function page form.'
  );
}

/**
 * Classify one page route into the build-only page kind + generated-page fact.
 *
 * This is the ONE consumer verdict (M11-1/M11-2): the classified fact is
 * recorded on the page declaration, and every generated handler/routeInfo
 * branch reads that fact. Genuinely undecidable or unwired shapes fail closed
 * with the router-internal coded build errors below (no public catalogue row is
 * added by this slice).
 */
export function classifyPageRoute(
  route: RouteEntry,
  context: PageClassificationContext,
): PageRouteClassification {
  const carried = readPageModuleFacts(route);
  if (carried === undefined) {
    // No scan-produced build facts (a hand-built descriptor route — an
    // adapter integration or a test). The protocol facts are all there is and
    // the pre-M11 contract already answers from them: the recorded
    // function-page fact, else class page. Fail-closed ambiguity needs the
    // module facts; it is not guessed here.
    return { pageKind: route.functionPage === undefined ? 'class-page' : 'function-page' };
  }
  const facts = carried;
  const resolvedIsland =
    facts.pageArgument?.kind === 'import'
      ? resolveLocalIsland(facts.pageArgument.specifier, route.filePath, context)
      : undefined;
  const classification = classifyPageModule(facts, resolvedIsland);
  if (classification.kind === 'classified') {
    if (classification.pageKind !== 'generated-element-page') {
      return { pageKind: classification.pageKind };
    }
    // M11-2 bounded lane: a generated host is synchronous-SSR only (ADR-0181
    // A6 structurally refuses the stream executor), so a stream declaration is
    // refused at build instead of emitting a guard the runtime cannot serve.
    if ((route as { readonly streamManifest?: unknown }).streamManifest !== undefined) {
      throw buildError(
        PageClassificationCode.GENERATED_ELEMENT_PAGE_UNSUPPORTED,
        `[openElement] page route ${route.path} (${route.filePath}) is a generated element page ` +
          'and declares renderIntent.stream; generated element hosts are synchronous-SSR only, ' +
          'so streaming/deferred DSD for them is not supported. Remove the stream declaration, ' +
          'or move the page to a compiled @element class page.',
      );
    }
    const generatedElementPage = classification.generatedElementPage;
    if (generatedElementPage === undefined) {
      throw buildError(
        PageClassificationCode.GENERATED_ELEMENT_PAGE_UNSUPPORTED,
        `[openElement] page route ${route.path} (${route.filePath}) classified as a generated ` +
          'element page without a compiler-owned host producer identity.',
      );
    }
    return { pageKind: classification.pageKind, generatedElementPage };
  }
  if (classification.kind === 'unsupported-generated-page') {
    throw buildError(
      PageClassificationCode.GENERATED_ELEMENT_PAGE_UNSUPPORTED,
      `[openElement] page route ${route.path} (${route.filePath}) resolves its page component to ` +
        `generated element <${classification.islandTag}> (generated-element lane: ` +
        `${classification.laneKind}), but ${generatedPageRefusalReason(classification.laneKind)}`,
    );
  }
  throw buildError(
    PageClassificationCode.AMBIGUOUS_PAGE_MODULE,
    `[openElement] page route ${route.path} (${route.filePath}) cannot be classified at build ` +
      `time: ${classification.reason}` +
      (classification.owners.length > 0
        ? ` — owning lanes: ${classification.owners.join(', ')}.`
        : '.') +
      ' A page module must be exactly one of: a compiled @element class page, a server function ' +
      'page (one exported function with a single JSX return declared by the route module and ' +
      'passed to definePage), or a .mdx route.',
  );
}

/** The page kind of one route (M11-1 consumer contract; no fact accessor). */
export function resolvePageKind(route: RouteEntry, context: PageClassificationContext): PageKind {
  return classifyPageRoute(route, context).pageKind;
}

/* ------------------------------------------------------------------------- *
 * Consumers' one read.
 * ------------------------------------------------------------------------- */

/** The page kind of one page declaration, with the protocol-fact fallback. */
export function pageKindOf(
  route: {
    readonly functionPage?: string;
  } & Partial<PageKindCarrier>,
): PageKind {
  const carried = (route as PageKindCarrier & typeof route).pageKind;
  if (carried !== undefined) return carried;
  return route.functionPage === undefined ? 'class-page' : 'function-page';
}

/** True for the server function page form (the only non-class form wired today). */
export function isFunctionPage(
  route: {
    readonly functionPage?: string;
  } & Partial<PageKindCarrier>,
): boolean {
  return pageKindOf(route) === 'function-page';
}

/** The build-only page kind carried on one generated page declaration, if any. */
export function readPageKind(route: PageRouteDecl | undefined): PageKind | undefined {
  return (route as (PageRouteDecl & PageKindCarrier) | undefined)?.pageKind;
}
