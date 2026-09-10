/**
 * manifest.ts - CEM manifest and compatibility contract types.
 */

import type { ComponentLayer, HydrationStrategy } from './framework.ts';

// --- Manifest descriptors (CEM-compatible) ------------------------

/** One documented attribute of a custom element declaration. */
export interface OpenElementAttribute {
  name: string;
  type?: string;
  default?: string;
  description?: string;
  reflects?: boolean;
  fieldName?: string;
}

/** One documented custom event of a custom element declaration. */
export interface OpenElementEvent {
  name: string;
  type?: string;
  description?: string;
}

/** One documented slot of a custom element declaration. */
export interface OpenElementSlot {
  name: string;
  description?: string;
}

/** One documented CSS part of a custom element declaration. */
export interface OpenElementCssPart {
  name: string;
  description?: string;
}

export interface OpenElementExtensions {
  ssr?: boolean;
  dsd?: boolean;
  layer?: ComponentLayer;
  hydrate?: HydrationStrategy;
  module?: string;
  export?: string;
}

/** One custom element declaration in a package manifest: tag, members and delivery metadata. */
export interface OpenElementDeclaration {
  tagName: string;
  className?: string;
  superclassName?: string;
  attributes?: OpenElementAttribute[];
  events?: OpenElementEvent[];
  slots?: OpenElementSlot[];
  cssParts?: OpenElementCssPart[];
  openElement?: OpenElementExtensions;
  description?: string;
}

/** Package manifest of component declarations (not a Custom Elements Manifest). */
export interface OpenElementPackageManifest {
  schemaVersion: string;
  packageName: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  declarations: OpenElementDeclaration[];
}

// --- Compatibility ------------------------------------------------

import type { CompatibilityClassification, CompatibilityTier } from './framework.ts';
export type { CompatibilityClassification, CompatibilityTier };

export interface CemCompatibilityReport {
  totalClassified: number;
  ssrCapableCount: number;
  clientOnlyCount: number;
  rejectedCount: number;
  experimentalDomCount: number;
  classifications: CompatibilityClassification[];
  summary: string;
}
