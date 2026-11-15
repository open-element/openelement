/**
 * @openelement/router/server-runtime — SSR registry guard.
 *
 * The request-time registration security of the generated entry (#952,
 * #965, #1339): the idempotent `customElements.define` wrapper, the
 * registration-ownership tracking, and the fail-closed conflict rule the
 * entry's component registrations run through. The guard lives in this real
 * module rather than inside a codegen template string, so it is directly
 * unit-testable.
 *
 * The marker constants are imported from the canonical protocol module
 * (../protocol/registry-markers.ts) instead of being injected into the
 * generated strings: the guard module is inside the Router package, so the
 * writers and the reader now share one import edge and no second literal can
 * drift. The wire values themselves stay pinned by
 * registry-marker-drift.test.ts — they still cross process/module-evaluation
 * boundaries (the stub registry written by ssr-polyfills.ts) that no import
 * edge can carry.
 *
 * The canonical dangerous-key set rides the kernel-free `/authoring` leaf —
 * the same transport as the action protocol constants — so the props
 * projection binds the canonical policy and the generated entry carries no
 * serialized copy of it (#1470 block e).
 */

import { DANGEROUS_KEYS } from '@openelement/element/authoring';
import {
  ENTRY_REGISTRATION_OWNERS,
  SSR_REGISTRY_GENERATED_HOSTS,
  SSR_REGISTRY_ORIGINAL_DEFINE,
  SSR_REGISTRY_STUB_MARKER,
} from '@openelement/protocol/registry-markers';

export { DANGEROUS_KEYS };

/** What the generated entry gets from {@linkcode installSsrRegistryGuard}. */
export interface SsrRegistryGuard {
  /**
   * Registers one component class under `tag` with the same
   * ownership/conflict rules the generated entry has always applied
   * (#952, #1339).
   */
  register(tag: string, ctor: unknown): void;
  /**
   * Registers one generated element class AND its compiler-emitted host
   * renderer as ONE atomic pair (M11 complete vertical).
   *
   * The pair is written under {@linkcode SSR_REGISTRY_GENERATED_HOSTS} only
   * when this call actually owns the class registration after running the
   * EXISTING define/ownership decision: a foreign (entry-unowned) conflict
   * pairs neither half, and a dev re-evaluation replaces both halves together.
   * The renderer is the emitted `<Name>__ssrHost` the generated entry imports
   * statically from the compiler fact; it is not a class static and never a
   * namespace-suffix lookup.
   */
  registerIsland(tag: string, ctor: unknown, hostRenderer: unknown): void;
}

interface MinimalRegistry {
  define(name: string, ctor: unknown, options?: ElementDefinitionOptions): void;
  get(name: string): unknown;
}

/**
 * Installs the SSR registry guard and returns its registration seam.
 *
 * Behavior contract (moved verbatim from the generated entry):
 * - The TRUE original `define` is captured ONCE on the registry itself
 *   (SSR_REGISTRY_ORIGINAL_DEFINE): the registry outlives vite dev SSR
 *   module re-evaluations, so a second installation must never capture the
 *   already-wrapped `define` as its "original" (#1339).
 * - On the dev SSR stub registry (SSR_REGISTRY_STUB_MARKER) re-definition
 *   WINS — the registry outlives module re-evaluation, so route edits only
 *   reach SSR output when define() overwrites the stale class (#952).
 * - `NotSupportedError` from a non-stub registry is swallowed (the shim's
 *   duplicate-define rejection is its designed live-reload notice); any
 *   other error propagates.
 * - A tag the entry registered itself (ownership map) is re-registered
 *   through the TRUE original define — a dev re-evaluation registers a FRESH
 *   class for the SAME tag and the new class must win. A registration the
 *   entry did NOT make is a genuine conflict and keeps the fail-closed
 *   no-op.
 */
export function installSsrRegistryGuard(): SsrRegistryGuard {
  const registry = globalThis.customElements as MinimalRegistry;
  const owned = (registry as unknown as Record<string, unknown>)[ENTRY_REGISTRATION_OWNERS] as
    | Map<string, unknown>
    | undefined;
  const entryDefined = owned ?? new Map<string, unknown>();
  if (!owned) {
    (registry as unknown as Record<string, unknown>)[ENTRY_REGISTRATION_OWNERS] = entryDefined;
  }
  const originalDefine = (registry as unknown as Record<string, unknown>)[
    SSR_REGISTRY_ORIGINAL_DEFINE
  ] as MinimalRegistry['define'] | undefined;
  if (!originalDefine) {
    (registry as unknown as Record<string, unknown>)[SSR_REGISTRY_ORIGINAL_DEFINE] =
      registry.define.bind(registry);
    registry.define = (name: string, ctor: unknown, options?: ElementDefinitionOptions) => {
      const stubbed = (registry as unknown as Record<string, unknown>)[SSR_REGISTRY_STUB_MARKER];
      if (!stubbed && registry.get(name)) return;
      try {
        (
          (registry as unknown as Record<string, unknown>)[
            SSR_REGISTRY_ORIGINAL_DEFINE
          ] as MinimalRegistry['define']
        )(name, ctor, options);
      } catch (e) {
        if (e && (e as { name?: string }).name === 'NotSupportedError') return;
        throw e;
      }
    };
  }
  /**
   * The ONE registration decision both the class-only call and the
   * generated-island pairing call run. Returns whether this entry owns `tag`
   * after the call — i.e. whether the class half is in place — so the pairing
   * path can never write a renderer for a class it did not register.
   */
  const registerOwned = (tag: string, ctor: unknown): boolean => {
    const current = registry.get(tag);
    if ((registry as unknown as Record<string, unknown>)[SSR_REGISTRY_STUB_MARKER]) {
      if (current && entryDefined.get(tag) !== current) return false;
      registry.define(tag, ctor);
      entryDefined.set(tag, ctor);
      return true;
    }
    if (!current) {
      registry.define(tag, ctor);
      entryDefined.set(tag, ctor);
      return true;
    }
    if (current === ctor) return entryDefined.get(tag) === ctor;
    // #1339: the registry outlives vite dev SSR module re-evaluation, so a
    // page/island edit re-registers the SAME tag with a FRESH class while
    // the stale class is still registered. When the entry re-registers its
    // OWN tag, the new class must win — through the TRUE original define
    // (the wrapper early-returns on existing registrations for non-stub
    // registries); the Map-backed dev SSR stub registry overwrites on
    // duplicate define (#952) instead of rejecting the re-registration.
    if (entryDefined.get(tag) === current) {
      (
        (registry as unknown as Record<string, unknown>)[
          SSR_REGISTRY_ORIGINAL_DEFINE
        ] as MinimalRegistry['define']
      )(tag, ctor);
      entryDefined.set(tag, ctor);
      return true;
    }
    return false;
  };
  /**
   * Drop any host renderer paired with `tag`. The pair is only meaningful for
   * the class registration it was written with, so every path that does not
   * (re)write the pair for this tag clears it: a class-only re-registration
   * (the island lost its producer) and a lost ownership conflict (the class is
   * no longer entry-owned) must never leave a stale renderer behind (review
   * B1). Keeping an empty Map preserves the one-writer/one-reader contract.
   */
  const clearPair = (tag: string): void => {
    const registryRecord = registry as unknown as Record<string, unknown>;
    const hosts = registryRecord[SSR_REGISTRY_GENERATED_HOSTS] as Map<string, unknown> | undefined;
    if (hosts instanceof Map) hosts.delete(tag);
  };
  return {
    register(tag: string, ctor: unknown) {
      registerOwned(tag, ctor);
      // The class-only path owns no host renderer: clear any stale pair so the
      // serializer can never invoke an old producer against this registration.
      clearPair(tag);
    },
    registerIsland(tag: string, ctor: unknown, hostRenderer: unknown) {
      // Validate BEFORE any registry mutation: a generated entry can only pass
      // the compiled class and the emitted producer function, so a mismatch is
      // an internal defect that must not leave a half-registered tag.
      if (typeof ctor !== 'function' || typeof hostRenderer !== 'function') {
        throw new TypeError(
          `[openElement] registerIsland(${JSON.stringify(tag)}) requires the generated element ` +
            'class and its compiler-emitted host renderer; got class ' +
            `${typeof ctor} and renderer ${typeof hostRenderer}. Both arguments come from the ` +
            "compiler's own generated artifacts.",
        );
      }
      if (!registerOwned(tag, ctor)) {
        // Foreign conflict: the class half did not move, so any pair left from
        // an earlier ownership must go with it (atomic pairing, review B1).
        clearPair(tag);
        return;
      }
      const registryRecord = registry as unknown as Record<string, unknown>;
      let hosts = registryRecord[SSR_REGISTRY_GENERATED_HOSTS] as Map<string, unknown> | undefined;
      if (!hosts) {
        hosts = new Map<string, unknown>();
        registryRecord[SSR_REGISTRY_GENERATED_HOSTS] = hosts;
      }
      hosts.set(tag, hostRenderer);
    },
  };
}
