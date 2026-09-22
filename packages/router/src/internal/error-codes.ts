/**
 * @openelement/router — application-authoring error codes.
 *
 * Every failure raised by the authoring surface (`definePage`,
 * `defineIslandConfig`) and the serve CLI carries a stable code, a phase and
 * a severity, exactly like the element package's `OpenElementError` contract
 * (decision 0053). Before this module those throws were bare `Error`s, so a host
 * could not classify a failure, and the CLI could not decide what to show
 * without pattern-matching message text.
 *
 * Phase is `validation` for every code here: each one rejects an author's
 * descriptor or argument before any render, route or build work starts. The
 * `*_MISUSE_*` split below follows the function that raises it, so a code
 * points at one authoring surface.
 */

import { OpenElementError } from '@openelement/element/authoring';

/** Stable codes for the page-authoring surface (`definePage`). */
export const PageErrorCode = {
  /** First argument is not the compiled page element class. */
  NOT_COMPILED_CLASS: 'OE_PAGE_NOT_COMPILED_CLASS',
  /** Descriptor is not an object, or carries a field the contract removed. */
  DESCRIPTOR_SHAPE: 'OE_PAGE_DESCRIPTOR_SHAPE',
  /** `route` intent is unsupported (`route.path`, mistyped `layout`). */
  ROUTE_INTENT: 'OE_PAGE_ROUTE_INTENT',
  /** `props`/`error` are present but are not projector functions. */
  PROJECTOR: 'OE_PAGE_PROJECTOR',
  /** `renderIntent.mode` is neither `static` nor `dynamic`. */
  RENDER_MODE: 'OE_PAGE_RENDER_MODE',
} as const;

/** Stable codes for the island-delivery surface (`defineIslandConfig`). */
export const IslandErrorCode = {
  /** Config is not an object, or carries a field outside the contract. */
  DESCRIPTOR_SHAPE: 'OE_ISLAND_DESCRIPTOR_SHAPE',
  /** `hydrate` / `media` disagree or name an unsupported strategy. */
  HYDRATE: 'OE_ISLAND_HYDRATE',
  /** `tags`/`tagNames` are malformed or contradict each other. */
  TAGS: 'OE_ISLAND_TAGS',
  /** `exportNames` is malformed or names a tag outside the delivery set. */
  EXPORT_NAMES: 'OE_ISLAND_EXPORT_NAMES',
} as const;

/** Stable codes for the serve CLI (`start`/`preview`). */
export const ServeErrorCode = {
  /** `--mode` is missing a value or names an unknown mode. */
  MODE: 'OE_SERVE_MODE',
} as const;

/**
 * One authoring-contract failure: `OpenElementError` with the shared
 * `validation` phase and `error` severity, so callers classify by code and
 * never by message text.
 */
export function authoringError(code: string, message: string): OpenElementError {
  return new OpenElementError(message, {
    code,
    phase: 'validation',
    severity: 'error',
    recoverable: false,
  });
}
