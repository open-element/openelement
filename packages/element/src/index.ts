/**
 * The default component authoring entry. The when/each Block builders are
 * installed here for consumers that use the internal Part Program runtime.
 * Generated elements own claim and mount in their compiled factories.
 *
 * The `./client-only` entry also installs Block builders. Use `./no-blocks`
 * or `./base` for an internal Part Program graph without when or each Parts.
 * The shared export list lives in public-surface.ts.
 *
 * Load the wildcard CSS module declaration through the tsconfig `types` array
 * using `@openelement/element/css-modules`.
 */
import './internal/compiled/runtime/blocks-install.ts';

export * from './public-surface.ts';
