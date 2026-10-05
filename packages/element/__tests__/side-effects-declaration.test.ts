/**
 * P8 guard for the sideEffects seam (see docs/architecture/seams.md).
 *
 * The `sideEffects` array in package.json is read by bundlers for in-repo
 * builds (vite resolves this package from source), while the packed artifact
 * carries its own compiled-.js mirror written by the release manifest
 * (tools/release/npm-manifest.ts SIDE_EFFECTS). One side without the other is
 * the #1425 incident: the claim install tree-shaken out of consumer bundles
 * while the artifact still looked correct.
 *
 * This test is the source-side guard: every module-scope side effect that
 * exists in src/ — a bare side-effect import, or a module-scope
 * `install<Something>(...)` call — must be named in the declaration, together
 * with the module that performs the bare import (a side-effect-free importer
 * loses it, so the importer edge is declared too). The walker is the release
 * check's own (pack-surface.ts), so both sides share one definition of
 * "module scope". The packed side keeps its guard in pack-surface's scan of
 * the real tarball.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { findModuleScopeGlobalWrites } from '../../../tools/release/pack-surface.ts';

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url)).replace(/\/+$/, '');

/** A bare relative import at module scope: `import './x.ts';` */
const BARE_IMPORT_PATTERN = /^import\s+'(\.[^']+)'\s*;?$/;

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(path, out);
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** Package-relative './src/…' form of an absolute path under the package. */
function declaredForm(absolutePath: string): string {
  return `./${relative(PKG_DIR, normalize(absolutePath))}`;
}

const manifest = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as {
  sideEffects?: unknown;
};

test('sideEffects is the array form with package-relative paths', () => {
  expect(Array.isArray(manifest.sideEffects)).toBe(true);
  for (const entry of manifest.sideEffects as string[]) {
    expect(entry.startsWith('./'), `${entry} must be package-relative ('./…')`).toBe(true);
    if (!entry.includes('*')) {
      expect(existsSync(join(PKG_DIR, entry)), `${entry} does not exist`).toBe(true);
    }
  }
});

test('every module-scope side effect in src/ is declared (#1425 class)', () => {
  const declared = new Set(manifest.sideEffects as string[]);
  const sources = listSourceFiles(join(PKG_DIR, 'src'));
  expect(sources.length).toBeGreaterThan(0);

  const undeclared: string[] = [];
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    const requireDeclared = (path: string, why: string): void => {
      if (!declared.has(path)) {
        undeclared.push(`${path} — ${why}`);
      }
    };
    for (const install of findModuleScopeGlobalWrites(text, /^install[A-Z][A-Za-z0-9_$]*\s*\(/)) {
      requireDeclared(declaredForm(file), `module-scope install ${install}`);
    }
    for (const line of findModuleScopeGlobalWrites(text, BARE_IMPORT_PATTERN)) {
      const specifier = line.match(BARE_IMPORT_PATTERN)?.[1];
      if (!specifier) continue;
      const target = declaredForm(normalize(join(dirname(file), specifier)));
      requireDeclared(target, `target of the bare import in ${declaredForm(file)}`);
      requireDeclared(declaredForm(file), 'module containing a bare side-effect import');
    }
  }
  expect(undeclared).toEqual([]);
});
