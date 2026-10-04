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
  SSR_REGISTRY_ORIGINAL_DEFINE,
  SSR_REGISTRY_STUB_MARKER,
} from '../protocol/registry-markers.ts';

export { DANGEROUS_KEYS };

/** What the generated entry gets from {@linkcode installSsrRegistryGuard}. */
export interface SsrRegistryGuard {
  /**
   * Registers one component class under `tag` with the same
   * ownership/conflict rules the generated entry has always applied
   * (#952, #1339).
   */
  register(tag: string, ctor: unknown): void;
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
  return {
    register(tag: string, ctor: unknown) {
      const current = registry.get(tag);
      if ((registry as unknown as Record<string, unknown>)[SSR_REGISTRY_STUB_MARKER]) {
        if (current && entryDefined.get(tag) !== current) return;
        registry.define(tag, ctor);
        entryDefined.set(tag, ctor);
        return;
      }
      if (!current) {
        registry.define(tag, ctor);
        entryDefined.set(tag, ctor);
        return;
      }
      if (current === ctor) return;
      // #1339: the registry outlives vite dev SSR module re-evaluation, so a
      // page/island edit re-registers the SAME tag with a FRESH class while
      // the stale class is still registered. When the entry re-registers its
      // OWN tag, the new class must win — through the TRUE original define
      // (the wrapper early-returns on existing registrations for non-stub
      // registries); the lit shim overwrites on duplicate define in
      // development mode (its console.warn is the upstream-designed
      // live-reload notice).
      if (entryDefined.get(tag) === current) {
        (
          (registry as unknown as Record<string, unknown>)[
            SSR_REGISTRY_ORIGINAL_DEFINE
          ] as MinimalRegistry['define']
        )(tag, ctor);
        entryDefined.set(tag, ctor);
      }
    },
  };
}
