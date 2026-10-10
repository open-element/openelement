/**
 * Registry-truth sync: post-publish `npm view` reads written back into
 * docs/release/release-state.json (and its www projection).
 *
 * Why this exists (the alpha.12 E404/E400 legacy): `publish:npm` uploads the
 * tarballs and verifies them read-only, but the tracked registry block was
 * updated by hand afterwards — alpha.12 shipped while the block still named
 * alpha.11, so the site advertised a version the registry no longer served
 * until a human noticed. The publish train now ends with one read-through:
 * re-read every published package's dist-tags and version list, rewrite the
 * tracked block to what the registry actually answers, and project that truth
 * into the site's display constants. A query or a write failing turns the
 * train red.
 *
 * Contract:
 *   - read-only against npm (`npm view <pkg> dist-tags --json` and
 *     `npm view <pkg> versions --json`); it never publishes or moves a tag.
 *   - the write is the sync's only side effect, over exactly three files:
 *     `docs/release/release-state.json` (the registry block: `verifiedAt`,
 *     `method`, each published package's `registry` object, and
 *     `latestPrerelease`), `www/app/data/version.ts` (the display projection:
 *     `PUBLISHED_LATEST` and `UNRELEASED_PACKAGES`, the two constants
 *     `release:state-machine:check` pins to the block), and the regenerated
 *     `www/app/data/_generated-release-line.ts` (through the site's own
 *     content generator, so `www-release-anchor` keeps agreeing with both).
 *     Every other byte of each file is preserved; the JSON round-trip is
 *     byte-identity (proven in the tests).
 *   - `commonCompleteVersion` (the stable intersection, needs full version
 *     sets and a release-admission decision) stays owned by
 *     release:registry-check and the maintainer; the sync never writes it.
 *
 * What the sync does NOT do: commit or push. The Release workflow uploads the
 * three files as a `registry-release-state` artifact and a maintainer lands
 * them through the ordinary pull-request path (the main-branch ruleset has no
 * machine bypass, and the release job holds no push identity). Until that PR
 * lands, `@openelement/tools-release#registry-drift:check` fails a build whose
 * displayed version values no longer match the live registry — it runs in the
 * release train (`gate:release`), and it is what a maintainer runs before
 * publishing. See docs/maintainers/releasing.md.
 *
 * One ordering fact callers must respect on the 1.0 line: the publish step
 * runs the sync while the `alpha` alias still points at the PREVIOUS release
 * (the alias re-point is a separate, best-effort step that runs after the
 * publish), so that first read-back records the alias as it then stands. The
 * Release workflow runs this module a second time after the re-point; without
 * that second read the tracked `alpha` entry would name the old version and
 * the drift check would fail on the next release. Because every dist-tag is
 * recorded verbatim, the second run needs no extra arguments.
 *
 * Relationship to release:registry-check (tools/repo/check-release-state-machine.ts):
 * that checker compares the tracked block against the live registry; this
 * module is the writer that keeps the block worth checking, and the www drift
 * check is the second reader (display vs registry). One authority, three
 * readers — not a second source of truth.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compare } from 'semver';
import { commandOutput } from '../repo/node-command.ts';
import { npmPublishTag } from './npm-publisher.ts';
import { tryParseLineVersion } from '../lib/version.ts';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const RELEASE_STATE_PATH = 'docs/release/release-state.json';
export const WWW_VERSION_PATH = 'www/app/data/version.ts';
/** The site's one content generator: also refreshes _generated-release-line.ts. */
export const SITE_CONTENT_GENERATOR = 'www/tools/generate-site-content-data.ts';

/** One package's registry record in release-state.json (schema v4). */
export interface ReleaseStatePackageEntry {
  name: string;
  status: 'published' | 'unpublished';
  registry?: Record<string, string>;
}

/** The release-state fields the sync reads and rewrites. */
export interface ReleaseStateDocument {
  schemaVersion: number;
  sourceVersion: string;
  packages: ReleaseStatePackageEntry[];
  latestPrerelease: {
    version: string;
    distTag: string;
    state: 'complete' | 'partial';
    publishedPackages: string[];
    missingPackages: string[];
    note?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** What the registry answers for one package, read-only. */
export interface RegistryEvidence {
  /** npm's dist-tags object, verbatim. */
  distTags: Record<string, string>;
  /** npm's version list, verbatim. */
  versions: string[];
}

/** Read-only evidence surface: one package name in, registry answers out. */
export type RegistryEvidenceQuery = (packageName: string) => Promise<RegistryEvidence>;

function decode(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

async function npmViewJson(packageName: string, field: string): Promise<unknown> {
  const result = await commandOutput('npm', {
    args: ['view', packageName, field, '--json'],
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  });
  if (!result.success) {
    throw new Error(`npm view ${packageName} ${field} failed: ${decode(result.stderr).trim()}`);
  }
  try {
    return JSON.parse(decode(result.stdout)) as unknown;
  } catch (error) {
    throw new Error(`npm view ${packageName} ${field} returned invalid JSON: ${String(error)}`);
  }
}

/** The production query: dist-tags plus the version list, both read-only. */
export async function npmRegistryEvidence(packageName: string): Promise<RegistryEvidence> {
  const distTagsRaw = await npmViewJson(packageName, 'dist-tags');
  if (typeof distTagsRaw !== 'object' || distTagsRaw === null || Array.isArray(distTagsRaw)) {
    throw new Error(`npm view ${packageName} dist-tags returned a non-object`);
  }
  const distTags: Record<string, string> = {};
  for (const [tag, version] of Object.entries(distTagsRaw as Record<string, unknown>)) {
    if (typeof version !== 'string') {
      throw new Error(`npm view ${packageName} dist-tags.${tag} is not a string`);
    }
    distTags[tag] = version;
  }
  const versionsRaw = await npmViewJson(packageName, 'versions');
  const versions =
    typeof versionsRaw === 'string'
      ? [versionsRaw]
      : Array.isArray(versionsRaw)
        ? versionsRaw.map(String)
        : null;
  if (versions === null) {
    throw new Error(`npm view ${packageName} versions returned neither a list nor a string`);
  }
  return { distTags, versions };
}

/** ISO calendar date (UTC) — the shape `registry.verifiedAt` has always used. */
export function calendarDateStamp(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The method string every tracked registry block carries. */
export const REGISTRY_METHOD = 'read-only npm view versions + dist-tags';

/**
 * The dist-tag the source line publishes onto: the channel tag for a pre-1.0
 * prerelease, `latest` for the 1.0 prerelease line (owner ruling 2026-10-07)
 * and for stable lines. Shares the publisher's own rule (`npmPublishTag`) so
 * the tag the record is read from can never drift from the tag the publish act
 * wrote — with one caveat worth knowing: on the 1.0 line that is `latest`, and
 * the `alpha` alias beside it is written by the release workflow AFTER the
 * publish step (the alias re-point is best-effort; see
 * docs/maintainers/releasing.md), so a read-back taken inside the publish
 * step records the alias as it still stands and the workflow re-reads the
 * registry after the re-point. Both reads go through this function; only the
 * moment differs.
 */
export function registryLineTag(version: string): string {
  const parsed = tryParseLineVersion(version);
  if (!parsed) throw new Error(`registryLineTag: not a line version: ${version}`);
  return parsed.prerelease === undefined ? 'latest' : npmPublishTag(version);
}

/** Compare two line versions (strict parse; both must be real line versions). */
function byLineVersionDescending(a: string, b: string): number {
  return compare(b, a);
}

/** `major.minor.patch` of a line version — the identity a release line shares. */
function sourceLineBase(version: string): string {
  const parsed = tryParseLineVersion(version);
  if (!parsed) throw new Error(`sourceLineBase: not a line version: ${version}`);
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

/**
 * Rewrite one release-state document from live registry answers. Pure (the
 * caller owns I/O), so the drift tests run it without a network.
 *
 * Rules:
 *   - an unpublished package keeps its absence: no registry object is
 *     manufactured (the schema's P6 rule); it still joins `missingPackages`,
 *     because the offline check requires `publishedPackages ∪ missingPackages`
 *     to partition the WHOLE package set — a train that has not published
 *     every package is not a complete one;
 *   - a published package's registry object becomes exactly the dist-tags the
 *     registry serves (a tag the registry no longer serves disappears); a
 *     published package with no `latest` tag fails closed, since the offline
 *     check requires it;
 *   - `latestPrerelease` is recomputed from the same answers: the newest version
 *     of the source line the published packages serve on the line tag (a stable
 *     source line lands on its own release; the field name predates the stable
 *     cut but the value it carries is the line the registry is serving), the
 *     partition of published/missing packages, and `state`.
 */
export function rewriteRegistryBlock(
  document: ReleaseStateDocument,
  evidenceByName: Readonly<Record<string, RegistryEvidence>>,
  verifiedAt: string,
): ReleaseStateDocument {
  const packages = document.packages.map((entry) => {
    if (entry.status === 'unpublished') return { ...entry };
    const evidence = evidenceByName[entry.name];
    if (!evidence) {
      throw new Error(`rewriteRegistryBlock: no registry evidence for ${entry.name}`);
    }
    if (!evidence.distTags.latest) {
      throw new Error(`rewriteRegistryBlock: ${entry.name} serves no latest dist-tag`);
    }
    return { ...entry, registry: { ...evidence.distTags } };
  });

  const publishedNames = packages
    .filter((entry) => entry.status === 'published')
    .map((entry) => entry.name);
  const unpublishedNames = packages
    .filter((entry) => entry.status === 'unpublished')
    .map((entry) => entry.name);
  const lineTag = registryLineTag(document.sourceVersion);
  const lineBase = sourceLineBase(document.sourceVersion);
  // The newest version OF THE SOURCE LINE the published packages serve on the
  // line tag is the version the release line is serving; packages that do not
  // carry it (and packages that have never published) are the "missing" set.
  // Filtering by line base keeps a package still serving the previous line on
  // some other tag from voting this line's version in.
  const servingVersions = publishedNames
    .map((name) => evidenceByName[name]?.distTags[lineTag])
    .filter((version): version is string => typeof version === 'string')
    .filter((version) => sourceLineBase(version) === lineBase);
  if (servingVersions.length === 0) {
    throw new Error(
      `rewriteRegistryBlock: no published package serves ${lineBase}.x on ${lineTag} ` +
        `(source line ${document.sourceVersion})`,
    );
  }
  const lineVersion = [...servingVersions].sort(byLineVersionDescending)[0]!;
  const publishedPackages = publishedNames.filter((name) =>
    (evidenceByName[name]?.versions ?? []).includes(lineVersion),
  );
  const missingPackages = [
    ...publishedNames.filter((name) => !publishedPackages.includes(name)),
    ...unpublishedNames,
  ];

  const registry = (document.registry ?? {}) as Record<string, unknown>;
  return {
    ...document,
    registry: { ...registry, verifiedAt, method: REGISTRY_METHOD },
    packages,
    latestPrerelease: {
      ...document.latestPrerelease,
      version: lineVersion,
      distTag: lineTag,
      state: missingPackages.length === 0 ? 'complete' : 'partial',
      publishedPackages,
      missingPackages,
      // The prose note is rewritten with the values: a hand-written sentence
      // about an older read-back is exactly the stale-copy class this sync
      // exists to end.
      note:
        `Registry read-back on ${verifiedAt} (tools/release/registry-sync.ts): the ` +
        `per-package registry blocks record the dist-tags npm served, and ` +
        `${lineVersion} is the newest version of the ${lineBase} line served on ${lineTag}.`,
    },
  };
}

/** One published package's display line in the www projection. */
function publishedLatestLines(document: ReleaseStateDocument): string[] {
  return document.packages
    .filter((entry) => entry.status === 'published')
    .map((entry) => {
      const latest = entry.registry?.latest;
      if (!latest) throw new Error(`projectWwwVersionSource: ${entry.name} carries no latest`);
      return `  '${entry.name}': 'v${latest}',`;
    });
}

/** The unpublished package names, as the `UNRELEASED_PACKAGES` literal. */
function unreleasedNames(document: ReleaseStateDocument): string[] {
  return document.packages
    .filter((entry) => entry.status === 'unpublished')
    .map((entry) => `'${entry.name}'`);
}

/**
 * Project the synced truth into www/app/data/version.ts. Text-level (the same
 * level release:state-machine:check and www-release-anchor read the file at),
 * and fail-closed: an unexpected shape throws instead of writing a half-edited
 * module. Only the two registry-derived constants are replaced; every
 * hand-written comment and constant around them is preserved.
 */
export function projectWwwVersionSource(source: string, document: ReleaseStateDocument): string {
  const publishedBlock =
    /(export const PUBLISHED_LATEST: Readonly<Record<string, string>> = \{)([\s\S]*?)(\n\};)/;
  const unreleasedBlock = /(export const UNRELEASED_PACKAGES: readonly string\[\] = )\[[^\]]*\](;)/;
  if (!publishedBlock.test(source)) {
    throw new Error('projectWwwVersionSource: PUBLISHED_LATEST declaration not found');
  }
  if (!unreleasedBlock.test(source)) {
    throw new Error('projectWwwVersionSource: UNRELEASED_PACKAGES declaration not found');
  }
  const withPublished = source.replace(
    publishedBlock,
    (_match, head: string, _body: string, tail: string) =>
      `${head}\n${publishedLatestLines(document).join('\n')}${tail}`,
  );
  const names = unreleasedNames(document);
  const unreleased = names.length === 0 ? '[]' : `[${names.join(', ')}]`;
  return withPublished.replace(unreleasedBlock, `$1${unreleased}$2`);
}

export interface RegistrySyncResult {
  verifiedAt: string;
  /** The prerelease line the registry currently serves. */
  latestPrerelease: string;
  /** Per published package: the `latest` dist-tag version. */
  latest: Record<string, string>;
}

/**
 * The sync step of the publish train: read the tracked release-state, query
 * the live registry for every published package, rewrite the block, project it
 * into www/app/data/version.ts, and refresh the generated release-line module
 * through the site's own generator. Fails closed on any query or write error.
 */
export async function syncRegistryState(options: {
  root: string;
  query?: RegistryEvidenceQuery;
  now?: () => Date;
  /** Skip the site-content regeneration (tests, pure-write callers). */
  regenerate?: boolean;
  runGenerator?: (script: string) => Promise<void>;
  log?: (message: string) => void;
}): Promise<RegistrySyncResult> {
  const readPath = (relative: string): string => join(options.root, relative);
  const document = JSON.parse(
    await readFile(readPath(RELEASE_STATE_PATH), 'utf8'),
  ) as ReleaseStateDocument;
  const query = options.query ?? npmRegistryEvidence;
  const evidenceByName: Record<string, RegistryEvidence> = {};
  for (const entry of document.packages) {
    if (entry.status === 'unpublished') continue;
    evidenceByName[entry.name] = await query(entry.name);
  }
  const verifiedAt = calendarDateStamp(options.now?.() ?? new Date());
  const synced = rewriteRegistryBlock(document, evidenceByName, verifiedAt);
  await writeFile(readPath(RELEASE_STATE_PATH), `${JSON.stringify(synced, null, 2)}\n`);
  const versionSource = await readFile(readPath(WWW_VERSION_PATH), 'utf8');
  await writeFile(readPath(WWW_VERSION_PATH), projectWwwVersionSource(versionSource, synced));

  if (options.regenerate !== false) {
    const runGenerator =
      options.runGenerator ??
      (async (script: string) => {
        const result = await commandOutput(process.execPath, {
          args: [script],
          cwd: options.root,
          stdin: 'null',
          stdout: 'piped',
          stderr: 'piped',
        });
        if (!result.success) {
          throw new Error(
            `registry sync: ${script} failed: ${decode(result.stderr).trim() || `exit ${result.code}`}`,
          );
        }
      });
    await runGenerator(SITE_CONTENT_GENERATOR);
  }

  const latest: Record<string, string> = {};
  for (const entry of synced.packages) {
    if (entry.status === 'published') latest[entry.name] = entry.registry!.latest!;
  }
  options.log?.(
    `[registry-sync] registry block synced (verified ${verifiedAt}): ` +
      `${Object.entries(latest)
        .map(([name, version]) => `${name.replace('@openelement/', '')}=${version}`)
        .join(' ')}; latestPrerelease ${synced.latestPrerelease.version} ` +
      `(${synced.latestPrerelease.state}, tag ${synced.latestPrerelease.distTag})`,
  );
  return {
    verifiedAt,
    latestPrerelease: synced.latestPrerelease.version,
    latest,
  };
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  await syncRegistryState({ root, log: console.log });
}
