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
} from './internal/protocol/data.ts';
export { ACTION_FETCH_HEADER, PROBLEM_JSON_MEDIA_TYPE } from './internal/protocol/data.ts';
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
} from './internal/protocol/framework.ts';
export { HYDRATION_STRATEGIES } from './internal/protocol/framework.ts';
export type { OpenElementRouteKind, OpenElementRouteNode } from './internal/protocol/app-model.ts';
export type {
  OpenElementAttribute,
  OpenElementCssPart,
  OpenElementDeclaration,
  OpenElementEvent,
  OpenElementPackageManifest,
  OpenElementSlot,
} from './internal/protocol/manifest.ts';
