import type { StyleSheetLike } from '@openelement/protocol/style-sheet';
import type { CompiledStyleScope } from '../../../open-element-styles.ts';
import { LifetimeScope } from '../lifetime-scope.ts';
import { claimRecipe, insertRecipe, type Recipe, type Projection } from '../runtime/recipe.ts';
import {
  releasePreUpgradeCapturesFor,
  replayPreUpgradeCaptures,
} from '../runtime/pre-upgrade-replay-hook.ts';

/**
 * Run every cleanup even when one throws; surface the FIRST error only. This is
 * how teardown preserves the original resource/range error instead of letting a
 * later root-scope cleanup replace it.
 */
export function captureCleanupFailures(cleanups: readonly (() => void)[]): void {
  let firstError: unknown;
  let failed = false;
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      if (!failed) {
        firstError = error;
        failed = true;
      }
    }
  }
  if (failed) throw firstError;
}

/**
 * Create and retain the element/island-lifetime instance scope and its setup
 * record (LC-0). Called from the first connect's call-once/retain site.
 *
 * The setup factory receives a real owner: setup-owned resources register on it
 * and are released only by explicit teardown. A throw is rolled back HERE with
 * every setup cleanup attempted (detach mode, because a failed setup never
 * attaches a region) and the ORIGINAL setup error rethrown; the fields are
 * cleared so the next connect retries setup on a fresh instance.
 */
export function retainGeneratedInstance(
  state: {
    instance: LifetimeScope | null;
    bindings: Readonly<Record<string, unknown>> | null;
  },
  createBindings: (instance: LifetimeScope) => Readonly<Record<string, unknown>>,
): LifetimeScope {
  const existing = state.instance;
  if (existing !== null) return existing;
  const instance = new LifetimeScope();
  try {
    const record = createBindings(instance);
    state.instance = instance;
    state.bindings = record;
    return instance;
  } catch (error) {
    try {
      instance.dispose(true);
    } catch {
      // Keep the original setup error; every cleanup was still attempted.
    }
    state.instance = null;
    state.bindings = null;
    throw error;
  }
}

/**
 * Release a FAILED connect's own state without letting a cleanup error replace
 * the original connect/claim error: every step runs, in order, errors dropped.
 */
export function releaseIgnoringErrors(steps: readonly (() => void)[]): void {
  for (const step of steps) {
    try {
      step();
    } catch {
      // The original connect/claim error is what surfaces.
    }
  }
}

/**
 * Adopt a CLIENT-ONLY island's declared sheets into the root this element owns
 * (2026-11-20 client style-adoption slice).
 *
 * Only a shell-created shadow root or a light root is a target here. An adopted
 * DSD root already carries the compiler's canonical marked `<link>` INSIDE its
 * template — that template is the sheet's delivery, and `sheetDeliveredByLink`
 * exists to keep a second constructable copy off it. The compiler never emits a
 * descriptor `styles` row for an SSR/DSD island, so this gate is the shell's own
 * statement of the same one-delivery rule, not a second policy.
 *
 * The scope is the class lane's `CompiledStyleScope`; `connect` is idempotent
 * (a sheet the root already adopted is not added twice), so a reconnect re-arms
 * the same root without a bookkeeping copy. Disconnect removes a shadow root's
 * adopted sheets only — a document's are shared per component type and stay.
 */
export function adoptGeneratedClientStyles(
  scope: CompiledStyleScope,
  root: HTMLElement | ShadowRoot,
  constructor: unknown,
  styles: readonly StyleSheetLike[],
  canAdoptDeclared: boolean,
): void {
  // A dev live sheet is adopted even into an ADOPTED (DSD) root: that is the whole
  // point of the field — dev must re-fill the same sheet object in place for HMR,
  // which a `<link>` delivered sheet cannot do. Build never sets it, so the
  // link-only rule is unchanged there.
  //
  // It is read off the CONSTRUCTOR, not the descriptor: the descriptor is a
  // module-local constant the dev entry cannot reach, while the class it defines is
  // a global the entry can annotate right after `customElements.define`.
  const devLive = (constructor as { __oeDevLiveStyles?: readonly StyleSheetLike[] } | undefined)
    ?.__oeDevLiveStyles;
  if (devLive !== undefined && devLive.length > 0) {
    scope.connect(root, [...devLive]);
    return;
  }
  if (canAdoptDeclared && styles.length > 0) scope.connect(root, [...styles]);
}

type RegionState = 'unobserved' | 'present' | 'absent';

export function observeGeneratedRegion(
  state: { regionState: RegionState },
  root: HTMLElement | ShadowRoot,
  canClaimExisting: boolean,
): void {
  if (state.regionState === 'unobserved') {
    state.regionState = canClaimExisting && root.childNodes.length > 0 ? 'present' : 'absent';
  }
}

export function projectGeneratedRegion(
  state: { regionState: RegionState },
  owner: LifetimeScope,
  recipe: Recipe<Record<string, unknown>>,
  parent: HTMLElement | ShadowRoot,
): Projection<Record<string, unknown>> {
  return state.regionState === 'present'
    ? claimRecipe(owner, recipe, parent)
    : insertRecipe(owner, recipe, parent);
}

export function replayFirstGeneratedConnection(element: HTMLElement, hadInstance: boolean): void {
  if (!hadInstance) replayPreUpgradeCaptures(element);
}

export function finishGeneratedConnection(
  element: HTMLElement,
  state: { connecting: boolean },
): void {
  state.connecting = false;
  releasePreUpgradeCapturesFor(element);
}
