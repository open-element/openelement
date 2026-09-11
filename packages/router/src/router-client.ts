/** Browser navigation entry for Router Route Mode; independent of Element. */
export { compileRouteMatcher, createRouter, matchRoute } from './internal/router/client-router.ts';
export type {
  CompiledRouteMatcher,
  RouteConfig,
  RouterInstance,
  RouterMode,
  SpaActionContext,
  SpaLoaderContext,
} from './internal/router/client-router.ts';
