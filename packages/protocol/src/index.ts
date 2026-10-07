/**
 * @openelement/protocol — the cross-system contract package (#1557).
 *
 * Zero dependencies, no logic growth: every module here is either a
 * cross-system data contract (types + serialized-shape constants) or a tiny
 * pure predicate the contract's consumers must evaluate identically. The
 * compiler emits the Part Program IR, the element runtime consumes it, and
 * the router build reads admission descriptors — all three depend on this
 * package and on none of each other, which makes the single-source-of-truth
 * rule physical instead of conventional.
 *
 * Prefer the per-module subpaths (tree-shakeable, explicit); the root entry
 * re-exports every contract module for convenience consumers.
 */

export * from './app-model.ts';
export * from './client-assets.ts';
export * from './data.ts';
export * from './errors.ts';
export * from './forbidden-sinks.ts';
export * from './framework.ts';
export * from './island-admission.ts';
export * from './island.ts';
export * from './manifest.ts';
export * from './module-descriptors.ts';
export * from './module-vocabulary.ts';
export * from './part-program.ts';
export * from './policy.ts';
export * from './registry-markers.ts';
export * from './render.ts';
export * from './runtime.ts';
export * from './signal.ts';
export * from './ssg.ts';
export * from './stream-frame-policy.ts';
export * from './style-sheet.ts';
export * from './void-tags.ts';
