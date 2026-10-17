/**
 * `./client-only` variant of the lazy element-runtime surface (B2 / #1416).
 *
 * Same three bindings as {@linkcode ./element-services-full.ts}; the element
 * entry it re-exports from installs the when/each Block builders and NOT the
 * hydration executor. Selected by `entry-client-codegen.ts` only when no
 * island on the page can hydrate server DOM, so a wrong pick fails closed at
 * mount instead of silently skipping the claim.
 */
export {
  ensureDeepFragmentNavigation,
  ensurePreHydrationClickCapture,
  OpenElement,
} from '@openelement/element/client-only';
