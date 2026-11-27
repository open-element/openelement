/** Compose the generated entry points for each component. */

import { type IrDiagnostic } from '../types.ts';
import { type EmissionSegment } from '../../semantic-core/source-map.ts';
import { type FunctionModelComponent } from '../../semantic-core/function-frontend.ts';
import { type LoweredExpressionRecord } from '../../semantic-core/expression-registry.ts';
import {
  type ExpressionPlacement,
  type RetentionPlan,
  type EmitState,
  MOUNT_SCOPE,
  MOUNT_HOST,
  INTERNAL_PREFIX,
  IDENTIFIER_PATTERN,
  diag,
  recordFor,
  declareReads,
  toIrSpan,
  pushParts,
  push,
  fragmentLineCount,
  MOUNT_PROPS,
  TRANSACTION_VAR,
  MOUNT_SUFFIX,
  moduleUsesErrorBoundary,
  ERROR_REPORT_PROPERTY,
  CLAIM_SUFFIX,
} from './emission.ts';
import {
  componentProjectsChildren,
  componentClaimable,
  textSlotOrdinals,
  assertTextBoundaryContext,
  staticElementDirectory,
  emissionNodes,
} from './structure.ts';
import {
  type SetupLocal,
  componentUsesContextIntrinsic,
  type AdmittedLifecycleHook,
  GENERATED_ROOT_INSTANCE_NAME,
  GENERATED_ROOT_CONNECT_RECORD,
  ROOT_SETUP_RECORD,
  ROOT_SETUP_REQUIRE,
  emitContextScopeDeclaration,
  emitContextProviders,
  emitSetupBinding,
  GENERATED_ROOT_CONNECT_ENV_RECORD,
  TEARDOWN_SIGNAL_VAR,
  HOST_ELEMENT_PROPERTY,
  STATES_PROPERTY,
  PROPERTY_CHANGE_PROPERTY,
  ERROR_HANDLER_PROPERTY,
  GENERATED_CONTEXT_SCOPE_RECORD,
  LEAF_SETUP_SUFFIX,
  emitSetupAlias,
  ROOT_SETUP_HOST_PROPERTY,
  LEAF_SETUP_HOST_PROPERTY,
  emitJoinTransaction,
  emitLifecycleReplay,
  emitLifecycleEnvReplay,
  moduleUsesLifecycleEnv,
  moduleUsesHostAccess,
  moduleUsesPropertyChange,
  moduleUsesContext,
  CONTEXT_SCOPE_PROPERTY,
} from './instance-emission.ts';
import {
  emitRecipes,
  emitMountedDirectory,
  type SinkEntry,
  emitNode,
  appendSinkToArray,
} from './mount-emission.ts';
import { emitClaimFunction } from './claim-emission.ts';
import { emitSsrFunction } from './server-emission.ts';

interface EmittedComponent {
  readonly lines: string[];
  readonly diagnostics: readonly IrDiagnostic[];
  readonly requiredBindings: readonly string[];
  readonly requiredProps: readonly string[];
  readonly requiresPropsChanged: boolean;
  readonly segments: readonly EmissionSegment[];
  readonly placements: readonly ExpressionPlacement[];
  /** The emitted root setup factory name, or null for a non-root/no-setup chunk. */
  readonly rootInstanceFactory: string | null;
  /** True when this component's generated claim calls the directory consumer. */
  readonly usesStaticSiblingDirectoryConsumer?: boolean;
  /** True when this component's generated claim calls `claimRecipe`. */
  readonly usesClaimRecipe?: boolean;
  /** True when the emitted recipe carries the captured claim body. */
  readonly hasClaim?: boolean;
  /** True when the emitted claim throws the leaf mismatch. */
  readonly usesLeafClaimMismatch?: boolean;
}

interface SetupFactoryStep {
  readonly order: number;
  readonly emit: () => void;
}

function emitDisposeHook(state: EmitState, hook: AdmittedLifecycleHook): void {
  if (hook.receivesEnv) {
    pushParts(
      state,
      [
        `${INTERNAL_PREFIX}owner.add(() => (`,
        { record: hook.record },
        `)({ host: ${MOUNT_HOST}.${HOST_ELEMENT_PROPERTY}, signal: ${TEARDOWN_SIGNAL_VAR}, states: ${MOUNT_HOST}.${STATES_PROPERTY} }));`,
      ],
      hook.span,
    );
    return;
  }
  pushParts(state, [`${INTERNAL_PREFIX}owner.add((`, { record: hook.record }, '));'], hook.span);
}

function prepareDisposeHooks(state: EmitState, hooks: readonly AdmittedLifecycleHook[]): void {
  if (hooks.some((hook) => hook.receivesEnv)) {
    push(state, `const ${TEARDOWN_SIGNAL_VAR} = ${INTERNAL_PREFIX}owner.signal;`);
  }
}

function setupOrder(span: { readonly line: number; readonly column: number }): number {
  return span.line * 100_000 + span.column;
}

/** Register a disposer before any later initializer that might throw. */
function emitSetupSteps(
  state: EmitState,
  declarations: readonly SetupFactoryStep[],
  hooks: readonly AdmittedLifecycleHook[],
): readonly AdmittedLifecycleHook[] {
  const last = declarations.at(-1);
  if (last === undefined || hooks.every((hook) => setupOrder(hook.span) >= last.order)) {
    for (const declaration of declarations) declaration.emit();
    return hooks;
  }
  prepareDisposeHooks(state, hooks);
  const steps = [
    ...declarations,
    ...hooks.map((hook) => ({
      order: setupOrder(hook.span),
      emit: () => emitDisposeHook(state, hook),
    })),
  ];
  steps.sort((left, right) => left.order - right.order);
  for (const step of steps) step.emit();
  return [];
}

export function emitComponent(
  file: string,
  component: FunctionModelComponent,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
  sharedClaimCursor: boolean,
  rootInstance: string | undefined,
  retention: RetentionPlan | null,
  claimStyleLinkPrefix: boolean,
  lightRoot: boolean,
): EmittedComponent {
  const propsName = component.propsParam;
  const projectsChildren = componentProjectsChildren(component);
  const declaredRecipeIds = new Set<string>();
  const recipeNames = new Set<string>();
  for (const resource of component.resources) {
    if (resource.recipeId === null) continue;
    declaredRecipeIds.add(resource.recipeId);
    recipeNames.add(resource.name);
  }
  const claimable = componentClaimable(component, {
    componentByName,
    stack: new Set(),
  });
  const state: EmitState = {
    component,
    lines: [],
    physicalLine: 0,
    indent: 1,
    diagnostics: [],
    requiredBindings: new Set(),
    requiredProps: new Set(),
    hostBindings: new Set(),
    localResources: new Set(),
    counter: { value: 0 },
    propsName,
    requiresPropsChanged: false,
    segments: [],
    placements: [],
    segmentKeys: new Set(),
    scopeVar: MOUNT_SCOPE,
    hostVar: MOUNT_HOST,
    componentByName,
    declaredRecipeIds,
    recipeNames,
    recipeVars: new Map(),
    entryNames: new Set(),
    refreshStack: [],
    listDepth: 0,
    recipeDepth: 0,
    childrenRecipeVar: projectsChildren ? `${INTERNAL_PREFIX}childrenRecipe` : null,
    ssrRecipeVars: new Map(),
    ssrChildrenRenderVar: null,
    directorySource: `${file}#${component.name}`,
    usesStaticSiblingDirectoryConsumer: false,
    claimCursorShared: false,
    claimStyleLinkPrefix: false,
    claimAdoptedVar: null,
    claimActivationVar: null,
    usesClaimRecipe: false,
    emitDirectoryMarkers: claimable,
    emitTextBoundaries: claimable,
    textOrdinals: textSlotOrdinals(component.roots),
    claimEntry: null,
    usesLeafClaimMismatch: false,
    retention,
    retainBody: retention !== null && retention.rootName === component.name,
    leafBody: retention?.leafBodies.has(component.name) === true,
    retainsChildren: retention?.retainingBodies.has(component.name) === true,
    claimTimeRecipeDepth: 0,
  };
  if (claimable && !assertTextBoundaryContext(state, component.roots)) {
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      rootInstanceFactory: null,
      segments: [],
      placements: [],
    };
  }
  if (
    propsName !== null &&
    (!IDENTIFIER_PATTERN.test(propsName) || propsName.startsWith(INTERNAL_PREFIX))
  ) {
    diag(state, 'OEIR_LEAF_INVALID_BINDING', `props parameter '${propsName}' is not usable`, {
      file,
      start: 0,
      end: 0,
      line: 1,
      column: 1,
    });
  }
  // Resources: signal/computed names are host bindings; local snapshots are
  // evaluated inside the mount (setup mode), preserving M03 semantics. For the
  // root they move into the `__oe_rootInstance` factory (T3 / 16b-LC-1).
  const localLines: SetupLocal[] = [];
  for (const resource of component.resources) {
    if (!IDENTIFIER_PATTERN.test(resource.name) || resource.name.startsWith(INTERNAL_PREFIX)) {
      diag(
        state,
        'OEIR_LEAF_INVALID_BINDING',
        `resource '${resource.name}' is not usable`,
        resource.span,
      );
      continue;
    }
    if (resource.kind === 'ref') {
      // `16b-REF`: a handle is a compiler-owned value, not a lowered snapshot;
      // only its OPTIONAL notification record needs read classification. A
      // DECLARED notification that cannot be resolved fails closed through
      // `recordFor`'s own diagnostic — it never silently degrades to the
      // handle-only form, which would drop the author's callback.
      if (resource.expression === null) {
        localLines.push({ name: resource.name, kind: 'ref', record: null, span: resource.span });
        continue;
      }
      const record = recordFor(state, resource.expression, records);
      if (record === null || !declareReads(state, record)) continue;
      state.localResources.add(resource.name);
      localLines.push({ name: resource.name, kind: 'ref', record, span: resource.span });
      continue;
    }
    if (resource.kind === 'host') {
      // `16b-REF` / `useHost`: the owning element is a host-record field the
      // retained factory reads — no lowered expression and no read
      // classification, and deliberately NOT a host binding (a binding lookup
      // would demand the name from the module's `bindings` channel, which is a
      // different thing entirely).
      state.localResources.add(resource.name);
      localLines.push({ name: resource.name, kind: 'host', record: null, span: resource.span });
      continue;
    }
    if (resource.kind === 'context') {
      // `16b-CTX`: the consumer signal is built by the retained factory, so a
      // reconnect writes into the SAME object. Only the TOKEN expression needs
      // read classification here.
      if (resource.expression === null) continue;
      const record = recordFor(state, resource.expression, records);
      if (record === null || !declareReads(state, record)) continue;
      state.localResources.add(resource.name);
      localLines.push({ name: resource.name, kind: 'context', record, span: resource.span });
      continue;
    }
    if (resource.kind === 'local') {
      // A reusable JSX value has no lowered initializer: its recipe is emitted
      // by `emitRecipes` only when at least one insertion site references it.
      if (resource.recipeId !== null || resource.expression === null) continue;
      const record = recordFor(state, resource.expression, records);
      if (record === null) continue;
      if (!declareReads(state, record)) continue;
      state.localResources.add(resource.name);
      localLines.push({ name: resource.name, kind: 'local', record, span: resource.span });
      continue;
    }
    state.hostBindings.add(resource.name);
    state.requiredBindings.add(resource.name);
  }
  if (state.diagnostics.length > 0) {
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      rootInstanceFactory: null,
      segments: [],
      placements: [],
    };
  }
  if (!IDENTIFIER_PATTERN.test(component.name) || component.name.startsWith(INTERNAL_PREFIX)) {
    diag(
      state,
      'OEIR_LEAF_INVALID_COMPONENT',
      `component '${component.name}' is not usable`,
      component.span,
    );
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      rootInstanceFactory: null,
      segments: [],
      placements: [],
    };
  }

  // `16b-LC` nested/hostless depth-1: the frontend admits the intrinsics
  // MODULE-WIDE; THIS emitter owns placement. One callback is an ordinary
  // lowered expression classified against the SAME state the setup locals use:
  // a setup local is a closure capture, `props` stays the live frozen props
  // record, builtin globals stay direct. A read the retained setup scope cannot
  // satisfy (host binding) keeps the existing `UNBOUND_BINDING` identity: the
  // read is declared, the module gate refuses, and no factory is emitted with a
  // name it cannot receive.
  //
  // A callback is carried by exactly two body shapes:
  //   - the generated element ROOT setup (unchanged bytes), or
  //   - a DEPTH-1 retained hostless child setup body (`leafBody` plus the same
  //     component marked a setup body by the retention plan).
  // Depth>=2, a reusable JSX/list body and a non-retained target have no
  // connection/disposal owner; they fail closed at the AUTHORED span instead of
  // silently dropping the author's work.
  // ADR-0183 D-4: the ROOT's `signal`/`computed` resources are CREATED by the
  // retained setup factory (`__oe_rootInstance`) and returned in its record, so
  // they are that factory's sibling locals rather than a demand on the shell.
  // A lifecycle hook carried by the SAME factory therefore reads them as
  // closure captures.
  //
  // This set is load-bearing, not an optimisation: the resource loop above has
  // already put every signal name in `state.hostBindings` (mount/claim resolve
  // them through the retained bindings record, which is correct for those
  // bodies), so without it `hookReadsHostBinding` classified the hook's read as
  // a host binding and the gate below skipped the callback SILENTLY — no
  // diagnostic, no emitted hook. A hook that read a root signal was therefore
  // dead code with a green build. The mount/claim bodies keep their own
  // `declareReads` calls and still declare the binding, so the two phases stay
  // one fact with two legitimate carriers.
  const rootBindingResources =
    rootInstance === component.name
      ? component.resources.filter(
          (resource) =>
            (resource.kind === 'signal' || resource.kind === 'computed') &&
            resource.expression !== null,
        )
      : [];
  const rootBindingNames = new Set(rootBindingResources.map((resource) => resource.name));
  const rootSetupCaptures = rootBindingNames;
  // The SAME fact `declareReads` just recorded: a read it turned into a host
  // binding cannot be satisfied by the retained setup factory (no bindings
  // channel there), so the hook is NOT admitted here and the module gate keeps
  // the existing `UNBOUND_BINDING` identity. Imports/module globals/local setup
  // reads are declared as their normal scope and stay admitted exactly as the
  // root hooks were before this slice.
  const hookReadsHostBinding = (record: LoweredExpressionRecord): boolean =>
    record.reads.some(
      (read) =>
        !rootSetupCaptures.has(read.name) &&
        !rootSetupCaptures.has(read.binding.name) &&
        (state.hostBindings.has(read.name) ||
          state.hostBindings.has(read.binding.name) ||
          state.requiredBindings.has(read.name) ||
          state.requiredBindings.has(read.binding.name)),
    );
  // `16b-CTX`: a context intrinsic needs an OWNER SCOPE, and this lane's owner
  // scopes exist at exactly two places — the generated element ROOT setup and a
  // DEPTH-1 retained hostless child setup (the same carry rule as the lifecycle
  // hooks, because both are carried by the same retained instance factory).
  // Depth >= 2, a reusable JSX/list body and a non-retained target have no owner
  // scope, so they fail closed at the AUTHORED span instead of emitting a
  // reference to a channel nothing supplied. Depth >= 2 retention is OWED by
  // ADR-0181 and is not implied here.
  const carriedByOwner =
    rootInstance === component.name ||
    (state.leafBody && state.retention?.setupBodies.has(component.name) === true);
  if (componentUsesContextIntrinsic(component) && !carriedByOwner) {
    const span = componentUsesContextIntrinsic(component)
      ? (component.contextProviders[0]?.span ??
        component.resources.find((resource) => resource.kind === 'context')?.span ??
        component.span)
      : component.span;
    diag(
      state,
      'OEIR_LEAF_INVALID_ARTIFACT',
      'a context intrinsic needs an owner scope: context is carried only by the generated element ' +
        'ROOT setup or a RETAINED hostless body setup (any depth, direct hostless references ' +
        'only); recipe/list bodies and a component no retained body references fail closed',
      toIrSpan({ id: 'context', mode: 'setup', span }),
    );
  }

  const admittedHooks: AdmittedLifecycleHook[] = [];
  for (const hook of component.lifecycle) {
    const record = recordFor(state, hook.callback, records);
    // The root setup factory's own signal/computed locals are sibling closure
    // captures for a hook it carries; they are NOT host bindings there. The
    // mount/claim bodies keep demanding them through the bindings record.
    if (record === null || !declareReads(state, record, rootSetupCaptures)) continue;
    if (hookReadsHostBinding(record)) continue;
    const carriedByRoot = rootInstance === component.name;
    const carriedByLeaf =
      state.leafBody && state.retention?.setupBodies.has(component.name) === true;
    if (!carriedByRoot && !carriedByLeaf) {
      diag(
        state,
        'OEIR_LEAF_INVALID_ARTIFACT',
        `the '${hook.kind}' lifecycle hook has no lifecycle owner: nested hooks are carried ` +
          'only by a RETAINED hostless body setup (any depth, direct hostless references only); ' +
          'recipe/list bodies and a component no retained body references fail closed',
        hook.span,
      );
      continue;
    }
    admittedHooks.push({ kind: hook.kind, record, receivesEnv: hook.receivesEnv, span: hook.span });
  }
  if (state.diagnostics.length > 0) {
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      rootInstanceFactory: null,
      segments: [],
      placements: [],
    };
  }
  const connectHooks = admittedHooks.filter((hook) => hook.kind === 'connect');
  const disposeHooks = admittedHooks.filter((hook) => hook.kind === 'dispose');
  const changeHooks = admittedHooks.filter((hook) => hook.kind === 'property-change');
  const errorHooks = admittedHooks.filter((hook) => hook.kind === 'error');

  // T3 / 16b-LC-1: the ROOT's local snapshots are element-lifetime setup, not
  // per-projection work. They move into one module-local factory the shell's
  // `createInstance` calls once; mount/claim alias the retained record. A
  // non-root component (and a root with no setup snapshot) keeps today's bytes
  // exactly. `generateElementModule` passes the option only for site modules.
  //
  // A root setup that reads a HOST BINDING cannot be evaluated by the instance
  // factory: the shell's `instanceHostFor` carries props/propsChanged only (no
  // bindings record) and T3 adds no binding channel. The lane's unchanged
  // `UNBOUND_BINDING` gate refuses such a module; keeping `rootSetup` false
  // here preserves the pre-change emitted text instead of writing a factory
  // that references a name it never declares.
  // ADR-0183 D-4: `rootBindingResources`/`rootBindingNames` were computed above
  // (the hook gate consumes them too); the setup-local check below reuses them.
  const setupReadsHostBinding = localLines.some((line) =>
    (line.record?.reads ?? []).some(
      (read) =>
        !rootBindingNames.has(read.name) &&
        !rootBindingNames.has(read.binding.name) &&
        (state.hostBindings.has(read.name) ||
          state.hostBindings.has(read.binding.name) ||
          state.requiredBindings.has(read.name) ||
          state.requiredBindings.has(read.binding.name)),
    ),
  );
  // `16b-CTX`: a provider is element-lifetime setup work exactly like a hook, so
  // it forces the retained factory on the component that owns it.
  const providersOnRoot =
    rootInstance === component.name && componentUsesContextIntrinsic(component);
  const hooksOnRoot = rootInstance === component.name && admittedHooks.length > 0;
  const rootSetup =
    rootInstance === component.name &&
    (localLines.length > 0 || hooksOnRoot || providersOnRoot || rootBindingResources.length > 0) &&
    !setupReadsHostBinding;
  // A component ALIASES the retained record only when the record can satisfy
  // every read the body needs. That is: it has setup locals, or it uses a context
  // intrinsic (whose owner scope the factory carries). A HOOK-only root is the
  // pre-existing shape and keeps its exact bytes, so it falls through.
  const aliasesSetupRecord = localLines.length > 0 || componentUsesContextIntrinsic(component);
  if ((hooksOnRoot || providersOnRoot) && !rootSetup) {
    // The factory is the ONLY carrier of the admitted hooks, so a setup shape
    // that cannot host the factory fails closed here instead of emitting an
    // instance record without its connect/dispose work. (The same module is
    // also refused by the unchanged binding gate; this diagnostic keeps the
    // drop impossible in the intermediate artifact too. Existing code, no new
    // diagnostic vocabulary.)
    return {
      lines: [],
      diagnostics: [
        ...state.diagnostics,
        {
          severity: 'error',
          code: 'OEIR_LEAF_UNSUPPORTED_BINDING',
          message:
            'the root setup reads a host binding, so the admitted lifecycle hooks and context ' +
            'providers cannot be carried by the retained instance factory; the generated ' +
            'element lane has no binding channel',
          span: { file: '', start: 0, end: 0, line: 1, column: 1 },
          origin: 'module',
        },
      ],
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      rootInstanceFactory: null,
      segments: [],
      placements: [],
    };
  }
  let setupLines: string[] = [];
  let setupSegments: EmissionSegment[] = [];
  let setupPlacements: ExpressionPlacement[] = [];
  if (rootSetup) {
    // Fail-closed belt: the factory and alias names are compiler-owned fixed
    // names. The `__oe_` prefix refusal above makes an authored collision
    // impossible and `nextName` always emits a counter suffix; refusing here
    // keeps a model that bypassed both from emitting a duplicate declaration.
    const fixedNames: readonly string[] = [
      GENERATED_ROOT_INSTANCE_NAME,
      GENERATED_ROOT_CONNECT_RECORD,
      ROOT_SETUP_RECORD,
      ROOT_SETUP_REQUIRE,
    ];
    const authoredNames = new Set<string>([
      component.name,
      ...component.resources.map((resource) => resource.name),
    ]);
    const collision = fixedNames.find((name) => authoredNames.has(name));
    if (collision !== undefined) {
      diag(
        state,
        'OEIR_LEAF_INVALID_ARTIFACT',
        `the root instance setup name '${collision}' collides with an authored identifier`,
        component.span,
      );
    } else if (localLines.some((line) => line.name === propsName)) {
      // A setup local named like the props parameter would emit a duplicate
      // `const` when the factory carries the props alias (B2). Impossible in
      // admitted source; fail closed instead of shipping an unparseable module.
      diag(
        state,
        'OEIR_LEAF_INVALID_BINDING',
        `the root setup local collides with the props parameter '${String(propsName)}'`,
        component.span,
      );
    }
    if (state.diagnostics.length > 0) {
      return {
        lines: [],
        diagnostics: state.diagnostics,
        requiredBindings: [],
        requiredProps: [],
        requiresPropsChanged: false,
        rootInstanceFactory: null,
        segments: [],
        placements: [],
      };
    }
    const setupReadsProps =
      // ADR-0183 D-4: a binding resource's initializer/derivation evaluates
      // INSIDE this factory, so a props read there needs the same alias a setup
      // local's read does.
      rootBindingResources.some((resource) =>
        (records.get(resource.expression?.id ?? '')?.reads ?? []).some(
          (read) => read.name === 'props' || read.binding.name === 'props',
        ),
      ) ||
      localLines.some((line) =>
        (line.record?.reads ?? []).some(
          (read) => read.name === 'props' || read.binding.name === 'props',
        ),
      ) ||
      admittedHooks.some((hook) =>
        hook.record.reads.some((read) => read.name === 'props' || read.binding.name === 'props'),
      ) ||
      // `16b-CTX`: the PROVIDER thunks also live in the retained factory, so a
      // thunk reading props needs the same alias. Without this the emitted
      // factory references an undeclared `props`.
      component.contextProviders.some((provider) =>
        [records.get(provider.token.id), records.get(provider.value.id)].some((record) =>
          (record?.reads ?? []).some(
            (read) => read.name === 'props' || read.binding.name === 'props',
          ),
        ),
      ) ||
      // `16b-CTX`: a consumer's TOKEN is usually an import, but it may read
      // props too, and the consumer declaration itself lives in the factory.
      component.resources.some(
        (resource) =>
          resource.kind === 'context' &&
          (records
            .get(resource.expression?.id ?? '')
            ?.reads.some((read) => read.name === 'props' || read.binding.name === 'props') ??
            false),
      );
    const setupPrologue: string[] = [
      `function ${GENERATED_ROOT_INSTANCE_NAME}(${INTERNAL_PREFIX}owner, ${MOUNT_HOST}) {`,
    ];
    if (setupReadsProps && propsName !== null) {
      // The shell passes the live frozen props record into `createInstance`;
      // the factory snapshots its getters' VALUES once at first connect. That
      // is the accepted ADR-0173 setup-once limitation: a prop seeded after the
      // first connect is not observed by retained setup (mount/claim keep
      // reading the same live record for non-setup reads).
      setupPrologue.push(`  const ${propsName} = ${MOUNT_HOST}.props;`);
    }
    const setupState: EmitState = {
      ...state,
      lines: [],
      physicalLine: 0,
      segments: [],
      placements: [],
      segmentKeys: new Set(),
    };
    // `16b-CTX` ordering: scope, then PROVIDERS, then locals. A component that
    // both provides and consumes must read its OWN value, so the provider has to
    // be published before the consumer declaration resolves. A root provides on
    // the element anchor itself, so its provider also covers every depth-1 child.
    emitContextScopeDeclaration(setupState, component, false);
    emitContextProviders(setupState, component.contextProviders, records);
    // ADR-0183 D-4: the binding resources are created ONCE per element (this
    // factory runs once per retained instance) and returned in the record the
    // shell keeps as `bindings`, so mount/claim resolve them through their
    // existing `host.bindings[name]` prologue.
    //
    // A binding resource and a setup local share ONE authored declaration
    // order: a derived node may read a local snapshot declared above it
    // (`const chrome = strings(props.locale); const label = computed(() => chrome.x)`),
    // which is the shape every site module with shared copy has. Emitting all
    // resources first would put `const label = computed(...)` above the
    // `const chrome = ...` it captures — a TDZ at runtime that no diagnostic
    // would catch. The merge is by authored `span.start`, which is the same
    // order the frontend lowered them in.
    type FactoryDecl = {
      readonly name: string;
      /** Authored position key: the lane's spans are 1-based line + column. */
      readonly order: number;
      readonly emit: () => void;
    };
    const factoryDecls: FactoryDecl[] = [];
    for (const resource of rootBindingResources) {
      const record = recordFor(setupState, resource.expression!, records);
      if (record === null || !declareReads(setupState, record)) {
        return {
          lines: [],
          diagnostics: state.diagnostics,
          requiredBindings: [],
          requiredProps: [],
          requiresPropsChanged: false,
          rootInstanceFactory: null,
          segments: [],
          placements: [],
        };
      }
      factoryDecls.push({
        name: resource.name,
        order: setupOrder(resource.span),
        emit: () => {
          pushParts(
            setupState,
            [
              resource.kind === 'computed'
                ? `const ${resource.name} = computed(`
                : `const ${resource.name} = signal((`,
              { record },
              resource.kind === 'computed' ? ');' : '));',
            ],
            resource.span,
          );
        },
      });
    }
    for (const line of localLines) {
      factoryDecls.push({
        name: line.name,
        order: setupOrder(line.span),
        emit: () => emitSetupBinding(setupState, line),
      });
    }
    factoryDecls.sort((left, right) => left.order - right.order);
    const lateDisposeHooks = emitSetupSteps(setupState, factoryDecls, disposeHooks);
    // `16b-LC` option 1a: the connect callbacks are RECORDED, not replayed
    // here. The root mount/claim prologue replays them on the per-connection
    // scope, so "setup runs once" and "the callback runs on every connection"
    // stay separate phases with no second lifecycle engine.
    if (connectHooks.length > 0) {
      const legacyConnectHooks = connectHooks.filter((hook) => !hook.receivesEnv);
      const envConnectHooks = connectHooks.filter((hook) => hook.receivesEnv);
      if (legacyConnectHooks.length > 0) {
        push(setupState, `const ${GENERATED_ROOT_CONNECT_RECORD} = [];`);
      }
      for (const hook of legacyConnectHooks) {
        pushParts(
          setupState,
          [`${GENERATED_ROOT_CONNECT_RECORD}.push((`, { record: hook.record }, '));'],
          hook.span,
        );
      }
      // Env-form callbacks get their OWN retained record: the replay passes the
      // env argument only for this form, so an all-zero-argument module keeps
      // its exact pre-env bytes (see the record constant's comment).
      if (envConnectHooks.length > 0) {
        push(setupState, `const ${GENERATED_ROOT_CONNECT_ENV_RECORD} = [];`);
      }
      for (const hook of envConnectHooks) {
        pushParts(
          setupState,
          [`${GENERATED_ROOT_CONNECT_ENV_RECORD}.push((`, { record: hook.record }, '));'],
          hook.span,
        );
      }
    }
    // `onDispose` registers on the element/island instance owner the shell
    // hands the factory: the existing LifetimeScope teardown cascade owns it
    // (once, after the connection/projection cleanups, LIFO, first-error rule).
    // An env-form callback is wrapped so the owner's own `signal` is read at
    // teardown: `LifetimeScope.dispose` aborts it BEFORE any cleanup runs, so
    // the callback observes an aborted signal. The signal is created here (once
    // per instance) so the abort is teardown-start, not first-callback.
    prepareDisposeHooks(setupState, lateDisposeHooks);
    for (const hook of lateDisposeHooks) emitDisposeHook(setupState, hook);
    for (const hook of changeHooks) {
      // Registration only: the shell owns the listener list, the env it builds
      // and the teardown clearing. The channel check keeps a hand-built
      // descriptor without the runtime property a no-op instead of a crash.
      pushParts(
        setupState,
        [
          `if (${MOUNT_HOST}.${PROPERTY_CHANGE_PROPERTY} !== undefined) ${MOUNT_HOST}.${PROPERTY_CHANGE_PROPERTY}((`,
          { record: hook.record },
          '));',
        ],
        hook.span,
      );
    }
    for (const hook of errorHooks) {
      // `16b-EB` registration only. The SHELL owns both capture points (the
      // connect/claim catch it already had, and the update-phase sink below),
      // the env it builds, and the teardown clearing; generated code never calls
      // the callback itself, so there is no second error channel. The callback
      // is handed to the channel verbatim: the shell always calls it with the
      // `{ host, signal, states, error }` env, and a zero-parameter authored
      // callback simply ignores it (same contract as the change channel's
      // event).
      pushParts(
        setupState,
        [
          `if (${MOUNT_HOST}.${ERROR_HANDLER_PROPERTY} !== undefined) ${MOUNT_HOST}.${ERROR_HANDLER_PROPERTY}((`,
          { record: hook.record },
          '));',
        ],
        hook.span,
      );
    }
    const recordFields = factoryDecls.map((declaration) => declaration.name);
    if (componentUsesContextIntrinsic(component)) {
      recordFields.push(GENERATED_CONTEXT_SCOPE_RECORD);
    }
    if (connectHooks.some((hook) => !hook.receivesEnv)) {
      recordFields.push(GENERATED_ROOT_CONNECT_RECORD);
    }
    if (connectHooks.some((hook) => hook.receivesEnv)) {
      recordFields.push(GENERATED_ROOT_CONNECT_ENV_RECORD);
    }
    const setupReturn =
      recordFields.length === 0 ? '  return {};' : `  return { ${recordFields.join(', ')} };`;
    setupLines = [...setupPrologue, ...setupState.lines, setupReturn, '}', ''];
    const setupShift = fragmentLineCount(setupPrologue);
    setupSegments = setupState.segments.map((segment) => ({
      ...segment,
      generatedLine: segment.generatedLine + setupShift,
    }));
    setupPlacements = setupState.placements.map((placement) => ({
      ...placement,
      generatedLine: placement.generatedLine + setupShift,
    }));
  }

  // 16b-LC retained-child: a LEAF instance body evaluates its setup exactly once on the
  // ledger-owned retained scope. The retaining reference site calls this
  // module-local factory inside `retainChildInstance`; the body itself only
  // aliases the returned record (never re-evaluates an initializer and never
  // emits a ledger call). A leaf with neither setup local nor lifecycle hook
  // needs no factory at all; a hook-only depth-1 child DOES need this one
  // factory (it is the only carrier of the retained callbacks — no second
  // lifecycle engine).
  const leafSetup =
    state.leafBody &&
    (localLines.length > 0 || admittedHooks.length > 0 || componentUsesContextIntrinsic(component));
  if (leafSetup) {
    // Belt mirroring the root factory: the alias names are compiler-owned and
    // an authored identifier cannot carry the `__oe_` prefix; refusing here
    // keeps a model that bypassed both from emitting a duplicate declaration.
    const fixedNames: readonly string[] = [
      ROOT_SETUP_RECORD,
      ROOT_SETUP_REQUIRE,
      GENERATED_ROOT_CONNECT_RECORD,
    ];
    const authoredNames = new Set<string>([
      component.name,
      ...component.resources.map((resource) => resource.name),
    ]);
    const collision = fixedNames.find((name) => authoredNames.has(name));
    if (collision !== undefined) {
      diag(
        state,
        'OEIR_LEAF_INVALID_ARTIFACT',
        `the leaf instance setup name '${collision}' collides with an authored identifier`,
        component.span,
      );
    } else if (propsName !== null && localLines.some((line) => line.name === propsName)) {
      diag(
        state,
        'OEIR_LEAF_INVALID_BINDING',
        `the leaf setup local collides with the props parameter '${String(propsName)}'`,
        component.span,
      );
    }
    if (state.diagnostics.length > 0) {
      return {
        lines: [],
        diagnostics: state.diagnostics,
        requiredBindings: [],
        requiredProps: [],
        requiresPropsChanged: false,
        rootInstanceFactory: null,
        segments: [],
        placements: [],
      };
    }
    const setupReadsProps =
      localLines.some((line) =>
        (line.record?.reads ?? []).some(
          (read) => read.name === 'props' || read.binding.name === 'props',
        ),
      ) ||
      admittedHooks.some((hook) =>
        hook.record.reads.some((read) => read.name === 'props' || read.binding.name === 'props'),
      ) ||
      // `16b-CTX`: the provider THUNKS and the consumer TOKENS also live in the
      // retained factory, so either reading props needs the same alias. Without
      // this the emitted factory references an undeclared `props` (a runtime
      // ReferenceError on the first connect).
      component.contextProviders.some((provider) =>
        [records.get(provider.token.id), records.get(provider.value.id)].some((record) =>
          (record?.reads ?? []).some(
            (read) => read.name === 'props' || read.binding.name === 'props',
          ),
        ),
      ) ||
      component.resources.some(
        (resource) =>
          resource.kind === 'context' &&
          (records
            .get(resource.expression?.id ?? '')
            ?.reads.some((read) => read.name === 'props' || read.binding.name === 'props') ??
            false),
      );
    const setupPrologue: string[] = [
      `function ${component.name}${LEAF_SETUP_SUFFIX}(${INTERNAL_PREFIX}owner, ${MOUNT_PROPS}, ${MOUNT_HOST}) {`,
    ];
    if (setupReadsProps && propsName !== null) {
      // The retaining site passes the per-read props record it built for the
      // reference; setup snapshots its getter VALUES once. This is the same
      // accepted ADR-0173 setup-once limitation the root factory has.
      setupPrologue.push(`  const ${propsName} = ${MOUNT_PROPS};`);
    }
    const setupState: EmitState = {
      ...state,
      lines: [],
      physicalLine: 0,
      segments: [],
      placements: [],
      segmentKeys: new Set(),
    };
    // `16b-CTX`: a hostless component owns a CHILD of the anchor scope, so its
    // providers are invisible to its siblings and visible to its subtree. Same
    // ordering as the root factory: the provider publishes before a consumer of
    // the SAME component resolves.
    emitContextScopeDeclaration(setupState, component, true);
    emitContextProviders(setupState, component.contextProviders, records);
    const lateDisposeHooks = emitSetupSteps(
      setupState,
      localLines.map((line) => ({
        order: setupOrder(line.span),
        emit: () => emitSetupBinding(setupState, line),
      })),
      disposeHooks,
    );
    // `16b-LC` nested/hostless depth-1: the connect callbacks are RECORDED in
    // the same retained setup record the locals use; the child mount/claim
    // prologue replays them on its per-projection scope. `onDispose` registers
    // on the retained instance owner, so the ledger's structural release /
    // owner teardown cascades it exactly once (LIFO, first-error rule). The env
    // form mirrors the root factory: its own retained record, and a wrapper
    // that reads the retained owner's signal at teardown.
    if (connectHooks.some((hook) => !hook.receivesEnv)) {
      push(setupState, `const ${GENERATED_ROOT_CONNECT_RECORD} = [];`);
    }
    for (const hook of connectHooks) {
      if (hook.receivesEnv) continue;
      pushParts(
        setupState,
        [`${GENERATED_ROOT_CONNECT_RECORD}.push((`, { record: hook.record }, '));'],
        hook.span,
      );
    }
    if (connectHooks.some((hook) => hook.receivesEnv)) {
      push(setupState, `const ${GENERATED_ROOT_CONNECT_ENV_RECORD} = [];`);
    }
    for (const hook of connectHooks) {
      if (!hook.receivesEnv) continue;
      pushParts(
        setupState,
        [`${GENERATED_ROOT_CONNECT_ENV_RECORD}.push((`, { record: hook.record }, '));'],
        hook.span,
      );
    }
    prepareDisposeHooks(setupState, lateDisposeHooks);
    for (const hook of lateDisposeHooks) emitDisposeHook(setupState, hook);
    for (const hook of changeHooks) {
      pushParts(
        setupState,
        [
          `if (${MOUNT_HOST}.${PROPERTY_CHANGE_PROPERTY} !== undefined) ${MOUNT_HOST}.${PROPERTY_CHANGE_PROPERTY}((`,
          { record: hook.record },
          '));',
        ],
        hook.span,
      );
    }
    for (const hook of errorHooks) {
      // `16b-EB`: same registration shape as the root factory. The child's setup
      // host carries the channel because the retaining reference site forwarded
      // it (see `childErrorBoundaryField`), so both the handler list and the
      // update-phase sink belong to the ONE enclosing generated element.
      pushParts(
        setupState,
        [
          `if (${MOUNT_HOST}.${ERROR_HANDLER_PROPERTY} !== undefined) ${MOUNT_HOST}.${ERROR_HANDLER_PROPERTY}((`,
          { record: hook.record },
          '));',
        ],
        hook.span,
      );
    }
    const setupFields = localLines.map((line) => line.name);
    if (componentUsesContextIntrinsic(component)) {
      setupFields.push(GENERATED_CONTEXT_SCOPE_RECORD);
    }
    if (connectHooks.some((hook) => !hook.receivesEnv)) {
      setupFields.push(GENERATED_ROOT_CONNECT_RECORD);
    }
    if (connectHooks.some((hook) => hook.receivesEnv)) {
      setupFields.push(GENERATED_ROOT_CONNECT_ENV_RECORD);
    }
    const setupReturn =
      setupFields.length === 0 ? '  return {};' : `  return { ${setupFields.join(', ')} };`;
    setupLines = [...setupPrologue, ...setupState.lines, setupReturn, '}', ''];
    const setupShift = fragmentLineCount(setupPrologue);
    setupSegments = setupState.segments.map((segment) => ({
      ...segment,
      generatedLine: segment.generatedLine + setupShift,
    }));
    setupPlacements = setupState.placements.map((placement) => ({
      ...placement,
      generatedLine: placement.generatedLine + setupShift,
    }));
  }

  // 16b-LC retained-child: the ROOT retaining body opens exactly one instance pass before
  // any setup/DOM work; the shell aborts it when mount/claim throws.
  if (state.retainBody) {
    // 16b-LC depth >= 2: capture the token only when a retained child is
    // itself a retaining body; a depth-1 module keeps the bare call bytes.
    const beginCall = `beginInstancePass(${MOUNT_HOST}.instance)`;
    push(
      state,
      state.retention?.transaction === true
        ? `const ${TRANSACTION_VAR} = ${beginCall};`
        : `${beginCall};`,
    );
  }
  push(state, `const ${INTERNAL_PREFIX}nodes = [];`);
  if (rootSetup && aliasesSetupRecord) {
    emitSetupAlias(state, localLines, ROOT_SETUP_HOST_PROPERTY);
  } else if (leafSetup && (localLines.length > 0 || componentUsesContextIntrinsic(component))) {
    emitSetupAlias(state, localLines, LEAF_SETUP_HOST_PROPERTY);
  } else {
    for (const line of localLines) emitSetupBinding(state, line);
  }
  emitJoinTransaction(state);
  // One read of the children recipe per mount (M06b2a): every projection site
  // inserts this same recipe value, and dynamic children content refreshes
  // through the recipe body's own subscriptions (never a props re-read here).
  // The check is the documented runtime boundary for a host-supplied root
  // instance: `props.children` may only be a real recipe built with
  // `createRecipe`; a plain value fails coded instead of rendering nothing.
  if (state.childrenRecipeVar !== null) {
    push(state, `const ${state.childrenRecipeVar} = ${MOUNT_PROPS}.children;`);
    push(
      state,
      `if (${state.childrenRecipeVar} == null || typeof ${state.childrenRecipeVar} !== "object" || typeof ${state.childrenRecipeVar}.mount !== "function" || ${state.childrenRecipeVar}.definitionOwner == null) throw new Error("OEIR_LEAF_MISSING_CHILDREN: component '<${component.name}>' projects props.children but the mounted instance was given no children recipe");`,
    );
  }
  // Reusable JSX values (M06b1a-2): recipes are declared before the roots so
  // every insertion site — including one inside another recipe body — can
  // reference them.
  emitRecipes(state, file, records);
  if (state.diagnostics.length > 0) {
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      rootInstanceFactory: null,
      segments: [],
      placements: [],
    };
  }
  const rootDirectory = state.emitDirectoryMarkers ? staticElementDirectory(component.roots) : null;
  if (rootDirectory !== null) {
    emitMountedDirectory(state, rootDirectory, records, {
      kind: 'array',
      name: `${INTERNAL_PREFIX}nodes`,
    });
  } else {
    for (const root of emissionNodes(state, component.roots)) {
      const sink: SinkEntry[] = [];
      emitNode(state, root, sink, records);
      appendSinkToArray(state, sink, `${INTERNAL_PREFIX}nodes`);
    }
  }
  if (state.retainBody) push(state, `endInstancePass(${MOUNT_HOST}.instance);`);
  push(state, `return ${INTERNAL_PREFIX}nodes;`);

  // The component body lives in one module-level mount so a component reference
  // and the exported root factory share exactly one emitted body per module.
  const mountPrologue: string[] = [
    `function ${component.name}${MOUNT_SUFFIX}(${MOUNT_SCOPE}, ${MOUNT_PROPS}, ${MOUNT_HOST}) {`,
  ];
  if (propsName !== null) {
    mountPrologue.push(`  const ${propsName} = ${MOUNT_PROPS};`);
    state.requiredProps.add(propsName);
  }
  if (state.requiredBindings.size > 0) {
    mountPrologue.push(
      `  const ${INTERNAL_PREFIX}requireBinding = (name) => { const value = ${MOUNT_HOST}.bindings[name]; if (value === undefined) throw new Error("OEIR_LEAF_MISSING_VALUE: " + name); return value; };`,
    );
    for (const binding of [...state.requiredBindings].sort()) {
      mountPrologue.push(
        `  const ${binding} = ${INTERNAL_PREFIX}requireBinding(${JSON.stringify(binding)});`,
      );
    }
  }
  // `16b-LC`: the mount is a connection too, so the same retained connect
  // callbacks replay on this fresh per-connection scope. A retained depth-1
  // hostless child reads them from its own setup record (`host.setup`); the
  // root keeps the unchanged `host.bindings` spelling (byte-identical).
  if (connectHooks.some((hook) => !hook.receivesEnv)) {
    for (const line of emitLifecycleReplay(rootSetup ? 'bindings' : 'setup')) {
      mountPrologue.push(line);
    }
  }
  if (connectHooks.some((hook) => hook.receivesEnv)) {
    for (const line of emitLifecycleEnvReplay(rootSetup ? 'bindings' : 'setup')) {
      mountPrologue.push(line);
    }
  }
  const mountHostVar = `${INTERNAL_PREFIX}mountHost`;
  const factoryLines: string[] = [
    `export function create${component.name}Recipe(${INTERNAL_PREFIX}owner, ${INTERNAL_PREFIX}host) {`,
  ];
  // 16b-LC retained-child: the root retaining body reads the logical instance scope from its
  // host record, so the factory forwards the shell's `instance` field. Only the
  // root component of a retained module changes bytes; every other factory keeps
  // today's literal exactly.
  const forwardedInstance = state.retainBody ? `, instance: ${INTERNAL_PREFIX}host.instance` : '';
  // Env-form callbacks read the owning element from the host record. The shell
  // attaches it; this literal carries it into the mount/claim host the replay
  // prologues read. Guests: modules without the env form keep today's bytes.
  const forwardedHostElement =
    moduleUsesLifecycleEnv(state) || moduleUsesHostAccess(state)
      ? `, ${HOST_ELEMENT_PROPERTY}: ${INTERNAL_PREFIX}host.${HOST_ELEMENT_PROPERTY}, ${STATES_PROPERTY}: ${INTERNAL_PREFIX}host.${STATES_PROPERTY}`
      : '';
  // The change channel rides the same literal for the depth-1 child setup host.
  const forwardedPropertyChange = moduleUsesPropertyChange(state)
    ? `, ${PROPERTY_CHANGE_PROPERTY}: ${INTERNAL_PREFIX}host.${PROPERTY_CHANGE_PROPERTY}`
    : '';
  // `16b-EB`: the registration channel AND the update-phase sink ride the same
  // literal, so the root setup can register its handler and the body's refresh
  // subscriptions can be guarded. Guests: modules without the intrinsic keep
  // today's bytes, including every two-argument `guardUpdate(fn)` call, which
  // then keeps the pre-`16b-EB` propagating form.
  const forwardedErrorBoundary = moduleUsesErrorBoundary(state)
    ? `, ${ERROR_HANDLER_PROPERTY}: ${INTERNAL_PREFIX}host.${ERROR_HANDLER_PROPERTY}, ${ERROR_REPORT_PROPERTY}: ${INTERNAL_PREFIX}host.${ERROR_REPORT_PROPERTY}`
    : '';
  // `16b-CTX`: the channel rides the same literal, so the mount/claim body's
  // consumer alias and the setup factory's provider registration resolve the one
  // element scope. Guests: modules without the intrinsic keep today's bytes.
  const forwardedContext = moduleUsesContext(state)
    ? `, ${CONTEXT_SCOPE_PROPERTY}: ${INTERNAL_PREFIX}host.${CONTEXT_SCOPE_PROPERTY}`
    : '';
  if (state.requiresPropsChanged) {
    // The root instance's defining scope is the host props channel: the
    // original OEIR_LEAF_MISSING_VALUE contract stays at factory creation.
    factoryLines.push(
      `  const ${INTERNAL_PREFIX}propsChanged = ${INTERNAL_PREFIX}host.propsChanged; if (${INTERNAL_PREFIX}propsChanged === undefined) throw new Error("OEIR_LEAF_MISSING_VALUE: propsChanged");`,
    );
    factoryLines.push(
      `  const ${mountHostVar} = { bindings: ${INTERNAL_PREFIX}host.bindings, propDeps: [${INTERNAL_PREFIX}propsChanged]${forwardedInstance}${forwardedHostElement}${forwardedPropertyChange}${forwardedErrorBoundary}${forwardedContext} };`,
    );
  } else {
    factoryLines.push(
      `  const ${mountHostVar} = { bindings: ${INTERNAL_PREFIX}host.bindings, propDeps: []${forwardedInstance}${forwardedHostElement}${forwardedPropertyChange}${forwardedErrorBoundary}${forwardedContext} };`,
    );
  }
  const claim =
    state.diagnostics.length === 0
      ? emitClaimFunction(
          file,
          component,
          records,
          componentByName,
          sharedClaimCursor,
          rootSetup,
          aliasesSetupRecord,
          rootInstance === component.name,
          connectHooks.some((hook) => !hook.receivesEnv)
            ? rootSetup
              ? 'bindings'
              : 'setup'
            : null,
          connectHooks.some((hook) => hook.receivesEnv) ? (rootSetup ? 'bindings' : 'setup') : null,
          retention,
          claimStyleLinkPrefix,
        )
      : null;
  if (claim !== null && claim.diagnostics.length > 0) {
    return {
      lines: [],
      diagnostics: [...state.diagnostics, ...claim.diagnostics],
      requiredBindings: [...state.requiredBindings].sort(),
      requiredProps: [...state.requiredProps].sort(),
      requiresPropsChanged: state.requiresPropsChanged,
      rootInstanceFactory: null,
      segments: [],
      placements: [],
    };
  }
  const recipeFields = [
    '  return createRecipe({',
    `    definitionOwner: ${INTERNAL_PREFIX}owner,`,
    `    source: ${JSON.stringify(`${file}#${component.name}`)},`,
    '    mount(__oe_scope) {',
    `      return ${component.name}${MOUNT_SUFFIX}(${MOUNT_SCOPE}, ${INTERNAL_PREFIX}host.props, ${mountHostVar});`,
    '    },',
  ];
  if (claim !== null) {
    recipeFields.push(
      '    claim(__oe_scope, __oe_props, __oe_parent) {',
      `      return ${component.name}${CLAIM_SUFFIX}(${MOUNT_SCOPE}, ${INTERNAL_PREFIX}host.props, ${mountHostVar}, __oe_parent);`,
      '    },',
    );
  }
  recipeFields.push('  });', '}', '');
  factoryLines.push(...recipeFields);
  const mountLines = [...mountPrologue, ...state.lines, '}', ''];
  const claimLines = claim?.lines ?? [];
  // M08-1a/M08-1b: a component that can claim existing DOM also emits the HTML
  // it would have produced, so the same proof surface exists on both sides. It
  // is appended after the claim chunk, which keeps every already-recorded
  // segment/placement line offset untouched.
  const ssr =
    claim === null
      ? null
      : emitSsrFunction(
          file,
          component,
          rootDirectory,
          records,
          componentByName,
          lightRoot,
          rootInstance ?? null,
        );
  if (ssr !== null && ssr.diagnostics.length > 0) {
    return {
      lines: [],
      diagnostics: [...state.diagnostics, ...ssr.diagnostics],
      requiredBindings: [...state.requiredBindings].sort(),
      requiredProps: [...state.requiredProps].sort(),
      requiresPropsChanged: state.requiresPropsChanged,
      rootInstanceFactory: null,
      segments: [],
      placements: [],
    };
  }
  const ssrLines = ssr?.lines ?? [];
  // Chunk offsets are physical lines: a multi-line lowered expression inside an
  // earlier chunk occupies more generated lines than one array element. The
  // root setup factory (when emitted) is the component chunk's first fragment,
  // so every later chunk shifts by its ACTUAL line count — never a constant.
  const setupShift = fragmentLineCount(setupLines);
  const claimShift = setupShift + fragmentLineCount(mountLines) + fragmentLineCount(factoryLines);
  const ssrShift = claimShift + fragmentLineCount(claimLines);
  const shift = setupShift + fragmentLineCount(mountPrologue);
  return {
    lines: [...setupLines, ...mountLines, ...factoryLines, ...claimLines, ...ssrLines],
    diagnostics: state.diagnostics,
    requiredBindings: [...state.requiredBindings].sort(),
    requiredProps: [...state.requiredProps].sort(),
    requiresPropsChanged: state.requiresPropsChanged,
    rootInstanceFactory: rootSetup ? GENERATED_ROOT_INSTANCE_NAME : null,
    usesStaticSiblingDirectoryConsumer: claim?.usesStaticSiblingDirectoryConsumer === true,
    usesClaimRecipe: claim?.usesClaimRecipe === true,
    hasClaim: claim !== null,
    usesLeafClaimMismatch: claim?.usesLeafClaimMismatch === true,
    segments: [
      ...setupSegments,
      ...state.segments.map((segment) => ({
        ...segment,
        generatedLine: segment.generatedLine + shift,
      })),
      ...(claim?.segments ?? []).map((segment) => ({
        ...segment,
        generatedLine: segment.generatedLine + claimShift,
      })),
      ...(ssr?.segments ?? []).map((segment) => ({
        ...segment,
        generatedLine: segment.generatedLine + ssrShift,
      })),
    ],
    placements: [
      ...setupPlacements,
      ...state.placements.map((placement) => ({
        ...placement,
        generatedLine: placement.generatedLine + shift,
      })),
      ...(claim?.placements ?? []).map((placement) => ({
        ...placement,
        generatedLine: placement.generatedLine + claimShift,
      })),
      ...(ssr?.placements ?? []).map((placement) => ({
        ...placement,
        generatedLine: placement.generatedLine + ssrShift,
      })),
    ],
  };
}
