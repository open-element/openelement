/**
 * Retained logical instances for nested generated-element children — the
 * PRIVATE runtime prerequisite for `16b-LC retained-child` (design
 * `nested-retention-design.md` §A Addendum; independent review
 * `nested-retention-review.md` P1).
 *
 * The generated root element already retains one logical instance across a
 * disconnect/reconnect (`shell.ts` `ensureInstance` plus the compiler-owned
 * `__oe_rootInstance` factory, T3). This module is the generic form for a
 * HOSTLESS nested child: every retained child instance is one `owner.child()`
 * scope plus the setup record evaluated on it exactly once, keyed by the
 * enclosing logical instance's owner scope and the compiler-emitted
 * projection-site key.
 *
 * ## Entry contract
 *
 * - `owner` is the enclosing LOGICAL INSTANCE's retained scope (the root
 *   element instance scope, or a retained child's scope). One ledger exists per
 *   owner, and the retained child scope is that owner's child, so explicit
 *   owner teardown disposes it through the existing `LifetimeScope` cascade.
 * - `siteKey` is the compiler-emitted, mount/claim-identical authored-span
 *   literal (`"<file>:<start>:<end>"`, review F3). The runtime never derives,
 *   parses or validates it.
 * - `structuralOwner` names the scope that owns the structural region the site
 *   was emitted in (condition branch, list item, connection/projection scope).
 *   It is recorded so explicit release can name a whole removed region by the
 *   ONE scope the compiler already has (`releaseUnderStructuralScope`); it is
 *   exact object identity, never a lifetime-class inference.
 *
 * ## Rules this module owns
 *
 * 1. Reuse-or-create: the first call for `(owner, siteKey)` creates the child
 *    scope and runs `setup` once; every later call returns the same entry and
 *    never re-runs setup (no duplicate resources / subscriptions).
 * 2. Setup failure: the new scope is plain-disposed with every cleanup
 *    attempted, then the ORIGINAL setup error is rethrown; no entry is stored,
 *    so the next call retries on a fresh scope. Cleanup errors never replace
 *    the setup error — the same discipline as `shell.ts` `ensureInstance`.
 * 3. Eviction is explicit and mode-independent: an entry is disposed plain
 *    (`dispose(false)`) and the ledger NEVER removes DOM; a retained child
 *    scope must not own a range cleanup (it owns no region). Release is not
 *    derived from the dispose-mode flag and is not registered as a range
 *    cleanup: a structural scope's own `dispose(false|true)` never evicts, and
 *    an explicit release evicts even after that scope died (review F1/F6,
 *    Addendum A.2.3).
 * 4. Pass epoch (`beginInstancePass` / `endInstancePass` / `abortInstancePass`):
 *    one pass brackets one generated mount/claim body on that body's own
 *    instance scope. `retainChildInstance` marks the site live. Commit
 *    (`endInstancePass`) sweeps every entry the pass did not reach (the site is
 *    structurally absent now); abort (`abortInstancePass`) evicts ONLY entries
 *    created during the aborted pass and keeps every pre-existing entry for the
 *    retry, so a failed claim neither leaks an uncommitted setup nor discards a
 *    committed one.
 * 5. Structural-owner rebinding is staged: mount and claim emit the same site
 *    with different scope objects, so a later pass may re-bind an existing
 *    entry; the new index is applied at commit and discarded by abort, which
 *    leaves the previous index intact (a rolled-back pass cannot re-point
 *    release bookkeeping at scopes of a connection that never committed).
 * 6. Idempotent explicit release: `releaseChildInstance` /
 *    `releaseUnderStructuralScope` delete bookkeeping FIRST and then dispose,
 *    so a second call (even after a throwing cleanup) is a no-op, and release
 *    after owner teardown still cleans bookkeeping instead of resurrecting a
 *    disposed entry.
 * 7. Disposed-state fail-closed: `retainChildInstance` refuses a disposed owner
 *    (`OE_KERNEL_DISPOSED`) and never reuses an entry whose retained scope was
 *    disposed independently; the caller must release that entry explicitly
 *    before retaining the site again.
 * 8. Setup is a one-shot, side-effect-bounded call: it receives the new
 *    retained scope, must not re-enter `retainChildInstance` for the SAME site
 *    (such a nested creation would be overwritten by the outer entry and leave
 *    an orphan scope; the ledger's per-owner `inFlight` set fails it closed as
 *    `OEIR_INSTANCE_LEDGER_REENTRANT`), and must not dispose its retained scope
 *    or the owner. If setup returns after disposing either, the entry is rolled
 *    back and refused with `OE_KERNEL_DISPOSED` — a disposed instance is never
 *    stored or aliased.
 * 9. Rollback isolation: while `abortInstancePass` is evicting, a cleanup that
 *    calls `retainChildInstance` is rejected (`OEIR_INSTANCE_LEDGER_ROLLBACK`),
 *    because a new entry created from a rolled-back cleanup would survive the
 *    abort as a leaked logical instance; opening a new pass from that cleanup
 *    is likewise refused (it would leave the aborting ledger with a stray open
 *    pass). Abort drops cleanup errors, so these rejections never replace the
 *    caller's original pass failure.
 * 10. Bounded state: two module-level `WeakMap`s (owner -> ledger, structural
 *    scope -> entries) plus per-ledger maps/sets whose empty structural sets
 *    are deleted. Weak keys keep no scope alive, but the structural set is a
 *    strong hold while its scope lives (see the mandatory-release note below);
 *    there is no global identity-keyed strong registry, no DOM/signal import
 *    and no second reactive engine.
 * 11. Owner-teardown release (`releaseRetainedChildren`): the explicit,
 *    deterministic cleanup for the owner's WHOLE lifetime. It closes a live
 *    transaction's member passes, drops the ledger (so no cleanup can re-enter
 *    it), deindexes every entry, plain-disposes every retained scope with all
 *    cleanups attempted (recursively releasing each scope's own ledger), keeps
 *    the first failure, discards open-pass state and deletes the ledger.
 *    Idempotent, mode-independent, and never inferred from a dispose flag —
 *    an owner that stops being externally reachable is not a cleanup
 *    trigger.
 * 12. One transaction per attempt (`InstanceTransaction`): the root pass owns
 *    the token; a retained body that retains children JOINS it instead of
 *    committing; commit/abort are the root's and close every member pass. A
 *    token whose root transaction is closed is refused (`STATE`), so a delayed
 *    child body can never open a pass nobody will commit.
 *
 * ## Eviction cleanup semantics (plain cleanups)
 *
 * Eviction is a PLAIN scope disposal: the retained scope's `add` cleanups run
 * (LIFO, every one attempted, first error kept) and its range cleanups are
 * dropped unrun — the ledger never removes DOM and a retained scope must not
 * own a range cleanup. Cleanup errors are handled per path: a setup failure and
 * an abort drop them so the original error wins; an explicit release and the
 * commit sweep surface the first one after every cleanup was attempted.
 *
 * ## Structural release is mandatory, and its index is a strong hold
 *
 * A structural scope's own `dispose()` in either mode is NOT a release by
 * design, and this module registers no range cleanup, so
 * `releaseUnderStructuralScope` (or an exact `releaseChildInstance`) is the
 * ONLY channel that ends a retained region. The compiler must therefore emit
 * the explicit release at every structural removal/rollback site that can
 * discard retained children: it is mandatory, not an optimization. The
 * structural index is `WeakMap<scope, Set<entry>>`: the key does not keep the
 * structural scope alive, but while that scope is alive the set strongly holds
 * every entry it can release (and via the entry the retained scope and record).
 * A forgotten release therefore keeps the logical instance reusable across a
 * re-entered structure (state resurrection) and keeps its resources alive until
 * the owner is torn down or an explicit release runs.
 *
 * ## Recursive ledgers and the cross-ledger transaction (depth ≥ 2, 2026-11-21)
 *
 * A retained child's scope is itself an owner, so nesting needs no extra state:
 * the child body retains its own children on that scope's ledger. What nesting
 * DID need is one transaction across those ledgers, because a child pass that
 * committed on its own would sweep/commit inside a parent attempt that may
 * still abort (the failure mode ADR-0181's original depth-1 boundary named).
 *
 * The protocol is a TOKEN, not a second registry:
 *
 * - the ROOT retaining body calls `beginInstancePass(owner)` and keeps the
 *   returned `InstanceTransaction`; the token is threaded to retained child
 *   calls as compiler-private generated data (`host.txn`);
 * - a retained body that itself retains children calls
 *   `joinInstancePass(ownScope, token)`: it opens a NORMAL pass on its own
 *   ledger and registers `(owner, pass)` on the token. It NEVER commits and
 *   never aborts on its own;
 * - `endInstancePass(rootOwner)` commits the root pass first (its sweep may
 *   evict a removed child, recursively releasing that child's ledger and any
 *   grandchild entries), then commits every surviving member shallow-first,
 *   skipping members whose ledger was released or whose pass no longer matches;
 * - `abortInstancePass(rootOwner)` aborts members deepest-first, then the root
 *   pass, so an attempt that never happened leaves pre-existing entries intact
 *   with their previous structural index and evicts exactly the entries each
 *   pass created;
 * - evicting ANY entry first releases that entry scope's own ledger
 *   (`releaseRetainedChildren(scope)`), so grandchild bookkeeping can never
 *   outlive its owner and a disposed subtree cannot be resurrected;
 * - `releaseRetainedChildren(owner)` closes a live transaction's member passes
 *   before dropping the owner's ledger, so an explicit owner teardown can never
 *   leave a member pass open on a scope that survives only as a WeakMap key.
 *
 * Members are registered shallow-first (the bodies run depth-first), and both
 * loops skip a member whose ledger no longer exists or whose pass number no
 * longer matches — the idempotent form of "the subtree was already released".
 * A joined pass is a normal pass: `createdPass` still distinguishes
 * created-in-attempt from pre-existing, and no pass is swept by an abort.
 *
 * Consumption boundary: the ROOT pass bracket, ref-site retention, the six
 * structural/ref release sites, the shell connect abort and the three
 * owner-teardown releases consume this module; depth ≥ 2 adds the token
 * (`beginInstancePass` return + `joinInstancePass`) and the JOINED child pass,
 * and no other protocol surface.
 *
 * ## Failure identities
 *
 * Internal identities, not protocol catalogue rows (the same practice as
 * `claim-invariants.ts`): `OEIR_INSTANCE_LEDGER_STATE` for pass-bracket
 * violations, `OEIR_INSTANCE_LEDGER_DUPLICATE` for the same site retained
 * twice inside one pass, `OEIR_INSTANCE_LEDGER_REENTRANT` for a same-site
 * retain from inside that site's own setup, and
 * `OEIR_INSTANCE_LEDGER_ROLLBACK` for a retain attempted from a cleanup running
 * inside an abort. A disposed owner or retained scope reuses
 * `OE_KERNEL_DISPOSED`. Messages honor the `RUNTIME_MESSAGES_ENABLED` strip
 * seam.
 *
 * @module ./instance-ledger.ts
 */

import {
  KernelErrorCode,
  raiseFrameworkError,
  RUNTIME_MESSAGES_ENABLED,
} from '@openelement/protocol/errors';
import type { LifetimeScope } from '../lifetime-scope.ts';

/** Internal identity: a pass-bracketing call arrived in the wrong state. */
export const INSTANCE_LEDGER_STATE = 'OEIR_INSTANCE_LEDGER_STATE';

/** Internal identity: one site key was retained twice inside the same pass. */
export const INSTANCE_LEDGER_DUPLICATE = 'OEIR_INSTANCE_LEDGER_DUPLICATE';

/** Internal identity: a site re-entered `retainChildInstance` from its own setup. */
export const INSTANCE_LEDGER_REENTRANT = 'OEIR_INSTANCE_LEDGER_REENTRANT';

/** Internal identity: a retain was attempted from an abort's cleanup. */
export const INSTANCE_LEDGER_ROLLBACK = 'OEIR_INSTANCE_LEDGER_ROLLBACK';

/** One retained logical child instance: its private scope and setup record. */
export interface RetainedChildInstance<T = Readonly<Record<string, unknown>>> {
  /** The retained child scope: a child of the enclosing logical instance. */
  readonly scope: LifetimeScope;
  /** The setup record, evaluated once and reused for the instance's lifetime. */
  readonly record: T;
}

/**
 * One mount/claim attempt's cross-ledger transaction token (depth >= 2).
 *
 * Created by the ROOT retaining body's `beginInstancePass` and threaded to
 * retained child calls as compiler-private generated data (`host.txn`). A
 * retained body that retains its own children calls `joinInstancePass`; it
 * never commits or aborts. The root's `endInstancePass`/`abortInstancePass`
 * close every joined pass, shallow-first on commit and deepest-first on abort.
 */
export interface InstanceTransaction {
  /** The root logical instance whose ledger owns this transaction. */
  readonly rootOwner: LifetimeScope;
  /** Joined child ledgers, shallow-first (their bodies run depth-first). */
  readonly members: Array<{ readonly owner: LifetimeScope; readonly pass: number }>;
}

/**
 * Ledger bookkeeping for one entry. The extra fields are runtime-internal
 * (`owner`/`siteKey` let a structural release find its ledger; `structuralOwner`
 * is the staged index key; `createdPass` is the rollback epoch).
 */
interface LedgerEntry {
  readonly owner: LifetimeScope;
  readonly siteKey: string;
  readonly scope: LifetimeScope;
  readonly record: unknown;
  structuralOwner: LifetimeScope | null;
  readonly createdPass: number;
}

/** One owner's ledger: live entries plus the optional open pass state. */
interface Ledger {
  readonly entries: Map<string, LedgerEntry>;
  /** Sites whose `setup` is currently running (same-site re-entry guard). */
  readonly inFlight: Set<string>;
  /** True while `abortInstancePass` evicts (retain during cleanup is refused). */
  rollingBack: boolean;
  pass: number;
  marks: Set<string> | null;
  pending: Map<string, LifetimeScope | null> | null;
  /** The open cross-ledger transaction owned by this (root) pass, if any. */
  transaction: InstanceTransaction | null;
  /**
   * The transaction this ledger's pass JOINED (a retained child that retains
   * its children), or null. A joined pass is committed/aborted by its root;
   * `endInstancePass`/`abortInstancePass` on it fail closed.
   */
  joined: InstanceTransaction | null;
}

/** `createdPass` of an entry retained outside any pass. */
const NO_PASS = 0;

/**
 * Two weak registries: an owner is collected with its ledger, and a structural
 * scope with the entries it can release. Weak keys never keep a scope alive,
 * but a live structural scope's set strongly holds its entries — explicit
 * release is mandated by the module contract, not a memory optimization.
 */
const ledgers = new WeakMap<LifetimeScope, Ledger>();
const structuralIndex = new WeakMap<LifetimeScope, Set<LedgerEntry>>();

/** A cleanup error captured during eviction, or `null` for a clean disposal. */
type CleanupFailure = { readonly error: unknown } | null;

function fail(code: string, prose: string): never {
  raiseFrameworkError(
    'csr',
    code,
    RUNTIME_MESSAGES_ENABLED ? `[compiled-runtime] ${prose}` : `[compiled-runtime] ${code}`,
  );
}

function failState(prose: string): never {
  fail(INSTANCE_LEDGER_STATE, prose);
}

function failDuplicate(siteKey: string): never {
  fail(
    INSTANCE_LEDGER_DUPLICATE,
    `the projection site ${siteKey} was retained twice inside one instance pass; one pass walks ` +
      `one site once (duplicate retention would share or split a logical instance)`,
  );
}

function failReentrant(siteKey: string): never {
  fail(
    INSTANCE_LEDGER_REENTRANT,
    `the projection site ${siteKey} was retained from inside its own setup; setup runs exactly ` +
      `once and must not re-enter retention for the same site (the inner creation would be ` +
      `orphaned by the outer entry)`,
  );
}

function failRollingBack(siteKey: string): never {
  fail(
    INSTANCE_LEDGER_ROLLBACK,
    `cannot retain the projection site ${siteKey} from a cleanup running inside an aborted ` +
      `instance pass; that pass is discarding its logical instances`,
  );
}

function failDisposed(prose: string): never {
  fail(KernelErrorCode.DISPOSED, prose);
}

function ledgerFor(owner: LifetimeScope): Ledger {
  let ledger = ledgers.get(owner);
  if (ledger === undefined) {
    ledger = {
      entries: new Map(),
      inFlight: new Set(),
      rollingBack: false,
      pass: NO_PASS,
      marks: null,
      pending: null,
      transaction: null,
      joined: null,
    };
    ledgers.set(owner, ledger);
  }
  return ledger;
}

/** Add one entry to its structural owner's release set. */
function indexEntry(entry: LedgerEntry): void {
  if (entry.structuralOwner === null) return;
  let indexed = structuralIndex.get(entry.structuralOwner);
  if (indexed === undefined) {
    indexed = new Set();
    structuralIndex.set(entry.structuralOwner, indexed);
  }
  indexed.add(entry);
}

/** Remove one entry from its structural owner's release set. */
function deindexEntry(entry: LedgerEntry): void {
  const structuralOwner = entry.structuralOwner;
  if (structuralOwner === null) return;
  const indexed = structuralIndex.get(structuralOwner);
  if (indexed === undefined) return;
  indexed.delete(entry);
  if (indexed.size === 0) structuralIndex.delete(structuralOwner);
}

/** Delete every piece of bookkeeping for one entry (idempotent). */
function dropEntry(ledger: Ledger, entry: LedgerEntry): void {
  if (ledger.entries.get(entry.siteKey) === entry) ledger.entries.delete(entry.siteKey);
  ledger.pending?.delete(entry.siteKey);
  deindexEntry(entry);
}

/**
 * Evict one entry's scope in plain mode. The bookkeeping must already be gone:
 * eviction never removes DOM, and a retained scope owns no range cleanup.
 */
function disposeEntry(entry: LedgerEntry): CleanupFailure {
  // A retained scope is an OWNER in its own right (depth >= 2): release its
  // ledger BEFORE disposing the scope, so grandchild bookkeeping never outlives
  // its owner and a disposed subtree cannot be resurrected by a later retain.
  // The recursive release is idempotent and plain-disposes its own entries; the
  // scope disposal below then only cascades scopes still attached.
  let failure: CleanupFailure = null;
  try {
    releaseRetainedChildren(entry.scope);
  } catch (error) {
    failure = { error };
  }
  try {
    entry.scope.dispose(false);
    return failure;
  } catch (error) {
    return failure ?? { error };
  }
}

/** Keep the first cleanup failure; later ones are attempted but do not replace it. */
function firstFailure(collected: CleanupFailure, next: CleanupFailure): CleanupFailure {
  return collected ?? next;
}

/**
 * Retain one nested logical instance: reuse the entry for `(owner, siteKey)`,
 * or create `owner.child()`, run `setup` on it once, and store the result.
 *
 * Setup runs exactly once per entry. A throwing setup rolls the new scope back
 * with every cleanup attempted and rethrows the ORIGINAL setup error, leaving
 * no entry (the next call retries on a fresh scope). Three guards keep the
 * one-shot contract honest: a same-site retain from inside that site's own
 * setup is refused (`inFlight`, so an inner creation can never be orphaned by
 * the outer entry), a setup that returns after disposing its retained scope or
 * the owner is refused with the entry rolled back and never stored, and a
 * retry from a cleanup running inside `abortInstancePass` is refused so a
 * rolled-back pass cannot leak a new logical instance.
 */
export function retainChildInstance<T>(
  owner: LifetimeScope,
  siteKey: string,
  structuralOwner: LifetimeScope | null,
  setup: (instanceScope: LifetimeScope) => T,
): RetainedChildInstance<T> {
  if (owner.disposed) {
    failDisposed(
      `cannot retain a child instance after its logical instance owner was disposed (${siteKey})`,
    );
  }
  const ledger = ledgerFor(owner);
  if (ledger.rollingBack) failRollingBack(siteKey);
  if (ledger.inFlight.has(siteKey)) failReentrant(siteKey);

  const existing = ledger.entries.get(siteKey);
  if (existing !== undefined) {
    if (existing.scope.disposed) {
      failDisposed(
        `the retained scope for ${siteKey} was disposed independently; release the entry before ` +
          `retaining the site again (a disposed record is never reused)`,
      );
    }
    if (ledger.marks === null) {
      // Outside a pass there is no transaction to stage: re-bind immediately so
      // the release bookkeeping names the current structural region.
      if (existing.structuralOwner !== structuralOwner) {
        deindexEntry(existing);
        existing.structuralOwner = structuralOwner;
        indexEntry(existing);
      }
    } else {
      if (ledger.marks.has(siteKey)) failDuplicate(siteKey);
      ledger.marks.add(siteKey);
      // Staged: the pass commit applies the new structural owner; abort keeps
      // the pre-existing index untouched.
      if (existing.structuralOwner !== structuralOwner) {
        ledger.pending?.set(siteKey, structuralOwner);
      }
    }
    return existing as RetainedChildInstance<T>;
  }

  // The enclosing pass is captured BEFORE setup: the entry belongs to the pass
  // that requested it, and setup must not alter the pass bracket.
  const marks = ledger.marks;
  const createdPass = marks === null ? NO_PASS : ledger.pass;
  // A disposed owner throws here as well (LifetimeScope's own attach guard);
  // the explicit check above keeps the failure independent of that message.
  const scope = owner.child();
  let record: unknown;
  ledger.inFlight.add(siteKey);
  try {
    record = setup(scope);
  } catch (error) {
    try {
      scope.dispose(false);
    } catch {
      // Keep the original setup error; every setup cleanup was still attempted.
    }
    throw error;
  } finally {
    ledger.inFlight.delete(siteKey);
  }
  if (scope.disposed || owner.disposed) {
    try {
      scope.dispose(false);
    } catch {
      // The disposal refusal is what surfaces; cleanups were still attempted.
    }
    failDisposed(
      `the setup for the projection site ${siteKey} disposed its retained scope or its logical ` +
        `instance owner; a disposed instance is never stored`,
    );
  }
  const entry: LedgerEntry = {
    owner,
    siteKey,
    scope,
    record,
    structuralOwner,
    createdPass,
  };
  ledger.entries.set(siteKey, entry);
  indexEntry(entry);
  marks?.add(siteKey);
  return entry as RetainedChildInstance<T>;
}

/**
 * Release one retained instance explicitly and immediately.
 *
 * Bookkeeping is deleted first, so the call is idempotent even when the
 * scope's cleanup throws; the first cleanup error then surfaces (the same
 * discipline as `LifetimeScope.dispose`). Release never depends on how the
 * structural scope was disposed, and after owner teardown it still removes the
 * stale bookkeeping instead of leaving a re-reusable entry behind.
 */
export function releaseChildInstance(owner: LifetimeScope, siteKey: string): void {
  const ledger = ledgers.get(owner);
  if (ledger === undefined) return;
  const entry = ledger.entries.get(siteKey);
  if (entry === undefined) return;
  dropEntry(ledger, entry);
  const failure = disposeEntry(entry);
  if (failure !== null) throw failure.error;
}

/**
 * Release every retained instance whose structural owner is exactly
 * `structuralScope`.
 *
 * This is the explicit, mode-independent release for a removed structural
 * region (condition branch, list item, discarded construction). Identity is
 * exact object identity: the compiler passes the scope that owns the region it
 * is removing, so no ancestor walk or lifetime-class inference is needed. The
 * scope may already be disposed — release is bookkeeping plus plain disposal,
 * never a `dispose(true)` region removal.
 */
export function releaseUnderStructuralScope(structuralScope: LifetimeScope): void {
  const indexed = structuralIndex.get(structuralScope);
  if (indexed === undefined) return;
  // Remove the whole set first: a re-entrant call for the same scope is a
  // no-op, and every entry below is about to lose its bookkeeping anyway.
  structuralIndex.delete(structuralScope);
  let failure: CleanupFailure = null;
  for (const entry of [...indexed]) {
    const ledger = ledgers.get(entry.owner);
    if (ledger !== undefined) dropEntry(ledger, entry);
    failure = firstFailure(failure, disposeEntry(entry));
  }
  if (failure !== null) throw failure.error;
}

/**
 * Release EVERY retained instance of one logical-instance owner and discard
 * its ledger (R-1: the explicit owner-teardown release the shell consumes).
 *
 * Release is the only channel that ends a retained region, and the structural
 * index is a strong hold while its structural scope lives, so an owner that
 * stops being used must be released explicitly instead of relying on WeakMap
 * collection. The generated-element shell calls this at explicit teardown
 * (`dispose(false)` / `dispose(true)`) and at the failed-first-connect
 * rollback, after the pre-existing projection/connection/range steps and
 * before `instance.dispose`, so the retained scopes are released while the
 * owner is still live (a cleanup observing `owner.disposed` sees `false`) and
 * a later `instance.dispose` cascade only sees already-disposed scopes.
 *
 * Bookkeeping is dropped FIRST: the ledger leaves the owner map and every
 * entry is deindexed before any scope is disposed, so a re-entrant call from a
 * cleanup, a later `releaseChildInstance`/`releaseUnderStructuralScope`, and a
 * second `releaseRetainedChildren` are all no-ops. Every retained scope is
 * then plain-disposed (all cleanups attempted, first failure kept) and the
 * first failure surfaces after the sweep. Open pass state is discarded with
 * the ledger, so no pass can be ended or aborted afterwards.
 *
 * Idempotent and mode-independent: it never reads a dispose flag, never
 * removes DOM, and never upgrades a plain disposal into a detach (`disposeEntry`
 * is the same plain path every other eviction uses).
 */
export function releaseRetainedChildren(owner: LifetimeScope): void {
  const ledger = ledgers.get(owner);
  if (ledger === undefined) return;
  // A live transaction's joined passes belong to this owner's attempt. Close
  // them BEFORE the ledger disappears, so an explicit teardown can never leave
  // a member pass open on a scope that survives only as a WeakMap key. Abort
  // (not commit): teardown is destroying the subtree, and abort keeps the
  // pre-existing member entries for the recursive disposal below.
  const transaction = ledger.transaction;
  ledger.transaction = null;
  // This owner may itself be a joined member being torn down: drop the join
  // marker so a later root commit/abort skips the released ledger.
  ledger.joined = null;
  if (transaction !== null) {
    for (const member of [...transaction.members].reverse()) {
      const memberLedger = ledgers.get(member.owner);
      if (memberLedger === undefined || memberLedger.marks === null) continue;
      if (memberLedger.pass !== member.pass) continue;
      memberLedger.joined = null;
      memberLedger.transaction = null;
      abortPass(memberLedger);
    }
  }
  // Bookkeeping first: remove the ledger before disposing anything, so a
  // cleanup that re-enters this module cannot observe or resurrect half of it.
  ledgers.delete(owner);
  ledger.marks = null;
  ledger.pending = null;
  ledger.rollingBack = false;
  ledger.inFlight.clear();
  const entries = [...ledger.entries.values()];
  let failure: CleanupFailure = null;
  for (const entry of entries) {
    dropEntry(ledger, entry);
    failure = firstFailure(failure, disposeEntry(entry));
  }
  if (failure !== null) throw failure.error;
}

/**
 * Open one mount/claim pass on `owner`'s ledger. A pass never nests on one
 * owner: each generated body brackets its OWN instance scope.
 */
/**
 * Open the ONE cross-ledger transaction of a mount/claim attempt on `owner`'s
 * ledger (the ROOT retaining body) and return its token.
 *
 * The token is compiler-private generated data: a retained body that itself
 * retains children hands it to `joinInstancePass`; no other reader exists. A
 * pass never nests on one owner, and an owner that already holds an open
 * transaction refuses a second begin.
 */
export function beginInstancePass(owner: LifetimeScope): InstanceTransaction {
  const ledger = ledgerFor(owner);
  if (ledger.joined !== null) {
    failState(
      'cannot begin an instance pass on a JOINED child ledger: its root transaction owns the pass',
    );
  }
  if (ledger.rollingBack) {
    failState(
      'cannot begin an instance pass from a cleanup running inside an aborted instance pass',
    );
  }
  if (ledger.marks !== null) {
    failState(
      `cannot begin an instance pass: pass ${ledger.pass} is already open for this logical instance`,
    );
  }
  ledger.pass += 1;
  ledger.marks = new Set();
  ledger.pending = new Map();
  const transaction: InstanceTransaction = { rootOwner: owner, members: [] };
  ledger.transaction = transaction;
  return transaction;
}

/**
 * Join the root's open transaction from a retained body that retains its own
 * children: open a NORMAL pass on `owner`'s ledger and register it as a member.
 *
 * The child body never commits or aborts. `endInstancePass`/`abortInstancePass`
 * on the root close every member, so an attempt that never happened cannot
 * leave a committed child sweep or a half-open child pass behind. A token whose
 * root transaction is closed (a delayed body call) is refused: joining it would
 * open a pass nobody owns. Joining twice from one owner in one transaction is a
 * no-op (the body runs once per owner per attempt; this keeps a defensive
 * re-entry from opening a second pass).
 */
export function joinInstancePass(owner: LifetimeScope, transaction: InstanceTransaction): void {
  if (owner.disposed) {
    failDisposed(
      'cannot join an instance transaction after the child logical instance was disposed',
    );
  }
  const rootLedger = ledgers.get(transaction.rootOwner);
  if (rootLedger === undefined || rootLedger.transaction !== transaction) {
    failState('cannot join an instance transaction that is no longer open on its root instance');
  }
  if (transaction.members.some((member) => member.owner === owner)) return;
  const ledger = ledgerFor(owner);
  if (ledger.joined !== null) {
    failState('cannot join two instance transactions from one logical instance');
  }
  if (ledger.rollingBack) {
    failState(
      'cannot join an instance transaction from a cleanup running inside an aborted instance pass',
    );
  }
  if (ledger.marks !== null) {
    failState(
      `cannot join an instance transaction: pass ${ledger.pass} is already open for this logical instance`,
    );
  }
  ledger.pass += 1;
  ledger.marks = new Set();
  ledger.pending = new Map();
  ledger.joined = transaction;
  transaction.members.push({ owner, pass: ledger.pass });
}

/**
 * Commit one open pass: apply its staged structural-owner rebinding and sweep
 * every entry the pass did not reach.
 *
 * The pass state is closed BEFORE the sweep, so a throwing cleanup cannot leave
 * a half-open pass; every swept scope is still disposed (plain) and the first
 * cleanup error is returned after all of them were attempted.
 */
function commitPass(ledger: Ledger): CleanupFailure {
  if (ledger.marks === null || ledger.pending === null) {
    failState('cannot end an instance pass: no pass is open for this logical instance');
  }
  const marks = ledger.marks;
  const pending = ledger.pending;
  ledger.marks = null;
  ledger.pending = null;

  for (const [siteKey, structuralOwner] of pending) {
    const entry = ledger.entries.get(siteKey);
    if (entry === undefined || entry.structuralOwner === structuralOwner) continue;
    deindexEntry(entry);
    entry.structuralOwner = structuralOwner;
    indexEntry(entry);
  }

  let failure: CleanupFailure = null;
  for (const [siteKey, entry] of [...ledger.entries]) {
    if (marks.has(siteKey)) continue;
    if (ledger.entries.get(siteKey) !== entry) continue;
    dropEntry(ledger, entry);
    failure = firstFailure(failure, disposeEntry(entry));
  }
  return failure;
}

/**
 * Abort one open pass: evict ONLY the entries created during it and keep every
 * pre-existing entry (with its previous structural-owner index) for a retry.
 *
 * Staged rebinding is discarded, not applied. Cleanup errors are dropped
 * because this path runs while the caller rethrows the pass's original
 * failure.
 */
function abortPass(ledger: Ledger): void {
  const abortedPass = ledger.pass;
  ledger.marks = null;
  ledger.pending = null;
  // A cleanup may re-enter `retainChildInstance`; an entry created there would
  // survive this abort as a leaked logical instance, so retention is refused
  // for the whole eviction window (the refusal is dropped with the cleanup
  // errors, never replacing the caller's original pass failure).
  ledger.rollingBack = true;
  try {
    for (const [siteKey, entry] of [...ledger.entries]) {
      if (entry.createdPass !== abortedPass) continue;
      if (ledger.entries.get(siteKey) !== entry) continue;
      dropEntry(ledger, entry);
      // The original pass failure is what surfaces: cleanup errors are dropped.
      disposeEntry(entry);
    }
  } finally {
    ledger.rollingBack = false;
  }
}

/**
 * Commit the root pass and every joined member pass (shallow-first).
 *
 * The root pass commits first: its sweep may evict a removed retained child,
 * and evicting that child recursively releases the child's own ledger (members
 * included). A member whose ledger was released, or whose recorded pass no
 * longer matches, is skipped — the idempotent form of "its subtree is already
 * gone". Every commit still attempts all of its cleanups; the first failure
 * surfaces after the whole transaction is closed.
 */
export function endInstancePass(owner: LifetimeScope): void {
  const ledger = ledgers.get(owner);
  if (ledger !== undefined && ledger.joined !== null) {
    failState('a joined child pass is committed by its root transaction, never by the child body');
  }
  if (ledger === undefined || ledger.marks === null || ledger.pending === null) {
    failState('cannot end an instance pass: no pass is open for this logical instance');
  }
  const transaction = ledger.transaction;
  ledger.transaction = null;
  let failure = commitPass(ledger);
  if (transaction !== null) {
    for (const member of transaction.members) {
      const memberLedger = ledgers.get(member.owner);
      if (memberLedger === undefined || memberLedger.marks === null) continue;
      if (memberLedger.pass !== member.pass) continue;
      memberLedger.joined = null;
      memberLedger.transaction = null;
      failure = firstFailure(failure, commitPass(memberLedger));
    }
  }
  if (failure !== null) throw failure.error;
}

/**
 * Abort one mount/claim attempt: the joined member passes deepest-first, then
 * the root pass.
 *
 * Deepest-first matters: a member's abort evicts only entries created in its
 * pass and keeps its pre-existing entries, so aborting the outermost pass first
 * would dispose the scopes those inner ledgers are keyed by. With no open pass
 * this is a no-op (rollback never masks the error that triggered it).
 */
export function abortInstancePass(owner: LifetimeScope): void {
  const ledger = ledgers.get(owner);
  if (ledger !== undefined && ledger.joined !== null) {
    failState('a joined child pass is aborted by its root transaction, never by the child body');
  }
  if (ledger === undefined || ledger.marks === null) return;
  const transaction = ledger.transaction;
  ledger.transaction = null;
  if (transaction !== null) {
    for (const member of [...transaction.members].reverse()) {
      const memberLedger = ledgers.get(member.owner);
      if (memberLedger === undefined || memberLedger.marks === null) continue;
      if (memberLedger.pass !== member.pass) continue;
      memberLedger.joined = null;
      memberLedger.transaction = null;
      abortPass(memberLedger);
    }
  }
  abortPass(ledger);
}
