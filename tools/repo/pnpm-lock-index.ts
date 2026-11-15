/**
 * The committed `pnpm-lock.yaml` importer index (#1715).
 *
 * vp pack stages its own workspace and runs `npm install` outside the pnpm
 * graph. That install must not re-resolve the workspace's dependency ranges
 * against whatever the registry serves at pack time — the 2026-11-06 incident
 * (`@tailwindcss/oxide@4.3.5` ETARGET) was exactly a staging install floating
 * a caret past the version `pnpm-lock.yaml` had resolved. This module reads the
 * committed lockfile's `importers` section, which records the exact resolution
 * for every package that declares the dependency.
 *
 * Only importers are read: the lockfile's `packages`/`snapshots` sections list
 * every artifact in the graph (the same name can legitimately appear at several
 * versions), so they cannot answer "what did THIS workspace member resolve".
 * A name resolved to different versions by different owners is an error here,
 * never a silent pick — forcing one global version would break a legitimate
 * multi-version graph.
 */

import { parseAllDocuments } from 'yaml';

/** One locked direct dependency: the manifest specifier and its exact version. */
export interface LockedDependency {
  readonly specifier: string;
  /** Peer contexts stripped (`4.3.3(vite@8.1.6)` -> `4.3.3`). */
  readonly version: string;
}

/** A parsed lockfile index: importer key -> dependency name -> resolution. */
export interface PnpmLockIndex {
  readonly importers: ReadonlyMap<string, ReadonlyMap<string, LockedDependency>>;
}

/** Drop pnpm's peer-dependency context suffix from a locked version. */
export function baseLockedVersion(version: string): string {
  const paren = version.indexOf('(');
  const base = paren === -1 ? version : version.slice(0, paren);
  return base.startsWith('link:') ? '' : base;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDependencySections(importer: Record<string, unknown>): Map<string, LockedDependency> {
  const out = new Map<string, LockedDependency>();
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    const record = importer[section];
    if (!isRecord(record)) continue;
    for (const [name, value] of Object.entries(record)) {
      if (!isRecord(value)) continue;
      const specifier = typeof value['specifier'] === 'string' ? value['specifier'] : '';
      const rawVersion = typeof value['version'] === 'string' ? value['version'] : '';
      // `link:`/`workspace:` entries are workspace members, not registry
      // artifacts; they resolve through the staging symlinks instead.
      const version = baseLockedVersion(rawVersion);
      if (version === '') continue;
      out.set(name, { specifier, version });
    }
  }
  return out;
}

/**
 * Parse the lockfile's importer section. Unknown/malformed shapes fail closed:
 * a staging install built on a guessed resolution is exactly the failure this
 * module exists to prevent.
 */
export function parsePnpmLockIndex(lockText: string): PnpmLockIndex {
  let documents: unknown[];
  try {
    // The committed lockfile is a TWO-document YAML stream: the package-manager
    // dependency document (`configDependencies` / `packageManagerDependencies`,
    // pnpm-lock.yaml:1-157 at this head) first, then the workspace document
    // (`lockfileVersion` / `settings` / `importers` / `packages` / `snapshots`,
    // after the `---` separator at line 158). Only the workspace document
    // carries `importers`; reading every document keeps a future pnpm layout
    // change from silently skipping the section.
    const parsedDocuments = parseAllDocuments(lockText);
    const invalid = parsedDocuments.find((document) => document.errors.length > 0);
    if (invalid !== undefined) {
      throw new Error(String(invalid.errors[0]));
    }
    documents = parsedDocuments.map((document) => document.toJS() as unknown);
  } catch (error) {
    throw new Error(
      `pnpm-lock-index: pnpm-lock.yaml is not parseable (${(error as Error).message}); ` +
        'regenerate the lockfile instead of letting the staging install float',
    );
  }
  const importers = new Map<string, ReadonlyMap<string, LockedDependency>>();
  for (const document of documents) {
    if (!isRecord(document) || !isRecord(document['importers'])) continue;
    for (const [key, value] of Object.entries(document['importers'])) {
      if (!isRecord(value)) {
        throw new Error(`pnpm-lock-index: importer ${JSON.stringify(key)} is not an object`);
      }
      importers.set(key, readDependencySections(value));
    }
  }
  if (importers.size === 0) {
    throw new Error(
      'pnpm-lock-index: pnpm-lock.yaml carries no importers section; the staging install ' +
        'cannot be pinned to committed resolutions',
    );
  }
  return { importers };
}

/**
 * The exact version each requested name resolved to for the given importer
 * owners (workspace-relative importer keys such as `.` or `packages/router`).
 *
 * - A name no owner declares fails closed: the staging manifest would have no
 *   committed resolution to pin.
 * - Owners disagreeing on the version fails closed with the per-owner detail:
 *   one staging root can carry only one entry per dependency name, and a global
 *   override across a legitimate multi-version graph is not acceptable.
 */
export function lockedDirectVersions(
  index: PnpmLockIndex,
  owners: readonly string[],
  names: readonly string[],
): ReadonlyMap<string, string> {
  const wanted = new Set(names);
  const resolved = new Map<string, Map<string, string[]>>();
  for (const owner of owners) {
    const dependencies = index.importers.get(owner);
    if (dependencies === undefined) continue;
    for (const [name, locked] of dependencies) {
      if (!wanted.has(name)) continue;
      let versions = resolved.get(name);
      if (versions === undefined) {
        versions = new Map();
        resolved.set(name, versions);
      }
      const ownersForVersion = versions.get(locked.version) ?? [];
      ownersForVersion.push(owner);
      versions.set(locked.version, ownersForVersion);
    }
  }
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const name of names) {
    const versions = resolved.get(name);
    if (versions === undefined || versions.size === 0) {
      missing.push(name);
      continue;
    }
    if (versions.size > 1) {
      const detail = [...versions.entries()]
        .map(([version, versionOwners]) => `${version} (${versionOwners.join(', ')})`)
        .join('; ');
      throw new Error(
        `pnpm-lock-index: ${name} resolves to different versions across importers: ${detail}. ` +
          'The staging workspace carries one entry per name; fix the workspace manifests so the ' +
          'lockfile has one resolution, rather than forcing a global version override',
      );
    }
    out.set(name, [...versions.keys()][0]!);
  }
  if (missing.length > 0) {
    throw new Error(
      `pnpm-lock-index: no committed lock resolution for ${missing.sort().join(', ')} in ` +
        `importer(s) ${owners.join(', ')}; run pnpm install so pnpm-lock.yaml records it before packing`,
    );
  }
  return out;
}
