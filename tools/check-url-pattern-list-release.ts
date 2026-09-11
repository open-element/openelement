#!/usr/bin/env -S deno run --allow-read --allow-net=registry.npmjs.org
/**
 * check-url-pattern-list-release.ts — registry provenance gate for the
 * external URLPatternList fork (#1324, Beta.2.1 release qualification).
 *
 * The Router's pattern indexing/winner selection is owned by the published
 * `@openelement/url-pattern-list` package, pinned exactly by this workspace.
 * A release verifier must be able to establish — mechanically, against the
 * live public npm registry — that the consumed artifact is the intended
 * OpenElement-maintained fork, at the exact declared version, with the exact
 * integrity the lockfile recorded. This gate fails closed: any network,
 * registry, lockfile, integrity or content anomaly exits non-zero.
 *
 * What it proves (all against live registry data, never inferred from source
 * package.json files):
 *   1. the workspace declares the dependency as an EXACT npm pin in both the
 *      root import map and packages/router/deno.json (no ^, ~, tag, workspace:,
 *      git:, file:, or unversioned specifier), and both declarations agree;
 *   2. the lockfile records the same exact specifier, resolves it to the same
 *      exact version, and carries an integrity hash;
 *   3. the registry package exists, the exact version exists, and the
 *      version's name/version/license/repository metadata match policy
 *      (MIT license; the open-element/url-pattern-list fork repository);
 *   4. dist.tarball / dist.integrity / dist.shasum are present and well
 *      formed, and the registry integrity EQUALS the lockfile integrity;
 *   5. the published tarball itself: its bytes hash to dist.integrity
 *      (SHA-512) and dist.shasum (SHA-1), its package.json identity matches,
 *      every static entry-point target exists, LICENSE/README are present,
 *      the file count matches the registry manifest, and the shipped code
 *      carries no @openelement/* dependency or source reference — the fork
 *      stays generic and must not absorb OpenElement Router semantics.
 *
 * The expected name/version are derived from the workspace declaration, so
 * future releases reuse the gate by changing the pin; license and repository
 * are release policy constants (EXPECTED_LICENSE / EXPECTED_REPOSITORY_*).
 *
 * Usage:
 *   deno run --allow-read --allow-net=registry.npmjs.org tools/check-url-pattern-list-release.ts
 *   deno run --allow-read --allow-net=registry.npmjs.org tools/check-url-pattern-list-release.ts --json
 *
 * Network access is scoped to the npm registry host. This gate belongs in
 * authoritative CI/release qualification; local developer loops stay offline.
 */

import { parseLineVersion } from './lib/version.ts';
import { getArg } from './lib/process.ts';

// ---------------------------------------------------------------------------
// Policy constants (stable properties of the maintained fork, #1324)
// ---------------------------------------------------------------------------

export const EXPECTED_PACKAGE_NAME = '@openelement/url-pattern-list';
export const EXPECTED_LICENSE = 'MIT';
export const EXPECTED_REPOSITORY_HOST = 'github.com';
export const EXPECTED_REPOSITORY_PATH = '/open-element/url-pattern-list';
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

const REGISTRY_DELAYS_MS = [0, 1_000, 2_000, 4_000] as const;

export class ProvenanceError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = 'ProvenanceError';
  }
}

export interface DependencyExpectation {
  name: string;
  version: string;
}

// ---------------------------------------------------------------------------
// 1. Declaration and lockfile analysis (pure, testable)
// ---------------------------------------------------------------------------

/**
 * Parse an import-map specifier into an exact npm pin. Any non-exact form —
 * ranges (^, ~, *, comparators), dist-tags, or non-registry schemes
 * (workspace:, git:, file:, http(s):, link:, jsr:) — is rejected.
 */
export function parseNpmPin(specifier: string): DependencyExpectation {
  const match = specifier.match(/^npm:((?:@[\d.a-z_-]+\/)?[\d.a-z_-]+)@([^@]+)$/);
  if (!match) {
    throw new ProvenanceError(
      `Dependency specifier is not an npm registry pin: ${specifier}`,
    );
  }
  const [, name, range] = match;
  if (/^[~^*]/.test(range) || /^(?:latest|[<>=|xX-])/.test(range) || range.includes(' ')) {
    throw new ProvenanceError(
      `Dependency ${name} must be an exact version pin, got range/tag: ${specifier}`,
    );
  }
  try {
    // The canonical strict line-version grammar (#1231 M16) rejects partial
    // versions, leading zeros, build metadata and v prefixes.
    parseLineVersion(range);
  } catch {
    throw new ProvenanceError(`Dependency ${name} pin is not strict semver: ${range}`);
  }
  return { name, version: range };
}

interface ImportMapConfig {
  imports?: Record<string, string>;
}

/** Both the root and packages/router import maps must carry the same exact pin. */
export function expectationFromConfigs(
  rootDenoJson: string,
  appDenoJson: string,
  packageName: string = EXPECTED_PACKAGE_NAME,
): DependencyExpectation {
  const read = (label: string, text: string): string => {
    let config: ImportMapConfig;
    try {
      config = JSON.parse(text) as ImportMapConfig;
    } catch (error) {
      throw new ProvenanceError(`${label} is not valid JSON: ${error}`);
    }
    const specifier = config.imports?.[packageName];
    if (typeof specifier !== 'string') {
      throw new ProvenanceError(`${label} does not declare ${packageName}`);
    }
    return specifier;
  };
  const rootPin = parseNpmPin(read('root deno.json', rootDenoJson));
  const appPin = parseNpmPin(read('packages/router/deno.json', appDenoJson));
  if (rootPin.name !== packageName || appPin.name !== packageName) {
    throw new ProvenanceError(
      `Declared package must be ${packageName}: root=${rootPin.name} app=${appPin.name}`,
    );
  }
  if (rootPin.version !== appPin.version) {
    throw new ProvenanceError(
      `root and packages/router pins diverge: ${rootPin.version} vs ${appPin.version}`,
    );
  }
  return rootPin;
}

export interface LockConsistency {
  specifier: string;
  resolvedVersion: string;
  integrity: string;
}

interface LockfileV5 {
  specifiers?: Record<string, string>;
  npm?: Record<string, { integrity?: string }>;
}

/**
 * The lockfile must record the exact specifier, resolve it to the exact
 * version, and carry an integrity hash for the resolved package.
 */
export function lockConsistency(
  lockText: string,
  expectation: DependencyExpectation,
): LockConsistency {
  let lock: LockfileV5;
  try {
    lock = JSON.parse(lockText) as LockfileV5;
  } catch (error) {
    throw new ProvenanceError(`deno.lock is not valid JSON: ${error}`);
  }
  const { name, version } = expectation;
  const specifiers = lock.specifiers ?? {};
  const matching = Object.keys(specifiers).filter((key) =>
    key.startsWith(`npm:${name}@`) || key === `npm:${name}`
  );
  const exactKey = `npm:${name}@${version}`;
  for (const key of matching) {
    if (key !== exactKey) {
      throw new ProvenanceError(
        `lockfile carries a non-exact or stale specifier for ${name}: ${key}`,
      );
    }
  }
  const resolved = specifiers[exactKey];
  if (resolved !== version) {
    throw new ProvenanceError(
      `lockfile does not resolve ${exactKey} to ${version} (found: ${resolved ?? 'nothing'})`,
    );
  }
  const entry = lock.npm?.[`${name}@${version}`];
  if (!entry || typeof entry.integrity !== 'string' || entry.integrity.length === 0) {
    throw new ProvenanceError(`lockfile has no integrity entry for ${name}@${version}`);
  }
  return { specifier: exactKey, resolvedVersion: resolved, integrity: entry.integrity };
}

// ---------------------------------------------------------------------------
// 2. Registry document validation (pure, testable)
// ---------------------------------------------------------------------------

export interface RegistryVersionFacts {
  name: string;
  version: string;
  license: string;
  repositoryUrl: string;
  tarball: string;
  integrity: string;
  shasum: string;
  fileCount?: number;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Normalize an npm repository URL (`git+https://…git`, `git://…`, `github:…`)
 * to host + path for comparison against policy.
 */
export function repositoryHostAndPath(rawUrl: string): { host: string; path: string } {
  let url = rawUrl.trim();
  if (url.startsWith('github:')) url = `https://github.com/${url.slice('github:'.length)}`;
  if (url.startsWith('git+')) url = url.slice(4);
  if (url.startsWith('git://')) url = `https://${url.slice('git://'.length)}`;
  if (url.endsWith('.git')) url = url.slice(0, -4);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProvenanceError(`repository metadata is not a URL: ${rawUrl}`);
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  return { host: parsed.host, path };
}

/** Validate the registry document for the expected exact version. Fail closed. */
export function registryVersionFacts(
  documentText: string,
  expectation: DependencyExpectation,
  registry: string = DEFAULT_REGISTRY,
): RegistryVersionFacts {
  let doc: JsonObject;
  try {
    doc = asObject(JSON.parse(documentText))!;
  } catch {
    throw new ProvenanceError('registry response is not a JSON object');
  }
  if (!doc) throw new ProvenanceError('registry response is not a JSON object');
  if (doc.name !== expectation.name) {
    throw new ProvenanceError(
      `registry document is for ${String(doc.name)}, expected ${expectation.name}`,
    );
  }
  const versions = asObject(doc.versions);
  const vdoc = versions ? asObject(versions[expectation.version]) : undefined;
  if (!vdoc) {
    throw new ProvenanceError(
      `registry has no version ${expectation.version} for ${expectation.name}`,
    );
  }
  if (vdoc.name !== expectation.name || vdoc.version !== expectation.version) {
    throw new ProvenanceError(
      `registry version identity mismatch: ${String(vdoc.name)}@${String(vdoc.version)}`,
    );
  }
  const license = asNonEmptyString(vdoc.license);
  if (license !== EXPECTED_LICENSE) {
    throw new ProvenanceError(
      `license metadata mismatch: expected ${EXPECTED_LICENSE}, got ${license ?? '<missing>'}`,
    );
  }
  const repository = asObject(vdoc.repository);
  const repositoryUrl = repository ? asNonEmptyString(repository.url) : undefined;
  if (!repositoryUrl) throw new ProvenanceError('repository metadata is missing');
  const { host, path } = repositoryHostAndPath(repositoryUrl);
  if (host !== EXPECTED_REPOSITORY_HOST || path !== EXPECTED_REPOSITORY_PATH) {
    throw new ProvenanceError(
      `repository must be ${EXPECTED_REPOSITORY_HOST}${EXPECTED_REPOSITORY_PATH}, got ${host}${path}`,
    );
  }
  // The fork must stay generic: the published artifact may not depend on any
  // other @openelement/* package.
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const deps = asObject(vdoc[field]);
    if (!deps) continue;
    for (const dep of Object.keys(deps)) {
      if (dep.startsWith('@openelement/')) {
        throw new ProvenanceError(
          `published fork carries an OpenElement-scoped ${field} entry: ${dep}`,
        );
      }
    }
  }
  const dist = asObject(vdoc.dist);
  const tarball = dist ? asNonEmptyString(dist.tarball) : undefined;
  const integrity = dist ? asNonEmptyString(dist.integrity) : undefined;
  const shasum = dist ? asNonEmptyString(dist.shasum) : undefined;
  if (!tarball) throw new ProvenanceError('dist.tarball is missing');
  let tarballUrl: URL;
  try {
    tarballUrl = new URL(tarball);
  } catch {
    throw new ProvenanceError(`dist.tarball is not a URL: ${tarball}`);
  }
  const registryHost = new URL(registry).host;
  if (tarballUrl.protocol !== 'https:' || tarballUrl.host !== registryHost) {
    throw new ProvenanceError(`dist.tarball is not an https URL on ${registryHost}: ${tarball}`);
  }
  if (!integrity || !integrity.startsWith('sha512-')) {
    throw new ProvenanceError('dist.integrity is missing or not sha512');
  }
  if (!shasum || !/^[0-9a-f]{40}$/u.test(shasum)) {
    throw new ProvenanceError('dist.shasum is missing or not a SHA-1 hex digest');
  }
  const fileCount = typeof dist?.fileCount === 'number' ? dist.fileCount : undefined;
  return {
    name: expectation.name,
    version: expectation.version,
    license,
    repositoryUrl,
    tarball,
    integrity,
    shasum,
    ...(fileCount !== undefined ? { fileCount } : {}),
  };
}

// ---------------------------------------------------------------------------
// 3. Tarball integrity and content verification (pure, testable)
// ---------------------------------------------------------------------------

export interface TarEntry {
  name: string;
  /** '0' file, '5' directory. Long-name/pax records are resolved away. */
  type: string;
  data: Uint8Array;
}

function tarText(bytes: Uint8Array): string {
  const nul = bytes.indexOf(0);
  return new TextDecoder().decode(bytes.subarray(0, nul === -1 ? bytes.length : nul));
}

/** Minimal ustar reader: prefix field, GNU longname ('L') and pax ('x') paths. */
export function parseTarArchive(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let longName: string | undefined;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const sizeText = tarText(header.subarray(124, 136)).trim();
    const size = Number.parseInt(sizeText, 8);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new ProvenanceError(`malformed tar header size at offset ${offset}`);
    }
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    offset += 512;
    if (offset + size > bytes.length) {
      throw new ProvenanceError('truncated tar archive');
    }
    const data = bytes.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if (type === 'L') {
      longName = tarText(data);
      continue;
    }
    if (type === 'x') {
      // pax per-file extended header: honor an overriding path= record.
      const content = tarText(data);
      const pathMatch = content.match(/(?:^|\n)\d+ path=([^\n]+)/);
      if (pathMatch) longName = pathMatch[1];
      continue;
    }
    if (type === 'g') continue; // pax global header: no per-entry effect here
    if (type !== '0' && type !== '5') continue;
    const name = tarText(header.subarray(0, 100));
    const prefix = tarText(header.subarray(345, 500));
    const fullName = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = undefined;
    entries.push({ name: fullName.replace(/^\.\//, ''), type, data });
  }
  if (entries.length === 0) throw new ProvenanceError('tar archive carries no entries');
  return entries;
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  } catch (error) {
    throw new ProvenanceError(`tarball is not gzip: ${error}`);
  }
  try {
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (error) {
    throw new ProvenanceError(`tarball gzip stream is corrupt: ${error}`);
  }
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function integritySha512(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-512', new Uint8Array(bytes));
  return `sha512-${base64Encode(new Uint8Array(digest))}`;
}

export async function shasumSha1(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface TarballContentReport {
  files: string[];
  entryPoints: string[];
}

/** Collect static entry-point targets from main/module/types/exports. */
export function entryPointTargets(packageJson: JsonObject): string[] {
  const targets: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string' && !value.includes('*')) {
      targets.push(value.replace(/^\.\//, ''));
    }
  };
  add(packageJson.main);
  add(packageJson.module);
  add(packageJson.types);
  const walkExports = (value: unknown): void => {
    if (typeof value === 'string') return add(value);
    if (Array.isArray(value)) return value.forEach(walkExports);
    const object = asObject(value);
    if (object) Object.values(object).forEach(walkExports);
  };
  walkExports(packageJson.exports);
  return [...new Set(targets)];
}

const CODE_SUFFIX = /\.(?:cjs|js|mjs|ts)$/u;

/**
 * Verify the published artifact corresponds to the expected fork package:
 * identity, entry points, license/readme carriage, registry file count, and
 * genericity (no OpenElement-scoped dependency or source reference).
 */
export function verifyTarballContents(
  entries: TarEntry[],
  expectation: DependencyExpectation,
  expectedFileCount?: number,
): TarballContentReport {
  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.type !== '0') continue;
    if (!entry.name.startsWith('package/')) {
      throw new ProvenanceError(`tarball entry escapes the package/ root: ${entry.name}`);
    }
    files.set(entry.name.slice('package/'.length), entry.data);
  }
  if (files.size === 0) throw new ProvenanceError('tarball carries no files');
  const manifestText = files.get('package.json');
  if (!manifestText) throw new ProvenanceError('tarball lacks package/package.json');
  let manifest: JsonObject;
  try {
    manifest = asObject(JSON.parse(tarText(manifestText)))!;
  } catch {
    throw new ProvenanceError('tarball package.json is not a JSON object');
  }
  if (manifest.name !== expectation.name || manifest.version !== expectation.version) {
    throw new ProvenanceError(
      `tarball identity mismatch: ${String(manifest.name)}@${String(manifest.version)} ` +
        `(expected ${expectation.name}@${expectation.version}) — the artifact is stale or wrong`,
    );
  }
  if (manifest.license !== EXPECTED_LICENSE) {
    throw new ProvenanceError(`tarball license mismatch: ${String(manifest.license)}`);
  }
  const names = [...files.keys()];
  const entryPoints = entryPointTargets(manifest);
  if (entryPoints.length === 0) {
    throw new ProvenanceError('tarball package.json has no entry points');
  }
  for (const target of entryPoints) {
    if (!files.has(target)) {
      throw new ProvenanceError(`entry point target missing from tarball: ${target}`);
    }
  }
  if (!names.some((name) => /^LICENSE(?:\.|$)/iu.test(name))) {
    throw new ProvenanceError('tarball carries no LICENSE file');
  }
  if (!names.some((name) => /^README(?:\.|$)/iu.test(name))) {
    throw new ProvenanceError('tarball carries no README file');
  }
  if (expectedFileCount !== undefined && expectedFileCount !== files.size) {
    throw new ProvenanceError(
      `registry fileCount ${expectedFileCount} != actual tarball file count ${files.size}`,
    );
  }
  // Genericity: the fork must not absorb OpenElement Router semantics. Shipped
  // code referencing the @openelement scope (including this repo's Router
  // surface) is proof of absorption; docs may mention the fork's governance.
  for (const [name, data] of files) {
    if (!CODE_SUFFIX.test(name)) continue;
    const text = tarText(data);
    if (text.includes('@openelement/')) {
      throw new ProvenanceError(`shipped code references the @openelement scope: ${name}`);
    }
  }
  return { files: names.sort(), entryPoints };
}

// ---------------------------------------------------------------------------
// 4. Live registry access (retry only transient failures; fail closed)
// ---------------------------------------------------------------------------

export interface HttpResponse {
  status: number;
  body: Uint8Array;
}

export type HttpGet = (url: string, headers: Record<string, string>) => Promise<HttpResponse>;

export const defaultHttpGet: HttpGet = async (url, headers) => {
  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    throw new ProvenanceError(`network error fetching ${url}: ${error}`, true);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (response.status >= 500 || response.status === 429) {
    throw new ProvenanceError(`registry answered ${response.status} for ${url}`, true);
  }
  if (response.status === 404) {
    throw new ProvenanceError(`registry has no such package/version: ${url} (404)`);
  }
  if (response.status !== 200) {
    throw new ProvenanceError(`registry answered ${response.status} for ${url}`);
  }
  return { status: response.status, body };
};

export async function fetchWithRetry(
  get: HttpGet,
  url: string,
  headers: Record<string, string>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  delaysMs: readonly number[] = REGISTRY_DELAYS_MS,
): Promise<HttpResponse> {
  let last: unknown = 'unknown error';
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    const delay = delaysMs[attempt];
    if (delay > 0) await sleep(delay);
    try {
      return await get(url, headers);
    } catch (error) {
      last = error;
      if (!(error instanceof ProvenanceError) || !error.retryable) throw error;
    }
  }
  throw new ProvenanceError(
    `registry fetch failed after ${delaysMs.length} attempts for ${url}: ${last}`,
  );
}

// ---------------------------------------------------------------------------
// 5. Orchestration
// ---------------------------------------------------------------------------

export interface ProvenanceReport {
  package: string;
  version: string;
  registry: string;
  specifier: string;
  lockIntegrity: string;
  repositoryUrl: string;
  license: string;
  tarball: string;
  integrity: string;
  shasum: string;
  fileCount: number;
  entryPoints: string[];
  checks: string[];
}

export interface VerifyOptions {
  root: string;
  registry?: string;
  packageName?: string;
  httpGet?: HttpGet;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export async function verifyUrlPatternListRelease(
  options: VerifyOptions,
): Promise<ProvenanceReport> {
  const log = options.log ?? (() => {});
  const packageName = options.packageName ?? EXPECTED_PACKAGE_NAME;
  const registry = options.registry ?? DEFAULT_REGISTRY;
  const get = options.httpGet ?? defaultHttpGet;
  const checks: string[] = [];

  const [rootConfig, appConfig, lockText] = await Promise.all([
    Deno.readTextFile(`${options.root}/deno.json`),
    Deno.readTextFile(`${options.root}/packages/router/deno.json`),
    Deno.readTextFile(`${options.root}/deno.lock`),
  ]);
  const expectation = expectationFromConfigs(rootConfig, appConfig, packageName);
  checks.push(
    `declared exact pin ${expectation.name}@${expectation.version} in root and app configs`,
  );
  log(
    `✓ declaration: exact pin ${expectation.name}@${expectation.version} (root + packages/router)`,
  );

  const lock = lockConsistency(lockText, expectation);
  checks.push(`lockfile resolves ${lock.specifier} to ${lock.resolvedVersion} with integrity`);
  log(`✓ lockfile: ${lock.specifier} → ${lock.resolvedVersion}, integrity recorded`);

  const documentUrl = `${registry}/${expectation.name.replace('/', '%2F')}`;
  const document = await fetchWithRetry(
    get,
    documentUrl,
    { accept: 'application/json' },
    options.sleep,
  );
  const facts = registryVersionFacts(
    new TextDecoder().decode(document.body),
    expectation,
    registry,
  );
  checks.push(
    `registry metadata: version ${facts.version}, license ${facts.license}, repository ${facts.repositoryUrl}`,
  );
  log(
    `✓ registry: ${facts.name}@${facts.version} license=${facts.license} repository=${facts.repositoryUrl}`,
  );

  if (lock.integrity !== facts.integrity) {
    throw new ProvenanceError(
      `lockfile integrity ${lock.integrity} != registry dist.integrity ${facts.integrity}`,
    );
  }
  checks.push('lockfile integrity equals registry dist.integrity');
  log('✓ lockfile integrity equals registry dist.integrity');

  const tarballResponse = await fetchWithRetry(get, facts.tarball, {
    accept: 'application/octet-stream',
  }, options.sleep);
  const tarballBytes = tarballResponse.body;
  const [integrity, shasum] = await Promise.all([
    integritySha512(tarballBytes),
    shasumSha1(tarballBytes),
  ]);
  if (integrity !== facts.integrity) {
    throw new ProvenanceError(
      `tarball bytes hash ${integrity} != registry dist.integrity ${facts.integrity}`,
    );
  }
  if (shasum !== facts.shasum) {
    throw new ProvenanceError(`tarball SHA-1 ${shasum} != registry dist.shasum ${facts.shasum}`);
  }
  checks.push(`tarball bytes verified against dist.integrity (sha512) and dist.shasum (sha1)`);
  log(`✓ tarball: ${tarballBytes.length} bytes, sha512/sha1 verified`);

  const entries = parseTarArchive(await gunzip(tarballBytes));
  const report = verifyTarballContents(entries, expectation, facts.fileCount);
  checks.push(
    `tarball contents: identity, ${report.entryPoints.length} entry point(s), LICENSE/README, genericity`,
  );
  log(`✓ contents: ${report.files.length} files, entry points ${report.entryPoints.join(', ')}`);

  return {
    package: expectation.name,
    version: expectation.version,
    registry,
    specifier: lock.specifier,
    lockIntegrity: lock.integrity,
    repositoryUrl: facts.repositoryUrl,
    license: facts.license,
    tarball: facts.tarball,
    integrity: facts.integrity,
    shasum: facts.shasum,
    fileCount: report.files.length,
    entryPoints: report.entryPoints,
    checks,
  };
}

async function main(): Promise<void> {
  const json = Deno.args.includes('--json');
  const registry = getArg('--registry') ?? DEFAULT_REGISTRY;
  const packageName = getArg('--package') ?? EXPECTED_PACKAGE_NAME;
  try {
    const report = await verifyUrlPatternListRelease({
      root: Deno.cwd(),
      registry,
      packageName,
      log: json ? () => {} : (message) => console.log(message),
    });
    if (json) {
      console.log(JSON.stringify({ ok: true, ...report }, null, 2));
    } else {
      console.log(
        `\nurl-pattern-list provenance OK: ${report.package}@${report.version} ` +
          `(${report.integrity}) — ${report.checks.length} check groups passed.`,
      );
    }
  } catch (error) {
    console.error(`url-pattern-list provenance FAILED: ${error}`);
    Deno.exit(1);
  }
}

if (import.meta.main) await main();
