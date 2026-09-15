/**
 * Site asset provenance and size-budget gate.
 *
 * Every file under `www/public/assets` (except the manifest itself) must
 * be declared in `www/public/assets/manifest.json` with a matching
 * SHA-256. External first-party assets remain in the same provenance ledger,
 * but carry an immutable HTTPS origin/key and must not also exist in the
 * vendored tree. Every entry must carry a non-empty role, source, and license;
 * third-party entries additionally need a name/version and must appear in
 * `THIRD_PARTY_NOTICES.md`. The manifest's byte budgets cap the vendored asset
 * weight and any single media file, so large media cannot return silently.
 *
 * Group entries (`"path": "dragon-frames/"`) exist so first-party frame sets
 * are one manifest record while still hashing every file individually.
 */

import { walkSync } from '@std/fs/walk';

export const ASSETS_DIR = 'www/public/assets';
export const MANIFEST_PATH = `${ASSETS_DIR}/manifest.json`;
export const NOTICES_PATH = 'THIRD_PARTY_NOTICES.md';

/** Extensions counted against the single-media budget. */
export const MEDIA_EXTENSIONS = [
  '.webp',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.avif',
  '.svg',
  '.mp4',
  '.webm',
  '.mp3',
  '.wav',
  '.ogg',
  '.woff2',
  '.woff',
  '.ttf',
  '.otf',
];

export interface AssetEntry {
  path: string;
  kind: 'third-party' | 'first-party';
  name?: string;
  version?: string;
  role: string;
  source: string;
  license: string;
  copyright?: string;
  sha256?: string;
  files?: Record<string, string>;
  remote?: {
    type: 'external';
    origin: string;
    key: string;
  };
}

export interface AssetsManifest {
  schemaVersion: number;
  notice: string;
  budgets: {
    assetsTotalBytes: number;
    singleMediaBytes: number;
  };
  assets: AssetEntry[];
}

export interface AssetFile {
  /** Path relative to the assets directory, POSIX separators. */
  path: string;
  bytes: number;
  sha256: string;
}

const HEX = '0123456789abcdef';

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += HEX[byte >> 4] + HEX[byte & 0x0f];
  return out;
}

export async function sha256File(path: string | URL): Promise<string> {
  const bytes = await Deno.readFile(path);
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

export function isMediaPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MEDIA_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate a manifest against the files that exist on disk. Pure: callers
 * provide the file digests (the CLI walks the tree and hashes). Returns a list
 * of human-readable failures; an empty list means the gate passes.
 */
export function checkAssetsProvenance(
  manifest: unknown,
  files: AssetFile[],
  notices: string,
): string[] {
  const failures: string[] = [];
  if (typeof manifest !== 'object' || manifest === null) {
    return ['manifest must be a JSON object'];
  }
  const candidate = manifest as Partial<AssetsManifest>;
  if (candidate.schemaVersion !== 2) failures.push('manifest schemaVersion must be 2');
  const budgets = candidate.budgets;
  if (
    typeof budgets !== 'object' || budgets === null ||
    !Number.isInteger(budgets.assetsTotalBytes) || budgets.assetsTotalBytes <= 0 ||
    !Number.isInteger(budgets.singleMediaBytes) || budgets.singleMediaBytes <= 0
  ) {
    failures.push(
      'manifest budgets.assetsTotalBytes and budgets.singleMediaBytes must be positive integers',
    );
  }
  if (!Array.isArray(candidate.assets)) {
    failures.push('manifest assets must be an array');
    return failures;
  }

  const exact = new Map<string, AssetEntry>();
  const groups: Array<{ prefix: string; entry: AssetEntry }> = [];
  const remoteExact = new Set<string>();
  const remoteGroups: string[] = [];
  const declaredPaths = new Set<string>();
  const remoteUrls = new Set<string>();
  const thirdPartyNames = new Set<string>();
  for (const [index, entry] of candidate.assets.entries()) {
    const label = `assets[${index}]`;
    if (typeof entry !== 'object' || entry === null) {
      failures.push(`${label} must be an object`);
      continue;
    }
    const asset = entry as AssetEntry;
    const id = isNonEmptyString(asset.path) ? asset.path : label;
    if (!isNonEmptyString(asset.path)) {
      failures.push(`${label}.path must be a non-empty string`);
      continue;
    }
    if (declaredPaths.has(asset.path)) failures.push(`${id}: duplicate manifest entry`);
    declaredPaths.add(asset.path);
    if (asset.kind !== 'third-party' && asset.kind !== 'first-party') {
      failures.push(`${id}: kind must be "third-party" or "first-party"`);
    }
    for (const field of ['role', 'source', 'license'] as const) {
      if (!isNonEmptyString(asset[field])) failures.push(`${id}: ${field} must be non-empty`);
    }
    if (asset.kind === 'third-party') {
      if (!isNonEmptyString(asset.name)) failures.push(`${id}: third-party entries need a name`);
      if (!isNonEmptyString(asset.version)) {
        failures.push(`${id}: third-party entries need a version`);
      }
      if (isNonEmptyString(asset.source) && !/^https:\/\//.test(asset.source)) {
        failures.push(`${id}: third-party source must be an https upstream URL`);
      }
      if (isNonEmptyString(asset.name)) thirdPartyNames.add(asset.name);
    }
    const declared = asset.sha256 !== undefined || asset.files !== undefined;
    if (!declared) failures.push(`${id}: needs sha256 (file) or files (group) digests`);
    if (asset.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(asset.sha256)) {
      failures.push(`${id}: sha256 must be 64 lowercase hex characters`);
    }
    if (asset.files !== undefined && (typeof asset.files !== 'object' || asset.files === null)) {
      failures.push(`${id}: files must be a digest map`);
    } else if (asset.files !== undefined) {
      const fileDigests = Object.entries(asset.files);
      if (fileDigests.length === 0) failures.push(`${id}: files digest map must not be empty`);
      for (const [file, digest] of fileDigests) {
        if (
          !file || file.startsWith('/') || file.includes('\\') || file.split('/').includes('..')
        ) {
          failures.push(`${id}: invalid relative file key ${JSON.stringify(file)}`);
        }
        if (!/^[0-9a-f]{64}$/.test(digest)) {
          failures.push(`${id}: ${file} digest must be 64 lowercase hex characters`);
        }
      }
    }

    const isRemote = asset.remote !== undefined;
    if (isRemote) {
      const remote = asset.remote;
      if (typeof remote !== 'object' || remote === null) {
        failures.push(`${id}: remote must be an object`);
      } else {
        if (remote.type !== 'external') failures.push(`${id}: remote.type must be "external"`);
        let validOrigin = false;
        if (!isNonEmptyString(remote.origin)) {
          failures.push(`${id}: remote.origin must be non-empty`);
        } else {
          try {
            const origin = new URL(remote.origin);
            validOrigin = origin.protocol === 'https:' && origin.origin === remote.origin;
          } catch {
            validOrigin = false;
          }
          if (!validOrigin) failures.push(`${id}: remote.origin must be an HTTPS origin`);
        }
        const validKey = isNonEmptyString(remote.key) && !remote.key.startsWith('/') &&
          !remote.key.includes('\\') && !remote.key.split('/').includes('..');
        if (!validKey) failures.push(`${id}: remote.key must be a safe relative object key`);
        if (
          asset.path.endsWith('/') !== (isNonEmptyString(remote.key) && remote.key.endsWith('/'))
        ) {
          failures.push(`${id}: grouped path and remote.key must agree on trailing slash`);
        }
        if (validOrigin && validKey) {
          const url = `${remote.origin}/${remote.key}`;
          if (remoteUrls.has(url)) failures.push(`${id}: duplicate remote URL ${url}`);
          remoteUrls.add(url);
        }
      }
    }
    if (asset.path.endsWith('/')) {
      if (asset.files === undefined || typeof asset.files !== 'object' || asset.files === null) {
        failures.push(`${id}: group entries need a files digest map`);
      }
      if (isRemote) remoteGroups.push(asset.path);
      else groups.push({ prefix: asset.path, entry: asset });
    } else {
      if (isRemote) remoteExact.add(asset.path);
      else exact.set(asset.path, asset);
    }
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    if (file.path === 'manifest.json') continue;
    seen.add(file.path);
    totalBytes += file.bytes;
    if (
      remoteExact.has(file.path) || remoteGroups.some((prefix) => file.path.startsWith(prefix))
    ) {
      failures.push(`${file.path}: declared external but still exists in the vendored asset tree`);
      continue;
    }
    let expected: string | undefined;
    let owner: AssetEntry | undefined;
    const direct = exact.get(file.path);
    if (direct) {
      expected = direct.sha256;
      owner = direct;
    } else {
      for (const group of groups) {
        if (!file.path.startsWith(group.prefix)) continue;
        expected = group.entry.files?.[file.path.slice(group.prefix.length)];
        owner = group.entry;
        break;
      }
    }
    if (!owner) {
      failures.push(`${file.path}: no manifest entry`);
      continue;
    }
    if (expected === undefined) {
      failures.push(`${file.path}: missing SHA-256 in manifest`);
    } else if (expected !== file.sha256) {
      failures.push(`${file.path}: SHA-256 mismatch (manifest ${expected}, file ${file.sha256})`);
    }
    if (
      typeof budgets === 'object' && budgets !== null &&
      Number.isInteger(budgets.singleMediaBytes) &&
      isMediaPath(file.path) && file.bytes > budgets.singleMediaBytes
    ) {
      failures.push(
        `${file.path}: ${file.bytes} bytes exceeds the single-media budget of ${budgets.singleMediaBytes} bytes`,
      );
    }
  }
  for (const declared of exact.keys()) {
    if (!seen.has(declared)) failures.push(`${declared}: manifest entry has no file on disk`);
  }
  if (
    typeof budgets === 'object' && budgets !== null &&
    Number.isInteger(budgets.assetsTotalBytes) && totalBytes > budgets.assetsTotalBytes
  ) {
    failures.push(
      `assets total ${totalBytes} bytes exceeds the budget of ${budgets.assetsTotalBytes} bytes`,
    );
  }

  for (const name of thirdPartyNames) {
    if (!notices.includes(name)) {
      failures.push(`${NOTICES_PATH}: missing third-party notice for ${name}`);
    }
  }
  const hasMit = candidate.assets.some((entry) =>
    typeof entry === 'object' && entry !== null && (entry as AssetEntry).license === 'MIT'
  );
  if (hasMit && !notices.includes('THE SOFTWARE IS PROVIDED "AS IS"')) {
    failures.push(`${NOTICES_PATH}: MIT license text must be included verbatim`);
  }
  return failures;
}

/** Load the repository manifest/notices and verify the real asset tree. */
export async function scanAssetsProvenance(): Promise<string[]> {
  const manifest = JSON.parse(await Deno.readTextFile(MANIFEST_PATH));
  const notices = await Deno.readTextFile(NOTICES_PATH);
  const files: AssetFile[] = [];
  for (const entry of walkSync(ASSETS_DIR, { includeDirs: false })) {
    const path = entry.path.slice(ASSETS_DIR.length + 1);
    if (path === 'manifest.json') continue;
    const { size } = Deno.statSync(entry.path);
    files.push({ path, bytes: size ?? 0, sha256: await sha256File(entry.path) });
  }
  return checkAssetsProvenance(manifest, files, notices);
}

if (import.meta.main) {
  const failures = await scanAssetsProvenance();
  if (failures.length > 0) {
    console.error('Asset provenance check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    Deno.exit(1);
  }
  console.log('Asset provenance check passed.');
}
