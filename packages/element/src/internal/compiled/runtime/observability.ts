/**
 * Runtime evidence counters for the M04 ownership/recipe primitives.
 *
 * INTERNAL TEST HOOK — not package surface. The generated-code runtime
 * primitives are delivered to Alpha16a's exit gate G2 with observable
 * owner/region/cleanup/subscription accounting (execution plan §1 M04; JSX
 * model §4.1c/§9 obligations 11–13), and a `LifetimeScope` keeps its internal
 * counts private. Rather than grow `LifetimeScope` into a graph service, the
 * primitives that create and release those resources increment a tiny
 * module-local counter record here, and the probes snapshot it.
 *
 * The counters are monotonic since the last {@linkcode runtimeProbe.reset};
 * tests assert deltas. They are deliberately process-local and never
 * serialized: nothing in production reads them, and no behavior depends on
 * them.
 *
 * @module ./observability.ts
 */

/** Monotonic counters for the generated-code runtime primitives. */
export interface RuntimeProbeCounts {
  /** Successful insertions (one per projection/region). */
  projections: number;
  /** Region identities allocated (equals projections; kept separate for clarity). */
  regions: number;
  /** Projection-site `LifetimeScope`s created (includes rolled-back setups). */
  owners: number;
  /** Top-level region nodes inserted into their parent. */
  nodes: number;
  /** Region range cleanups registered (one per successful insertion). */
  rangeCleanups: number;
  /** Write subscriptions opened through the neutral binding helper. */
  subscriptions: number;
  /** Write subscriptions released (scope cleanup or immediate disposed-scope add). */
  unsubscribed: number;
  /** Lineage checks that admitted a projection. */
  lineageAccepted: number;
  /** Lineage checks that rejected a projection. */
  lineageRejected: number;
  /** Projection disposals requested through `Projection.dispose` (idempotent). */
  disposed: number;
}

function emptyCounts(): RuntimeProbeCounts {
  return {
    projections: 0,
    regions: 0,
    owners: 0,
    nodes: 0,
    rangeCleanups: 0,
    subscriptions: 0,
    unsubscribed: 0,
    lineageAccepted: 0,
    lineageRejected: 0,
    disposed: 0,
  };
}

let counts: RuntimeProbeCounts = emptyCounts();

/** The internal probe: snapshot the counters, or reset them between probes. */
export const runtimeProbe = {
  snapshot(): Readonly<RuntimeProbeCounts> {
    return { ...counts };
  },
  reset(): void {
    counts = emptyCounts();
  },
} as const;

/** One projection owner was created (recorded before setup may fail). */
export function recordOwnerCreated(): void {
  counts.owners++;
}

/** One region identity was allocated. */
export function recordRegionAllocated(): void {
  counts.regions++;
}

/** One insertion committed: the region and its top-level nodes are owned. */
export function recordProjection(nodes: number): void {
  counts.projections++;
  counts.nodes += nodes;
}

/** One region range cleanup was registered. */
export function recordRangeCleanup(): void {
  counts.rangeCleanups++;
}

/** One write subscription was opened through the neutral binding helper. */
export function recordSubscriptionOpened(): void {
  counts.subscriptions++;
}

/** One write subscription was released. */
export function recordSubscriptionClosed(): void {
  counts.unsubscribed++;
}

/** One lineage check admitted (or rejected) a projection. */
export function recordLineage(accepted: boolean): void {
  if (accepted) counts.lineageAccepted++;
  else counts.lineageRejected++;
}

/** One projection disposal was requested (idempotent per projection). */
export function recordProjectionDisposed(): void {
  counts.disposed++;
}
