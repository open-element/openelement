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
export {
  DANGEROUS_KEYS,
  injectPropsSafe,
  isDangerousKey,
  isSafeAttributeName,
} from './internal/core/security.ts';
export { ERROR_PREFIX, OpenElementError } from './internal/core/errors.ts';
export { HYDRATION_STRATEGIES } from '@openelement/protocol/framework';
export type { HydrationStrategy } from '@openelement/protocol/framework';
export { ACTION_FETCH_HEADER, PROBLEM_JSON_MEDIA_TYPE } from '@openelement/protocol/data';
// Streamed-route policy constants (internal/protocol/policy.ts and
// stream-frame-policy.ts, both import-free): the single-source admission
// budgets and frame deny lists the router's typed stream runtime imports
// kernel-free (#1470 block d) — the same leaf transport as the protocol
// constants above, so no consumer of them ever reaches the runtime barrel.
// MAX_ACTION_BODY_BYTES joins for the same reason (#1470 block e): the typed
// action runtime binds the canonical body-limit budget directly instead of
// receiving a serialized copy through the generated entry.
export {
  MAX_ACTION_BODY_BYTES,
  STREAM_MAX_FIELDS,
  STREAM_MAX_OWNERS,
  STREAM_MAX_PAYLOAD_LENGTH,
  STREAM_MAX_SEED_PROPERTIES,
  STREAM_TIMEOUT_MS,
} from '@openelement/protocol/policy';
export {
  STREAM_FRAME_FORBIDDEN_TAGS,
  STREAM_FRAME_UNSAFE_URL,
  STREAM_FRAME_URL_ATTRIBUTES,
  STREAM_FRAME_URL_CONTROL_MAX,
} from '@openelement/protocol/stream-frame-policy';
