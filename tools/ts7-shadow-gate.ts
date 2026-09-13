/**
 * TypeScript 7 shadow gate (1.0 Alpha convergence — "TypeScript 7: split
 * decision"). An INDEPENDENT SHADOW GATE, not a required gate: it is wired
 * into CI as a non-blocking job and is deliberately absent from
 * gate:ci/gate:release. It graduates to required only after a complete
 * matching matrix against the current checker.
 *
 * The layered TypeScript strategy this gate enforces/observes:
 * - Deno source keeps using Deno's supported checker (deno task typecheck).
 * - The Element compiler and every other AST consumer keep using the classic
 *   TypeScript compiler API, resolved through the import-map name
 *   "typescript" -> npm:typescript@6.0.3. The packed Element dependency owns
 *   that classic compiler API; the disposable consumer root owns TS7 only.
 * - The TS7 tsc CLI is exercised here, and only here, against the Node/npm
 *   consumer contract: the pack:dry-run tarballs installed into a disposable
 *   consumer OUTSIDE the workspace (same observational rule as
 *   tools/consumer-packaged-shared.ts — qualify the packed artifact, never the
 *   workspace source).
 *
 * Cells (every cell prints PASS/FAIL; any TS7 checker error fails the run —
 * a shadow gate that always passes is not evidence):
 *
 *   pack                fresh pack:dry-run tarballs for all three packages
 *   manifest            packed @openelement/element package.json pins its own
 *                       classic TypeScript 6 dependency
 *   install             hermetic npm install of the tarballs plus pinned
 *                       typescript@7 in the temp-consumer root
 *   typecheck           TS7 tsc --noEmit over a consumer program importing
 *                       the documented public entry points of element and
 *                       the router Route Mode set
 *   declaration-emit    TS7 tsc --emitDeclarationOnly over a program that
 *                       walks the same public subpaths (exercises the packed
 *                       .d.ts graph); emitted declarations must exist
 *   build-mode          TS7 tsc -b over the composite declaration project
 *   baseline-compare    the same typecheck/declaration-emit runs under the
 *                       packed TS6 baseline; outcomes are compared and
 *                       REPORTED. A TS7 failure is a gate failure; a
 *                       baseline/TS7 divergence is printed in the summary.
 *
 * Both tsc versions are exact pins in the temp consumer's package.json so
 * the matrix is reproducible locally and in CI.
 */

import { existsSync } from '@std/fs';
import { join, resolve } from '@std/path';
import { readPackages } from './lib/package-graph.ts';
import { tarballPath } from './lib/npm-tarball.ts';

const repoRoot = resolve(import.meta.dirname!, '..');

// Exact pins: the shadow checker and the classic-API baseline. Bump
// deliberately; a floating shadow gate is not reproducible evidence.
const TS7_VERSION = '7.0.2';
const TS6_VERSION = '6.0.3';

const PACK_TIMEOUT_MS = 15 * 60_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const TSC_TIMEOUT_MS = 5 * 60_000;

interface CellOutcome {
  ok: boolean;
  detail: string;
}

const outcomes = new Map<string, CellOutcome>();
const notes: string[] = [];

function record(cell: string, outcome: CellOutcome): void {
  outcomes.set(cell, outcome);
  const short = outcome.detail.split('\n')[0].slice(0, 240);
  console.log(`${outcome.ok ? 'PASS' : 'FAIL'} ${cell}${short ? ` — ${short}` : ''}`);
  if (!outcome.ok && outcome.detail.includes('\n')) console.error(outcome.detail);
}

async function cell(
  name: string,
  prerequisites: string[],
  fn: () => Promise<string | undefined> | string | undefined,
): Promise<void> {
  const blocker = prerequisites.find((p) => !outcomes.get(p)?.ok);
  if (blocker) {
    record(name, { ok: false, detail: `blocked: ${blocker} failed` });
    return;
  }
  try {
    record(name, { ok: true, detail: (await fn()) ?? '' });
  } catch (error) {
    record(name, { ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

async function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<{ success: boolean; output: string }> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const result = await new Deno.Command(command, {
      args,
      cwd,
      stdout: 'piped',
      stderr: 'piped',
      signal: controller.signal,
      env,
    }).output();
    const output = new TextDecoder().decode(result.stdout) +
      new TextDecoder().decode(result.stderr);
    if (timedOut) {
      return {
        success: false,
        output: `Timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}\n${output}`,
      };
    }
    return { success: result.success, output };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Consumer sources ───────────────────────────────────────────────────────
//
// Namespace imports keep the matrix about module resolution and declaration
// health of the documented public entry points, not about any single export.
// Router set is the Route Mode surface only (index/http/router/router-client/
// document): no renderer entry, matching the two-product distribution model.

const ELEMENT_ENTRIES = [
  '@openelement/element',
  '@openelement/element/jsx-runtime',
  '@openelement/element/jsx-dev-runtime',
  '@openelement/element/sanitize',
  '@openelement/element/authoring',
  '@openelement/element/html',
  '@openelement/element/logger',
  '@openelement/element/build-utils',
  '@openelement/element/compiler',
  '@openelement/element/vite',
];

const ROUTER_ROUTE_MODE_ENTRIES = [
  '@openelement/router',
  '@openelement/router/http',
  '@openelement/router/router',
  '@openelement/router/router/client',
  '@openelement/router/document',
];

function consumerProgram(): string {
  const lines: string[] = [];
  const all = [...ELEMENT_ENTRIES, ...ROUTER_ROUTE_MODE_ENTRIES];
  all.forEach((specifier, index) => {
    lines.push(`import * as entry${index} from '${specifier}';`);
  });
  lines.push(
    `const entries = [${all.map((_, index) => `entry${index}`).join(', ')}];`,
    'for (const entry of entries) {',
    "  if (typeof entry !== 'object' && typeof entry !== 'function') {",
    "    throw new Error('entry point did not resolve to a module namespace');",
    '  }',
    '}',
    'export const entryCount = entries.length;',
  );
  return lines.join('\n') + '\n';
}

const TSCONFIG_BASE = {
  target: 'ES2022',
  module: 'NodeNext',
  moduleResolution: 'NodeNext',
  lib: ['ES2022', 'DOM', 'DOM.Iterable'],
  strict: true,
  skipLibCheck: true,
  jsx: 'react-jsx',
  jsxImportSource: '@openelement/element',
};

// ─── Gate ───────────────────────────────────────────────────────────────────

const packages = await readPackages();
const tarballs = new Map(packages.map((pkg) => [pkg.name, join(repoRoot, tarballPath(pkg))]));

const tmp = await Deno.makeTempDir({ prefix: 'openelement-ts7-shadow-' });
try {
  await cell('pack', [], async () => {
    const packed = await run(
      Deno.execPath(),
      ['task', 'pack:dry-run'],
      repoRoot,
      PACK_TIMEOUT_MS,
    );
    if (!packed.success) throw new Error(`pack:dry-run failed:\n${packed.output}`);
    for (const [name, tar] of tarballs) {
      if (!existsSync(tar)) throw new Error(`Missing ${tar} for ${name} after pack:dry-run`);
    }
    return `${tarballs.size} fresh tarballs`;
  });

  await cell('manifest', ['pack'], async () => {
    const elementTar = tarballs.get('@openelement/element');
    if (!elementTar) throw new Error('@openelement/element is missing from the package graph');
    const shown = await run(
      'tar',
      ['-xzOf', elementTar, 'package/package.json'],
      repoRoot,
      30_000,
    );
    if (!shown.success) throw new Error(`tar failed:\n${shown.output}`);
    const pkgJson = JSON.parse(shown.output) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const deps = { ...pkgJson.peerDependencies, ...pkgJson.dependencies };
    if (deps['typescript'] !== TS6_VERSION) {
      throw new Error(
        'packed @openelement/element must pin its classic TypeScript dependency to ' +
          `${TS6_VERSION}; ` +
          `dependencies: ${JSON.stringify(deps)}`,
      );
    }
    if (deps['@typescript/typescript6'] !== undefined) {
      throw new Error(
        'packed @openelement/element must not retain the deprecated @typescript/typescript6 wrapper',
      );
    }
    return `@openelement/element tarball dependency: typescript@${TS6_VERSION}`;
  });

  await cell('install', ['manifest'], async () => {
    const dependencies: Record<string, string> = {};
    for (const [name, tar] of tarballs) dependencies[name] = `file:${tar}`;
    await Deno.writeTextFile(
      join(tmp, 'package.json'),
      JSON.stringify(
        {
          name: 'openelement-ts7-shadow-consumer',
          private: true,
          type: 'module',
          dependencies,
          devDependencies: {
            typescript: TS7_VERSION,
          },
        },
        null,
        2,
      ),
    );
    await Deno.writeTextFile(join(tmp, 'main.ts'), consumerProgram());
    await Deno.writeTextFile(
      join(tmp, 'tsconfig.check.json'),
      JSON.stringify(
        { compilerOptions: { ...TSCONFIG_BASE, noEmit: true }, include: ['main.ts'] },
        null,
        2,
      ),
    );
    await Deno.writeTextFile(
      join(tmp, 'tsconfig.emit.json'),
      JSON.stringify(
        {
          compilerOptions: {
            ...TSCONFIG_BASE,
            composite: true,
            declaration: true,
            emitDeclarationOnly: true,
            outDir: '.ts7-emit',
            tsBuildInfoFile: '.ts7-emit/.tsbuildinfo',
          },
          include: ['main.ts'],
        },
        null,
        2,
      ),
    );
    const installed = await run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--fetch-timeout=30000'],
      tmp,
      INSTALL_TIMEOUT_MS,
      { NPM_CONFIG_CACHE: join(tmp, '.npm-cache') },
    );
    if (!installed.success) throw new Error(`npm install failed:\n${installed.output}`);
    // Invoke the launchers by explicit package path, never node_modules/.bin:
    // the consumer root owns TS7 while Element owns its pinned TS6 dependency.
    for (
      const required of [
        'node_modules/typescript/bin/tsc',
        'node_modules/@openelement/element/node_modules/typescript/bin/tsc',
        'node_modules/@openelement/element',
        'node_modules/@openelement/router',
        'node_modules/@openelement/create',
      ]
    ) {
      if (!existsSync(join(tmp, required))) {
        throw new Error(`consumer install incomplete: missing ${required}`);
      }
    }
    const version = await run(
      'node',
      [join(tmp, 'node_modules', 'typescript', 'bin', 'tsc'), '--version'],
      tmp,
      60_000,
    );
    if (!version.success || !version.output.includes(`Version ${TS7_VERSION}`)) {
      throw new Error(
        `TS7 tsc did not report Version ${TS7_VERSION}:\n${version.output}`,
      );
    }
    return `consumer installed; tsc reports TS ${TS7_VERSION}, Element-owned baseline TS ${TS6_VERSION}`;
  });

  interface TscRun {
    success: boolean;
    output: string;
  }

  const TSC_LAUNCHERS = {
    tsc: join(tmp, 'node_modules', 'typescript', 'bin', 'tsc'),
    tsc6: join(
      tmp,
      'node_modules',
      '@openelement',
      'element',
      'node_modules',
      'typescript',
      'bin',
      'tsc',
    ),
  } as const;
  const tsc = (bin: keyof typeof TSC_LAUNCHERS, args: string[]): Promise<TscRun> =>
    run('node', [TSC_LAUNCHERS[bin], ...args], tmp, TSC_TIMEOUT_MS);

  // Diagnostics carry absolute temp paths; normalize before comparing the
  // two checkers so only real diagnostic differences surface.
  const normalize = (output: string): string =>
    output.replaceAll(tmp, '<consumer>').split('\n').filter((line) => line.trim() !== '').sort()
      .join('\n');

  const ts7Check: TscRun = await tsc('tsc', ['-p', 'tsconfig.check.json']);
  await cell('typecheck', ['install'], () => {
    if (!ts7Check.success) {
      throw new Error(`TS7 tsc --noEmit reported checker errors:\n${ts7Check.output}`);
    }
    return 'TS7 tsc --noEmit clean over element + router Route Mode entry points';
  });

  const emitOut = join(tmp, '.ts7-emit');
  const ts7Emit: TscRun = await tsc('tsc', ['-p', 'tsconfig.emit.json']);
  await cell('declaration-emit', ['install'], () => {
    if (!ts7Emit.success) {
      throw new Error(`TS7 tsc --emitDeclarationOnly failed:\n${ts7Emit.output}`);
    }
    if (!existsSync(join(emitOut, 'main.d.ts'))) {
      throw new Error('TS7 declaration emit produced no .ts7-emit/main.d.ts');
    }
    return 'TS7 declaration emit clean against the packed .d.ts graph';
  });

  await cell('build-mode', ['declaration-emit'], async () => {
    const built = await tsc('tsc', ['-b', 'tsconfig.emit.json', '--force']);
    if (!built.success) throw new Error(`TS7 tsc -b failed:\n${built.output}`);
    return 'TS7 tsc -b (composite) clean';
  });

  await cell('baseline-compare', ['typecheck', 'declaration-emit'], async () => {
    const ts6Check = await tsc('tsc6', ['-p', 'tsconfig.check.json']);
    const ts6Emit = await tsc('tsc6', ['-p', 'tsconfig.emit.json']);
    const legs: string[] = [];
    let divergence = false;
    for (
      const [label, ts7, ts6] of [
        ['typecheck', ts7Check, ts6Check],
        ['declaration-emit', ts7Emit, ts6Emit],
      ] as const
    ) {
      if (ts7.success !== ts6.success || normalize(ts7.output) !== normalize(ts6.output)) {
        divergence = true;
        legs.push(
          `${label}: DIVERGENCE (ts7 ok=${ts7.success}, ts6 ok=${ts6.success})\n` +
            `--- ts7 ---\n${ts7.output}\n--- ts6 baseline ---\n${ts6.output}`,
        );
      } else {
        legs.push(`${label}: ts7 == ts6 baseline`);
      }
    }
    if (divergence) {
      // TS7 failing where the baseline passes is already a hard FAIL in the
      // typecheck/declaration-emit cells. Reaching here with a divergence
      // means the baseline disagrees in TS7's favor or in diagnostics only —
      // report it; the matrix owner decides whether it blocks graduation.
      notes.push(`baseline divergence:\n${legs.join('\n')}`);
      return `divergence reported (see summary); ts6 ok=${ts6Check.success}/${ts6Emit.success}`;
    }
    return legs.join('; ');
  });
} finally {
  // Summary first, cleanup after: the matrix line is the evidence CI keeps.
  const failed = [...outcomes.entries()].filter(([, outcome]) => !outcome.ok);
  console.log('\nTS7 shadow gate summary:');
  for (const [name, outcome] of outcomes) {
    console.log(`  ${outcome.ok ? 'PASS' : 'FAIL'} ${name}`);
  }
  for (const note of notes) console.log(`  note: ${note}`);
  console.log(
    failed.length === 0
      ? `TS7 shadow gate PASS — typescript@${TS7_VERSION} CLI vs Element-owned typescript@${TS6_VERSION} baseline (shadow only; not a required gate).`
      : `TS7 shadow gate FAIL — ${failed.map(([name]) => name).join(', ')}`,
  );
  await Deno.remove(tmp, { recursive: true }).catch(() => undefined);
  if (failed.length > 0) Deno.exit(1);
}
