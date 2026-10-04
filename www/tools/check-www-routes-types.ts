/**
 * check-www-routes-types.ts — derived typecheck gate for www/app/routes.
 *
 * The vite build only transpiles route modules, so no other gate type-checks
 * them (the retired www#check task pinned a hand-maintained __tests__ list and
 * rotted). This gate derives the route entry list from the framework's own
 * route scanner — the same module the dev server and SSG build enumerate with
 * — then type-checks the route modules with the workspace TypeScript compiler
 * under the compiler options the routes are written against
 * (allowImportingTsExtensions, strict, bundler resolution; see the flags
 * passed to tsc below).
 * Derivation means a new route file joins the gate automatically.
 *
 * Fail-closed invariants:
 *   - generated modules are produced by `generate:all`, which both gate:source
 *     (the PR layer) and gate:release (the release train) run first; a missing
 *     one is diagnosed from the compiler's own TS2307
 *     output (see below), so the hint can never go stale;
 *   - a zero-entry scan is an error, never a vacuous pass;
 *   - any compiler failure fails the gate.
 *
 * Usage:
 *   node www/tools/check-www-routes-types.ts
 */

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRoutes } from '../../packages/router/src/vite/internal/ssg/route-scanner.ts';
import process from 'node:process';
import { commandOutput } from '../../tools/repo/node-command.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
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
  process.exit(1);
}

/**
 * A missing generated module surfaces as TS2307. The compiler reports the
 * culprit as an absolute file:// URL (or, rarely, the source-relative
 * specifier); normalize either to an absolute path. When git ignores it, it is a
 * generated module that was never produced — say so, naming generate:all.
 * Returns the repo-relative path when that diagnosis fires, else null.
 */
async function generatedModuleHint(output: string, importerFile: string): Promise<string | null> {
  if (!output.includes('TS2307')) return null;
  for (const match of output.matchAll(/Cannot find module '([^']+)'/g)) {
    const specifier = match[1];
    const abs = specifier.startsWith('file://')
      ? fileURLToPath(specifier)
      : specifier.startsWith('.')
        ? resolve(dirname(importerFile), specifier)
        : null;
    if (!abs) continue;
    const check = await commandOutput('git', {
      args: ['check-ignore', '-q', abs],
      cwd: repoRoot,
      stdin: 'null',
      stdout: 'null',
      stderr: 'null',
    });
    const { code } = check;
    if (code === 0) return relative(repoRoot, abs);
  }
  return null;
}

const tsc = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const check = await commandOutput(process.execPath, {
  args: [
    tsc,
    '--noEmit',
    '--allowImportingTsExtensions',
    '--strict',
    '--skipLibCheck',
    '--target',
    'es2023',
    '--module',
    'esnext',
    '--moduleResolution',
    'bundler',
    '--lib',
    'es2023,dom,dom.iterable',
    '--jsx',
    'react-jsx',
    '--jsxImportSource',
    '@openelement/element',
    '--experimentalDecorators',
    '--noImplicitOverride',
    '--types',
    'node',
    ...files,
  ],
  cwd: repoRoot,
  // Fail closed on a prompt rather than hanging (gate invariant).
  stdin: 'null',
  stdout: 'piped',
  stderr: 'piped',
});
const text = new TextDecoder().decode(check.stdout) + new TextDecoder().decode(check.stderr);
// Preserve the historical pass-through log shape.
await process.stdout.write(new TextEncoder().encode(text));

if (check.code !== 0) {
  // Attribute each diagnostic to its route module for the per-file FAIL log;
  // errors from transitively checked sources still fail the gate.
  const failedRoutes = new Set<string>(
    files.filter((file) => text.includes(relative(repoRoot, file))),
  );
  let failures = 0;
  for (const file of files) {
    if (failedRoutes.has(file)) {
      console.error(`FAIL ${relative(repoRoot, file)}`);
      const hinted = await generatedModuleHint(text, file);
      if (hinted) {
        console.error(
          `hint: ${hinted} is a generated module (gitignored). Run ` +
            '`pnpm --filter @openelement/tools-repo run generate:all` first.',
        );
      }
      failures++;
    } else {
      console.log(`PASS ${relative(repoRoot, file)}`);
    }
  }
  if (failures === 0) {
    // Diagnostics outside the route modules themselves: still fail closed.
    console.error('FAIL routes typecheck (errors in transitively checked sources)');
    failures = 1;
  }
  console.error(`routes typecheck failed: ${failures}/${files.length} route module(s)`);
  process.exit(1);
}
console.log(`routes typecheck ok: ${files.length} route module(s) checked`);
process.exit(0);
