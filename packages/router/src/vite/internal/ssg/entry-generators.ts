/**
 * entry-generators.ts - Island entry validation + virtual runtime specifiers
 *
 * The validation axis of the entry-* family (#901): island admission checks
 * (module specifier, tag name, hydration strategy) shared by the entry
 * codegen and the client entry emission, plus the virtual runtime module
 * specifiers resolved by build-client.ts. String emission lives in
 * entry-codegen.ts.
 *
 * v0.21.0: manifest-driven hydration strategies.
 * Zero DOM interaction - cannot interfere with DSD rendering.
 */

import { HYDRATION_STRATEGIES, isValidTagName } from '@openelement/element';
import {
  type ClientIslandDeliveryEntry,
  type ClientIslandDeliveryInput,
  isIslandDeliveryStrategy,
  ISLAND_DELIVERY_STRATEGIES,
  type IslandDeliveryStrategy,
  resolveIslandDeliveryTags,
  validateIslandDeliveryExportNames,
  validateIslandMediaQuery,
} from './delivery.ts';

// #868: the browser runtimes are real modules (island-scheduler.ts,
// enhance-client.ts) bundled via the virtual:open-client-runtime specifiers
// resolved by build-client.ts. The generated entry only wires them; no
// toString() serialization, no import-free constraint, no string copy.
export const VIRTUAL_RUNTIME_SPECIFIERS = {
  scheduler: 'virtual:open-client-runtime/scheduler',
  enhance: 'virtual:open-client-runtime/enhance',
} as const;

const URL_OR_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const SAFE_RELATIVE_SPECIFIER_RE = /^\.{1,2}\/[A-Za-z0-9_./@-]+$/;
const SAFE_ROOT_SPECIFIER_RE = /^\/[A-Za-z0-9_./@-]+$/;
// Vite `/@fs/` absolute-path convention; the optional drive-letter segment
// (`C:/`) is how Windows absolute paths become valid specifiers (#460).
const SAFE_FS_SPECIFIER_RE = /^\/@fs\/(?:[A-Za-z]:\/)?[A-Za-z0-9_./@-]+$/;
const SAFE_BARE_SPECIFIER_RE =
  /^(?:@[a-z0-9_.-]+\/[a-z0-9_.-]+|[a-z0-9_.-]+)(?:\/[A-Za-z0-9_./@-]+)?$/;
const VALID_STRATEGIES = new Set<string>([
  ...HYDRATION_STRATEGIES,
  ...ISLAND_DELIVERY_STRATEGIES,
]);

declare const admittedIslandModuleSpecifier: unique symbol;
export type AdmittedIslandModuleSpecifier = string & {
  readonly [admittedIslandModuleSpecifier]: true;
};

export interface AdmittedClientIslandEntry
  extends Omit<ClientIslandDeliveryEntry, 'modulePath' | 'strategy'> {
  modulePath: AdmittedIslandModuleSpecifier;
  strategy: IslandDeliveryStrategy;
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hasTraversalSegment(value: string): boolean {
  return value.split('/').includes('..');
}

export function validateIslandModuleSpecifier(modulePath: string): void {
  if (
    !modulePath ||
    hasControlCharacter(modulePath) ||
    URL_OR_SCHEME_RE.test(modulePath) ||
    modulePath.startsWith('//') ||
    hasTraversalSegment(modulePath)
  ) {
    throw new Error(`Invalid island modulePath: ${modulePath}`);
  }
  if (
    !SAFE_RELATIVE_SPECIFIER_RE.test(modulePath) &&
    !SAFE_ROOT_SPECIFIER_RE.test(modulePath) &&
    !SAFE_FS_SPECIFIER_RE.test(modulePath) &&
    !SAFE_BARE_SPECIFIER_RE.test(modulePath)
  ) {
    throw new Error(`Invalid island modulePath: ${modulePath}`);
  }
}

function admitIslandModuleSpecifier(modulePath: string): AdmittedIslandModuleSpecifier {
  validateIslandModuleSpecifier(modulePath);
  return modulePath as AdmittedIslandModuleSpecifier;
}

export function validateClientIslandEntry(
  entry: ClientIslandDeliveryInput,
): AdmittedClientIslandEntry {
  const deliveryEntry = entry as ClientIslandDeliveryEntry;
  if (!isValidTagName(entry.tagName)) {
    throw new Error(`Invalid island tagName: ${entry.tagName}`);
  }
  let modulePath: AdmittedIslandModuleSpecifier;
  try {
    modulePath = admitIslandModuleSpecifier(entry.modulePath);
  } catch (e) {
    throw new Error(`Invalid island modulePath for ${entry.tagName}: ${entry.modulePath}`, {
      cause: e,
    });
  }
  if (!isIslandDeliveryStrategy(entry.strategy) || !VALID_STRATEGIES.has(entry.strategy)) {
    throw new Error(
      `Invalid island strategy for ${entry.tagName}: ${String(entry.strategy)}. ` +
        'Use one of: load, idle, visible, media, only.',
    );
  }
  const tags = resolveIslandDeliveryTags(
    entry.tagName,
    deliveryEntry.tags,
    deliveryEntry.tagNames,
    entry.tagName,
  );
  const media = deliveryEntry.media === undefined
    ? undefined
    : validateIslandMediaQuery(deliveryEntry.media, entry.tagName);
  if (entry.strategy === 'media' && media === undefined) {
    throw new Error(
      `Invalid island media query for ${entry.tagName}: strategy "media" requires media`,
    );
  }
  if (entry.strategy !== 'media' && media !== undefined) {
    throw new Error(
      `Invalid island media query for ${entry.tagName}: media is only valid with strategy "media"`,
    );
  }
  if (
    deliveryEntry.exportName !== undefined &&
    (typeof deliveryEntry.exportName !== 'string' ||
      deliveryEntry.exportName.trim() === '' ||
      hasControlCharacter(deliveryEntry.exportName))
  ) {
    throw new Error(`Invalid island export name for ${entry.tagName}`);
  }
  const exportNames = validateIslandDeliveryExportNames(
    deliveryEntry.exportNames,
    tags,
    entry.tagName,
  );
  return {
    ...entry,
    modulePath,
    ...(tags.length > 0 ? { tags } : {}),
    ...(media !== undefined ? { media } : {}),
    ...(exportNames === undefined ? {} : { exportNames }),
  };
}
