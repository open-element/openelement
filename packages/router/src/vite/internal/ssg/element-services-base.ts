/**
 * `./base` variant of the lazy element-runtime surface (B2 / #1548).
 *
 * Same three bindings as {@linkcode ./element-services-full.ts}; the element
 * entry it re-exports from installs NEITHER optional runtime half. Selected
 * by `entry-client-codegen.ts` only when the page's islands are all
 * client-only AND the island blocks scan proved no Block Part — the
 * two-predicate row of the runtime-shape floor table.
 */
export {
  ensureDeepFragmentNavigation,
  ensurePreHydrationClickCapture,
  OpenElement,
} from '@openelement/element/base';
