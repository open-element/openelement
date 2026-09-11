/**
 * props-utils.ts - Shared prop collection utility (#621).
 *
 * Single implementation of public-prop extraction used by both
 * defineElement (element package) and definePage (app package).
 * Filters internal `__openElement` prefixed keys and uses Reflect.get
 * for safe access to inherited getters.
 *
 * v0.42.0-alpha.15 (#903): normalizePublicProps is the shared
 * prop-normalization core. DANGEROUS_KEYS filtering applies on every
 * projection path (host prop collection / SSR serialization here, page
 * projection via injectPropsSafe and projectPageProps, and the Router tooling
 * generated server runtime — #1214) through the single isDangerousKey
 * predicate in security.ts.
 *
 * @module ./props-utils.ts
 */

import { isDangerousKey } from './security.ts';
import { createLogger } from './logger.ts';
import { formatError } from './errors.ts';

const log = createLogger('props-utils');

/**
 * Framework-internal own fields of an OpenElement instance that are not user
 * props (#1037): the signal registry (a Map) and ElementInternals. Both are
 * own-enumerable (the constructor assigns `_internals` unconditionally, so the
 * key exists even when undefined), so without filtering they leak into
 * collected props and serialize as garbage attributes
 * (`signal-registry="[object Map]"`).
 */
const INTERNAL_HOST_FIELDS = new Set(['signalRegistry', '_internals']);

/**
 * Collect all public (non-internal) own properties from a host object.
 * Keys starting with `__openElement` are framework-internal and excluded.
 * Uses Reflect.get for safe access (respects getters); a getter that throws
 * is skipped with a warning so one bad prop cannot take the tree down.
 */
export function collectPublicProps(host: object): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const key of Object.keys(host)) {
    if (key.startsWith('__openElement')) continue;
    if (INTERNAL_HOST_FIELDS.has(key)) continue;
    try {
      props[key] = Reflect.get(host, key);
    } catch (err) {
      log.warn(`Skipping throwing getter prop "${key}": ${formatError(err)}`);
    }
  }
  return normalizePublicProps(props);
}

/**
 * Shared prop-normalization core (#903): strip framework-internal
 * (`__openElement*`) and prototype-dangerous keys from a raw props map.
 * Both SSR (render-dsd.ts) and CSR (jsx-render-dom.ts) filter through this
 * so the two paths cannot diverge on which keys survive.
 */
export function normalizePublicProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('__openElement')) continue;
    if (isDangerousKey(key)) continue;
    clean[key] = value;
  }
  return clean;
}
