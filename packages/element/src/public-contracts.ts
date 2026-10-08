/** Explicit compatibility contracts retained on the frozen root surface. */
export type {
  Action,
  ActionContext,
  ActionResult,
  Loader,
  LoaderContext,
  ProblemDetails,
  ServerRouteContext,
  ServerRouteMetadata,
} from '@openelement/protocol/data';
export { ACTION_FETCH_HEADER, PROBLEM_JSON_MEDIA_TYPE } from '@openelement/protocol/data';
export type {
  AppShellConfig,
  CompatibilityClassification,
  CompatibilityTier,
  ComponentLayer,
  FrameworkOptions,
  HydrationStrategy,
  LocalePath,
  Middleware,
  RouteEntry,
  SpecialFileType,
} from '@openelement/protocol/framework';
export { HYDRATION_STRATEGIES } from '@openelement/protocol/framework';
export type { OpenElementRouteKind, OpenElementRouteNode } from '@openelement/protocol/app-model';
export type {
  OpenElementAttribute,
  OpenElementCssPart,
  OpenElementDeclaration,
  OpenElementEvent,
  OpenElementPackageManifest,
  OpenElementSlot,
} from '@openelement/protocol/manifest';
