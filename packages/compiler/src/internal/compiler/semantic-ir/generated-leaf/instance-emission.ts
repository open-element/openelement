/** Instance retention, setup and lifecycle emission. */

import {
  type FunctionModelComponent,
  type FunctionModelComponentRef,
  type FunctionModelNode,
  type FunctionModelModule,
  type FunctionModelContextProvider,
} from '../../semantic-core/function-frontend.ts';
import { type IrSpan, type IrDiagnostic } from '../types.ts';
import { type LoweredExpressionRecord } from '../../semantic-core/expression-registry.ts';
import {
  INTERNAL_PREFIX,
  type EmitState,
  moduleUsesErrorBoundary,
  ERROR_REPORT_PROPERTY,
  type ModuleImportContext,
  RECIPE_REFERENCE_CALLEE,
  type RetentionPlan,
  importContextOf,
  type SpanLike,
  pushParts,
  push,
  recordFor,
  declareReads,
  MOUNT_HOST,
  MOUNT_SCOPE,
  TRANSACTION_VAR,
} from './emission.ts';
import { referencedRecipeIds, recipeMap, componentProjectsChildren } from './structure.ts';

/**
 * T3 / 16b-LC-1: the module-local ROOT setup factory name.
 *
 * The emitted CE descriptor's `createInstance` row references exactly this
 * name (the tail appends the row when this declaration exists), and the root
 * mount/claim alias the record it returns instead of re-evaluating the setup
 * initializers. It is compiler-owned generated code, not an author hook and
 * not a package export: the `__oe_` prefix is refused for every authored
 * identifier, and `nextName` always emits a counter suffix, so neither an
 * authored name nor a generator-local name can collide with this fixed
 * module-scope declaration.
 */
export const GENERATED_ROOT_INSTANCE_NAME = `${INTERNAL_PREFIX}rootInstance`;

/**
 * `16b-LC` option 1a: the compiler-owned key/array name carrying the ROOT's
 * admitted `onConnect` callbacks through the retained instance record.
 *
 * The `__oe_rootInstance` factory pushes every lowered callback into this
 * array and returns it with the setup record; the root mount/claim PROLOGUE
 * replays the array on the per-connection scope the shell handed it and
 * registers each returned cleanup on that same scope. It is not a runtime hook
 * dispatcher and not author syntax: the record field is read by generated code
 * only, the `__oe_` prefix is refused for every authored identifier, and the
 * name is a fixed compiler-owned local, so it cannot collide with an authored
 * name or a `nextName` identifier.
 */
export const GENERATED_ROOT_CONNECT_RECORD = `${INTERNAL_PREFIX}connect`;

/**
 * `16b-LC` option 1a env form: the compiler-owned retained-record key carrying
 * the callbacks that declare the one `env` parameter. It is a SEPARATE record
 * on purpose: a module whose hooks are all zero-argument keeps the exact
 * pre-env bytes, and the replay for each form is emitted only when that form is
 * present. Like `__oe_connect`, the key is read by generated code only.
 */
export const GENERATED_ROOT_CONNECT_ENV_RECORD = `${INTERNAL_PREFIX}connectEnv`;

/**
 * The compiler-private host-record property carrying the element a connection
 * belongs to: the generated element itself for the root, and the nearest
 * ancestor generated element for a depth-1 retained hostless child. The shell
 * attaches it as a runtime property (`hostFor`/`instanceHostFor`) — the
 * exported host types are not changed and no exported symbol is added.
 */
export const HOST_ELEMENT_PROPERTY = `${INTERNAL_PREFIX}hostElement`;

/** Replay locals the root mount/claim prologue uses (all compiler-owned). */
const LIFECYCLE_HOOKS_VAR = `${INTERNAL_PREFIX}lifecycleHooks`;

const LIFECYCLE_HOOK_VAR = `${INTERNAL_PREFIX}lifecycleHook`;

const LIFECYCLE_CLEANUP_VAR = `${INTERNAL_PREFIX}lifecycleCleanup`;

/** Env-form replay locals (separate from the zero-argument ones). */
const LIFECYCLE_ENV_HOOKS_VAR = `${INTERNAL_PREFIX}lifecycleEnvHooks`;

const LIFECYCLE_ENV_HOOK_VAR = `${INTERNAL_PREFIX}lifecycleEnvHook`;

const LIFECYCLE_ENV_CLEANUP_VAR = `${INTERNAL_PREFIX}lifecycleEnvCleanup`;

/** The instance-lifetime signal an `onDispose(env)` registration captures. */
export const TEARDOWN_SIGNAL_VAR = `${INTERNAL_PREFIX}teardownSignal`;

/**
 * The compiler-private host-record property that registers an element-lifetime
 * `onPropertyChange` callback. The shell owns the actual listener list and the
 * env it builds; generated code only registers through this channel, exactly
 * like `__oe_hostElement` is a runtime property and not an exported symbol.
 */
export const PROPERTY_CHANGE_PROPERTY = `${INTERNAL_PREFIX}onPropertyChange`;

/** The host-record property exposing the element's `CustomStateSet` to the env. */
export const STATES_PROPERTY = `${INTERNAL_PREFIX}states`;

/**
 * `16b-EB`: the compiler-private host-record property that registers the
 * element-lifetime `onError` handler. The shell owns the capture points and the
 * handler list; generated code only registers through this channel, exactly like
 * `__oe_onPropertyChange`. Registration is FORWARDED through host literals only
 * for modules that use the intrinsic, so every other module keeps its bytes.
 */
export const ERROR_HANDLER_PROPERTY = `${INTERNAL_PREFIX}onError`;

/**
 * `16b-CTX`: the compiler-private host-record property that exposes the
 * generated element's ONE context scope. The shell owns the service; generated
 * code only calls `provider(token, read)`, `use(token)` and `owner()` through
 * this channel, exactly like `__oe_onPropertyChange` and `__oe_onError` are
 * runtime properties rather than exported symbols.
 */
export const CONTEXT_SCOPE_PROPERTY = `${INTERNAL_PREFIX}context`;

/**
 * `16b-CTX`: the compiler-owned retained record field carrying THIS component's
 * owner scope channel.
 *
 * A generated element ROOT provides and consumes on the element anchor itself
 * (so every depth-1 child sees its providers). A hostless component is an owner
 * in its own right: its scope is `anchor.owner()`, a CHILD of the anchor, so its
 * provider is invisible to its siblings while its own consumers still resolve
 * the anchor's ancestors. Storing that channel in the retained record is what
 * makes the component's whole subtree — and its own consumers — agree on one
 * scope across a reconnect.
 */
export const GENERATED_CONTEXT_SCOPE_RECORD = `${INTERNAL_PREFIX}contextScope`;

/**
 * `16b-CTX` — the SSR producer's optional trailing parameter carrying the
 * ENCLOSING render scope channel.
 *
 * It is a PARAMETER, never a module global: two concurrent server renders each
 * own their scope, and a producer that reads one request's value out of module
 * state would share it with the other. A context-using component's producer does
 *
 *   `const __oe_contextScope = __oe_ssrContext === undefined
 *      ? createRenderContextScope()
 *      : __oe_ssrContext.owner();`
 *
 * which is the SERVER spelling of the client's two owner shapes: the module root
 * creates the render's anchor (the host wrapper and the light serializer pass no
 * scope), and a depth-1 child joins it as `anchor.owner()` — the identical rule
 * the client's retained setup factory uses.
 */
export const SSR_CONTEXT_PARAM = `${INTERNAL_PREFIX}ssrContext`;

/**
 * Whether any component in the module uses a `16b-CTX` intrinsic. The channel is
 * forwarded through the host-record literals only for such a module, so every
 * other module keeps its exact bytes.
 */
export function moduleUsesContext(state: EmitState): boolean {
  for (const component of state.componentByName.values()) {
    if (component.contextProviders.length > 0) return true;
    if (component.resources.some((resource) => resource.kind === 'context')) return true;
  }
  return false;
}

/**
 * Whether any component in the module registers an `onPropertyChange`
 * callback. The registration channel is forwarded through the host-record
 * literals only for such a module, so every other module keeps its exact bytes.
 */
export function moduleUsesPropertyChange(state: EmitState): boolean {
  for (const component of state.componentByName.values()) {
    if (component.lifecycle.some((hook) => hook.kind === 'property-change')) return true;
  }
  return false;
}

/**
 * Whether any component in the module declares an env-form lifecycle callback.
 * The host-element property is forwarded through the host-record literals only
 * for such a module, so a module that never opts into the env form keeps its
 * exact pre-env bytes (including every hook-free SHA pin).
 */
/**
 * True when ANY component in the module declares a `useHost()` accessor
 * (`16b-REF`).
 *
 * The lowering is a field read on the setup host record, so the record must
 * carry the element. A generated element ROOT gets it unconditionally (the
 * shell attaches it), but a RETAINED depth-1 hostless child's host literal is
 * built by the parent and only forwards the fields the child actually reads —
 * which is why this fact has to be module-wide, exactly like the env-form
 * lifecycle gate beside it.
 */
export function moduleUsesHostAccess(state: EmitState): boolean {
  for (const component of state.componentByName.values()) {
    if (component.resources.some((resource) => resource.kind === 'host')) return true;
  }
  return false;
}

/** True when `component` itself declares a `useHost()` accessor. */
function componentUsesHostAccess(component: FunctionModelComponent): boolean {
  return component.resources.some((resource) => resource.kind === 'host');
}

export function moduleUsesLifecycleEnv(state: EmitState): boolean {
  for (const component of state.componentByName.values()) {
    if (
      component.lifecycle.some(
        (hook) => hook.kind !== 'property-change' && hook.kind !== 'error' && hook.receivesEnv,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The host-element field a RETAINED reference-site host literal forwards to a
 * depth-1 child that declares an env-form lifecycle callback. Empty otherwise,
 * so every other module and reference site keeps its exact bytes.
 */
export function childHostElementField(state: EmitState, node: FunctionModelComponentRef): string {
  const child = state.componentByName.get(node.name);
  if (child === undefined) return '';
  // `16b-REF`: a child that reads `useHost()` needs the element field for the
  // same reason an env-form lifecycle callback does — its retained setup reads
  // the field off its own host literal.
  const needsElement =
    (moduleUsesLifecycleEnv(state) && child.lifecycle.some((hook) => hook.receivesEnv)) ||
    componentUsesHostAccess(child);
  if (!needsElement) return '';
  return `, ${HOST_ELEMENT_PROPERTY}: ${state.hostVar}.${HOST_ELEMENT_PROPERTY}, ${STATES_PROPERTY}: ${state.hostVar}.${STATES_PROPERTY}`;
}

/** The change channel a retained child setup host forwards (empty otherwise). */
export function childPropertyChangeField(
  state: EmitState,
  node: FunctionModelComponentRef,
): string {
  if (!moduleUsesPropertyChange(state)) return '';
  const child = state.componentByName.get(node.name);
  if (child === undefined || !child.lifecycle.some((hook) => hook.kind === 'property-change')) {
    return '';
  }
  return `, ${PROPERTY_CHANGE_PROPERTY}: ${state.hostVar}.${PROPERTY_CHANGE_PROPERTY}`;
}

/**
 * The `16b-CTX` channel a RETAINED reference-site host literal forwards to a
 * depth-1 child that uses a context intrinsic. Empty otherwise, so every other
 * module and reference site keeps its exact bytes. Both the child's setup host
 * (provider registration and consumer construction) and its mount/claim host
 * (the alias the body reads) need it, which is why the same field rides both.
 */
export function childContextField(state: EmitState, node: FunctionModelComponentRef): string {
  if (!moduleUsesContext(state)) return '';
  const child = state.componentByName.get(node.name);
  if (child === undefined) return '';
  const uses =
    child.contextProviders.length > 0 ||
    child.resources.some((resource) => resource.kind === 'context');
  if (!uses) return '';
  return `, ${CONTEXT_SCOPE_PROPERTY}: ${state.hostVar}.${CONTEXT_SCOPE_PROPERTY}`;
}

/**
 * The `16b-EB` channels a RETAINED reference-site host literal forwards to a
 * depth-1 child that declares `onError`: the registration channel (so the
 * child's `<Name>__setup` can register on the element's one handler list) and
 * the update-phase sink (so the child's own refresh subscriptions are guarded).
 * Empty otherwise, so every other module and reference site keeps its bytes.
 */
export function childErrorBoundaryField(state: EmitState, node: FunctionModelComponentRef): string {
  if (!moduleUsesErrorBoundary(state)) return '';
  const child = state.componentByName.get(node.name);
  if (child === undefined || !child.lifecycle.some((hook) => hook.kind === 'error')) return '';
  return `, ${ERROR_HANDLER_PROPERTY}: ${state.hostVar}.${ERROR_HANDLER_PROPERTY}, ${ERROR_REPORT_PROPERTY}: ${state.hostVar}.${ERROR_REPORT_PROPERTY}`;
}

/**
 * The `16b-EB` update-phase sink alone, for the `__oe_childHost` literal a
 * retained child's MOUNT/CLAIM body reads. Registration belongs to the setup
 * host, but the refresh subscriptions are opened by the mount/claim body, so it
 * needs the sink there too. Without this the child's refresh would call
 * `guardUpdate(fn, undefined)` and propagate — the enclosing element's handler
 * would never see the throw. Empty otherwise, keeping every other site's bytes.
 */
export function childErrorReportField(state: EmitState, node: FunctionModelComponentRef): string {
  if (!moduleUsesErrorBoundary(state)) return '';
  const child = state.componentByName.get(node.name);
  if (child === undefined || !child.lifecycle.some((hook) => hook.kind === 'error')) return '';
  return `, ${ERROR_REPORT_PROPERTY}: ${state.hostVar}.${ERROR_REPORT_PROPERTY}`;
}

/**
 * 16b-LC retained-child: the module-local setup factory a RETAINED hostless child exposes to
 * its retaining reference site (`<Name>__setup`). Synthesized from the
 * component's own name, exactly like `<Name>__mount`/`<Name>__claim`, so it can
 * never collide with another component's generated declarations; it adds no
 * descriptor row, no metadata and no diagnostic. The factory runs once on the
 * ledger-owned retained scope and its return value is the retained record the
 * child body aliases.
 */
export const LEAF_SETUP_SUFFIX = '__setup';

/**
 * The retained-record source property of each generated host record:
 * the ROOT body aliases the shell's retained `bindings` record, while a LEAF
 * body aliases the compiler-private `setup` property of the child host literal
 * the retaining reference site built. One property per body mode; no runtime
 * probing and no fallback branch.
 */
export const ROOT_SETUP_HOST_PROPERTY = 'bindings';

export const LEAF_SETUP_HOST_PROPERTY = 'setup';

/**
 * 16b-LC retained-child site key: the ONE authored-span literal emitted by both the mount
 * and the claim reference-site emitters. Identity is the authored span
 * (`IrSpan` UTF-16 start/end), so the same site re-claiming on a new connection
 * reuses the same ledger entry and two distinct sites can never share one. The
 * runtime never parses or derives it.
 */
export function siteKeyLiteral(span: IrSpan): string {
  return JSON.stringify(`${span.file}:${span.start}:${span.end}`);
}

/**
 * Root mount/claim alias of the retained setup record (`__oe_host.bindings`).
 * Presence is checked with `Object.hasOwn`, so a legitimately `undefined` setup
 * value is retained; the host-binding `__oe_requireBinding` helper keeps its
 * documented undefined-means-missing identity (two records, two deliberate
 * semantics).
 */
export const ROOT_SETUP_RECORD = `${INTERNAL_PREFIX}setup`;

/** The own-property presence helper used by the root mount/claim aliases. */
export const ROOT_SETUP_REQUIRE = `${INTERNAL_PREFIX}requireRootSetup`;

/** One emitted component-reference site and the emission context it sits in. */
interface RefSite {
  readonly node: FunctionModelComponentRef;
  /** The component whose emitted body contains the site. */
  readonly owner: string;
  /** Emitted inside a reusable-JSX/children recipe body. */
  readonly inRecipe: boolean;
  /** Emitted inside a list-entry template. */
  readonly inList: boolean;
}

function collectComponentRefSites(
  component: FunctionModelComponent,
  nodes: readonly FunctionModelNode[],
  inRecipe: boolean,
  inList: boolean,
  sink: RefSite[],
): void {
  for (const node of nodes) {
    switch (node.kind) {
      case 'component-ref':
        sink.push({ node, owner: component.name, inRecipe, inList });
        break;
      case 'element':
      case 'fragment':
        collectComponentRefSites(component, node.children, inRecipe, inList, sink);
        break;
      case 'condition':
        collectComponentRefSites(component, node.consequent, inRecipe, inList, sink);
        if (node.alternate !== null) {
          collectComponentRefSites(component, node.alternate, inRecipe, inList, sink);
        }
        break;
      case 'list':
        collectComponentRefSites(component, node.template, inRecipe, true, sink);
        break;
      default:
        break;
    }
  }
}

/**
 * Collect every emitted component-reference site. `recipes` selects whether
 * unreferenced (never emitted) recipes participate: the eligibility fixpoint
 * only counts emitted bodies, while the root-target guard is a deliberate
 * conservative superset and walks every recipe.
 */
function collectModuleRefSites(module: FunctionModelModule, recipes: 'emitted' | 'all'): RefSite[] {
  const sites: RefSite[] = [];
  for (const component of module.components) {
    collectComponentRefSites(component, component.roots, false, false, sites);
    const emitted = recipes === 'all' ? null : referencedRecipeIds(component);
    for (const recipe of component.recipes) {
      if (emitted !== null && !emitted.has(recipe.id)) continue;
      collectComponentRefSites(component, [recipe.target], true, false, sites);
    }
  }
  return sites;
}

/**
 * The root-style setup gateway (`generate.ts` `rootSetup` facts, shared here so
 * one body shape per component): a setup local may read props, other setup
 * locals and plain globals only. Any other read is a host-binding read
 * (`declareReads`'s fallback), and the retained setup scope has no bindings
 * record, so such a component stays legacy and its references emit today's
 * inline text.
 */
function setupReadAllowed(
  read: LoweredExpressionRecord['reads'][number],
  setupLocals: ReadonlySet<string>,
  imports?: ModuleImportContext,
): boolean {
  if (read.name === 'props' || read.binding.name === 'props') return true;
  if (setupLocals.has(read.name) || setupLocals.has(read.binding.name)) return true;
  if (
    read.value === 'plain' &&
    read.binding.name === read.name &&
    read.binding.scope.path === 'global'
  ) {
    return true;
  }
  // `16b-CTX`: a context TOKEN is normally a static module import (`createContext`
  // in a tokens module). `declareReads` already treats such a read as a direct
  // module reference with no host binding, so the gateway must agree — otherwise
  // a token-bearing consumer is demoted out of the retained-child plan and the
  // context placement gate refuses a shape the lane can actually carry.
  if (imports !== undefined && imports.byLocal.has(read.name)) return true;
  return false;
}

function setupGatewayPasses(
  component: FunctionModelComponent,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  imports: ModuleImportContext | undefined,
): boolean {
  // `signal`/`computed` are the only host-binding resource kinds. A `local`
  // snapshot and a `16b-REF` handle are BOTH retained setup values: the handle
  // is built by the factory (its notification callback, when present, reads the
  // same captured scope), so both belong in `setupLocals`.
  const hostBindings = new Set(
    component.resources
      .filter((resource) => resource.kind === 'signal' || resource.kind === 'computed')
      .map((r) => r.name),
  );
  const setupLocals = new Set(
    component.resources
      .filter(
        (resource) =>
          (resource.kind === 'local' || resource.kind === 'ref' || resource.kind === 'context') &&
          resource.recipeId === null &&
          resource.expression !== null,
      )
      .map((resource) => resource.name),
  );
  // `16b-LC` nested/hostless depth-1: a lifecycle callback is placement work,
  // not a resource, but it reads the SAME retained setup scope. Any read the
  // setup gateway cannot evaluate (host binding, recipe reference) keeps the
  // component out of the retained-child plan (the lane's existing
  // `UNBOUND_BINDING` gate then refuses the module).
  for (const hook of component.lifecycle) {
    const record = records.get(hook.callback.id);
    if (record === undefined) return false;
    if (record.lowered.includes(RECIPE_REFERENCE_CALLEE)) return false;
    if (!record.reads.every((read) => setupReadAllowed(read, setupLocals, imports))) return false;
  }
  // `16b-CTX`: a provider THUNK is placement work too — it is re-read inside the
  // retained factory on every connect, so it must be evaluable there.
  for (const provider of component.contextProviders) {
    for (const ref of [provider.token, provider.value]) {
      const record = records.get(ref.id);
      if (record === undefined) return false;
      if (record.lowered.includes(RECIPE_REFERENCE_CALLEE)) return false;
      if (!record.reads.every((read) => setupReadAllowed(read, setupLocals, imports))) {
        return false;
      }
    }
  }
  for (const resource of component.resources) {
    if (resource.recipeId !== null || resource.expression === null) continue;
    if (resource.kind !== 'local' && resource.kind !== 'ref' && resource.kind !== 'context') {
      continue;
    }
    const record = records.get(resource.expression.id);
    if (record === undefined) return false;
    if (record.lowered.includes(RECIPE_REFERENCE_CALLEE)) return false;
    for (const read of record.reads) {
      if (read.name === 'props' || read.binding.name === 'props') continue;
      if (setupLocals.has(read.name) || setupLocals.has(read.binding.name)) continue;
      if (
        read.value === 'plain' &&
        read.binding.name === read.name &&
        read.binding.scope.path === 'global'
      ) {
        continue;
      }
      // `16b-CTX`: a static import is a direct module reference (never a host
      // binding), so a token imported from a tokens module is evaluable here.
      if (imports !== undefined && imports.byLocal.has(read.name)) continue;
      if (hostBindings.has(read.name) || hostBindings.has(read.binding.name)) return false;
      // Every remaining read becomes a host binding in `declareReads`; the
      // retained setup scope has no bindings channel.
      return false;
    }
  }
  return true;
}

/**
 * Compute the retention plan, or `null` when this module emits today's bytes
 * exactly (no eligible site, or a root-target reference).
 *
 * Depth-1 vs depth >= 2 is the SAME fixpoint with one more owner class: a site
 * is retention-eligible when its owner emits retain calls (the root, or a
 * retained component that itself retains children). The plan starts at the
 * greatest candidate set and demotes monotonically, so a component referenced
 * from BOTH a retaining body and a legacy/recipe/list body ends up legacy
 * everywhere (one body shape per component, no runtime probing), and the
 * transaction flag is true only when a retained child is itself a retaining
 * body. A depth-1 module therefore keeps its exact pre-change bytes.
 */
export function planRetention(
  module: FunctionModelModule,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  rootName: string | undefined,
): RetentionPlan | null {
  if (rootName === undefined || !componentByName.has(rootName)) return null;
  // B3b: any reference to the module root, anywhere (reachable body, recipe
  // body, dead component/recipe path) would call the retaining root body with
  // the LEGACY host record (no `instance`), so the whole module is emitted
  // legacy. Reachable root references that the mount-cycle guard refuses keep
  // their existing diagnostic, unchanged; this guard adds none.
  if (collectModuleRefSites(module, 'all').some((site) => site.node.name === rootName)) {
    return null;
  }
  const sites = collectModuleRefSites(module, 'emitted');
  const byTarget = new Map<string, RefSite[]>();
  for (const site of sites) {
    const list = byTarget.get(site.node.name);
    if (list === undefined) byTarget.set(site.node.name, [site]);
    else list.push(site);
  }
  const candidates = new Set<string>();
  for (const component of module.components) {
    if (component.name === rootName) continue;
    if (setupGatewayPasses(component, records, importContextOf(component))) {
      candidates.add(component.name);
    }
  }
  // Joint greatest fixpoint over two sets:
  //   - retained: non-root components whose body is the retained (leaf) shape;
  //   - retaining: bodies that emit retain calls (root + retained components
  //     whose own body references a retained child).
  // Both start maximal and only shrink, so the iteration terminates and the
  // largest valid plan wins. A target is demoted when ANY of its refs sits in
  // a recipe/list body, comes from an owner that is not root/retained, or comes
  // from an owner that is not a retainer (its body emits no ledger text).
  const retained = new Set(candidates);
  const retaining = new Set<string>([rootName, ...retained]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of [...retained]) {
      const targetSites = byTarget.get(name) ?? [];
      if (targetSites.length === 0) {
        retained.delete(name);
        retaining.delete(name);
        changed = true;
        continue;
      }
      const eligible = targetSites.every(
        (site) =>
          !site.inRecipe &&
          !site.inList &&
          retaining.has(site.owner) &&
          (site.owner === rootName || retained.has(site.owner)),
      );
      if (!eligible) {
        retained.delete(name);
        retaining.delete(name);
        changed = true;
      }
    }
    for (const name of [...retaining]) {
      if (name === rootName) continue;
      const ownsRetainedChild = sites.some(
        (site) =>
          site.owner === name && !site.inRecipe && !site.inList && retained.has(site.node.name),
      );
      if (!ownsRetainedChild) {
        retaining.delete(name);
        changed = true;
      }
    }
  }
  const retainedRefs = new Set<FunctionModelComponentRef>();
  for (const site of sites) {
    if (site.inRecipe || site.inList) continue;
    if (!retaining.has(site.owner)) continue;
    if (site.owner !== rootName && !retained.has(site.owner)) continue;
    if (retained.has(site.node.name)) retainedRefs.add(site.node);
  }
  if (retainedRefs.size === 0) return null;
  // The retaining bodies that actually carry a retained ref site (the fixpoint
  // above may leave a retained component in `retaining` only through a stale
  // maximal start; recompute from the selected sites).
  const retainingBodies = new Set<string>([rootName]);
  for (const site of sites) {
    if (!retainedRefs.has(site.node)) continue;
    if (retained.has(site.owner)) retainingBodies.add(site.owner);
  }
  const transaction = sites.some(
    (site) => retainedRefs.has(site.node) && retainingBodies.has(site.node.name),
  );
  const setupBodies = new Set<string>();
  for (const name of retained) {
    const component = componentByName.get(name)!;
    // A hook-bearing retained child needs its `<Name>__setup` factory even when
    // it has no setup local: the factory is the only carrier of its retained
    // connect callbacks + disposal registrations (same one factory as a setup
    // snapshot; no second engine).
    if (
      component.lifecycle.length > 0 ||
      component.contextProviders.length > 0 ||
      component.resources.some(
        (resource) =>
          (resource.kind === 'local' || resource.kind === 'ref' || resource.kind === 'context') &&
          resource.recipeId === null,
      )
    ) {
      setupBodies.add(name);
    }
  }
  return {
    rootName,
    retainedRefs,
    leafBodies: retained,
    setupBodies,
    retainingBodies,
    transaction,
  };
}

/** One `childrenRecipeId` projection edge (M06b2a mount-graph input). */
interface ChildrenProjectionEdge {
  /** The component whose mount projects the children recipe (the child). */
  readonly projectingComponent: string;
  /** The defining component whose recipe it is, and the recipe id. */
  readonly definingComponent: string;
  readonly recipeId: string;
  readonly span: IrSpan;
}

/**
 * Collect every `<Child>…</Child>` reference site in one component's roots: the
 * child mount will project that children recipe whenever `<Child>` itself
 * projects `props.children` (M06b2a). Used by `findMountCycle` to add the
 * conservative projection edge `c:<Child> -> r:<defining>:<childrenRecipeId>`,
 * so a component that projects the children of a reference back to itself is
 * refused instead of emitting an unbounded mount.
 */
function collectChildrenProjectionEdges(
  component: FunctionModelComponent,
  out: ChildrenProjectionEdge[],
): void {
  const walk = (nodes: readonly FunctionModelNode[]): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'component-ref':
          if (node.childrenRecipeId !== null) {
            out.push({
              projectingComponent: node.name,
              definingComponent: component.name,
              recipeId: node.childrenRecipeId,
              span: node.span,
            });
          }
          break;
        case 'element':
        case 'fragment':
          walk(node.children);
          break;
        case 'condition':
          walk(node.consequent);
          if (node.alternate !== null) walk(node.alternate);
          break;
        case 'list':
          walk(node.template);
          break;
        default:
          break;
      }
    }
  };
  walk(component.roots);
}

/** One component-local setup snapshot (M03 "evaluate once" resource). */
export interface SetupLocal {
  readonly name: string;
  /**
   * `local` is a snapshot evaluated once in the retained setup factory; `ref`
   * is a `16b-REF` NODE HANDLE the factory builds (one object for the whole
   * element lifetime) and the emitted `ref` channel drives.
   */
  readonly kind: 'local' | 'ref' | 'context' | 'host';
  /**
   * The record the factory evaluates for a `local`. For a `ref` this is the
   * OPTIONAL attach/detach notification callback (the same record the plain
   * `ref` channel admits), or `null` for a handle-only declaration.
   */
  readonly record: LoweredExpressionRecord | null;
  readonly span: SpanLike;
}

/**
 * The `16b-REF` handle expression the retained setup factory emits.
 *
 * A handle is a CALLABLE with one `current` field, which is exactly what the
 * existing intrinsic `ref` channel already accepts: the channel validates
 * `typeof handler === "function"`, calls it with the element on attach, keeps
 * the returned cleanup for detach, and calls it with `null` after that cleanup
 * ran. So the handle IS the channel value — the ref slice adds no sink kind, no
 * second attachment mechanism and no new cleanup ordering; it only makes the
 * handle survive mount/claim/reconnect by building it in the retained factory.
 *
 * Attach order: `current` is populated BEFORE the notification runs, so an
 * author callback observing the handle sees the node. Detach order is the
 * channel's existing one: the notification's cleanup runs first (while
 * `current` still names the node), then this handle is called with `null`,
 * which clears `current` and forwards `null` to the notification.
 */
export function emitSetupBinding(state: EmitState, local: SetupLocal): void {
  if (local.kind === 'local') {
    if (local.record === null) return;
    pushParts(state, [`const ${local.name} = (`, { record: local.record }, ');'], local.span);
    return;
  }
  if (local.kind === 'host') {
    // `16b-REF` / `useHost`: the owning element is ALREADY on the retained
    // setup factory's host record (the shell attaches it for the lifecycle env
    // form), so the lowering is one field read — no channel, no allocation and
    // no cleanup. The value never changes for an instance, which is why no
    // reactivity or lifetime work is needed here.
    push(state, `const ${local.name} = ${state.hostVar}.${HOST_ELEMENT_PROPERTY};`, local.span);
    return;
  }
  if (local.kind === 'context') {
    // `16b-CTX`: ONE persistent consumer-local signal per declaration. The
    // token record is the authored expression; the shell's context channel
    // builds the signal and starts the bridge on connect. This is the reactive
    // counterpart of the `ref` handle: a tracked slot reading `.value` is a
    // real dependency, which is why no read-position gate exists for it.
    if (local.record === null) return;
    pushParts(
      state,
      [
        `const ${local.name} = ${GENERATED_CONTEXT_SCOPE_RECORD}.use((`,
        { record: local.record },
        '));',
      ],
      local.span,
    );
    return;
  }
  const handle = local.name;
  // The `current` seed and the two writes live in the closure; the notification
  // (if any) is the ONE authored record, passed in verbatim.
  const tail = ` fn.current = null; return fn; })();`;
  if (local.record === null) {
    pushParts(
      state,
      [`const ${handle} = (() => { const fn = (element) => { fn.current = element; };${tail}`],
      local.span,
    );
    return;
  }
  pushParts(
    state,
    [
      `const ${handle} = (() => { const notify = (`,
      { record: local.record },
      `); const fn = (element) => { fn.current = element; return notify(element); };${tail}`,
    ],
    local.span,
  );
}

/**
 * `16b-CTX` — emit this component's provider registrations into a retained setup
 * factory.
 *
 * Each admitted `provideContext(token, () => value)` becomes ONE registration on
 * this component's OWNER scope. The owner expression is the channel itself for a
 * generated element ROOT (so a root provider covers every depth-1 child) and
 * `host.<channel>.owner()` for a nested hostless component (so siblings are
 * isolated from each other while both still see the element's ancestors). The
 * thunk is emitted verbatim: the VALUE is re-read on connect and after every
 * declared-property commit — the lane's one change channel — instead of being
 * snapshotted here.
 *
 * `nested` is the placement fact, decided by the same rule that carries the
 * lifecycle hooks (root setup vs retained depth-1 child setup).
 */
export function emitContextProviders(
  state: EmitState,
  providers: readonly FunctionModelContextProvider[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): void {
  for (const provider of providers) {
    const token = recordFor(state, provider.token, records);
    const value = recordFor(state, provider.value, records);
    if (token === null || value === null) continue;
    if (!declareReads(state, token)) continue;
    if (!declareReads(state, value)) continue;
    pushParts(
      state,
      [
        `${GENERATED_CONTEXT_SCOPE_RECORD}.provider((`,
        { record: token },
        '), (',
        { record: value },
        '));',
      ],
      provider.span,
    );
  }
}

/**
 * `16b-CTX` — emit the component's owner-scope declaration into a retained setup
 * factory.
 *
 * The ROOT owns the element anchor. Every other component is a hostless owner,
 * so its scope is `anchor.owner()` — a child of the anchor. Two sibling hostless
 * children therefore get two distinct scopes and cannot see each other's
 * providers, while both still resolve the element's ancestors, which is exactly
 * the ADR-0182 "nearest owning component, hostless owners included" rule.
 *
 * The declaration is emitted only for a component that uses a context intrinsic,
 * so every other component's bytes are unchanged.
 */
export function emitContextScopeDeclaration(
  state: EmitState,
  component: FunctionModelComponent,
  nested: boolean,
): void {
  if (!componentUsesContextIntrinsic(component)) return;
  const channel = `${MOUNT_HOST}.${CONTEXT_SCOPE_PROPERTY}`;
  const expression = nested ? `${channel}.owner()` : channel;
  push(state, `const ${GENERATED_CONTEXT_SCOPE_RECORD} = ${expression};`, component.span);
}

/** Does one component itself use `provideContext` or `useContext`? */
export function componentUsesContextIntrinsic(component: FunctionModelComponent): boolean {
  return (
    component.contextProviders.length > 0 ||
    component.resources.some((resource) => resource.kind === 'context')
  );
}

/**
 * `16b-CTX` SERVER side — declare this producer call's owner scope.
 *
 * The scope arrives as a PARAMETER (`__oe_ssrContext`) when an enclosing
 * component reference supplies one, and is created fresh otherwise:
 *
 * - a MODULE ROOT producer (called by the host wrapper or the light serializer
 *   with no scope) creates the render's anchor — one per producer call, so two
 *   concurrent renders are independent and no request value lives in module
 *   state;
 * - a NESTED producer joins the caller as `anchor.owner()`, which is the exact
 *   server image of the client's depth-1 hostless owner: a child provider is
 *   invisible to the caller's other children while the child still resolves the
 *   anchor's providers.
 *
 * The `undefined` guard keeps a hand-written or older caller working: a producer
 * invoked without a scope behaves as the root of its own render rather than
 * reading provider state that does not exist.
 */
export function emitSsrContextScope(state: EmitState): void {
  // ONE spelling for both owner shapes, because the parameter is supplied by
  // exactly one kind of caller — a component reference rendering this component
  // as its child. With no scope this producer IS a module root and creates the
  // render's anchor; with a scope it joins that anchor as `owner()`, the server
  // image of the client's depth-1 hostless owner.
  push(
    state,
    `const ${GENERATED_CONTEXT_SCOPE_RECORD} = ${SSR_CONTEXT_PARAM} === undefined ? createRenderContextScope() : ${SSR_CONTEXT_PARAM}.owner();`,
  );
}

/**
 * `16b-CTX` SERVER side — does this component's producer need a render scope at
 * all? True when the component itself uses a context intrinsic, or when it
 * renders a component reference whose own producer does (the scope must be
 * threaded down as an argument, never read from module state).
 *
 * A component that neither provides, consumes nor references a scope-using
 * child keeps its exact pre-`16b-CTX` producer bytes: no parameter, no import,
 * no declaration.
 */
export function componentNeedsSsrContextScope(
  component: FunctionModelComponent,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
): boolean {
  return ssrScopeNeed(component, componentByName, new Set());
}

function ssrScopeNeed(
  component: FunctionModelComponent,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
  stack: Set<string>,
): boolean {
  if (componentUsesContextIntrinsic(component)) return true;
  if (stack.has(component.name)) return false;
  stack.add(component.name);
  try {
    return ssrScopeNeedInNodes(component.roots, component, componentByName, stack);
  } finally {
    stack.delete(component.name);
  }
}

function ssrScopeNeedInNodes(
  nodes: readonly FunctionModelNode[],
  component: FunctionModelComponent,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
  stack: Set<string>,
): boolean {
  const recipes = recipeMap(component);
  const walk = (list: readonly FunctionModelNode[]): boolean => {
    for (const node of list) {
      if (node.kind === 'fragment' || node.kind === 'element') {
        if (walk(node.children)) return true;
        continue;
      }
      if (node.kind === 'condition') {
        if (walk(node.consequent)) return true;
        if (node.alternate !== null && walk(node.alternate)) return true;
        continue;
      }
      if (node.kind === 'list') {
        if (walk(node.template)) return true;
        continue;
      }
      if (node.kind === 'component-ref') {
        const target = componentByName.get(node.name);
        if (target !== undefined && ssrScopeNeed(target, componentByName, stack)) return true;
        if (node.childrenRecipeId !== null) {
          const recipe = recipes.get(node.childrenRecipeId);
          if (recipe !== undefined && walk([recipe.target])) return true;
        }
        continue;
      }
      if (node.kind === 'insertion-site') {
        const recipe = recipes.get(node.recipeId);
        if (recipe !== undefined && walk([recipe.target])) return true;
      }
    }
    return false;
  };
  return walk(nodes);
}

/**
 * One admitted `16b-LC` lifecycle intrinsic callback after read classification.
 * `kind` mirrors the frontend model; `record` is the lowered (type-erased)
 * callback expression the factory emits verbatim as an ordinary closure.
 */
export interface AdmittedLifecycleHook {
  readonly kind: 'connect' | 'dispose' | 'property-change' | 'error';
  readonly record: LoweredExpressionRecord;
  /** `true` when the authored callback declares the one admitted env parameter. */
  readonly receivesEnv: boolean;
  readonly span: SpanLike;
}

/**
 * The retained-setup alias prologue (T3 / 16b-LC-1 for the root, 16b-LC retained-child for a
 * leaf instance body).
 *
 * One body shape per component: a body that must NOT re-evaluate its setup
 * reads each setup name from the retained record by OWN-PROPERTY presence
 * instead of re-running the authored initializer. The ROOT body aliases
 * `host.bindings` (the shell's `ensureInstance` publishes it before the recipe
 * is created); a LEAF instance body aliases the compiler-private
 * `host.setup` property of the child host literal its retaining reference site
 * built. Presence, not value, is checked: a setup value that legitimately is
 * `undefined` is retained. A missing key is the coded leaf missing-value
 * failure, thrown before any claim write — the same fail-closed identity the
 * host-binding helper uses for an absent binding.
 */
export function emitSetupAlias(
  state: EmitState,
  localLines: readonly SetupLocal[],
  hostProperty: string,
): void {
  push(state, `const ${ROOT_SETUP_RECORD} = ${state.hostVar}.${hostProperty} ?? {};`);
  push(
    state,
    `const ${ROOT_SETUP_REQUIRE} = (name) => { if (!Object.hasOwn(${ROOT_SETUP_RECORD}, name)) throw new Error("OEIR_LEAF_MISSING_VALUE: " + name); return ${ROOT_SETUP_RECORD}[name]; };`,
  );
  // `16b-CTX`: the retained record carries this component's OWNER SCOPE, so the
  // mount/claim body resolves consumers against the same owner a reconnect
  // would. Emitted only for a component that uses a context intrinsic.
  if (componentUsesContextIntrinsic(state.component)) {
    push(
      state,
      `const ${GENERATED_CONTEXT_SCOPE_RECORD} = ${ROOT_SETUP_REQUIRE}(${JSON.stringify(GENERATED_CONTEXT_SCOPE_RECORD)});`,
    );
  }
  for (const line of localLines) {
    push(state, `const ${line.name} = ${ROOT_SETUP_REQUIRE}(${JSON.stringify(line.name)});`);
  }
}

/**
 * `16b-LC` option 1a — replay the retained `onConnect` callbacks on the
 * per-connection scope of the ROOT body that is about to mount or claim.
 *
 * The callbacks were lowered into the compiler-owned
 * `__oe_rootInstance`/`<Name>__setup` factory and carried by the retained instance record, so
 * replaying here never repeats setup. Each callback's optional returned cleanup
 * is registered on the SAME per-connection scope the projection owns, so the
 * shell's existing disconnect/rollback disposal releases it (LIFO, first error
 * surfaced after every cleanup was attempted). Nothing here is a second
 * lifecycle engine: mount and claim call the one retained list, and the
 * intrinsic itself never reaches the emitted module.
 *
 * A throwing callback stops the replay and propagates into the shell's existing
 * connect catch: the projection/connection rollback disposes the entries the
 * earlier callbacks already registered, then the original error surfaces.
 * Absence of the key is the hand-built-descriptor / hook-free shape and is a
 * no-op (never a fabricated subscription).
 */
export function emitLifecycleReplay(hostRecordProperty: 'bindings' | 'setup'): string[] {
  return [
    `  const ${LIFECYCLE_HOOKS_VAR} = ${MOUNT_HOST}.${hostRecordProperty}.${GENERATED_ROOT_CONNECT_RECORD};`,
    `  if (${LIFECYCLE_HOOKS_VAR} !== undefined) {`,
    `    for (const ${LIFECYCLE_HOOK_VAR} of ${LIFECYCLE_HOOKS_VAR}) {`,
    `      const ${LIFECYCLE_CLEANUP_VAR} = ${LIFECYCLE_HOOK_VAR}();`,
    `      if (typeof ${LIFECYCLE_CLEANUP_VAR} === "function") ${MOUNT_SCOPE}.add(${LIFECYCLE_CLEANUP_VAR});`,
    '    }',
    '  }',
  ];
}

/**
 * `16b-LC` option 1a, env form — replay the retained `onConnect(env)` callbacks
 * on the per-connection scope of the body that is about to mount or claim.
 *
 * The env argument is built HERE, from data the body already has: the host
 * element the shell attached to the host record (runtime property; no exported
 * type change) and the per-connection scope's own `signal`. `LifetimeScope`
 * aborts that signal at the FIRST step of `dispose()`, before children and
 * before any registered cleanup, so a cleanup that runs at disconnect observes
 * an aborted signal. Each returned cleanup registers on the same scope, exactly
 * like the zero-argument form. The env form has its own retained record and its
 * own replay lines, so a module whose callbacks are all zero-argument keeps its
 * exact pre-env bytes.
 */
export function emitLifecycleEnvReplay(hostRecordProperty: 'bindings' | 'setup'): string[] {
  return [
    `  const ${LIFECYCLE_ENV_HOOKS_VAR} = ${MOUNT_HOST}.${hostRecordProperty}.${GENERATED_ROOT_CONNECT_ENV_RECORD};`,
    `  if (${LIFECYCLE_ENV_HOOKS_VAR} !== undefined) {`,
    `    for (const ${LIFECYCLE_ENV_HOOK_VAR} of ${LIFECYCLE_ENV_HOOKS_VAR}) {`,
    `      const ${LIFECYCLE_ENV_CLEANUP_VAR} = ${LIFECYCLE_ENV_HOOK_VAR}({ host: ${MOUNT_HOST}.${HOST_ELEMENT_PROPERTY}, signal: ${MOUNT_SCOPE}.signal, states: ${MOUNT_HOST}.${STATES_PROPERTY} });`,
    `      if (typeof ${LIFECYCLE_ENV_CLEANUP_VAR} === "function") ${MOUNT_SCOPE}.add(${LIFECYCLE_ENV_CLEANUP_VAR});`,
    '    }',
    '  }',
  ];
}

/**
 * Emit `<Name>__claim` for a claimable component. Returns null when the shape
 * is outside the admitted claim slice; the caller then leaves the recipe mount-only.
 */
/**
 * The depth >= 2 transaction-token field a retained child body joins with, as a
 * fragment of its compiler-private host literal. A target that retains no
 * children gets no field, so every depth-1 host literal keeps its exact bytes.
 * The root body threads its own captured token; a retained body forwards the
 * one it received.
 */
export function retainedTransactionField(state: EmitState, target: string): string {
  if (state.retention?.retainingBodies.has(target) !== true) return '';
  return `, txn: ${state.retainBody ? TRANSACTION_VAR : `${state.hostVar}.txn`}`;
}

/**
 * 16b-LC depth >= 2 (2026-11-21): a retained body that retains its own children
 * joins the root attempt's transaction before any retain call. The token arrives
 * in the compiler-private host literal (`host.txn`); a hand-built fixture host
 * without one emits nothing (such a body would then be legacy-shaped and has no
 * retain calls to coordinate).
 */
export function emitJoinTransaction(state: EmitState): void {
  if (!state.leafBody || !state.retainsChildren) return;
  push(state, `const ${TRANSACTION_VAR} = ${MOUNT_HOST}.txn;`);
  push(
    state,
    `if (${TRANSACTION_VAR} !== undefined) joinInstancePass(${MOUNT_HOST}.instance, ${TRANSACTION_VAR});`,
  );
}

/**
 * One directed mount edge in the module's mount graph: a component instance or
 * a reusable-JSX recipe instance can call another mount at instance time. Nodes
 * are addressed by keys: `c:<Component>` for a component chunk and
 * `r:<Component>:<recipeId>` for a recipe of that component.
 */
interface MountEdge {
  readonly to: string;
  readonly span: IrSpan;
}

/** Collect every mount edge under one node tree, in authored order. */
function collectMountEdges(
  component: FunctionModelComponent,
  nodes: readonly FunctionModelNode[],
  edges: MountEdge[],
): void {
  for (const node of nodes) {
    switch (node.kind) {
      case 'component-ref':
        edges.push({ to: `c:${node.name}`, span: node.span });
        break;
      case 'insertion-site':
        edges.push({ to: `r:${component.name}:${node.recipeId}`, span: node.span });
        break;
      case 'element':
      case 'fragment':
        collectMountEdges(component, node.children, edges);
        break;
      case 'condition':
        collectMountEdges(component, node.consequent, edges);
        if (node.alternate !== null) collectMountEdges(component, node.alternate, edges);
        break;
      case 'list':
        collectMountEdges(component, node.template, edges);
        break;
      default:
        // text / dynamic-text carry no mount edges. A children projection is
        // also not an edge here: the child mount does not know statically which
        // reference site supplied its recipe, so `findMountCycle` adds that
        // (conservative) projection edge separately (M06b2a).
        break;
    }
  }
}

/**
 * Fail closed on mount cycles (M06b1a-2 extends the M06b1a-1 component-cycle
 * DFS): a component reference and a reusable-JSX recipe both mount another
 * mount at instance time, so a cycle would emit self-recursive mounts (unbounded
 * recursion). Recipe targets are walked because a recipe can mount a component,
 * and recipe bodies can insert another recipe. Children recipes (M06b2a) are
 * component recipes too, so their target edges are already in the graph; the
 * projection edge from the child component to the recipe is added conservatively
 * (see the children-projection pass below) because only the runtime instance
 * knows which reference site supplied its `props.children`. The first cycle in
 * authored order is reported with its path and the closing edge's span; a cycle
 * that passes through a recipe node gets `OEIR_LEAF_RECIPE_CYCLE`, a pure
 * component-reference cycle keeps `OEIR_LEAF_COMPONENT_CYCLE`.
 */
export function findMountCycle(module: FunctionModelModule): IrDiagnostic | null {
  const edges = new Map<string, MountEdge[]>();
  const labels = new Map<string, string>();
  const addNode = (key: string, label: string, collected: MountEdge[]): void => {
    labels.set(key, label);
    edges.set(key, collected);
  };
  for (const component of module.components) {
    const componentEdges: MountEdge[] = [];
    collectMountEdges(component, component.roots, componentEdges);
    addNode(`c:${component.name}`, component.name, componentEdges);
    for (const recipe of component.recipes) {
      const recipeEdges: MountEdge[] = [];
      collectMountEdges(component, [recipe.target], recipeEdges);
      addNode(`r:${component.name}:${recipe.id}`, `${component.name}${recipe.id}`, recipeEdges);
    }
  }
  // Children-projection edges (M06b2a): a component that projects
  // `props.children` mounts the recipe supplied by whichever reference site
  // created its instance; the instance cannot know that statically, so every
  // `<Child>…</Child>` site whose `<Child>` projects children contributes the
  // conservative edge `c:<Child> -> r:<Definer>:<childrenRecipeId>`. This is what
  // refuses a component that projects the children of a reference back into
  // itself (an unbounded mount, not just a static recursion).
  const projectsChildrenByName = new Map(
    module.components.map(
      (component) => [component.name, componentProjectsChildren(component)] as const,
    ),
  );
  for (const component of module.components) {
    const projectionEdges: ChildrenProjectionEdge[] = [];
    collectChildrenProjectionEdges(component, projectionEdges);
    for (const edge of projectionEdges) {
      if (projectsChildrenByName.get(edge.projectingComponent) !== true) continue;
      const fromEdges = edges.get(`c:${edge.projectingComponent}`);
      const toKey = `r:${edge.definingComponent}:${edge.recipeId}`;
      if (fromEdges === undefined || !edges.has(toKey)) continue;
      fromEdges.push({ to: toKey, span: edge.span });
    }
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const path: string[] = [];
  const visit = (key: string): IrDiagnostic | null => {
    color.set(key, GRAY);
    path.push(key);
    for (const edge of edges.get(key) ?? []) {
      // Unknown/external component targets have no node here and fail closed on
      // their own during emission.
      if (!edges.has(edge.to)) continue;
      const targetColor = color.get(edge.to) ?? WHITE;
      if (targetColor === GRAY) {
        const cycleKeys = path.slice(path.indexOf(edge.to));
        const recipeCycle =
          cycleKeys.some((entry) => entry.startsWith('r:')) || edge.to.startsWith('r:');
        const cycle = [...cycleKeys, edge.to]
          .map((entry) => labels.get(entry) ?? entry)
          .join(' -> ');
        return {
          severity: 'error',
          code: recipeCycle ? 'OEIR_LEAF_RECIPE_CYCLE' : 'OEIR_LEAF_COMPONENT_CYCLE',
          message: recipeCycle
            ? `recipe insertion cycle: ${cycle}`
            : `component reference cycle: ${cycle}`,
          span: edge.span,
          origin: 'ir-object',
        };
      }
      if (targetColor === WHITE) {
        const found = visit(edge.to);
        if (found !== null) return found;
      }
    }
    path.pop();
    color.set(key, BLACK);
    return null;
  };
  for (const component of module.components) {
    const key = `c:${component.name}`;
    if ((color.get(key) ?? WHITE) !== WHITE) continue;
    const found = visit(key);
    if (found !== null) return found;
  }
  return null;
}
