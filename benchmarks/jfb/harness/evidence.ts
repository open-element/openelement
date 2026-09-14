/**
 * Identity-safe evidence handling for the JFB harness (issue #1219).
 *
 * Benchmark runs are local, not published: results are CI artifacts or an
 * explicit local output. Raw runs can carry machine identity (hostname,
 * account names, absolute build paths), so evidence is redacted before it is
 * written and re-validated afterwards — a reproducible record without leaking
 * identity. Committed thresholds, when the project has a stable repeatable
 * budget, must be identity-free budgets with units and tolerance rather than
 * one machine's raw samples.
 *
 * This module is host-free on purpose (no node imports) so tests can import
 * it; the runner supplies the identity values it wants scrubbed.
 */

export const DEFAULT_EVIDENCE_PATH = '.artifacts/jfb-evidence.json';

export const JFB_REPO = 'krausest/js-framework-benchmark';

export interface EvidenceIdentity {
  hostname?: string;
  username?: string;
  homeDir?: string;
  repoRoot?: string;
  buildDir?: string;
  tmpDir?: string;
}

const IDENTITY_KEYS = new Set(['hostname', 'username', 'user', 'home', 'homedir', 'cwd']);

const ABSOLUTE_PATH =
  /(?:^|[\s"'(=,;:])(?:\/(?:Users|home|private|var|tmp|opt|root|Volumes|Applications)\/|[A-Za-z]:\\\\)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Deep-copy `value`, replacing known identity literals with placeholders and
 * dropping identity-named keys. Unknown absolute paths under private roots
 * are tokenized too, so no caller can smuggle a home directory through.
 */
export function redactEvidence<T>(value: T, identity: EvidenceIdentity = {}): T {
  const replacements: Array<[string, string]> = [];
  const push = (needle: string | undefined, token: string) => {
    if (isNonEmptyString(needle) && needle.length > 1) replacements.push([needle, token]);
  };
  push(identity.hostname, '<hostname>');
  push(identity.username, '<user>');
  push(identity.homeDir, '<home>');
  push(identity.repoRoot, '<repo>');
  push(identity.buildDir, '<build-dir>');
  push(identity.tmpDir, '<tmp>');
  replacements.sort((a, b) => b[0].length - a[0].length);

  const scrub = (text: string): string => {
    let out = text;
    for (const [needle, token] of replacements) out = out.split(needle).join(token);
    return out
      .replace(/\/Users\/[^/\s"']+/g, '/Users/<user>')
      .replace(/\/home\/[^/\s"']+/g, '/home/<user>')
      .replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, 'C:\\Users\\<user>');
  };

  const visit = (node: unknown): unknown => {
    if (typeof node === 'string') return scrub(node);
    if (Array.isArray(node)) return node.map(visit);
    if (isRecord(node)) {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node)) {
        if (IDENTITY_KEYS.has(key.toLowerCase())) continue;
        out[key] = visit(child);
      }
      return out;
    }
    return node;
  };
  return visit(value) as T;
}

/**
 * Report machine-identifying residue in an evidence object: identity-named
 * keys, known identity literals, and absolute filesystem paths. The caller
 * passes the identity values it knows (the recording machine's), so a clean
 * run has an empty result on any host.
 */
export function findIdentityLeaks(value: unknown, identity: EvidenceIdentity = {}): string[] {
  const leaks: string[] = [];
  const needles: Array<[string, string]> = [];
  if (isNonEmptyString(identity.hostname)) needles.push([identity.hostname, 'hostname']);
  if (isNonEmptyString(identity.username)) needles.push([identity.username, 'username']);
  if (isNonEmptyString(identity.homeDir)) needles.push([identity.homeDir, 'home directory']);
  if (isNonEmptyString(identity.repoRoot)) needles.push([identity.repoRoot, 'repository root']);
  if (isNonEmptyString(identity.buildDir)) needles.push([identity.buildDir, 'build directory']);
  if (isNonEmptyString(identity.tmpDir)) needles.push([identity.tmpDir, 'temporary directory']);

  const visit = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      if (ABSOLUTE_PATH.test(node)) leaks.push(`${path}: absolute path`);
      for (const [needle, label] of needles) {
        if (node.includes(needle)) leaks.push(`${path}: contains ${label}`);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (isRecord(node)) {
      for (const [key, child] of Object.entries(node)) {
        if (IDENTITY_KEYS.has(key.toLowerCase())) leaks.push(`${path}.${key}: identity key`);
        visit(child, `${path}.${key}`);
      }
    }
  };
  visit(value, '$');
  return leaks;
}

/**
 * Structural validation of a recorded evidence object: schema, pinned JFB
 * commit, environment/toolchain versions, and finite measured numbers. This
 * is the reproducible-schema bar; it does not compare timings.
 */
export function validateEvidence(
  value: unknown,
  options: { jfbCommit?: string } = {},
): string[] {
  const failures: string[] = [];
  if (!isRecord(value)) return ['evidence must be a JSON object'];
  if (value.schemaVersion !== 1) failures.push('schemaVersion must be 1');
  if (value.kind !== 'jfb-local-baseline') failures.push('kind must be jfb-local-baseline');
  if (value.issue !== 1219) failures.push('issue must be 1219');
  if (typeof value.recordedAt !== 'string' || Number.isNaN(Date.parse(value.recordedAt))) {
    failures.push('recordedAt must be an ISO timestamp');
  }

  const provenance = isRecord(value.provenance) ? value.provenance : undefined;
  if (!provenance) {
    failures.push('provenance is required');
  } else {
    const oe = isRecord(provenance.openElement) ? provenance.openElement : undefined;
    if (!oe || !/^[0-9a-f]{40}$/.test(String(oe.sha))) {
      failures.push('provenance.openElement.sha must be a 40-hex revision');
    }
    const jfb = isRecord(provenance.jfb) ? provenance.jfb : undefined;
    if (!jfb) {
      failures.push('provenance.jfb is required');
    } else {
      if (jfb.repo !== JFB_REPO) failures.push(`provenance.jfb.repo must be ${JFB_REPO}`);
      if (!/^[0-9a-f]{40}$/.test(String(jfb.commit))) {
        failures.push('provenance.jfb.commit must be a 40-hex revision');
      }
      if (options.jfbCommit && jfb.commit !== options.jfbCommit) {
        failures.push(`provenance.jfb.commit must be the pinned commit ${options.jfbCommit}`);
      }
    }
    const browser = isRecord(provenance.browser) ? provenance.browser : undefined;
    if (!browser || !isNonEmptyString(browser.engine) || !isNonEmptyString(browser.version)) {
      failures.push('provenance.browser needs engine and version');
    }
    const toolchain = isRecord(provenance.toolchain) ? provenance.toolchain : undefined;
    if (!toolchain) {
      failures.push('provenance.toolchain is required');
    } else {
      // Deno.version is an object ({ deno, v8, typescript }); plain version
      // strings (node/npm/platform/...) are accepted as-is.
      const isVersion = (candidate: unknown): boolean =>
        isNonEmptyString(candidate) ||
        (isRecord(candidate) && Object.values(candidate).some(isNonEmptyString));
      for (const field of ['platform', 'release', 'arch', 'cpuModel', 'deno', 'node', 'npm']) {
        if (!isVersion(toolchain[field])) {
          failures.push(`provenance.toolchain.${field} must be a non-empty version string`);
        }
      }
      if (!isFiniteNumber(toolchain.cpuCount) || toolchain.cpuCount <= 0) {
        failures.push('provenance.toolchain.cpuCount must be positive');
      }
      if (!isFiniteNumber(toolchain.totalMemoryBytes) || toolchain.totalMemoryBytes <= 0) {
        failures.push('provenance.toolchain.totalMemoryBytes must be positive');
      }
    }
    const iterations = isRecord(provenance.iterations) ? provenance.iterations : undefined;
    if (!iterations) {
      failures.push('provenance.iterations is required');
    } else {
      for (const field of ['cpu', 'cpuStock', 'mem']) {
        if (!Number.isInteger(iterations[field]) || (iterations[field] as number) <= 0) {
          failures.push(`provenance.iterations.${field} must be a positive integer`);
        }
      }
    }
  }

  if (!Array.isArray(value.results) || value.results.length === 0) {
    failures.push('results must be a non-empty array');
    return failures;
  }
  for (const [index, entry] of value.results.entries()) {
    if (!isRecord(entry)) {
      failures.push(`results[${index}] must be an object`);
      continue;
    }
    if (!isNonEmptyString(entry.id)) failures.push(`results[${index}].id is required`);
    if (typeof entry.stock !== 'boolean') {
      failures.push(`results[${index}].stock must be a boolean`);
    }
    if (!Array.isArray(entry.pageErrors)) {
      failures.push(`results[${index}].pageErrors must be an array`);
    }
    if (!isFiniteNumber(entry.cpuGeomeanMs) || entry.cpuGeomeanMs <= 0) {
      failures.push(`results[${index}].cpuGeomeanMs must be positive and finite`);
    }
    if (!Array.isArray(entry.cpu) || entry.cpu.length === 0) {
      failures.push(`results[${index}].cpu must be a non-empty array`);
    } else {
      for (const [benchIndex, bench] of entry.cpu.entries()) {
        const label = `results[${index}].cpu[${benchIndex}]`;
        if (!isRecord(bench)) {
          failures.push(`${label} must be an object`);
          continue;
        }
        if (!isNonEmptyString(bench.id)) failures.push(`${label}.id is required`);
        if (!Array.isArray(bench.samplesMs) || bench.samplesMs.length === 0) {
          failures.push(`${label}.samplesMs must be a non-empty array`);
        } else {
          for (const sample of bench.samplesMs) {
            if (!isFiniteNumber(sample) || sample < 0) {
              failures.push(`${label}.samplesMs entries must be finite and non-negative`);
              break;
            }
          }
        }
        for (const field of ['medianMs', 'meanMs', 'maxMs']) {
          if (!isFiniteNumber(bench[field]) || (bench[field] as number) < 0) {
            failures.push(`${label}.${field} must be finite and non-negative`);
          }
        }
        if (!isFiniteNumber(bench.minMs) || (bench.minMs as number) < 0) {
          failures.push(`${label}.minMs must be finite and non-negative`);
        }
      }
    }
    if (!Array.isArray(entry.memory)) failures.push(`results[${index}].memory must be an array`);
  }
  return failures;
}

/** Validate an evidence object and fail closed on any identity leak. */
export function assertEvidenceSafe(
  value: unknown,
  identity: EvidenceIdentity,
  options: { jfbCommit?: string } = {},
): void {
  const failures = [...validateEvidence(value, options), ...findIdentityLeaks(value, identity)];
  if (failures.length > 0) {
    throw new Error(
      `[jfb-evidence] refusing to write unsafe evidence:\n- ${failures.join('\n- ')}`,
    );
  }
}
