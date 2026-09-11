/**
 * v0.44 island delivery contracts.
 *
 * Delivery is deliberately a build-side concern. The generated client entry
 * knows only which capability module to import and which custom-element names
 * it can register; it does not know anything about Parts, Regions, Signals or
 * rendering. A capability module may expose one or many element constructors.
 */

import type { ClientIslandEntry, IslandDeliveryStrategy } from '../protocol/ssg.ts';
export type { IslandDeliveryStrategy } from '../protocol/ssg.ts';
import { isValidTagName } from '@openelement/element';

export const ISLAND_DELIVERY_STRATEGIES = [
  'load',
  'idle',
  'visible',
  'media',
  'only',
] as const;

/** One capability module may deliver several native custom elements. */
export interface ClientIslandDeliveryEntry extends ClientIslandEntry {
  /** A media query required when `strategy` is `media`. */
  media?: string;
  /** Optional one-to-many element names served by this module. */
  tags?: readonly string[];
  /** Alias accepted by generated artifact producers. */
  tagNames?: readonly string[];
  /** Named constructor exports keyed by custom-element tag. */
  exportNames?: Readonly<Record<string, string>>;
}

export interface IslandDeliveryMeta {
  media?: string;
  tags?: readonly string[];
  tagNames?: readonly string[];
  exportNames?: Readonly<Record<string, string>>;
}

export type ClientIslandDeliveryInput = ClientIslandEntry | ClientIslandDeliveryEntry;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Media queries are data in the generated artifact, never executable source.
 * Keep the value bounded and reject controls before it is passed to
 * `matchMedia`; the code generator still quotes it as a JavaScript literal.
 */
export function validateIslandMediaQuery(media: unknown, context = 'island'): string {
  if (typeof media !== 'string' || media.trim() === '') {
    throw new Error(`Invalid island media query for ${context}: a non-empty string is required`);
  }
  const normalized = media.trim();
  if (normalized.length > 512 || hasControlCharacters(normalized)) {
    throw new Error(`Invalid island media query for ${context}: unsafe or oversized value`);
  }
  return normalized;
}

export function isIslandDeliveryStrategy(value: unknown): value is IslandDeliveryStrategy {
  return typeof value === 'string' &&
    (ISLAND_DELIVERY_STRATEGIES as readonly string[]).includes(value);
}

/** Validate a one-to-many tag list without executing an island module. */
export function validateIslandDeliveryTags(
  tags: readonly string[] | undefined,
  context: string,
): string[] {
  if (tags === undefined) return [];
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error(`Invalid island tags for ${context}: at least one tag is required`);
  }
  const seen = new Set<string>();
  return tags.map((tag) => {
    if (typeof tag !== 'string' || !isValidTagName(tag)) {
      throw new Error(`Invalid island tagName for ${context}: ${tag}`);
    }
    if (seen.has(tag)) throw new Error(`Duplicate island tagName for ${context}: ${tag}`);
    seen.add(tag);
    return tag;
  });
}

/**
 * Resolve the canonical tag list for a capability declaration. `tagNames` is
 * accepted as an artifact-producer alias, but two aliases may not disagree;
 * silently choosing one would make the server and client manifests diverge.
 */
export function resolveIslandDeliveryTags(
  primaryTag: string,
  tags: readonly string[] | undefined,
  tagNames: readonly string[] | undefined,
  context = primaryTag,
): string[] {
  if (!isValidTagName(primaryTag)) {
    throw new Error(`Invalid island tagName for ${context}: ${primaryTag}`);
  }
  const validatedTags = tags === undefined ? undefined : validateIslandDeliveryTags(tags, context);
  const validatedTagNames = tagNames === undefined
    ? undefined
    : validateIslandDeliveryTags(tagNames, context);
  if (validatedTags && validatedTagNames) {
    if (
      validatedTags.length !== validatedTagNames.length ||
      validatedTags.some((tag, index) => tag !== validatedTagNames[index])
    ) {
      throw new Error(`Conflicting island tags/tagNames for ${context}`);
    }
  }
  return validatedTags ?? validatedTagNames ?? [primaryTag];
}

export function validateIslandDeliveryExportNames(
  exportNames: Readonly<Record<string, string>> | undefined,
  tags: readonly string[],
  context: string,
): Record<string, string> | undefined {
  if (exportNames === undefined) return undefined;
  if (typeof exportNames !== 'object' || exportNames === null || Array.isArray(exportNames)) {
    throw new Error(`Invalid island export names for ${context}: an object is required`);
  }
  const allowedTags = new Set(tags);
  const result: Record<string, string> = {};
  for (const [tag, exportName] of Object.entries(exportNames)) {
    if (
      !allowedTags.has(tag) ||
      !isValidTagName(tag) ||
      typeof exportName !== 'string' ||
      exportName.trim() === '' ||
      hasControlCharacters(exportName)
    ) {
      throw new Error(`Invalid island export name for ${context}: ${tag}`);
    }
    result[tag] = exportName;
  }
  return result;
}
