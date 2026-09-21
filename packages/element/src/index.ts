/**
 * Canonical component-authoring facade for openElement (0.44) — the default
 * entry, with the compiled claim executor installed.
 *
 * This is the entry for any page whose components can hydrate server-rendered
 * markup: it imports the claim install below, so a connected element whose
 * root already carries content claims that DOM instead of building fresh.
 *
 * `client-only.ts` re-exports the identical surface without the install; use
 * it only for pages where no island can hydrate server DOM (see that file).
 * The export list itself lives in `public-surface.ts`, spelled out once.
 *
 * The public OpenElement base class runs on the compiled Part Program kernel;
 * the legacy VNode renderer and runtime JSX factories were removed —
 * components are compiled by @openelement/element/compiler. Build
 * orchestration remains in @openelement/router; build adapters import
 * build-time helpers from `@openelement/element/build-utils`.
 */
import './internal/compiled/runtime/claim-install.ts';

export * from './public-surface.ts';
