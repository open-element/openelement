import { isSafeAttributeName } from '@openelement/protocol/forbidden-sinks';
import { classValueOf, CompiledProgramValidationError, styleValueOf } from '../runtime/values.ts';

type CompiledHostAttribute = readonly [name: string, value: unknown];

/** One host attribute after the ONE canonical value algebra. */
export interface NormalizedHostAttribute {
  /** The attribute name, exactly as the caller supplied it. */
  readonly name: string;
  /**
   * The canonical string value. A presence-only attribute (`true`) carries the
   * canonical pair encoding of presence: the empty string.
   */
  readonly value: string;
  /**
   * Presence-only (`true`). The class writer emits the bare `name` spelling;
   * the typed generated-host pair channel spells `name=""`. One algebra, two
   * canonical wire spellings — parsed attribute presence is identical.
   */
  readonly bare: boolean;
}

/** The one normalized host-attribute result. */
export interface NormalizedHostAttributes {
  readonly attributes: readonly NormalizedHostAttribute[];
  /**
   * Lowercased names the raw input carried, INCLUDING values the algebra
   * omitted (a `false` flag still names the attribute). The light-root writer
   * needs the ledger for its `data-oe-light` ownership refusal.
   */
  readonly names: ReadonlySet<string>;
}

/** Check attribute names and normalize host values in authored order. */
export function normalizeHostAttributePairs(
  raw: readonly CompiledHostAttribute[] | Record<string, unknown> | undefined,
): NormalizedHostAttributes {
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
  const attributes: NormalizedHostAttribute[] = [];
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
      if (serialized !== '') attributes.push({ name, value: serialized, bare: false });
      continue;
    }
    if (value === false || value === null || value === undefined) continue;
    if (value === true) {
      attributes.push({ name, value: '', bare: true });
      continue;
    }
    attributes.push({ name, value: String(value), bare: false });
  }
  return { attributes, names: seen };
}
