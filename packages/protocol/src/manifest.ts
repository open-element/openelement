/**
 * manifest.ts - CEM manifest and compatibility contract types.
 */

import type {
  CompatibilityClassification,
  CompatibilityTier,
  ComponentLayer,
  HydrationStrategy,
} from './framework.ts';

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

/**
 * A declaration's utility-compilation requirement and the package-owned style
 * sources that requirement compiles (the declared-compilation contract; see
 * the router's `style-plan` module for the resolution rules).
 *
 * `required` is the mandatory-compilation dependency: the component's
 * presentation cannot be delivered without the compile, so an application that
 * disables the entry (`tailwind: false`) fails the build with a coded
 * diagnostic instead of shipping an unstyled component. Merely offering a theme
 * source is NOT a requirement — leave `required` unset for a source a consumer
 * may adopt on its own.
 *
 * `sources` are package-relative paths (e.g. `./theme.css`) resolved against
 * THIS package, so a consumer never repeats the owner's declaration. They must
 * exist in the installed package (i.e. ship in the tarball).
 *
 * `dialect` names the CLASS LANGUAGE this component's utility tokens are
 * written in, not the engine that compiles them: the declaration stays
 * provider-neutral, and a selected provider that does not implement the
 * dialect fails the build before any compile. Omitted means `tailwind4` — the
 * language every declaration written before this field existed uses.
 */
export interface OpenElementTailwindDeclaration {
  required?: boolean;
  sources?: string[];
  dialect?: 'tailwind4';
}

/** The openElement-specific extension block of a package manifest declaration. */
export interface OpenElementExtensions {
  ssr?: boolean;
  dsd?: boolean;
  layer?: ComponentLayer;
  hydrate?: HydrationStrategy;
  /** Stability marker from the owning package's manifest policy. */
  status?: 'stable' | 'experimental';
  module?: string;
  export?: string;
  tailwind?: OpenElementTailwindDeclaration;
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

export type { CompatibilityClassification, CompatibilityTier };

/** The compatibility classification report for one custom element manifest. */
export interface CemCompatibilityReport {
  totalClassified: number;
  ssrCapableCount: number;
  clientOnlyCount: number;
  rejectedCount: number;
  experimentalDomCount: number;
  classifications: CompatibilityClassification[];
  summary: string;
}
