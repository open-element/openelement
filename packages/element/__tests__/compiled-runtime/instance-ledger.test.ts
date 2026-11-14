/**
 * The private instance-ledger prerequisite for `16b-LC-2` nested generated
 * retention (design `nested-retention-design.md` §A Addendum, independent
 * review P1). These probes exercise the runtime primitive directly against
 * REAL `LifetimeScope` owners and REAL registered cleanups (including cleanups
 * that throw) — no mocks, no skips, no generated code.
 *
 * Pinned here:
 *
 * - reuse-or-create per `(owner, siteKey)`, with the retained scope a real
 *   child of the enclosing logical-instance owner and setup running exactly
 *   once (a retained `undefined` record is a value, not a miss);
 * - setup failure: every cleanup attempted, the ORIGINAL setup error rethrown,
 *   nothing stored (the next call retries on a fresh scope);
 * - explicit release is idempotent, plain (`dispose(false)`; a retained range
 *   cleanup never runs from eviction) and propagates the first cleanup error;
 * - dispose mode is never a retention signal: a structural scope's own
 *   `dispose(false)`/`dispose(true)` never evicts, and an explicit release still
 *   works after that scope was disposed;
 * - owner/site isolation and per-owner pass independence;
 * - pass commit marks + sweeps, abort keeps every pre-existing entry and evicts
 *   only the ones created in the aborted pass (retry commits exactly once);
 * - staged structural-owner rebinding: commit applies it, abort discards it and
 *   the previous release index survives; explicit release during an open pass
 *   drops the staged rebinding and cannot be resurrected by the commit;
 * - setup one-shot guards: a same-site retain from inside that site's own setup
 *   is refused (no orphan entry), and a setup that returns after disposing its
 *   retained scope or owner is refused with no entry stored;
 * - abort rollback refuses a retain attempted from its own cleanup (no leaked
 *   survivor) while the caller's original pass failure stays the surfaced one;
 * - release during an open pass (exact-site and structural) evicts immediately
 *   and the commit cannot resurrect the released entries;
 * - disposed owner/entry are never reused, and the release paths still clean
 *   their bookkeeping (so a stale structural index cannot evict a newer entry);
 * - nested ledgers: a retained child scope is its own owner, and owner teardown
 *   cleans grandchild resources through the `LifetimeScope` cascade (this
 *   module performs NO cross-ledger sweep, by contract);
 * - end-sweep cleanup errors: every swept scope is disposed, then the first
 *   error surfaces and the pass is already closed.
 *
 * NON-CLAIMS: this is a runtime prerequisite only. Nested retention is not
 * wired by this slice, no compiler/shell/emitter text or descriptor is
 * exercised, and nothing here is 16b-LC / §4.1d / M09 exit evidence.
 */

import { expect, test } from 'vitest';
import { KernelErrorCode, OpenElementError } from '@openelement/protocol/errors';
import { LifetimeScope, parentScopeOf } from '../../src/internal/compiled/lifetime-scope.ts';
import {
  abortInstancePass,
  beginInstancePass,
  endInstancePass,
  INSTANCE_LEDGER_DUPLICATE,
  INSTANCE_LEDGER_REENTRANT,
  INSTANCE_LEDGER_ROLLBACK,
  INSTANCE_LEDGER_STATE,
  releaseChildInstance,
  releaseUnderStructuralScope,
  retainChildInstance,
} from '../../src/internal/compiled/runtime/instance-ledger.ts';

/** Run `run` and return what it threw (fails the test when it does not throw). */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

/** Run `run`, expect the coded framework error, and return it. */
function codedFailure(run: () => unknown): OpenElementError {
  const thrown = thrownBy(run);
  if (thrown instanceof OpenElementError) return thrown;
  throw thrown;
}

test('retain is reuse-or-create: setup runs once and the scope is the owner child', () => {
  const owner = new LifetimeScope();
  const structural = owner.child();
  const cleanups: string[] = [];
  let setups = 0;
  const seen: LifetimeScope[] = [];

  const first = retainChildInstance(owner, 'fixtures/Child.tsx:10:42', structural, (scope) => {
    setups += 1;
    seen.push(scope);
    scope.add(() => cleanups.push('resource'));
    return { label: 'first' };
  });
  const second = retainChildInstance(owner, 'fixtures/Child.tsx:10:42', structural, () => {
    setups += 1;
    return { label: 'second' };
  });

  expect(setups).toBe(1);
  expect(second).toBe(first);
  expect(second.scope).toBe(first.scope);
  expect(second.record).toBe(first.record);
  expect(first.record.label).toBe('first');
  expect(seen).toEqual([first.scope]);
  expect(parentScopeOf(first.scope)).toBe(owner);

  owner.dispose();
  expect(first.scope.disposed).toBe(true);
  expect(cleanups).toEqual(['resource']);
});

test('a retained undefined record is a value: the entry is reused, not re-evaluated', () => {
  const owner = new LifetimeScope();
  let setups = 0;
  const first = retainChildInstance<undefined>(owner, 'site', null, () => {
    setups += 1;
    return undefined;
  });
  const second = retainChildInstance<undefined>(owner, 'site', null, () => {
    setups += 1;
    return undefined;
  });

  expect(second).toBe(first);
  expect(second.record).toBeUndefined();
  expect(setups).toBe(1);
  owner.dispose();
});

test('setup failure disposes its scope, attempts every cleanup, and rethrows the original error', () => {
  const owner = new LifetimeScope();
  const ran: string[] = [];
  const setupBoom = new Error('setup boom');
  const cleanupBoom = new Error('cleanup boom');

  const thrown = thrownBy(() =>
    retainChildInstance(owner, 'site', null, (scope) => {
      scope.add(() => ran.push('first'));
      scope.add(() => {
        ran.push('second');
        throw cleanupBoom;
      });
      throw setupBoom;
    }),
  );

  expect(thrown).toBe(setupBoom);
  // LIFO disposal attempted every cleanup even though one threw.
  expect(ran).toEqual(['second', 'first']);

  let retried = 0;
  const entry = retainChildInstance(owner, 'site', null, (scope) => {
    scope.add(() => retried++);
    return { ok: true };
  });
  expect(retried).toBe(0);
  expect(entry.record.ok).toBe(true);
  owner.dispose();
  expect(retried).toBe(1);
});

test('explicit release is idempotent, disposes plain, and never runs a range cleanup', () => {
  const owner = new LifetimeScope();
  let resources = 0;
  let ranges = 0;
  const entry = retainChildInstance(owner, 'site', null, (scope) => {
    scope.add(() => resources++);
    scope.addRangeCleanup(() => ranges++);
    return {};
  });

  releaseChildInstance(owner, 'site');
  expect(entry.scope.disposed).toBe(true);
  expect(resources).toBe(1);
  // Plain disposal: eviction never asks for the region-removal mode.
  expect(ranges).toBe(0);

  releaseChildInstance(owner, 'site');
  releaseChildInstance(owner, 'unknown-site');
  expect(resources).toBe(1);
  expect(ranges).toBe(0);
  owner.dispose();
});

test('release propagates the first cleanup error after attempting all and stays evicted', () => {
  const owner = new LifetimeScope();
  const ran: string[] = [];
  const cleanupBoom = new Error('cleanup boom');
  const entry = retainChildInstance(owner, 'site', null, (scope) => {
    scope.add(() => ran.push('first'));
    scope.add(() => {
      ran.push('second');
      throw cleanupBoom;
    });
    return {};
  });

  expect(thrownBy(() => releaseChildInstance(owner, 'site'))).toBe(cleanupBoom);
  expect(ran).toEqual(['second', 'first']);
  expect(entry.scope.disposed).toBe(true);

  // Bookkeeping was deleted before disposal: a second release is a no-op.
  releaseChildInstance(owner, 'site');
  expect(ran).toEqual(['second', 'first']);
  owner.dispose();
});

test('dispose mode is not a retention signal: structural disposal never evicts', () => {
  const owner = new LifetimeScope();
  const structural = owner.child();
  let setups = 0;
  let resources = 0;
  const entry = retainChildInstance(owner, 'site', structural, (scope) => {
    setups += 1;
    scope.add(() => resources++);
    return { n: 1 };
  });

  // Detach-mode disposal of the structural region is NOT a logical release.
  structural.dispose(true);
  expect(entry.scope.disposed).toBe(false);
  expect(resources).toBe(0);
  expect(retainChildInstance(owner, 'site', structural, () => ({ n: 2 }))).toBe(entry);
  expect(setups).toBe(1);

  // Plain-mode disposal is likewise not a release; explicit release still works
  // after the structural scope is gone.
  const plainStructural = owner.child();
  const second = retainChildInstance(owner, 'second', plainStructural, () => ({ n: 3 }));
  plainStructural.dispose(false);
  expect(second.scope.disposed).toBe(false);
  releaseUnderStructuralScope(plainStructural);
  expect(second.scope.disposed).toBe(true);
  releaseUnderStructuralScope(plainStructural);
  expect(second.scope.disposed).toBe(true);

  owner.dispose();
  expect(entry.scope.disposed).toBe(true);
});

test('owner and site keyspaces are isolated', () => {
  const ownerA = new LifetimeScope();
  const ownerB = new LifetimeScope();
  const structural = new LifetimeScope();

  const a = retainChildInstance(ownerA, 'same-site', structural, () => ({ owner: 'a' }));
  const b = retainChildInstance(ownerB, 'same-site', structural, () => ({ owner: 'b' }));
  expect(a).not.toBe(b);
  expect(a.scope).not.toBe(b.scope);
  expect(a.record.owner).toBe('a');
  expect(b.record.owner).toBe('b');

  releaseChildInstance(ownerA, 'same-site');
  expect(a.scope.disposed).toBe(true);
  expect(b.scope.disposed).toBe(false);

  const otherSite = retainChildInstance(ownerB, 'other-site', structural, () => ({ owner: 'b2' }));
  expect(otherSite).not.toBe(b);
  releaseChildInstance(ownerB, 'same-site');
  expect(otherSite.scope.disposed).toBe(false);

  ownerA.dispose();
  ownerB.dispose();
  expect(otherSite.scope.disposed).toBe(true);
});

test('passes are per owner: aborting one owner leaves the other owner untouched', () => {
  const ownerA = new LifetimeScope();
  const ownerB = new LifetimeScope();
  beginInstancePass(ownerA);
  beginInstancePass(ownerB);
  const a = retainChildInstance(ownerA, 'site', null, () => ({}));
  const b = retainChildInstance(ownerB, 'site', null, () => ({}));

  abortInstancePass(ownerA);
  expect(a.scope.disposed).toBe(true);
  expect(b.scope.disposed).toBe(false);

  endInstancePass(ownerB);
  expect(b.scope.disposed).toBe(false);
  ownerB.dispose();
});

test('pass commit keeps marked sites and sweeps the structurally absent ones', () => {
  const owner = new LifetimeScope();
  const structural = owner.child();
  let retainedCleanups = 0;
  let absentCleanups = 0;

  beginInstancePass(owner);
  const absent = retainChildInstance(owner, 'absent', structural, (scope) => {
    scope.add(() => absentCleanups++);
    return {};
  });
  const retained = retainChildInstance(owner, 'retained', structural, (scope) => {
    scope.add(() => retainedCleanups++);
    return {};
  });
  endInstancePass(owner);
  expect(absent.scope.disposed).toBe(false);
  expect(retained.scope.disposed).toBe(false);

  beginInstancePass(owner);
  const same = retainChildInstance(owner, 'retained', structural, () => {
    throw new Error('the committed entry must not be re-evaluated');
  });
  endInstancePass(owner);

  expect(same).toBe(retained);
  expect(retained.scope.disposed).toBe(false);
  expect(retainedCleanups).toBe(0);
  expect(absent.scope.disposed).toBe(true);
  expect(absentCleanups).toBe(1);

  owner.dispose();
  expect(retainedCleanups).toBe(1);
});

test('abort keeps pre-existing entries and evicts only the ones created in the failed pass', () => {
  const owner = new LifetimeScope();
  const structural = owner.child();
  let committedCleanups = 0;
  let setupCount = 0;
  let uncommittedCleanups = 0;

  beginInstancePass(owner);
  const committed = retainChildInstance(owner, 'committed', structural, (scope) => {
    setupCount += 1;
    scope.add(() => committedCleanups++);
    return { value: 1 };
  });
  endInstancePass(owner);

  beginInstancePass(owner);
  const uncommitted = retainChildInstance(owner, 'uncommitted', structural, (scope) => {
    setupCount += 1;
    scope.add(() => uncommittedCleanups++);
    return { value: 2 };
  });
  const reused = retainChildInstance(owner, 'committed', structural, () => {
    throw new Error('a pre-existing entry is never re-evaluated');
  });
  abortInstancePass(owner);

  expect(reused).toBe(committed);
  expect(committed.scope.disposed).toBe(false);
  expect(committedCleanups).toBe(0);
  expect(uncommitted.scope.disposed).toBe(true);
  expect(uncommittedCleanups).toBe(1);
  expect(setupCount).toBe(2);

  // The retry commits exactly once: the pre-existing entry is reused and the
  // rolled-back site runs setup for the first time on the committed attempt.
  beginInstancePass(owner);
  const retried = retainChildInstance(owner, 'uncommitted', structural, () => {
    setupCount += 1;
    return { value: 3 };
  });
  expect(retainChildInstance(owner, 'committed', structural, () => ({}))).toBe(committed);
  endInstancePass(owner);

  expect(setupCount).toBe(3);
  expect(retried).not.toBe(uncommitted);
  expect(retried.record.value).toBe(3);
  expect(retried.scope.disposed).toBe(false);

  owner.dispose();
  expect(committedCleanups).toBe(1);
  expect(uncommittedCleanups).toBe(1);
});

test('abort drops rollback cleanup errors and is a no-op with no open pass', () => {
  const owner = new LifetimeScope();
  const cleanupBoom = new Error('rollback cleanup boom');
  abortInstancePass(owner);

  beginInstancePass(owner);
  retainChildInstance(owner, 'site', null, (scope) => {
    scope.add(() => {
      throw cleanupBoom;
    });
    return {};
  });
  // The caller is rethrowing the pass failure; abort must not replace it.
  abortInstancePass(owner);
  abortInstancePass(owner);
  owner.dispose();
});

test('pass bracket violations are coded and leave the ledger usable', () => {
  const owner = new LifetimeScope();

  beginInstancePass(owner);
  const doubleBegin = codedFailure(() => beginInstancePass(owner));
  expect(doubleBegin.code).toBe(INSTANCE_LEDGER_STATE);

  // The first pass is still open and usable after the refused second begin.
  const entry = retainChildInstance(owner, 'site', null, () => ({}));
  endInstancePass(owner);
  expect(entry.scope.disposed).toBe(false);

  const endWithoutPass = codedFailure(() => endInstancePass(owner));
  expect(endWithoutPass.code).toBe(INSTANCE_LEDGER_STATE);

  beginInstancePass(owner);
  endInstancePass(owner);
  owner.dispose();
});

test('the same site retained twice in one pass is a coded failure and aborts with the pass', () => {
  const owner = new LifetimeScope();
  let cleanups = 0;
  beginInstancePass(owner);
  const entry = retainChildInstance(owner, 'fixtures/Child.tsx:7:9', null, (scope) => {
    scope.add(() => cleanups++);
    return {};
  });

  const duplicate = codedFailure(() =>
    retainChildInstance(owner, 'fixtures/Child.tsx:7:9', null, () => {
      throw new Error('must not be evaluated');
    }),
  );
  expect(duplicate.code).toBe(INSTANCE_LEDGER_DUPLICATE);
  expect(duplicate.message).toContain('fixtures/Child.tsx:7:9');

  abortInstancePass(owner);
  expect(entry.scope.disposed).toBe(true);
  expect(cleanups).toBe(1);
  owner.dispose();
});

test('staged structural rebinding commits: release bookkeeping follows the latest pass', () => {
  const owner = new LifetimeScope();
  const mountStructural = owner.child();
  const entry = retainChildInstance(owner, 'site', mountStructural, () => ({ n: 1 }));

  const claimStructural = owner.child();
  beginInstancePass(owner);
  expect(retainChildInstance(owner, 'site', claimStructural, () => ({ n: 2 }))).toBe(entry);
  endInstancePass(owner);

  // The previous mount index is retracted by the commit; the claim index owns it.
  releaseUnderStructuralScope(mountStructural);
  expect(entry.scope.disposed).toBe(false);
  releaseUnderStructuralScope(claimStructural);
  expect(entry.scope.disposed).toBe(true);
  owner.dispose();
});

test('staged structural rebinding is discarded by abort: the previous index survives', () => {
  const owner = new LifetimeScope();
  const mountStructural = owner.child();
  const entry = retainChildInstance(owner, 'site', mountStructural, () => ({ n: 1 }));

  const claimStructural = owner.child();
  beginInstancePass(owner);
  retainChildInstance(owner, 'site', claimStructural, () => ({ n: 2 }));
  abortInstancePass(owner);

  // Abort never re-points release bookkeeping at the rolled-back connection.
  releaseUnderStructuralScope(claimStructural);
  expect(entry.scope.disposed).toBe(false);
  releaseUnderStructuralScope(mountStructural);
  expect(entry.scope.disposed).toBe(true);
  owner.dispose();
});

test('abort keeps the last committed index instead of reverting to an older one', () => {
  const owner = new LifetimeScope();
  const firstStructural = owner.child();
  const entry = retainChildInstance(owner, 'site', firstStructural, () => ({}));

  const committedStructural = owner.child();
  beginInstancePass(owner);
  retainChildInstance(owner, 'site', committedStructural, () => ({}));
  endInstancePass(owner);

  const abortedStructural = owner.child();
  beginInstancePass(owner);
  retainChildInstance(owner, 'site', abortedStructural, () => ({}));
  abortInstancePass(owner);

  releaseUnderStructuralScope(firstStructural);
  releaseUnderStructuralScope(abortedStructural);
  expect(entry.scope.disposed).toBe(false);
  releaseUnderStructuralScope(committedStructural);
  expect(entry.scope.disposed).toBe(true);
  owner.dispose();
});

test('rebinding outside a pass applies immediately', () => {
  const owner = new LifetimeScope();
  const first = owner.child();
  const second = owner.child();
  const entry = retainChildInstance(owner, 'site', first, () => ({}));
  retainChildInstance(owner, 'site', second, () => ({}));

  releaseUnderStructuralScope(first);
  expect(entry.scope.disposed).toBe(false);
  releaseUnderStructuralScope(second);
  expect(entry.scope.disposed).toBe(true);
  owner.dispose();
});

test('retain refuses a disposed owner, and release still cleans its bookkeeping', () => {
  const owner = new LifetimeScope();
  const structural = owner.child();
  let cleanups = 0;
  const entry = retainChildInstance(owner, 'site', structural, (scope) => {
    scope.add(() => cleanups++);
    return {};
  });

  owner.dispose();
  expect(entry.scope.disposed).toBe(true);
  expect(cleanups).toBe(1);

  const refused = codedFailure(() =>
    retainChildInstance(owner, 'site', structural, () => {
      throw new Error('must not be evaluated');
    }),
  );
  expect(refused.code).toBe(KernelErrorCode.DISPOSED);
  expect(cleanups).toBe(1);

  releaseChildInstance(owner, 'site');
  releaseChildInstance(owner, 'site');
  releaseUnderStructuralScope(structural);
  expect(cleanups).toBe(1);
});

test('an independently disposed retained scope is never reused, and a stale index cannot evict a newer entry', () => {
  const owner = new LifetimeScope();
  const structuralA = owner.child();
  const structuralB = owner.child();
  let setups = 0;

  const stale = retainChildInstance(owner, 'site', structuralA, () => {
    setups += 1;
    return { n: 1 };
  });
  stale.scope.dispose(true);
  expect(stale.scope.disposed).toBe(true);

  const refused = codedFailure(() =>
    retainChildInstance(owner, 'site', structuralB, () => {
      setups += 1;
      return { n: 2 };
    }),
  );
  expect(refused.code).toBe(KernelErrorCode.DISPOSED);
  expect(setups).toBe(1);

  // Explicit release is the recovery channel: it removes the stale entry's
  // bookkeeping (including its index membership) before the site is retained again.
  releaseChildInstance(owner, 'site');
  const fresh = retainChildInstance(owner, 'site', structuralB, () => {
    setups += 1;
    return { n: 3 };
  });
  expect(fresh).not.toBe(stale);
  expect(setups).toBe(2);

  // A stale index entry would delete/dispose this fresh entry by site key.
  releaseUnderStructuralScope(structuralA);
  expect(fresh.scope.disposed).toBe(false);
  releaseUnderStructuralScope(structuralB);
  expect(fresh.scope.disposed).toBe(true);
  owner.dispose();
});

test('releaseUnderStructuralScope releases the whole exact scope, all cleanups, first error', () => {
  const owner = new LifetimeScope();
  const structural = owner.child();
  const other = owner.child();
  const cleanupBoom = new Error('cleanup boom');
  let aRan = 0;
  let bRan = 0;

  const a = retainChildInstance(owner, 'a', structural, (scope) => {
    scope.add(() => {
      aRan += 1;
      throw cleanupBoom;
    });
    return {};
  });
  const b = retainChildInstance(owner, 'b', structural, (scope) => {
    scope.add(() => bRan++);
    return {};
  });
  const c = retainChildInstance(owner, 'c', other, () => ({}));
  const d = retainChildInstance(owner, 'd', null, () => ({}));

  expect(thrownBy(() => releaseUnderStructuralScope(structural))).toBe(cleanupBoom);
  expect(aRan).toBe(1);
  expect(bRan).toBe(1);
  expect(a.scope.disposed).toBe(true);
  expect(b.scope.disposed).toBe(true);
  expect(c.scope.disposed).toBe(false);
  expect(d.scope.disposed).toBe(false);

  // Idempotent: the set was removed before disposal, so no cleanup runs twice.
  releaseUnderStructuralScope(structural);
  expect(aRan).toBe(1);
  expect(bRan).toBe(1);

  releaseUnderStructuralScope(other);
  expect(c.scope.disposed).toBe(true);
  expect(d.scope.disposed).toBe(false);

  owner.dispose();
  expect(d.scope.disposed).toBe(true);
});

test('nested ledgers: a retained child owns its ledger and teardown cascades resources', () => {
  const owner = new LifetimeScope();
  let childCleanups = 0;
  let grandchildCleanups = 0;

  beginInstancePass(owner);
  const child = retainChildInstance(owner, 'child', null, (scope) => {
    scope.add(() => childCleanups++);
    return { depth: 1 };
  });

  // The child body brackets its OWN pass on its own retained scope.
  beginInstancePass(child.scope);
  const grandchild = retainChildInstance(child.scope, 'grandchild', null, (scope) => {
    scope.add(() => grandchildCleanups++);
    return { depth: 2 };
  });
  endInstancePass(child.scope);
  expect(grandchild.scope.disposed).toBe(false);

  // The parent abort evicts only the child entry; the grandchild ledger is NOT
  // walked — its resources are released by the LifetimeScope cascade.
  abortInstancePass(owner);
  expect(child.scope.disposed).toBe(true);
  expect(childCleanups).toBe(1);
  expect(grandchild.scope.disposed).toBe(true);
  expect(grandchildCleanups).toBe(1);

  // The retained scope of a torn-down owner is never reused as an owner.
  const refused = codedFailure(() =>
    retainChildInstance(child.scope, 'grandchild', null, () => {
      throw new Error('must not be evaluated');
    }),
  );
  expect(refused.code).toBe(KernelErrorCode.DISPOSED);
  owner.dispose();
});

test('end sweep surfaces the first cleanup error after every swept scope was disposed', () => {
  const owner = new LifetimeScope();
  const cleanupBoom = new Error('sweep cleanup boom');
  let secondSwept = false;

  beginInstancePass(owner);
  const first = retainChildInstance(owner, 'first', null, (scope) => {
    scope.add(() => {
      throw cleanupBoom;
    });
    return {};
  });
  const second = retainChildInstance(owner, 'second', null, (scope) => {
    scope.add(() => {
      secondSwept = true;
    });
    return {};
  });
  endInstancePass(owner);

  beginInstancePass(owner);
  expect(thrownBy(() => endInstancePass(owner))).toBe(cleanupBoom);
  expect(first.scope.disposed).toBe(true);
  expect(second.scope.disposed).toBe(true);
  expect(secondSwept).toBe(true);

  // The pass state was closed before the sweep, so the ledger stays usable.
  beginInstancePass(owner);
  endInstancePass(owner);
  owner.dispose();
});

test('same-site setup re-entry is refused and leaves no orphan entry', () => {
  const owner = new LifetimeScope();
  let setups = 0;
  let innerSetups = 0;
  let innerFailure: unknown;

  const outer = retainChildInstance(owner, 'site', null, () => {
    setups += 1;
    innerFailure = codedFailure(() =>
      retainChildInstance(owner, 'site', null, () => {
        innerSetups += 1;
        return {};
      }),
    );
    return { which: 'outer' };
  });

  expect(setups).toBe(1);
  expect(innerSetups).toBe(0);
  expect(innerFailure).toBeInstanceOf(OpenElementError);
  expect((innerFailure as OpenElementError).code).toBe(INSTANCE_LEDGER_REENTRANT);
  expect(outer.record.which).toBe('outer');

  // Exactly one entry exists: one release disposes it, and a later retain is fresh.
  releaseChildInstance(owner, 'site');
  expect(outer.scope.disposed).toBe(true);
  const fresh = retainChildInstance(owner, 'site', null, () => {
    setups += 1;
    return { which: 'fresh' };
  });
  expect(fresh).not.toBe(outer);
  expect(setups).toBe(2);
  owner.dispose();
});

test('a setup that disposes its retained scope is refused and stores no entry', () => {
  const owner = new LifetimeScope();
  let setups = 0;
  let cleanups = 0;

  const refused = codedFailure(() =>
    retainChildInstance(owner, 'site', null, (scope) => {
      setups += 1;
      scope.add(() => cleanups++);
      scope.dispose(true);
      return { n: 1 };
    }),
  );
  expect(refused.code).toBe(KernelErrorCode.DISPOSED);
  expect(setups).toBe(1);
  expect(cleanups).toBe(1);

  // No entry was stored: the retry runs setup on a fresh, live scope.
  const fresh = retainChildInstance(owner, 'site', null, () => {
    setups += 1;
    return { n: 2 };
  });
  expect(setups).toBe(2);
  expect(fresh.record.n).toBe(2);
  expect(fresh.scope.disposed).toBe(false);
  owner.dispose();
});

test('a setup that disposes its owner is refused and runs each cleanup exactly once', () => {
  const owner = new LifetimeScope();
  let cleanups = 0;
  let setups = 0;

  const refused = codedFailure(() =>
    retainChildInstance(owner, 'site', null, (scope) => {
      setups += 1;
      scope.add(() => cleanups++);
      owner.dispose();
      return {};
    }),
  );
  expect(refused.code).toBe(KernelErrorCode.DISPOSED);
  expect(owner.disposed).toBe(true);
  expect(setups).toBe(1);
  // The cascade ran the cleanup; the refusal's own rollback must not run it again.
  expect(cleanups).toBe(1);
  owner.dispose();
});

test('a retain from an abort cleanup is refused, leaves no survivor, and never masks the pass error', () => {
  const owner = new LifetimeScope();
  const passError = new Error('pass failed');
  let rollbackCode: string | undefined;
  let reopenCode: string | undefined;
  let orphanSetups = 0;

  beginInstancePass(owner);
  const victim = retainChildInstance(owner, 'victim', null, (scope) => {
    scope.add(() => {
      rollbackCode = codedFailure(() =>
        retainChildInstance(owner, 'orphan', null, () => {
          orphanSetups += 1;
          return {};
        }),
      ).code;
      // A cleanup also must not smuggle a fresh pass bracket through the abort.
      reopenCode = codedFailure(() => beginInstancePass(owner)).code;
    });
    return {};
  });

  let caught: unknown;
  try {
    throw passError;
  } catch (error) {
    caught = error;
    abortInstancePass(owner);
  }

  expect(caught).toBe(passError);
  expect(rollbackCode).toBe(INSTANCE_LEDGER_ROLLBACK);
  expect(reopenCode).toBe(INSTANCE_LEDGER_STATE);
  expect(orphanSetups).toBe(0);
  expect(victim.scope.disposed).toBe(true);

  // No leaked survivor: the site runs setup for the first time after the abort.
  const survivor = retainChildInstance(owner, 'orphan', null, () => {
    orphanSetups += 1;
    return {};
  });
  expect(orphanSetups).toBe(1);
  expect(survivor.scope.disposed).toBe(false);
  owner.dispose();
});

test('release during an open pass evicts immediately and the commit cannot resurrect it', () => {
  const owner = new LifetimeScope();
  let setups = 0;
  let cleanups = 0;

  beginInstancePass(owner);
  const entry = retainChildInstance(owner, 'site', null, (scope) => {
    setups += 1;
    scope.add(() => cleanups++);
    return {};
  });
  releaseChildInstance(owner, 'site');
  expect(entry.scope.disposed).toBe(true);
  expect(cleanups).toBe(1);

  // A released site is absent, not stale: the same pass may retain it fresh.
  const fresh = retainChildInstance(owner, 'site', null, () => {
    setups += 1;
    return {};
  });
  expect(fresh).not.toBe(entry);
  endInstancePass(owner);
  expect(fresh.scope.disposed).toBe(false);
  expect(cleanups).toBe(1);
  owner.dispose();
});

test('a site released during an open pass stays gone when that pass aborts', () => {
  const owner = new LifetimeScope();
  let releasedCleanups = 0;
  let createdCleanups = 0;

  beginInstancePass(owner);
  const released = retainChildInstance(owner, 'released', null, (scope) => {
    scope.add(() => releasedCleanups++);
    return {};
  });
  releaseChildInstance(owner, 'released');
  const created = retainChildInstance(owner, 'created', null, (scope) => {
    scope.add(() => createdCleanups++);
    return {};
  });

  abortInstancePass(owner);
  expect(released.scope.disposed).toBe(true);
  expect(releasedCleanups).toBe(1);
  expect(created.scope.disposed).toBe(true);
  expect(createdCleanups).toBe(1);

  // Nothing survived: both sites run setup fresh afterwards.
  let setups = 0;
  retainChildInstance(owner, 'released', null, () => {
    setups += 1;
    return {};
  });
  retainChildInstance(owner, 'created', null, () => {
    setups += 1;
    return {};
  });
  expect(setups).toBe(2);
  owner.dispose();
});

test('release during an open pass drops the staged rebinding before commit', () => {
  const owner = new LifetimeScope();
  const mountStructural = owner.child();
  const claimStructural = owner.child();
  const entry = retainChildInstance(owner, 'site', mountStructural, () => ({}));

  beginInstancePass(owner);
  retainChildInstance(owner, 'site', claimStructural, () => {
    throw new Error('a pre-existing entry is never re-evaluated');
  });
  releaseChildInstance(owner, 'site');
  endInstancePass(owner);

  expect(entry.scope.disposed).toBe(true);
  // Neither the old nor the staged index may evict a later entry by site key.
  const fresh = retainChildInstance(owner, 'site', claimStructural, () => ({}));
  releaseUnderStructuralScope(mountStructural);
  expect(fresh.scope.disposed).toBe(false);
  releaseUnderStructuralScope(claimStructural);
  expect(fresh.scope.disposed).toBe(true);
  owner.dispose();
});

test('releaseUnderStructuralScope during an open pass evicts its current-pass entries', () => {
  const owner = new LifetimeScope();
  const structural = owner.child();
  let aRan = 0;
  let bRan = 0;

  beginInstancePass(owner);
  const a = retainChildInstance(owner, 'a', structural, (scope) => {
    scope.add(() => aRan++);
    return {};
  });
  const b = retainChildInstance(owner, 'b', structural, (scope) => {
    scope.add(() => bRan++);
    return {};
  });

  releaseUnderStructuralScope(structural);
  expect(a.scope.disposed).toBe(true);
  expect(b.scope.disposed).toBe(true);
  expect(aRan).toBe(1);
  expect(bRan).toBe(1);

  // Commit sees no entries; the stale marks cannot resurrect anything.
  endInstancePass(owner);
  owner.dispose();
});
