/**
 * @openelement/element/authoring — runtime guards shared by authoring layers
 * (Beta.2.2, #1339/#1326).
 *
 * definePage()/defineLitPage() and their sibling authoring entries validate
 * descriptors with exactly these guards. They live on a dedicated leaf
 * subpath so an authoring layer that ships in a browser graph (e.g. a Lit
 * route module) never has to import the package root barrel — which carries
 * the compiled Native runtime — just to validate a descriptor. Pure
 * re-exports of leaf modules; no runtime kernel is reachable from here.
 */
export { assertValidTagName, isValidTagName } from './internal/core/tag-utils.ts';
export { DANGEROUS_KEYS, injectPropsSafe, isDangerousKey } from './internal/core/security.ts';
export { ERROR_PREFIX, OpenElementError } from './internal/core/errors.ts';
export { HYDRATION_STRATEGIES } from './internal/protocol/framework.ts';
export type { HydrationStrategy } from './internal/protocol/framework.ts';
export { ACTION_FETCH_HEADER, PROBLEM_JSON_MEDIA_TYPE } from './internal/protocol/data.ts';
