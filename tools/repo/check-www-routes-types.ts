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
 *   - the generated data modules the route graph imports must already exist
 *     (run `deno task --cwd tools/repo generate:site-content-data` and
 *     `generate:api-reference` first; gate:source orders this step after both);
 *   - a zero-entry scan is an error, never a vacuous pass;
 *   - any per-module `deno check` failure fails the gate.
 *
 * Usage:
 *   deno run --allow-read --allow-env --allow-run tools/repo/check-www-routes-types.ts
 */

import { fromFileUrl, join, relative } from '@std/path';
import { scanRoutes } from '../../packages/router/src/vite/internal/ssg/route-scanner.ts';

const repoRoot = fromFileUrl(new URL('../..', import.meta.url));
const routesDir = join(repoRoot, 'www/app/routes');

/** Untracked modules the route import graph needs (generated earlier in gate:source). */
const GENERATED_PREREQUISITES = [
  'www/app/data/_generated-blog-data.ts',
  'www/app/data/_generated-guide-data.ts',
  'www/app/data/_generated-architecture-data.ts',
  'www/app/data/_generated-api-reference.ts',
];

const missing: string[] = [];
for (const path of GENERATED_PREREQUISITES) {
  try {
    await Deno.stat(join(repoRoot, path));
  } catch {
    missing.push(path);
  }
}
if (missing.length > 0) {
  console.error(
    'routes typecheck: generated data modules are missing:\n' +
      missing.map((path) => `  ${path}`).join('\n') +
      '\nrun `deno task --cwd tools/repo generate:site-content-data` and ' +
      '`deno task --cwd tools/repo generate:api-reference` first.',
  );
  Deno.exit(1);
}

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

let failures = 0;
for (const file of files) {
  const child = new Deno.Command(Deno.execPath(), {
    args: ['check', '--config', join(repoRoot, 'deno.json'), file],
    cwd: repoRoot,
    // Fail closed on a permission prompt rather than hanging (gate invariant).
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn();
  const { code } = await child.status;
  if (code === 0) {
    console.log(`PASS ${relative(repoRoot, file)}`);
  } else {
    console.error(`FAIL ${relative(repoRoot, file)} (deno check exited ${code})`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`routes typecheck failed: ${failures}/${files.length} route module(s)`);
  Deno.exit(1);
}
console.log(`routes typecheck ok: ${files.length} route module(s) checked`);
