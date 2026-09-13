/** Pure Route Mode matching entry: no Element, host or build dependencies. */
export { RouteTable } from './internal/router/route-table.ts';
export type {
  RouteMatch,
  RouteRecord,
  RouteResolution,
  RouteTableOptions,
} from './internal/router/route-table.ts';
export { normalizeRoutePatternForURLPattern } from './internal/router/route-pattern.ts';
