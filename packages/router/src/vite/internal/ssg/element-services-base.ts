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
} from '@openelement/element/base';
// The shared sheet registry the entry registers the compiled component sheet in.
// It lives on an INTERNAL subpath so the deletion of the class base did not widen
// the public surface with a symbol authors are not meant to touch (F16).
export { themeManager } from '@openelement/element/internal/styles';
