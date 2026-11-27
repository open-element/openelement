import { isSafeAttributeName } from '@openelement/protocol/forbidden-sinks';
import { classValueOf, CompiledProgramValidationError, styleValueOf } from '../runtime/values.ts';

/** Descriptor rows that the server function's prop-to-attribute handoff skips. */
export const ssrPropertyOnlyNames = new WeakMap<CustomElementConstructor, ReadonlySet<string>>();

type CompiledHostAttribute = readonly [name: string, value: unknown];

/** Check attribute names and normalize host values in authored order. */
export function normalizeHostAttributePairs(
  raw: readonly CompiledHostAttribute[] | Record<string, unknown> | undefined,
): Array<readonly [string, string]> {
  let pairs: Array<CompiledHostAttribute>;
  if (Array.isArray(raw)) {
    pairs = raw.map((pair, index) => {
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw new CompiledProgramValidationError(
          `hostAttrs[${index}]`,
          'host attributes must be [name, value] pairs',
        );
      }
      const name: unknown = pair[0];
      if (typeof name !== 'string') {
        throw new CompiledProgramValidationError(
          `hostAttrs[${index}]`,
          'host attribute name must be a string',
        );
      }
      const value: unknown = pair[1];
      return [name, value] as CompiledHostAttribute;
    });
  } else if (raw && typeof raw === 'object') {
    pairs = Object.entries(raw);
  } else {
    pairs = [];
  }
  const seen = new Set<string>();
  const attributes: Array<readonly [string, string]> = [];
  for (const [name, value] of pairs) {
    if (typeof name !== 'string' || !isSafeAttributeName(name)) {
      throw new CompiledProgramValidationError(
        'hostAttrs',
        `unsafe attribute name ${String(name)}`,
      );
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new CompiledProgramValidationError(
        'hostAttrs',
        `duplicate attribute ${JSON.stringify(name)}`,
      );
    }
    seen.add(key);
    if (key === 'class' || key === 'style') {
      const serialized = key === 'class' ? classValueOf(value) : styleValueOf(value);
      if (serialized !== '') attributes.push([name, serialized]);
      continue;
    }
    if (value === false || value === null || value === undefined) continue;
    if (value === true) {
      attributes.push([name, '']);
      continue;
    }
    attributes.push([name, String(value)]);
  }
  return attributes;
}
