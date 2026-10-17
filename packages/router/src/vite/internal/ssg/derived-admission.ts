/**
 * Scan-time derivation of the AUTO package admission set (the alpha15
 * auto-admission ruling).
 *
 * The admitted set is DERIVED from what the application really renders, never
 * guessed: the shared resolver walk (`walkModuleGraph`, the same traversal the
 * build's other discovery passes use) starts from the app's page routes,
 * islands and layout modules, follows every specifier form the bundler
 * understands, and every reached module OUTSIDE the application whose compiler
 * facts say "compiled element" attributes itself to its owner package (the
 * nearest `package.json`, the shared identity rule). A package with a VALID
 * OpenElement manifest is admitted; the dependency list, a tag prefix, and a
 * path pattern are never consulted.
 *
 * The three diagnostic classes this module owns (each names the fix through
 * the explicit-declaration path):
 *
 * - a package-owned element module whose owner has NO valid manifest — the
 *   one true mistake class (coded warning);
 * - two packages claiming one delivered tag with no explicit owner — a coded
 *   build failure; an explicit `packageIslands` entry outranks a derived
 *   claim and resolves it;
 * - a package element module reached only through a dynamic `import()` —
 *   outside the static reachability contract, so reported as unprovable
 *   (coded warning) instead of silently undelivered.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'pathe';
import { analyzeModuleSemantics } from '@openelement/compiler';
import type { OpenElementPackageManifest, RouteEntry } from '../../framework.ts';
import { createLogger } from '@openelement/element';
import { ROUTER_MODULE_VOCABULARY } from '@openelement/protocol/module-vocabulary';
import { buildError, PackageAdmissionErrorCode } from '../../../internal/error-codes.ts';
import { reportScanFatal } from '../build-diagnostics.ts';
import { owningPackageName, owningPackageRoot, packageNameAt } from '../package-identity.ts';
import { walkModuleGraph, type ModuleWalkResolver } from '../module-graph-walk.ts';
import { loadPackageManifest } from './island-scanner.ts';
import { resolveIslandDeliveryTags } from './delivery.ts';

const log = createLogger('derived-admission');

/** The inputs the derivation walks: the app's own render graph seeds. */
export interface DeriveAdmissionInput {
  /** Absolute project root (the app's own package root). */
  root: string;
  /** The BUNDLER's resolver — the same one every discovery pass walks through. */
  resolve: ModuleWalkResolver;
  /** The scanned page routes (their files are the walk's primary seeds). */
  routes: readonly RouteEntry[];
  routesDir: string;
  islandsDir: string;
  /** Local island files (islandsDir-relative), from the Phase 1 scan. */
  islandFiles: readonly string[];
  /** The configured default layout, if any (its module is a seed). */
  layout?: { import?: string } | false | 'default';
  /** Named layouts, if any (their modules are seeds). */
  layouts?: Record<string, { import?: string } | false | 'default' | undefined>;
}

/** What the derivation produced, before the explicit list is merged in. */
export interface DerivedAdmission {
  /** Valid manifests of the derived packages, sorted by package name. */
  readonly manifests: OpenElementPackageManifest[];
  /** Package-owned element modules whose owner has no valid manifest. */
  readonly manifestLess: ReadonlyArray<{
    readonly packageName: string;
    readonly module: string;
    readonly reason: string;
  }>;
  /** Package element modules reached only through a dynamic `import()`. */
  readonly dynamicUnproven: ReadonlyArray<{
    readonly packageName: string;
    readonly specifier: string;
    readonly importer: string;
  }>;
}

/**
 * Derive the admitted packages from the app's real module graph. Reads and
 * resolves only — nothing is imported or executed except the packages'
 * manifest modules (the one load the admission contract has always made).
 */
export async function deriveAdmittedPackages(
  input: DeriveAdmissionInput,
): Promise<DerivedAdmission> {
  const root = resolve(input.root);
  const seeds = derivationSeeds(root, input);
  const walk = await walkModuleGraph(input.resolve, seeds, { collectDynamicImports: true });
  if (walk.truncated) {
    log.warn(
      'Package admission derivation stopped at its module bound; some imported component ' +
        'packages may not be derived (reported, never silent).',
    );
  }

  const appPackageName = packageNameAt(root);
  const owners = new Map<string, string>();
  const manifestLess: Array<{ packageName: string; module: string; reason: string }> = [];
  const staticOwners = new Set<string>();
  /** Each derived owner's package directory, from the walked module id. */
  const packageRoots = new Map<string, string>();

  for (const file of walk.files) {
    // Identity, not paths: the nearest package.json names the owner. The app's
    // own modules (owner === the app package) are its own components, never
    // package islands; a module with no package owner has no identity to
    // derive or report.
    const packageName = owningPackageName(file);
    if (packageName === undefined || packageName === appPackageName) continue;
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    // The SAME compiler analysis the static-component scan uses, with the
    // derivation's own predicate: a module that DEFINES a custom element
    // through the compiled element decorator (named exports included — a
    // package component need not be the module's default export). The tag
    // identity itself stays the manifest's; this fact only says "element
    // module of this owner package". Never a path or import-list guess.
    let defined: readonly string[] = [];
    try {
      defined = analyzeModuleSemantics(source, file, {
        vocabulary: ROUTER_MODULE_VOCABULARY,
      }).definedCustomElementTags;
    } catch {
      continue;
    }
    if (defined.length === 0) continue;
    staticOwners.add(packageName);
    owners.set(packageName, file);
    const packageRoot = owningPackageRoot(file, packageName);
    if (packageRoot !== undefined) packageRoots.set(packageName, packageRoot);
  }

  // Load each derived owner's manifest through the ONE shared loader, and
  // classify the outcome: a valid manifest admits; a missing manifest is the
  // manifest-less warning class; an INVALID manifest (present, broken shape)
  // and a real transport failure fail closed.
  const manifests: OpenElementPackageManifest[] = [];
  for (const packageName of [...staticOwners].sort()) {
    const load = await loadPackageManifest(packageName, {
      from: root,
      packageRoot: packageRoots.get(packageName),
    });
    if (load.status === 'ok') {
      manifests.push(load.manifest);
      continue;
    }
    if (load.status === 'missing-package') {
      // The app reached the module through a resolution the plain name cannot
      // reproduce (an alias, a workspace layout): nothing to scan by name, and
      // nothing admitted without a manifest.
      manifestLess.push({
        packageName,
        module: owners.get(packageName)!,
        reason: 'the package does not resolve under its own name for the manifest scan',
      });
      continue;
    }
    if (load.status === 'no-manifest') {
      manifestLess.push({
        packageName,
        module: owners.get(packageName)!,
        reason: load.reason,
      });
      continue;
    }
    if (load.status === 'invalid') {
      // A manifest PRESENT but broken is a failed component package, not an
      // unknown one: fail closed with the manifest scan's own code — the same
      // verdict an explicitly listed package would get. Reported through the
      // scan-phase fatal seam (#1616): the bundler's buildStart error surface
      // does not carry the thrown message to the CLI on rolldown-vite 8
      // (pre-existing; verified on the alpha15 baseline), and a coded
      // diagnostic that never reaches the developer is not a diagnostic.
      throw reportScanFatal(
        buildError(
          'PACKAGE_MANIFEST_ERROR',
          `Invalid manifest in ${packageName}: ${load.reason}. ` +
            'The package is imported by this app as a component package; fix its manifest export ' +
            '(packageName + declarations) or stop importing its element modules.',
        ),
      );
    }
    throw load.error;
  }

  // Dynamic reach is not static proof: a package element module the app pulls
  // only through `import()` cannot be derived (the import may be conditional),
  // so it is reported with the explicit fix instead of silently undelivered —
  // unless its owner is already admitted by a static fact.
  const admitted = new Set([...staticOwners, ...manifests.map((m) => m.packageName)]);
  const dynamicUnproven: Array<{
    packageName: string;
    specifier: string;
    importer: string;
  }> = [];
  for (const { specifier, importer } of walk.dynamicImports) {
    let resolved: { id: string; external?: boolean | 'absolute' | 'relative' } | null;
    try {
      resolved = await input.resolve.resolve(specifier, importer);
    } catch {
      continue;
    }
    if (resolved === null || resolved.external === true) continue;
    const id = resolved.id.split('?', 1)[0]!;
    const packageName = owningPackageName(id);
    if (packageName === undefined || packageName === appPackageName) continue;
    if (admitted.has(packageName)) continue;
    let source: string;
    try {
      source = await readFile(id, 'utf8');
    } catch {
      continue;
    }
    let defined: readonly string[] = [];
    try {
      defined = analyzeModuleSemantics(source, id, {
        vocabulary: ROUTER_MODULE_VOCABULARY,
      }).definedCustomElementTags;
    } catch {
      continue;
    }
    if (defined.length === 0) continue;
    dynamicUnproven.push({ packageName, specifier, importer });
  }

  return {
    manifests,
    manifestLess,
    dynamicUnproven: dynamicUnproven.sort(
      (a, b) =>
        a.packageName.localeCompare(b.packageName) || a.specifier.localeCompare(b.specifier),
    ),
  };
}

/** The walk's seed files: page routes, local islands, and the layout modules. */
function derivationSeeds(root: string, input: DeriveAdmissionInput): string[] {
  const seeds: string[] = [];
  for (const route of input.routes) {
    if (route.type !== 'page' || route.special) continue;
    const file = resolve(root, input.routesDir, route.filePath);
    if (existsSync(file)) seeds.push(file);
  }
  for (const file of input.islandFiles) {
    const full = resolve(root, input.islandsDir, file);
    if (existsSync(full)) seeds.push(full);
  }
  for (const shell of [input.layout, ...Object.values(input.layouts ?? {})]) {
    if (!shell || typeof shell !== 'object' || typeof shell.import !== 'string') continue;
    const file = resolve(root, shell.import);
    if (existsSync(file)) seeds.push(file);
  }
  return seeds;
}

/** The delivery tags one manifest claims (the admission-eligible declarations). */
export function manifestTagClaims(manifest: OpenElementPackageManifest): string[] {
  const claims: string[] = [];
  for (const declaration of manifest.declarations) {
    if (!declaration.openElement?.module) continue;
    const delivery = declaration as typeof declaration & {
      tags?: readonly string[];
      tagNames?: readonly string[];
    };
    const openElement = declaration.openElement as typeof declaration.openElement & {
      tags?: readonly string[];
      tagNames?: readonly string[];
    };
    for (const tag of resolveIslandDeliveryTags(
      declaration.tagName,
      delivery.tags ?? openElement?.tags,
      delivery.tagNames ?? openElement?.tagNames,
      declaration.tagName,
    )) {
      claims.push(tag);
    }
  }
  return claims;
}

export interface MergeAdmittedManifestsInput {
  /** The explicitly declared packages' manifests (they outrank derived claims). */
  explicit: readonly OpenElementPackageManifest[];
  /** The scan-derived packages' manifests. */
  derived: readonly OpenElementPackageManifest[];
}

export interface MergedAdmission {
  /** The admitted manifests: every explicit one, plus the non-conflicting derived ones. */
  readonly manifests: OpenElementPackageManifest[];
  /** Derived packages whose conflicting declaration(s) an explicit owner took (decision log). */
  readonly yielded: ReadonlyArray<{ packageName: string; tags: readonly string[] }>;
}

/**
 * Merge the explicit and derived manifests into ONE admitted list.
 *
 * Explicit priority: when a derived package claims a tag an explicit package
 * also claims, the derived claim yields (the whole declaration is dropped; the
 * package's other tags stay). When two DERIVED packages (or a derived and an
 * already-ambiguous explicit pair) claim the same tag with no explicit owner,
 * the scan fails closed — that is the one ambiguity no automatic rule may
 * resolve. Two EXPLICIT packages keep their existing downstream guard (the
 * client build's one-to-one tag ownership), which this merge does not preempt.
 */
export function mergeAdmittedManifests(input: MergeAdmittedManifestsInput): MergedAdmission {
  const explicitNames = new Set(input.explicit.map((manifest) => manifest.packageName));

  // Tag → explicit owners (for the priority decision) and derived owners (for
  // the fail-closed conflict check).
  const tagOwners = new Map<string, { packageName: string; explicit: boolean }[]>();
  const claim = (manifest: OpenElementPackageManifest, explicit: boolean): void => {
    for (const tag of manifestTagClaims(manifest)) {
      const owners = tagOwners.get(tag) ?? [];
      if (owners.some((owner) => owner.packageName === manifest.packageName)) continue;
      owners.push({ packageName: manifest.packageName, explicit });
      tagOwners.set(tag, owners);
    }
  };
  for (const manifest of input.explicit) claim(manifest, true);
  for (const manifest of input.derived) claim(manifest, false);

  // Fail closed on a derived-vs-derived conflict with no explicit owner.
  for (const [tag, owners] of [...tagOwners].sort(([a], [b]) => a.localeCompare(b))) {
    const derived = owners.filter((owner) => !owner.explicit);
    if (derived.length < 2) continue;
    const names = derived
      .map((owner) => owner.packageName)
      .sort()
      .join('", "');
    // Reported through the scan-phase fatal seam (#1616): the bundler's
    // buildStart error surface does not carry the thrown message to the CLI
    // on rolldown-vite 8 (pre-existing; verified on the alpha15 baseline).
    throw reportScanFatal(
      buildError(
        PackageAdmissionErrorCode.TAG_CONFLICT,
        `Two derived component packages claim the tag <${tag}>: "${names}". The scan cannot ` +
          'pick an owner for a tag two packages both declare. Declare the intended owner in ' +
          '`packageIslands` in openelement.config.ts (an explicit entry outranks a derived ' +
          "claim), or stop importing one of the packages' element modules.",
      ),
    );
  }

  // Explicit priority: a derived declaration whose tag an explicit package
  // claims yields to it.
  const yielded: Array<{ packageName: string; tags: string[] }> = [];
  const manifests = [...input.explicit];
  for (const manifest of input.derived) {
    if (explicitNames.has(manifest.packageName)) continue;
    const lost = new Set<string>();
    for (const tag of manifestTagClaims(manifest)) {
      const owners = tagOwners.get(tag);
      if (owners?.some((owner) => owner.explicit && owner.packageName !== manifest.packageName)) {
        lost.add(tag);
      }
    }
    if (lost.size === 0) {
      manifests.push(manifest);
      continue;
    }
    const kept = {
      ...manifest,
      declarations: manifest.declarations.filter((declaration) => {
        const tags = manifestTagClaims({ ...manifest, declarations: [declaration] });
        return !tags.some((tag) => lost.has(tag));
      }),
    };
    if (kept.declarations.length > 0) manifests.push(kept);
    yielded.push({ packageName: manifest.packageName, tags: [...lost].sort() });
    log.info(
      `Package "${manifest.packageName}" yields <${[...lost].sort().join('>, <')}> to the ` +
        'explicitly declared owner(s).',
    );
  }

  return {
    manifests: manifests.sort((a, b) => a.packageName.localeCompare(b.packageName)),
    yielded,
  };
}
