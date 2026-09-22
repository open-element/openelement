export {
  classifyActionResult,
  defineIslandConfig,
  definePage,
  fail,
  isActionFailure,
  isOpenElementNotFound,
  isOpenElementRedirect,
  notFound,
  OpenElementActionFailure,
  OpenElementNotFound,
  OpenElementRedirect,
  projectPageProps,
  redirect,
} from './authoring.ts';
export type {
  ActionOutcome,
  IslandConfig,
  IslandDeliveryStrategy,
  JsonValue,
  OpenElementPageDescriptor,
  PageComponentConstructor,
  PageErrorProjector,
  PageHead,
  PageHeadResolver,
  PagePropsContext,
  PagePropsProjector,
  StructuredDataEntry,
} from './authoring.ts';

// Re-export route data types from protocol for convenience
export type {
  Action,
  ActionContext,
  ActionResult,
  Loader,
  LoaderContext,
  ProblemDetails,
  ServerRouteContext,
  ServerRouteMetadata,
} from '@openelement/element';
export { ACTION_FETCH_HEADER, PROBLEM_JSON_MEDIA_TYPE } from '@openelement/element/authoring';

// OpenElement-owned request context contract and convenience constructor.
// This is the single canonical RequestContext authority. Adapters build it
// from their own request event:
//   - the Nitro integration (nitro-mount.ts) re-implements the
//     shape inline (createNitroRequestContext) because generated Nitro server
//     output must stay free of unresolved bare package imports; the type-only
//     import in nitro-mount pins it to this contract.
// The historical Hono driver bridge (createHonoRequestContext) was removed:
// it had zero production consumers and left the "official default request
// driver bridge" API as an empty shell (🟡-F).
export { createRequestContext } from './model.ts';
export type { CreateRequestContextOptions, OpenElementRequestContext } from './model.ts';

// Framework configuration surface (#1411): `openelement.config.ts` imports
// defineConfig from here. Host-neutral — this module reads no files and
// imports no host APIs; loading lives in @openelement/router/vite and
// @openelement/router/cli/*.
export {
  CONVENTION_APP_SHELL_PATH,
  CONVENTION_APP_SHELL_TAG,
  CONVENTION_PACKAGE_JSON,
  CONVENTION_TOKENS_PATH,
  defineConfig,
  OPEN_ELEMENT_CONFIG_FILE,
  OPEN_ELEMENT_CONFIG_KEYS,
} from './config.ts';
export type { OpenElementUserConfig } from './config.ts';
