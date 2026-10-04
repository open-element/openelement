/**
 * Pre-upgrade event capture/replay (claim-activation helpers), plus the one
 * facade capture registry (single bookkeeping layer — the registry lives
 * here, not beside the Events family). Registry retention is organized BY
 * ROOT: a bounded shared pending pool holds records until their claim root
 * adopts them into its own WeakMap-keyed bucket; replay and release then
 * touch only that bucket, and every registry map is a WeakMap, so entries
 * live exactly as long as their key (no page-lifetime retention, no
 * page-lifetime entry table).
 */

import type { CompiledClaimOptions } from './claim.ts';
import { ClaimErrorCode } from '../../protocol/errors.ts';
import { fail } from './program-kernel.ts';

export interface PreUpgradeEvent {
  readonly target: EventTarget;
  readonly type: string;
  readonly event?: Event;
  readonly init?: EventInit;
  /**
   * Capture order assigned by the page-lifetime capture that recorded this
   * event. A root replays only records that predate its first activation, so
   * a morph reconnect (cached claim activation) never re-handles an
   * interaction the live island already processed. Hand-built records omit
   * it and sort before every captured event.
   */
  readonly seq?: number;
}

export interface PreUpgradeEventCapture {
  readonly events: readonly PreUpgradeEvent[];
  stop(): void;
}

const SUPPORTED_PRE_UPGRADE_EVENTS = new Set([
  'change',
  'click',
  'input',
  'keydown',
  'keyup',
  'pointerdown',
  'pointerup',
  'submit',
]);

/**
 * Hard bound on retained pre-upgrade records per page-lifetime capture.
 * One record per target/type; hits beyond the bound fail closed (the new
 * interaction is dropped, pending replays are never evicted). 64 covers a
 * large island page (8 event types x 8 pending islands) while keeping the
 * queue provably finite in a long-lived SPA.
 *
 * The cap is fixed, not LRU — evicting pending replays would silently
 * drop pre-hydration clicks; upgrade path is per-pending-root local capture
 * if a page ever legitimately exceeds this bound (no such page known).
 */
export const MAX_PRE_UPGRADE_CAPTURED_EVENTS = 64;

const consumedEventRecords = new WeakSet<object>();
const consumedEventObjects = new WeakSet<object>();
/**
 * Page-lifetime capture order. Bumped for every recorded interaction so a
 * claim root can distinguish pre-upgrade events (replayable) from
 * post-activation events the live island already handled (never replayed).
 */
let preUpgradeCaptureSequence = 0;
/**
 * First-activation cutoff per claim root. Pinned at a root's first replay
 * pass; later passes for the same root node (morph reconnect reuses the
 * cached claim activation) replay nothing newer. Keyed by root node, so a
 * nested pending island keeps its own later cutoff.
 */
const claimRootActivationSequence = new WeakMap<object, number>();

/**
 * Resolve the original interaction target for a captured event (#942).
 * Prefers the composed path head (shadow-aware) and falls back to the
 * retargeted event.target where composedPath is unavailable. Never throws:
 * a hostile or exotic event object degrades to event.target.
 */
function resolveCaptureTarget(event: Event): EventTarget | null {
  try {
    const withPath = event as Event & { composedPath?: () => EventTarget[] };
    if (typeof withPath.composedPath === 'function') {
      const path = withPath.composedPath();
      if (Array.isArray(path) && path.length > 0 && path[0]) return path[0];
    }
  } catch {
    // Fall through to event.target below.
  }
  return event.target;
}

/**
 * Island hosts that already reached their activation decision (claim or
 * fresh, success or failure). The facade marks its host element here; the
 * document-level capture then skips ordinary traffic inside settled islands
 * while still capturing for nested still-pending islands. Kernel-level
 * callers (claimExistingDom tests, non-facade hosts) never consult this set:
 * their capture contract is "everything inside the claim root".
 */
const settledIslandHosts = new WeakSet<object>();

/** Facade activation decisions land here (success or failure). */
export function markPreUpgradeIslandSettled(host: unknown): void {
  if (host && typeof host === 'object') settledIslandHosts.add(host);
}

function isIslandHostTag(node: unknown): boolean {
  try {
    const element = node as { localName?: unknown; tagName?: unknown };
    if (!element || typeof element !== 'object') return false;
    const rawName =
      typeof element.localName === 'string'
        ? element.localName
        : typeof element.tagName === 'string'
          ? element.tagName.toLowerCase()
          : '';
    return rawName.includes('-');
  } catch {
    return false;
  }
}

function tagNameOf(node: unknown): string {
  try {
    const element = node as { localName?: unknown; tagName?: unknown };
    if (!element || typeof element !== 'object') return '';
    if (typeof element.localName === 'string') return element.localName.toLowerCase();
    if (typeof element.tagName === 'string') return element.tagName.toLowerCase();
    return '';
  } catch {
    return '';
  }
}

function eventPathNodes(event: Event, target: EventTarget): readonly unknown[] {
  try {
    const withPath = event as Event & { composedPath?: () => unknown };
    if (typeof withPath.composedPath === 'function') {
      const path = withPath.composedPath();
      if (Array.isArray(path)) return path;
    }
  } catch {
    // Fall through to the target-ancestor walk below.
  }
  // No composedPath (older harness / exotic event): walk the target chain
  // directly, crossing shadow boundaries through hosts where visible.
  const out: unknown[] = [];
  let current: unknown = target;
  let depth = 0;
  while (current && typeof current === 'object' && depth < 1024) {
    out.push(current);
    const node = current as { parentNode?: unknown; host?: unknown };
    if (node.parentNode) current = node.parentNode;
    else if (node.host) current = node.host;
    else break;
    depth++;
  }
  return out;
}

/**
 * Facade document-capture filter: only interactions that could belong to a
 * still-pending DECLARED OpenElement island enter the queue.
 *
 * The entry's `__tags` (the generated client entry's island list) is the
 * owner: a path node counts only when its tag is in the root's declared set
 * and its host is not settled. Undeclared third-party custom elements
 * (sl-*, md-*, ion-*, ...) never enter the queue no matter how many distinct
 * targets they produce — otherwise 64 foreign targets exhaust the bounded
 * queue and a real delayed island loses its replay. Nested pending declared
 * islands still capture through a settled outer (any pending declared host
 * on the path keeps the record).
 *
 * Legacy: with no declared set (empty/omitted — direct kernel callers and
 * older ensure() calls without tags), falls back to the dash heuristic so
 * existing call sites keep working.
 */
function declaredTagCount(declaredTags: ReadonlySet<string> | readonly string[]): number {
  // Array.isArray does not narrow readonly arrays under strict settings;
  // branch on the runtime shape explicitly instead.
  if (typeof (declaredTags as ReadonlySet<string>).size === 'number') {
    return (declaredTags as ReadonlySet<string>).size;
  }
  return (declaredTags as readonly string[]).length;
}

export function acceptPendingIslandEvent(
  event: Event,
  target: EventTarget,
  declaredTags?: ReadonlySet<string> | readonly string[],
): boolean {
  try {
    const hasDeclared = declaredTags !== undefined && declaredTagCount(declaredTags) > 0;
    const path = eventPathNodes(event, target);
    if (hasDeclared) {
      const lookup = Array.isArray(declaredTags)
        ? new Set(declaredTags.map((tag) => tag.toLowerCase()))
        : (declaredTags as ReadonlySet<string>);
      for (const node of path) {
        const tag = tagNameOf(node);
        if (!tag || !lookup.has(tag)) continue;
        if (!settledIslandHosts.has(node as object)) return true;
      }
      return false;
    }
    for (const node of path) {
      if (!isIslandHostTag(node)) continue;
      // A pending host anywhere on the path (delayed / idle / visible /
      // nested-late / morph-added) keeps the record capturable.
      if (!settledIslandHosts.has(node as object)) return true;
    }
    // No island host (background) or every host settled (live traffic).
    return false;
  } catch {
    // Strict mode fails closed (never let an undecodable event occupy the
    // bounded queue); legacy mode preserves the old uncertainty-captures rule.
    const hasDeclared = declaredTags !== undefined && declaredTagCount(declaredTags) > 0;
    return !hasDeclared;
  }
}

function isDetachedTarget(target: EventTarget): boolean {
  try {
    const node = target as { isConnected?: unknown };
    return (node as { isConnected?: boolean }).isConnected === false;
  } catch {
    return false;
  }
}

/**
 * Drop records whose target left the document. Detached nodes can never
 * hydrate, so holding them only leaks memory until page end.
 */
function pruneDetachedTargets(
  events: PreUpgradeEvent[],
  index: Map<EventTarget, Map<string, number>>,
): void {
  let removed = false;
  for (let position = events.length - 1; position >= 0; position--) {
    if (isDetachedTarget(events[position].target)) {
      events.splice(position, 1);
      removed = true;
    }
  }
  if (removed) rebuildCaptureIndex(events, index);
}

function rebuildCaptureIndex(
  events: PreUpgradeEvent[],
  index: Map<EventTarget, Map<string, number>>,
): void {
  index.clear();
  for (let position = 0; position < events.length; position++) {
    const record = events[position];
    let byType = index.get(record.target);
    if (!byType) {
      byType = new Map<string, number>();
      index.set(record.target, byType);
    }
    byType.set(record.type, position);
  }
}

/**
 * Bounded per-target retention unit — the shape every pre-upgrade record
 * container shares (a standalone capture queue, the facade's shared pending
 * pool, and one claimed root's bucket). One latest record per target/type
 * (per-target dedup), hard capped, with detached records swept under
 * pressure and removals expressible as order-preserving takes.
 */
export interface PreUpgradeRecordStore {
  /** Retained records in capture order. */
  readonly events: PreUpgradeEvent[];
  /** Retain one latest record per target/type; drops the newcomer at the cap. */
  replaceFor(record: PreUpgradeEvent): void;
  /** Remove and return the matching records, order preserved. */
  takeWhere(predicate: (record: PreUpgradeEvent) => boolean): PreUpgradeEvent[];
  /** Deterministically drop every retained record. */
  clear(): void;
}

/** Index-aware insert: one slot per target/type, positions kept current. */
function upsertCaptureRecord(
  events: PreUpgradeEvent[],
  index: Map<EventTarget, Map<string, number>>,
  record: PreUpgradeEvent,
): void {
  index.get(record.target)?.set(record.type, events.length) ??
    index.set(record.target, new Map([[record.type, events.length]]));
  events.push(record);
}

function createPreUpgradeRecordStore(): PreUpgradeRecordStore {
  const events: PreUpgradeEvent[] = [];
  const index = new Map<EventTarget, Map<string, number>>();
  return {
    events,
    replaceFor(record: PreUpgradeEvent): void {
      const position = index.get(record.target)?.get(record.type);
      if (position !== undefined && events[position]?.target === record.target) {
        events[position] = record;
        return;
      }
      if (events.length >= MAX_PRE_UPGRADE_CAPTURED_EVENTS) {
        // One detached sweep before failing closed: a burst of removals
        // (navigation / morph) must free budget for genuinely pending islands.
        pruneDetachedTargets(events, index);
        if (events.length >= MAX_PRE_UPGRADE_CAPTURED_EVENTS) return;
      }
      upsertCaptureRecord(events, index, record);
    },
    takeWhere(predicate: (record: PreUpgradeEvent) => boolean): PreUpgradeEvent[] {
      const taken: PreUpgradeEvent[] = [];
      const kept: PreUpgradeEvent[] = [];
      for (const record of events) {
        (predicate(record) ? taken : kept).push(record);
      }
      if (taken.length === 0) return taken;
      events.length = 0;
      for (const record of kept) events.push(record);
      rebuildCaptureIndex(events, index);
      return taken;
    },
    clear(): void {
      events.length = 0;
      index.clear();
    },
  };
}

/**
 * Capture the bounded pre-upgrade interaction set on an owning root. One
 * latest event per target/type is retained, matching the one-click-per-host
 * queue contract while keeping replay deterministic and finite.
 *
 * Boundedness (three independent mechanisms, any one suffices):
 *   1. pending-owner filter (opt-in via `options.accept`, used by the facade
 *      document capture) — only interactions that could belong to a
 *      still-pending island enter the queue; ordinary events inside
 *      already-settled islands are skipped. Kernel-level callers pass no
 *      filter and keep the "everything inside the claim root" contract;
 *   2. capacity cap — beyond MAX_PRE_UPGRADE_CAPTURED_EVENTS the incoming
 *      record is dropped (fail closed, pending replays are never evicted);
 *   3. detached prune — removed nodes are swept (on capture pressure and on
 *      every release) instead of being held to page end.
 */
export function capturePreUpgradeEvents(
  root: EventTarget,
  eventTypes: readonly string[] = [...SUPPORTED_PRE_UPGRADE_EVENTS],
  options: {
    accept?: (event: Event, target: EventTarget) => boolean;
    /** Internal seam: record into a caller-owned store (the facade's shared
     * pending pool) instead of a capture-private queue. */
    store?: PreUpgradeRecordStore;
  } = {},
): PreUpgradeEventCapture {
  const store = options.store ?? createPreUpgradeRecordStore();
  const listeners: Array<{ type: string; listener: EventListener }> = [];
  for (const type of eventTypes) {
    if (!SUPPORTED_PRE_UPGRADE_EVENTS.has(type)) continue;
    const listener: EventListener = (event) => {
      // Shadow-aware target resolution (#942): a document-level capture
      // listener observes a retargeted event.target (the outer host) when the
      // interaction originates inside an open shadow root. composedPath()[0]
      // is the original interaction target, which is what the claiming
      // island's isInsideRoot check must see. Closed shadow roots hide their
      // internals from outside composedPath() by platform design; those
      // records fail closed at replay (never misdelivered, never crashed).
      const target = resolveCaptureTarget(event);
      if (!target) return;
      // No connected check here: harness and parser flows dispatch before
      // the nodes connect (they still hydrate later). Detached fate is
      // decided at replay (fail closed, never dispatched) and at release
      // (swept, never held to page end).
      // Opt-in pending-owner filter (facade document capture only).
      if (options.accept && !options.accept(event as Event, target)) return;
      store.replaceFor({ target, type, event, seq: ++preUpgradeCaptureSequence });
    };
    root.addEventListener(type, listener, { capture: true });
    listeners.push({ type, listener });
  }
  let stopped = false;
  return {
    events: store.events,
    stop(): void {
      if (stopped) return;
      stopped = true;
      for (const { type, listener } of listeners) {
        root.removeEventListener(type, listener, {
          capture: true,
        });
      }
    },
  };
}

function isNodeValue(value: unknown): value is Node {
  return (
    typeof value === 'object' && value !== null && 'nodeType' in value && 'childNodes' in value
  );
}

/**
 * One step up the composed tree. ShadowRoot.parentNode is null by spec, so
 * crossing out of a shadow tree goes through its host. Both fields are
 * standard: parentNode for ordinary nodes, host for shadow roots.
 */
function composedParentNode(node: Node): Node | null {
  if (node.parentNode) return node.parentNode;
  const host = (node as { host?: unknown }).host;
  return isNodeValue(host) ? host : null;
}

/**
 * Canonical composed-tree ownership predicate shared by replay and release:
 * a target belongs to `root` when walking parentNode (crossing each shadow
 * root through its host) reaches `root`. Traversal only follows the target's
 * own ancestor chain, so unrelated shadow trees, sibling islands, and
 * detached subtrees never match.
 */
function isInsideRoot(root: Node, target: EventTarget): target is Node {
  if (!isNodeValue(target)) return false;
  let current: Node | null = target;
  while (current) {
    if (current === root) return true;
    current = composedParentNode(current);
  }
  return false;
}

export function preUpgradeEventList(
  source: CompiledClaimOptions['preUpgradeEvents'],
): readonly PreUpgradeEvent[] {
  if (!source) return [];
  if (Array.isArray(source)) return source;
  if (typeof source === 'object' && 'stop' in source) {
    source.stop();
    return source.events;
  }
  fail(
    ClaimErrorCode.PRE_UPGRADE_EVENTS_INVALID,
    '[compiled-claim] preUpgradeEvents: expected an event array or capture object',
  );
}

/**
 * Replay each captured record at most once, and only while its target remains
 * owned by this root. Records owned by OTHER roots stay pending: an element
 * that upgrades late (delayed/lazy island) must still receive its replay when
 * its own activation arrives (#1170), so an outside-root record is neither
 * replayed nor consumed here. Records captured after this root's first
 * activation stay pending too: the live island already handled them, and a
 * later pass for the same root (morph reconnect) must not re-handle them.
 */
export function replayPreUpgradeEvents(root: Node, captured: readonly PreUpgradeEvent[]): number {
  // Pin this root's first-activation cutoff. Records captured after the pin
  // are interactions a live island already handled: replaying them on a
  // later pass for the same root (morph reconnect) would double-handle one
  // event per target/type. Records owned by other (nested, still-pending)
  // roots are unaffected: each root pins its own cutoff, and a skipped
  // record stays pending for the root it actually belongs to.
  const seenCutoff = claimRootActivationSequence.get(root as object);
  const cutoff = seenCutoff ?? preUpgradeCaptureSequence;
  if (seenCutoff === undefined) claimRootActivationSequence.set(root as object, cutoff);
  let replayed = 0;
  for (const record of captured) {
    if ((record.seq ?? 0) > cutoff) continue;
    if (consumedEventRecords.has(record)) continue;
    if (!SUPPORTED_PRE_UPGRADE_EVENTS.has(record.type)) {
      consumedEventRecords.add(record);
      continue;
    }
    if (!isInsideRoot(root, record.target)) continue;
    const target = record.target;
    if (record.event && typeof record.event === 'object') {
      if (consumedEventObjects.has(record.event)) {
        consumedEventRecords.add(record);
        continue;
      }
      consumedEventObjects.add(record.event);
    }
    consumedEventRecords.add(record);
    // Fail closed on detached targets: an interaction whose node left the
    // document before its island hydrated replays nowhere (never throws,
    // never delivers to a recycled node, never retries on a later upgrade).
    if (
      isNodeValue(target) &&
      typeof target.isConnected === 'boolean' &&
      target.isConnected === false
    ) {
      continue;
    }
    if (typeof target.dispatchEvent !== 'function') continue;
    const event =
      record.event ??
      (typeof globalThis.Event === 'function'
        ? new Event(record.type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            ...record.init,
          })
        : undefined);
    if (!event) continue;
    target.dispatchEvent(event);
    replayed++;
  }
  return replayed;
}

/**
 * Release the captured records owned by one activated root, dropping the
 * strong references to their event targets (including detached DOM). Runs at
 * that element's activation decision — success or failure — so retained
 * records never outlive it (the M1 leak). Records owned by other roots stay
 * pending for their own activation. The capture's listener set is untouched:
 * one fixed listener set per page is installed once by the generated entry
 * and is not the leak.
 */
export function releasePreUpgradeEvents(root: Node, captured: readonly PreUpgradeEvent[]): void {
  const events = captured as PreUpgradeEvent[];
  for (let index = events.length - 1; index >= 0; index--) {
    if (isInsideRoot(root, events[index].target)) events.splice(index, 1);
  }
  // Removal / navigation / morph replacement detaches pending targets that
  // no activation will ever own: sweep them with every release so they never
  // survive to page end waiting for an island that is already gone.
  for (let index = events.length - 1; index >= 0; index--) {
    if (isDetachedTarget(events[index].target)) events.splice(index, 1);
  }
}

// ─── Facade capture registry (claim replay seam) ─────────────────────

/**
 * The facade's shared pending pool. Every facade capture records into this
 * one bounded store (same cap and per-target dedup as any capture queue), so
 * a claimed root has a single place to adopt from and the page-wide pending
 * set stays bounded no matter how many capture roots install listeners.
 * Records leave only by adoption into a claim root's bucket or by the
 * detached sweep; nothing here is keyed by target, so there is no
 * page-lifetime entry table to grow.
 */
const preUpgradePendingRecords = createPreUpgradeRecordStore();

/**
 * Listener sets for the facade captures, keyed by the capture root the
 * listeners are installed on (usually the document). WeakMap, not Map: a
 * capture root removed before its islands activate no longer pins its entry,
 * so the remove-before-activation leak is a structural property instead of a
 * cleanup duty. The fixed listener set itself is page-lifetime by design and
 * was never the leak; the retained records live in the bounded pool above
 * and the per-root buckets below, never here.
 */
const preUpgradeCaptureRoots = new WeakMap<
  EventTarget,
  { capture: PreUpgradeEventCapture; declared: Set<string> }
>();

/**
 * Per-claim-root record ownership (the M1 data model). A claimed root adopts
 * its records exactly once out of the shared pool into its own bounded
 * per-target bucket; from then on replay and release touch ONLY this root's
 * bucket — O(the root's own share), never the page-wide pool — and release
 * deterministically empties it. Keyed by root in a WeakMap: the bucket lives
 * and dies with its root by construction. That keying is the memory
 * guarantee; JS cannot observe GC, so nothing asserts collection behavior.
 */
interface PreUpgradeRootBucket {
  readonly store: PreUpgradeRecordStore;
  /** True once the root has claimed its share of the shared pool. */
  adopted: boolean;
}
const preUpgradeRootBuckets = new WeakMap<object, PreUpgradeRootBucket>();

/**
 * The root's own bucket, claiming its share of the shared pool on first
 * touch. Adoption is the one-time ownership handoff that makes per-root
 * replay possible at all: records are captured before their claim root
 * exists (delayed/lazy upgrade, #1170 — the upgraded element replaces the
 * un-upgraded host), so a root must claim its share when it first arrives,
 * sweeping detached records in the same pass. Afterwards the pool holds only
 * records owned by still-pending roots, which adopt them at their own
 * activation.
 */
function adoptRootBucket(root: Node): PreUpgradeRecordStore {
  let bucket = preUpgradeRootBuckets.get(root as object);
  if (!bucket) {
    bucket = { store: createPreUpgradeRecordStore(), adopted: false };
    preUpgradeRootBuckets.set(root as object, bucket);
  }
  if (bucket.adopted) return bucket.store;
  bucket.adopted = true;
  // Detached records can never hydrate: sweep them first so removals free
  // their slot for genuinely pending islands.
  preUpgradePendingRecords.takeWhere((record) => isDetachedTarget(record.target));
  for (const record of preUpgradePendingRecords.takeWhere((candidate) =>
    isInsideRoot(root, candidate.target),
  )) {
    bucket.store.replaceFor(record);
  }
  return bucket.store;
}

/**
 * Install the bounded pre-upgrade interaction capture on an owning root
 * (default: the document). Generated client entries call this with their
 * declared island tags before any compiled element upgrades; after a
 * successful claim the element replays the captured events whose targets
 * live inside its root (compiled claim capture/replay,
 * internal/compiled/runtime.ts). Idempotent per root (repeat calls merge
 * tags, never reinstall listeners) and a no-op where no DOM exists (SSR).
 *
 * Invariant: the capture itself — one fixed listener set per owning root,
 * installed once per page — is page-lifetime by design and is NOT the leak.
 * The M1 leak was retained event-target records; each element releases exactly
 * its own records at its activation decision (success or failure), while
 * records owned by still-pending elements survive for their delayed/lazy
 * upgrade (#1170).
 *
 * Boundedness: the facade capture passes the declared-island filter, so only
 * interactions under a still-pending DECLARED island tag enter the queue —
 * ordinary events and undeclared third-party custom elements are skipped
 * (nested pending declared islands still capture through their own unsettled
 * host). With no tags declared the legacy dash heuristic applies. The shared
 * queue carries a hard capacity cap (fail closed), detached records are
 * swept when a claim root adopts its share (and under queue pressure), and
 * each activation decision deterministically empties that root's own bucket,
 * so post-hydration traffic and removals never grow retention.
 */
export function ensurePreHydrationClickCapture(
  root?: EventTarget,
  pendingTags?: readonly string[],
): void {
  const target =
    root ?? (typeof document !== 'undefined' ? (document as unknown as EventTarget) : undefined);
  if (!target || typeof target.addEventListener !== 'function') return;
  const existing = preUpgradeCaptureRoots.get(target);
  if (existing) {
    if (pendingTags) {
      for (const tag of pendingTags) {
        if (typeof tag === 'string' && tag) existing.declared.add(tag.toLowerCase());
      }
    }
    return;
  }
  const declared = new Set<string>();
  if (pendingTags) {
    for (const tag of pendingTags) {
      if (typeof tag === 'string' && tag) declared.add(tag.toLowerCase());
    }
  }
  // The accept closure holds the LIVE declared set: later merges into the
  // same Set are visible to the filter without reinstalling listeners.
  const accept = (event: Event, eventTarget: EventTarget): boolean =>
    acceptPendingIslandEvent(event, eventTarget, declared);
  preUpgradeCaptureRoots.set(target, {
    capture: capturePreUpgradeEvents(target, undefined, {
      accept,
      store: preUpgradePendingRecords,
    }),
    declared,
  });
}

/** Replay captured pre-upgrade events owned by a successfully claimed root. */
export function replayPreUpgradeCaptures(root: Node): void {
  replayPreUpgradeEvents(root, adoptRootBucket(root).events);
}

/**
 * Per-element release at the activation decision — success or failure:
 * deterministically empty this root's own bucket, dropping its strong
 * event-target references in the same tick. Other roots' buckets and the
 * pool's still-pending records (#1170) are untouched. The shared listener
 * set stays installed for elements that have not yet activated.
 */
export function releasePreUpgradeCapturesFor(root: Node): void {
  adoptRootBucket(root).clear();
}

/**
 * Test-only structural introspection: how many records the registry retains
 * for `root`'s own bucket right now (0 for a released or never-adopted
 * root). Retention is pinned by state assertions like this one — the WeakMap
 * keying above is the memory guarantee itself.
 */
export function preUpgradeRetainedRecordCount(root: Node): number {
  return preUpgradeRootBuckets.get(root as object)?.store.events.length ?? 0;
}
