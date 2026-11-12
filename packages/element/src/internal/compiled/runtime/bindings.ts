/**
 * Neutral write-subscription and guarded-update plumbing shared by the Part
 * Program kernel and the generated-code runtime primitives.
 *
 * The Part Program kernel (`program-kernel.ts`) and the M04 recipe/projection
 * primitives need the same three mechanisms — resolve a host signal by name,
 * subscribe to future writes only, and isolate a signal-driven update error —
 * but the kernel's forms are bound to its `MountContext` (program origin,
 * host dialect) while the generated path must stay compiler-neutral. The
 * mechanism therefore lives once here; `program-kernel.ts` keeps its
 * context-shaped wrappers and delegates, so there is one subscription
 * discipline on both paths (no second subscription implementation).
 *
 * @module ./bindings.ts
 */

import type { SignalLike } from '@openelement/protocol/signal';
import { raiseFrameworkError, RuntimeErrorCode } from '@openelement/protocol/errors';
import type { LifetimeScope } from '../lifetime-scope.ts';
import { runUntracked } from '../../signal/preact-engine.ts';
import { recordSubscriptionClosed, recordSubscriptionOpened } from './observability.ts';

/**
 * Look up one host signal without subscribing, discovering or validating the
 * host record: `undefined` means the name is not registered. The caller owns
 * the diagnostic (the Part Program kernel names the program origin; a
 * generated module names its own host contract).
 */
export function lookupSignal<T>(
  signals: Readonly<Record<string, SignalLike<T>>>,
  name: string,
): SignalLike<T> | undefined {
  const signal: SignalLike<T> | undefined = signals[name];
  return signal;
}

/**
 * Subscribe to FUTURE writes only, on a scope's lifetime.
 *
 * Preact's adapter delivers a synchronous initial effect; a conforming lazy
 * engine may not. Only that exact subscription-time echo (a delivery equal to
 * the value read at subscribe time) is ignored, so a lazy engine's first real
 * write is never lost. The subscription is released with the scope, and an
 * update that arrives after disposal is dropped.
 *
 * `name` is used only for the coded failure when an engine returns something
 * that is not an unsubscribe function.
 */
export function bindSignalWrites(
  scope: LifetimeScope,
  signal: SignalLike<unknown>,
  name: string,
  fn: (value: unknown) => void,
): void {
  const snapshot = signal.value;
  let subscribeReturned = false;
  const unsub = signal.subscribe((value) => {
    if (!subscribeReturned && Object.is(value, snapshot)) return;
    if (!scope.disposed) fn(value);
  });
  subscribeReturned = true;
  if (typeof unsub !== 'function') {
    raiseFrameworkError(
      'render',
      RuntimeErrorCode.SUBSCRIPTION_INVALID,
      `[compiled-runtime] signal "${name}" returned an invalid unsubscribe`,
    );
  }
  recordSubscriptionOpened();
  scope.add(() => {
    recordSubscriptionClosed();
    unsub();
  });
}

/**
 * Run a generated branch/entry builder without letting its initial value reads
 * become dependencies of the enclosing write subscription.
 *
 * A condition refresh runs inside the test signal's effect. Creating the selected
 * branch there also evaluates that branch's dynamic slots and opens their own
 * subscriptions. Without this boundary, one slot's `label.value` read would join
 * the enclosing test subscription, so a label write would re-run the branch
 * refresh (and rebuild the branch) even though the test did not change. The
 * branch's own subscriptions are created inside the callback and still track
 * their signals independently; only the enclosing subscription's dependency
 * capture is suppressed.
 */
export { runUntracked };

/**
 * Wrap one Block update callback with the update-phase isolation contract
 * (#1375): a throw is reported to the supplied sink (the kernel's
 * CompiledErrorBoundary) and not rethrown, so the failing write never escapes
 * into the signal writer's stack and the subscription stays live for the next
 * write. With no sink the propagating behavior is kept.
 */
export function guardUpdate(
  fn: (value: unknown) => void,
  onError?: (error: unknown) => void,
): (value: unknown) => void {
  return (value) => {
    try {
      fn(value);
    } catch (error) {
      if (!onError) throw error;
      onError(error);
    }
  };
}
