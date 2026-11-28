/** Activation driver for compiler-proven open-shadow leaves with no host channels. */
import type { StyleSheetLike } from '@openelement/protocol/style-sheet';
import { OpenElementBase } from '../../../open-element-base.ts';
import { CompiledStyleScope, themeManager } from '../../../open-element-styles.ts';
import type { LifetimeScope } from '../lifetime-scope.ts';
import { isExpandedLightRootHost } from '../runtime/claim-invariants.ts';
import { projectOwnGeneratedLeaf, type Projection, type Recipe } from '../runtime/recipe.ts';
import { removeNodes } from '../runtime/values.ts';
import { assertGeneratedElementTag, normalizeGeneratedStyles } from './descriptor.ts';
import {
  generatedClientStyles,
  captureCleanupFailures,
  finishGeneratedConnection,
  observeGeneratedRegion,
  projectGeneratedRegion,
  releaseIgnoringErrors,
  replayFirstGeneratedConnection,
  retainGeneratedInstance,
} from './driver-ownership.ts';
import { assertGeneratedRootOptions, resolveGeneratedOpenRoot } from './root.ts';
import type { GeneratedElement, GeneratedElementConstructor } from './shell.ts';

type Bindings = Readonly<Record<string, unknown>>;

interface DirectShadowDriverOptions {
  readonly tag: string;
  readonly delegatesFocus?: boolean;
  readonly styles?: readonly StyleSheetLike[];
  readonly createInstance?: (owner: LifetimeScope) => Bindings;
}

interface DirectShadowOptions extends DirectShadowDriverOptions {
  readonly createRecipe: (
    owner: LifetimeScope,
    host: { readonly bindings: Bindings; readonly props: Bindings },
  ) => Recipe<Record<string, unknown>>;
}

interface DirectLeafHost {
  readonly bindings: Bindings;
  readonly propDeps: readonly never[];
}

interface DirectShadowProjectionOptions extends DirectShadowDriverOptions {
  readonly source: string;
  readonly mount: (owner: LifetimeScope, props: Bindings, host: DirectLeafHost) => Node[];
  readonly claim: (
    owner: LifetimeScope,
    props: Bindings,
    host: DirectLeafHost,
    root: ShadowRoot,
  ) => Node[];
}

const emptyProps: Bindings = Object.freeze(Object.create(null));

export function createDirectShadowElementClass(
  options: DirectShadowOptions,
): GeneratedElementConstructor {
  return buildDirectShadowClass(options, (state, owner, root) => {
    const recipe = options.createRecipe(owner, { bindings: state.bindings!, props: emptyProps });
    return projectGeneratedRegion(state, owner, recipe, root);
  });
}

/** The compiler supplies the same mount and claim bodies without a Recipe envelope. */
export function createDirectShadowElementClassWithProjection(
  options: DirectShadowProjectionOptions,
): GeneratedElementConstructor {
  const { source, mount, claim } = options;
  return buildDirectShadowClass(options, (state, owner, root) => {
    const host: DirectLeafHost = { bindings: state.bindings!, propDeps: [] };
    return state.regionState === 'present'
      ? projectOwnGeneratedLeaf(
          owner,
          source,
          (scope) => claim(scope, emptyProps, host, root),
          root,
          false,
        )
      : projectOwnGeneratedLeaf(
          owner,
          source,
          (scope) => mount(scope, emptyProps, host),
          root,
          true,
        );
  });
}

function buildDirectShadowClass(
  options: DirectShadowDriverOptions,
  project: (
    state: {
      readonly bindings: Bindings | null;
      readonly regionState: 'unobserved' | 'present' | 'absent';
    },
    owner: LifetimeScope,
    root: ShadowRoot,
  ) => Projection<Record<string, unknown>>,
): GeneratedElementConstructor {
  assertGeneratedElementTag(options.tag);
  const delegatesFocus = options.delegatesFocus === true;
  const styles = normalizeGeneratedStyles(options.styles);

  class DirectShadowElement extends OpenElementBase implements GeneratedElement {
    readonly #state = {
      root: null as ReturnType<typeof resolveGeneratedOpenRoot> | null,
      styleScope: null as CompiledStyleScope | null,
      regionState: 'unobserved' as 'unobserved' | 'present' | 'absent',
      connecting: false,
      instance: null as LifetimeScope | null,
      bindings: null as Bindings | null,
      connection: null as LifetimeScope | null,
      projection: null as Projection<Record<string, unknown>> | null,
      ownedNodes: null as readonly Node[] | null,
    };

    connectedCallback(): void {
      const state = this.#state;
      if (state.projection !== null || state.connecting) return;
      if (typeof this.hasAttribute === 'function') isExpandedLightRootHost(this);
      themeManager.connect(this);
      state.connecting = true;
      const hadInstance = state.instance !== null;
      let connection: LifetimeScope | null = null;
      try {
        const resolved = (state.root ??= resolveGeneratedOpenRoot(this, delegatesFocus));
        const root = resolved.root;
        assertGeneratedRootOptions(root, 'open', delegatesFocus);
        const selectedStyles = generatedClientStyles(this.constructor, styles, resolved.created);
        if (selectedStyles !== undefined) {
          (state.styleScope ??= new CompiledStyleScope()).connect(root, [...selectedStyles]);
        }
        observeGeneratedRegion(state, root, !resolved.created);
        const instance = retainGeneratedInstance(
          state,
          (owner) => options.createInstance?.(owner) ?? {},
        );
        connection = instance.child();
        const projection = project(state, connection, root);
        state.connection = connection;
        state.projection = projection;
        state.ownedNodes = projection.nodes;
        state.regionState = 'present';
        replayFirstGeneratedConnection(this, hadInstance);
      } catch (error) {
        state.connection = null;
        state.projection = null;
        const instance = hadInstance ? null : state.instance;
        if (instance !== null) {
          state.instance = null;
          state.bindings = null;
        }
        releaseIgnoringErrors([
          () => state.styleScope?.disconnect(),
          () => connection?.dispose(false),
          () => instance?.dispose(true),
        ]);
        throw error;
      } finally {
        finishGeneratedConnection(this, state);
      }
    }

    disconnectedCallback(): void {
      themeManager.disconnect(this);
      const state = this.#state;
      const { projection, connection } = state;
      state.projection = null;
      state.connection = null;
      captureCleanupFailures([
        () => state.styleScope?.disconnect(),
        () => projection?.dispose(false),
        () => connection?.dispose(false),
      ]);
    }

    dispose(detachOwnedNodes = true): void {
      const state = this.#state;
      const { projection, connection, instance, ownedNodes } = state;
      state.projection = null;
      state.connection = null;
      state.instance = null;
      state.bindings = null;
      state.ownedNodes = null;
      if (detachOwnedNodes && (projection !== null || ownedNodes !== null)) {
        state.regionState = 'absent';
      }
      captureCleanupFailures([
        () => state.styleScope?.disconnect(),
        () => projection?.dispose(detachOwnedNodes),
        () => {
          if (detachOwnedNodes && ownedNodes !== null) removeNodes(ownedNodes);
        },
        () => connection?.dispose(false),
        () => instance?.dispose(detachOwnedNodes),
      ]);
    }
  }

  Object.defineProperty(DirectShadowElement, 'observedAttributes', {
    configurable: true,
    value: Object.freeze([]),
  });
  Object.defineProperty(DirectShadowElement, '__oeTag', { value: options.tag });
  if (delegatesFocus) {
    Object.defineProperty(DirectShadowElement, 'delegatesFocus', {
      configurable: true,
      value: true,
    });
  }
  return DirectShadowElement;
}
