/** Compatible with console.error and the tagged Logger from createLogger(). */
type ActionErrorLogger = (msg: string, ...args: unknown[]) => void;

/** The failure channel a normalized error rides: action data or page error. */
type FailureChannel = 'action' | 'loader';

/**
 * Convert an exception into stable render data and environment-safe
 * diagnostics for the given channel. Callers pass their own tagged logger
 * (e.g. the spa logger) so the messages carry the caller's tag instead of a
 * hardcoded prefix.
 */
function normalizeFailure(
  channel: 'action',
  error: unknown,
  development: boolean,
  log: ActionErrorLogger,
): { error: 'Action failed' };
function normalizeFailure(
  channel: 'loader',
  error: unknown,
  development: boolean,
  log: ActionErrorLogger,
): { error: 'Loader failed' };
function normalizeFailure(
  channel: FailureChannel,
  error: unknown,
  development: boolean,
  log: ActionErrorLogger,
): { error: 'Action failed' } | { error: 'Loader failed' } {
  if (development) log(`${channel} failed:`, error);
  else log(`${channel} failed`);
  return channel === 'action' ? { error: 'Action failed' } : { error: 'Loader failed' };
}

/**
 * Convert an action exception into stable render data and environment-safe
 * diagnostics. The shape rides the action data channel.
 */
export function normalizeActionFailure(
  error: unknown,
  development: boolean,
  log: ActionErrorLogger = console.error,
): { error: 'Action failed' } {
  return normalizeFailure('action', error, development, log);
}

/**
 * Convert a loader exception into a stable page error and environment-safe
 * diagnostics (#676). The shape rides the page error channel
 * (`__openElementError`), never the loader data channel.
 */
export function normalizeLoaderFailure(
  error: unknown,
  development: boolean,
  log: ActionErrorLogger = console.error,
): { error: 'Loader failed' } {
  return normalizeFailure('loader', error, development, log);
}
