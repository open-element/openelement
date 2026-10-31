/** Machine-path scanner semantics: text-only, strict markers. */
import { expect, test } from 'vitest';
import { findMachinePath, isTextArtifact } from './check-no-machine-paths.ts';

test('isTextArtifact: binary bytes are not text', () => {
  // Invalid UTF-8 (a lone continuation byte) is binary for this gate.
  expect(isTextArtifact(new Uint8Array([0x80, 0x81, 0x82]))).toEqual(false);
  expect(isTextArtifact(new TextEncoder().encode('<html>ok</html>'))).toEqual(true);
  expect(isTextArtifact(new Uint8Array())).toEqual(true);
});

test('findMachinePath: real machine paths are found', () => {
  for (const [input, label] of [
    ['/Users/alice/projects/app.js', 'macOS home path'],
    ['/home/runner/work/repo/build.js', 'Linux home path'],
    ['/private/tmp/checkout/x.css', 'private temp path'],
    ['/var/folders/xy/x.ts', 'macOS temp path'],
    ['C:\\projects\\app\\dist\\x.js', 'Windows drive path'],
    ['c:/ci/work/repo/y.js', 'Windows drive path'],
  ] as const) {
    const hit = findMachinePath(input);
    expect(hit?.label, input).toEqual(label);
  }
});

test('findMachinePath: Linux CI roots are caught', () => {
  for (const [input, label] of [
    ['/tmp/oe-build/checkout/openelement/www/dist/x.js', 'Linux temp path'],
    ['/builds/org/repo/www/dist/x.js', 'CI builds path'],
    ['/root/repo/www/dist/x.js', 'Linux root home path'],
    ['/opt/hostedtoolcache/node/20.11.0/x64/bin/node', 'hosted toolcache path'],
  ] as const) {
    const hit = findMachinePath(input);
    expect(hit?.label, input).toEqual(label);
  }
  // A bare prose mention of a temp directory is not a machine path.
  expect(findMachinePath('write the file under /tmp/ before moving it')).toEqual(null);
});

test('findMachinePath: short drive-letter lookalikes and clean text do not trip', () => {
  expect(findMachinePath('U:w')).toEqual(null);
  expect(findMachinePath('U:\\w')).toEqual(null);
  expect(findMachinePath('e:/p4--')).toEqual(null);
  expect(findMachinePath('the key U: is pressed')).toEqual(null);
  expect(findMachinePath('https://example.com/guide/install')).toEqual(null);
});

// ── targeted public-input mode (--source) ──────────────────────────────────
// The build gate discovers its own inputs; the `--source` mode must read ONLY
// the paths an operator names, report a hit as location + marker kind (never
// the matched machine value), and scan a large text file instead of skipping
// it — a PASS must never stand over unchecked bytes.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseCheckArgs,
  scanArtifactFile,
  scanBuildArtifacts,
  scanSourcePaths,
} from './check-no-machine-paths.ts';

async function tempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'oe-machine-paths-'));
}

test('parseCheckArgs: default gate, --source paths, and fail-closed usage', () => {
  expect(parseCheckArgs([])).toEqual({ source: null, help: false });
  expect(parseCheckArgs(['--source', 'docs/a.md', 'docs/release'])).toEqual({
    source: ['docs/a.md', 'docs/release'],
    help: false,
  });
  expect(parseCheckArgs(['--help'])).toEqual({ source: null, help: true });
  expect(() => parseCheckArgs(['--source'])).toThrow(/at least one/);
  expect(() => parseCheckArgs(['--nope'])).toThrow(/unknown argument/);
});

test('scanSourcePaths: a hit reports the location and label, never the value', async () => {
  const dir = await tempDir();
  try {
    await mkdir(join(dir, 'public'), { recursive: true });
    await writeFile(join(dir, 'public', 'leak.md'), 'built at /Users/alice/projects/app\n', 'utf8');
    await writeFile(join(dir, 'public', 'clean.md'), 'built in the checkout\n', 'utf8');
    await writeFile(join(dir, 'sibling-not-passed.md'), '/home/runner/work/build\n', 'utf8');
    const summary = await scanSourcePaths([join(dir, 'public')]);
    expect(summary.scanned).toEqual(2);
    expect(summary.binarySkipped).toEqual(0);
    expect(summary.failures).toEqual([`${join(dir, 'public')}/leak.md: macOS home path`]);
    expect(summary.failures.join('\n')).not.toContain('alice');
    expect(summary.failures.join('\n')).not.toContain('/Users/');
    // The sibling was NOT passed in, so it is not read: only named paths count.
    const onlyClean = await scanSourcePaths([join(dir, 'public', 'clean.md')]);
    expect(onlyClean.failures).toEqual([]);
    expect(onlyClean.scanned).toEqual(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('scanSourcePaths: a missing explicit path is an error, not a pass', async () => {
  await expect(scanSourcePaths(['does/not/exist.md'])).rejects.toThrow(
    /source path not found: does\/not\/exist\.md/,
  );
});

test('scanArtifactFile: a large text file is streamed and scanned in full', async () => {
  const dir = await tempDir();
  try {
    const clean = 'the quick brown fox jumps over the lazy dog\n'.repeat(100_000);
    const bigClean = join(dir, 'big-clean.txt');
    await writeFile(bigClean, clean, 'utf8');
    const cleanScan = await scanArtifactFile(bigClean);
    expect(cleanScan.status).toEqual('text');
    expect(cleanScan.hit).toEqual(null);

    // The marker sits past the first 4 MiB chunk; a skipped oversize file
    // would report no hit and a PASS over bytes nobody checked.
    const bigHit = join(dir, 'big-hit.txt');
    await writeFile(bigHit, `${clean}... and the build ran in /tmp/oe-build/checkout/x`, 'utf8');
    const hitScan = await scanArtifactFile(bigHit);
    expect(hitScan.status).toEqual('text');
    expect(hitScan.hit?.label).toEqual('Linux temp path');

    const summary = await scanBuildArtifacts([dir]);
    expect(summary.scanned).toEqual(2);
    expect(summary.binarySkipped).toEqual(0);
    expect(summary.failures).toEqual([`big-hit.txt: Linux temp path`]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('scanArtifactFile: binary bytes are counted as skipped, not scanned', async () => {
  const dir = await tempDir();
  try {
    const binary = join(dir, 'blob.bin');
    await writeFile(binary, new Uint8Array([0x80, 0x81, 0x82, 0x83]));
    const summary = await scanBuildArtifacts([dir]);
    expect(summary.scanned).toEqual(0);
    expect(summary.binarySkipped).toEqual(1);
    expect(summary.failures).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI --source: clean input exits 0 and a large text file is scanned, not skipped', async () => {
  const { spawnSync } = await import('node:child_process');
  const cli = join(import.meta.dirname, 'check-no-machine-paths.ts');
  const dir = await tempDir();
  try {
    await writeFile(join(dir, 'clean.md'), 'built in the checkout\n', 'utf8');
    // Larger than the in-memory chunk: the old gate listed it as oversize and
    // still printed "passed"; the streamed scan must include it instead.
    await writeFile(join(dir, 'big-clean.txt'), 'the quick brown fox\n'.repeat(250_000), 'utf8');
    const result = spawnSync(process.execPath, [cli, '--source', dir], { encoding: 'utf8' });
    expect(result.status).toEqual(0);
    expect(result.stdout).toMatch(/machine-path check passed \(2 text files scanned/);
    expect(result.stdout).not.toMatch(/oversize/i);

    // A hit exits 1 and the console line carries only the location + label.
    await writeFile(join(dir, 'leak.md'), 'built at /Users/alice/projects/app\n', 'utf8');
    const bad = spawnSync(process.execPath, [cli, '--source', dir], { encoding: 'utf8' });
    expect(bad.status).toEqual(1);
    expect(bad.stderr).toMatch(/leak\.md: macOS home path/);
    expect(bad.stderr).not.toContain('alice');
    expect(bad.stderr).not.toContain('/Users/');

    // A missing explicit path is a usage error (exit 2), never a pass.
    const missing = spawnSync(process.execPath, [cli, '--source', join(dir, 'nope.md')], {
      encoding: 'utf8',
    });
    expect(missing.status).toEqual(2);
    expect(missing.stderr).toMatch(/source path not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check:public-docs gate is wired to --source docs and fails closed on a hit', async () => {
  const { spawnSync } = await import('node:child_process');
  const { readFile } = await import('node:fs/promises');
  const repoRoot = join(import.meta.dirname, '..', '..');
  const runIn = join(repoRoot, 'tools/repo/run-in.ts');
  const cli = join(import.meta.dirname, 'check-no-machine-paths.ts');

  // Wiring pin: the gate task must scan the public docs tree explicitly, never
  // fall back to the build-output (repo-wide) mode.
  const pkg = JSON.parse(
    await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
  ) as {
    scripts: Record<string, string>;
  };
  expect(pkg.scripts['check:public-docs']).toMatch(/check-no-machine-paths\.ts --source docs$/);

  // The gate's real input is clean: this is the positive control for the
  // wrapper the gate uses (`run-in --root <repo> -- <scan> --source docs`).
  const clean = spawnSync(
    process.execPath,
    [runIn, '--root', repoRoot, '--', process.execPath, cli, '--source', 'docs'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  expect(clean.status).toEqual(0);

  // Negative control: seed the gate's command with a machine path through the
  // same wrapper, and the command must fail (exit 1), never print a pass.
  const dir = await tempDir();
  try {
    await writeFile(join(dir, 'seeded.md'), 'installed at /home/runner/work/repo\n', 'utf8');
    const seeded = spawnSync(
      process.execPath,
      [runIn, '--root', repoRoot, '--', process.execPath, cli, '--source', dir],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    expect(seeded.status).toEqual(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
