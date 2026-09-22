import { createLogger } from './internal/core/logger.ts';
import { AuthoringErrorCode, formatError, OpenElementError } from './internal/core/errors.ts';
import { signal } from './internal/signal/index.ts';

const MAX_PARAMS_ATTRIBUTE_BYTES = 64 * 1024;

/**
 * Route params are a flat string→string map. `"null"`, `"[1,2]"` or
 * `'{"a":1}'` all JSON.parse cleanly but are not params (`params.id` on null
 * throws a TypeError downstream) — reject them with a warning and fall back
 * to an empty object (#1036).
 */
function parseParamsAttribute(
  attrParams: string,
  element: HTMLElement,
): Record<string, string> {
  const parsed: unknown = JSON.parse(attrParams);
  if (
    typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
    Object.values(parsed).some((value) => typeof value !== 'string')
  ) {
    createLogger('element').warn(
      `Ignoring params attribute on <${element.tagName.toLowerCase()}>: expected a flat ` +
        'string→string JSON object.',
    );
    return {};
  }
  return parsed as Record<string, string>;
}

/**
 * Reactive route-params box owned by an OpenElement host.
 *
 * Extracted from the base class (#904, concern: locale/theme/props
 * reflection). SSR/SSG injects params as a JS property; the client reads
 * them from the `params` attribute (TG-01). The attribute is size-guarded —
 * a crafted 10 MB attribute would otherwise be JSON.parsed on every connect.
 */
export class ElementParams {
  #params = signal<Record<string, string>>({});

  get value(): Record<string, string> {
    return this.#params.value;
  }

  set value(next: Record<string, string>) {
    this.#params.value = { ...next };
  }

  /**
   * Read route params from the `params` attribute if present.
   * @returns true when the attribute was present (parsed or logged as error).
   */
  syncFromAttribute(element: HTMLElement): boolean {
    const attrParams = element.getAttribute('params');
    if (!attrParams) return false;
    try {
      if (new TextEncoder().encode(attrParams).byteLength > MAX_PARAMS_ATTRIBUTE_BYTES) {
        throw new OpenElementError('params attribute exceeds the 64 KiB limit', {
          code: AuthoringErrorCode.PARAMS_ATTRIBUTE_TOO_LARGE,
          phase: 'csr',
        });
      }
      this.#params.value = parseParamsAttribute(attrParams, element);
    } catch (err) {
      createLogger('element').error(
        `Failed to parse params attribute on <${element.tagName.toLowerCase()}>: ${
          formatError(err)
        }`,
      );
    }
    return true;
  }
}
