/**
 * property-conversion.ts — the canonical compiled-property conversion core.
 *
 * ONE owner for the three conversions the compiled property contract needs:
 *
 * - attribute string -> typed property value (`convertFromAttribute`);
 * - typed property value -> reflected attribute string (`convertToAttribute`);
 * - JS assignment -> typed property value (`coercePropertyValue`).
 *
 * This is an import-free leaf on purpose. It names only the structural fields
 * the conversions read, so it has no edge to the Part Program metadata, the
 * facade host, the compiled kernel, or any executor. `facade-host.ts`
 * re-exports the two public helpers for existing compiled-runtime callers; the
 * generated-element shell imports this leaf directly, so its module graph
 * cannot acquire the old execution backend through a conversion helper.
 *
 * The table lives here once. Consumers must not re-derive it: attribute
 * presence still means `true` for a boolean, `Number` with `NaN` -> `0` for a
 * number, JSON for array/object, and `null`/`undefined` reflect nothing.
 *
 * @module ./property-conversion.ts
 */

/** The value-type tags compiled property metadata admits. */
export type PropertyValueTypeName = 'string' | 'number' | 'boolean' | 'array' | 'object';

/**
 * The structural property record this leaf reads. It is deliberately a subset
 * of the protocol's `CompiledPropertyMetadata` (that record is structurally
 * assignable to this one), so this module can stay import-free while callers
 * keep their richer records.
 */
export interface PropertyConversionRecord {
  readonly converter: PropertyValueTypeName;
  readonly type: PropertyValueTypeName;
  readonly default: unknown;
}

/** Convert a raw attribute string into the compiled property value. */
export function convertFromAttribute(record: PropertyConversionRecord, raw: string): unknown {
  switch (record.converter) {
    case 'boolean':
      return true;
    case 'number': {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    case 'array':
    case 'object': {
      try {
        return JSON.parse(raw);
      } catch {
        return record.default;
      }
    }
    default:
      return raw;
  }
}

/** Serialize a property value for attribute reflection. */
export function convertToAttribute(
  record: PropertyConversionRecord,
  value: unknown,
): string | null {
  if (value === null || value === undefined) return null;
  if (record.type === 'boolean') return value ? '' : null;
  if (record.type === 'array' || record.type === 'object') return JSON.stringify(value);
  return String(value);
}

/** Coerce a JS-side property assignment into the compiled property type. */
export function coercePropertyValue(record: PropertyConversionRecord, value: unknown): unknown {
  if (value === null || value === undefined) return record.default;
  switch (record.type) {
    case 'boolean':
      return Boolean(value);
    case 'number':
      return typeof value === 'number' ? value : convertFromAttribute(record, String(value));
    case 'array':
      return Array.isArray(value) ? value : convertFromAttribute(record, String(value));
    case 'object':
      return typeof value === 'object' ? value : convertFromAttribute(record, String(value));
    default:
      return typeof value === 'string' ? value : String(value);
  }
}
