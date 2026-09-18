/**
 * check-www-routes-types.ts — derived typecheck gate for www/app/routes.
 *
 * The vite build only transpiles route modules, so no other gate type-checks
 * them (the retired www#check task pinned a hand-maintained __tests__ list and
 * rotted). This gate derives the route entry list from the framework's own
 * route scanner — the same module the dev server and SSG build enumerate with
 * — then runs `deno check` per route module against the root config (which
 * owns the jsxImportSource/strict compiler options the routes are written
 * against). Derivation means a new route file joins the gate automatically.
 *
 * Fail-closed invariants:
 *   - generated modules are produced by `generate:all`, which `gate:source`
 *     runs first; a missing one is diagnosed from the compiler's own TS2307
 *     output (see below), so the hint can never go stale;
 *   - a zero-entry scan is an error, never a vacuous pass;
 *   - any per-module `deno check` failure fails the gate.
 *
 * Usage:
 *   deno run --allow-read --allow-env --allow-run tools/repo/check-www-routes-types.ts
 */

import { dirname, fromFileUrl, join, relative, resolve } from '@std/path';
import { scanRoutes } from '../../packages/router/src/vite/internal/ssg/route-scanner.ts';

const repoRoot = fromFileUrl(new URL('../..', import.meta.url));
const routesDir = join(repoRoot, 'www/app/routes');

const entries = await scanRoutes(routesDir);
const files = [...new Set(entries.map((entry) => join(routesDir, entry.filePath)))]
  .filter((file) => /\.(ts|tsx|js|jsx)$/.test(file))
  .sort();

if (files.length === 0) {
  console.error(
    `routes typecheck: route scan of ${routesDir} returned zero entries — ` +
      'the scanner or the routes directory is broken; refusing to vacuously pass.',
  );
  Deno.exit(1);
}

/**
 * A missing generated module surfaces as TS2307. Deno reports the culprit
 * as an absolute file:// URL (or, rarely, the source-relative specifier);
 * normalize either to an absolute path. When git ignores it, it is a
 * generated module that was never produced — say so, naming generate:all.
 * Returns the repo-relative path when that diagnosis fires, else null.
 */
async function generatedModuleHint(
  output: string,
  importerFile: string,
): Promise<string | null> {
  if (!output.includes('TS2307')) return null;
  for (const match of output.matchAll(/Cannot find module '([^']+)'/g)) {
    const specifier = match[1];
    const abs = specifier.startsWith('file://')
      ? fromFileUrl(specifier)
      : specifier.startsWith('.')
      ? resolve(dirname(importerFile), specifier)
      : null;
    if (!abs) continue;
    const check = new Deno.Command('git', {
      args: ['check-ignore', '-q', abs],
      cwd: repoRoot,
      stdin: 'null',
      stdout: 'null',
      stderr: 'null',
    });
    const { code } = await check.output();
    if (code === 0) return relative(repoRoot, abs);
  }
  return null;
}

let failures = 0;
for (const file of files) {
  const child = new Deno.Command(Deno.execPath(), {
    args: ['check', '--config', join(repoRoot, 'deno.json'), file],
    cwd: repoRoot,
    // Fail closed on a permission prompt rather than hanging (gate invariant).
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn();
  const { code, stdout, stderr } = await child.output();
  const text = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);
  // Preserve the historical pass-through log shape.
  await Deno.stdout.write(new TextEncoder().encode(text));
  if (code === 0) {
    console.log(`PASS ${relative(repoRoot, file)}`);
  } else {
    console.error(`FAIL ${relative(repoRoot, file)} (deno check exited ${code})`);
    const hinted = await generatedModuleHint(text, file);
    if (hinted) {
      console.error(
        `hint: ${hinted} is a generated module (gitignored). Run ` +
          '`deno task --cwd tools/repo generate:all` first.',
      );
    }
    failures++;
  }
}

if (failures > 0) {
  console.error(`routes typecheck failed: ${failures}/${files.length} route module(s)`);
  Deno.exit(1);
}
console.log(`routes typecheck ok: ${files.length} route module(s) checked`);
