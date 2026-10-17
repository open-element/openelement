/**
 * Canonical component-authoring facade for openElement — the default
 * entry, with the compiled hydration executor and the compiled Block builders
 * installed.
 *
 * This is the entry for any page whose components can hydrate server-rendered
 * markup: it imports the claim install below, so a connected element whose
 * root already carries content hydrates that DOM instead of building fresh. It
 * also installs the when/each Block builders (#1548), so programs with
 * conditional or list Blocks execute on every entry choice.
 *
 * `client-only.ts` re-exports the identical surface without the claim
 * install; `no-blocks.ts` and `base.ts` drop the Block builders the same
 * way (#1548) — use them only for apps whose compiled Part Programs carry no
 * Block Parts. The generated client entry makes that selection (the
 * client-only split is #1416; the blocks split is #1548). The export list
 * itself lives in `public-surface.ts`, spelled out once.
 *
 * The public OpenElement base class runs on the compiled Part Program kernel;
 * the legacy VNode renderer and runtime JSX factories were removed —
 * components are compiled by @openelement/compiler. Build
 * orchestration remains in @openelement/router; build adapters import
 * build-time helpers from `@openelement/element/build-utils`.
 *
 * The `*.css` ambient module type (#1558) ships as `./css-modules.d.ts`,
 * exposed through the `./css-modules` export: a wildcard `declare module`
 * cannot live in a module file (TS2664) and a triple-slash reference is
 * lint-banned, so consuming tsconfigs load it through the standard
 * `types` array (the vite/client pattern).
 */
import './internal/compiled/runtime/hydrate-install.ts';
import './internal/compiled/runtime/blocks-install.ts';

export * from './public-surface.ts';
