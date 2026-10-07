/** Host-agnostic route and asset contracts shared by app and build drivers. */
export type OpenElementRouteKind = 'page' | 'api';

/**
 * One node of the host-agnostic route tree: the matched URL `path` and route
 * kind, the source and module paths the drivers resolve, the optional
 * registered tag and param names, and the nested `children`.
 */
export interface OpenElementRouteNode {
  kind: OpenElementRouteKind;
  path: string;
  filePath?: string;
  importPath?: string;
  tagName?: string;
  paramNames?: string[];
  children?: OpenElementRouteNode[];
  meta?: Record<string, unknown>;
}
