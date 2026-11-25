#!/usr/bin/env node
/**
 * starter-smoke quality gate (TPL-03).
 *
 * The packed-starter setup (setup.ts) creates the fresh scaffold through the
 * packed @openelement/create CLI, rewires its framework dependencies to this
 * checkout's tarballs and installs its own dependency surface. This gate then
 * runs the lifecycle the starter's own scripts promise, in the order a user
 * meets it, against that SAME scaffold:
 *
 *   create     the scaffold at the root setup.ts recorded in
 *              node_modules/.starter-smoke-work-dir — a per-run mkdtemp
 *              directory OUTSIDE the repository, so the starter's own lint
 *              walk sees its files (see ./paths.ts)
 *   typecheck  pnpm run typecheck   tsc --noEmit — the TPL-01 surface: the
 *                                   @types/node pin and the tsconfig
 *                                   `types: ["@openelement/element/css-modules", "node"]` list
 *   lint       pnpm run lint        oxlint at the scaffold's own pin
 *   test       pnpm run test        node --test (request-time API regression test)
 *   build      pnpm run build       oe build — SSR + client + SSG phases
 *   smoke      pnpm run start       oe start + HTTP probes over the wire
 *
 * WHY A STEP INSIDE THE EXISTING BASE-LAYER pack JOB, NOT A NEW JOB (Lead
 * ruling, 2026-10-19): the pack job already pays for pack:dry-run, this
 * scaffold, its install and its Playwright smoke on every push and PR. A
 * second job would re-pay the packed install to prove the same artifact, and a
 * new job ID would churn the qualification contract (job IDs and instance
 * counts pinned by the release workflow's ci-evidence list, CONTRIBUTING,
 * the internal release procedure (not published) and the known-reds ledger) for
 * no additional evidence. The step
 * fails closed: any nonzero lifecycle command or failed HTTP probe exits 1.
 *
 * Prerequisite: `pnpm --dir tests/e2e/starter-smoke run setup` (the CI step
 * order in autoflow-ci.yml's pack job guarantees it).
 *
 * Usage: pnpm --dir tests/e2e/starter-smoke run quality
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';
import { runStep } from '../../lib/qualify-harness/command-run.ts';
import { starterSmokeAppDir } from './paths.ts';

/**
 * The installed scaffold setup.ts produced, at the shared scratch root
 * (./paths.ts): outside the repository, so the starter's own lifecycle scripts
 * behave exactly as they do in a user's project — the pre-fix location under
 * the repo made `pnpm run lint` (bare `oxlint`) find zero files because
 * oxlint's walker honors the repository's ancestor .gitignore (CI run
 * 39262312202).
 *
 * Fail closed with ONE actionable line when no root is recorded: a missing
 * pointer means setup never ran (or its temp root was cleaned), and inventing
 * a fallback root would silently test an empty tree.
 */
function appDirOrFail(): string {
  try {
    return starterSmokeAppDir();
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const appDir = appDirOrFail();

/** [path, marker] probes asserted over the wire once the server answers. */
const PROBES: ReadonlyArray<readonly [string, string]> = [
  ['/', 'Rendered before JavaScript arrives'],
  ['/about', 'Static first, interactive where it counts'],
  ['/api/ping', '"pong":true'],
];

/** How long `oe start` may take to answer the first probe. */
const READY_TIMEOUT_MS = 30_000;

/** Let the OS pick an ephemeral port (parallel CI jobs must not collide). */
function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('listening', () => {
      const address = probe.address() as { port: number };
      probe.close(() => resolvePort(address.port));
    });
    probe.once('error', reject);
    probe.listen({ port: 0, host: '127.0.0.1' });
  });
}

/**
 * The create leg: the scaffold must be the packed CLI's output at the path
 * setup.ts documents. A missing tree is an actionable ordering failure, never
 * a silently skipped leg.
 */
function assertScaffoldPresent(): void {
  const manifestPath = join(appDir, 'package.json');
  if (!existsSync(manifestPath) || !existsSync(join(appDir, 'node_modules'))) {
    throw new Error(
      `[starter-quality] no installed scaffold at ${appDir}. Run ` +
        '`pnpm --dir tests/e2e/starter-smoke run setup` first — the CI step order in ' +
        "autoflow-ci.yml's pack job does exactly that.",
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  for (const script of ['dev', 'build', 'start', 'typecheck', 'lint', 'test']) {
    if (typeof manifest.scripts?.[script] !== 'string') {
      throw new Error(
        `[starter-quality] the scaffold at ${appDir} has no "${script}" script — the ` +
          'generated starter must carry the full lifecycle (create → … → smoke)',
      );
    }
  }
  if (!existsSync(join(appDir, 'tests', 'ping.test.ts'))) {
    throw new Error('[starter-quality] the packed starter did not scaffold tests/ping.test.ts');
  }
  console.log(`[starter-quality] create: scaffold present at ${appDir} (packed CLI output)`);
}

/** Boot the built starter and assert every route over the wire. */
async function smoke(): Promise<void> {
  const port = await reservePort();
  const server = spawn('pnpm', ['run', 'start'], {
    cwd: appDir,
    env: { ...process.env, OPEN_ELEMENT_HOST: '127.0.0.1', OPEN_ELEMENT_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group: `oe start` runs behind pnpm, so the stop below must
    // signal the whole group or an orphaned server keeps the pipes open.
    detached: true,
  });
  let exited = false;
  server.addListener('exit', () => {
    exited = true;
  });
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  void (async () => {
    for await (const chunk of server.stdout!) stdoutChunks.push(chunk as Uint8Array);
  })();
  void (async () => {
    for await (const chunk of server.stderr!) stderrChunks.push(chunk as Uint8Array);
  })();
  const output = (): string =>
    `${Buffer.concat(stdoutChunks.map((chunk) => Buffer.from(chunk))).toString()}\n` +
    Buffer.concat(stderrChunks.map((chunk) => Buffer.from(chunk))).toString();

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline && !exited) {
      try {
        const response = await fetch(`${baseUrl}${PROBES[0]![0]}`);
        await response.text();
        ready = true;
        break;
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 150));
      }
    }
    if (!ready) {
      throw new Error(
        `[starter-quality] "oe start" did not become ready within ${READY_TIMEOUT_MS}ms:\n` +
          output(),
      );
    }
    for (const [path, marker] of PROBES) {
      const response = await fetch(`${baseUrl}${path}`);
      const body = await response.text();
      if (response.status !== 200 || !body.includes(marker)) {
        throw new Error(
          `[starter-quality] smoke probe ${path} failed: status=${response.status}, ` +
            `missing marker ${JSON.stringify(marker)}\n${output()}`,
        );
      }
    }
    console.log(
      `[starter-quality] smoke: oe start served ${PROBES.map(([path]) => path).join(', ')} ` +
        `(port ${port})`,
    );
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.message = `${failure.message}\n${output().slice(-8000)}`;
    throw failure;
  } finally {
    if (!exited) {
      try {
        process.kill(-server.pid!, 'SIGTERM');
      } catch {
        // The process group is already gone.
      }
    }
    await new Promise((resolveSettled) => {
      if (exited) resolveSettled(null);
      else server.addListener('exit', () => resolveSettled(null));
    });
  }
}

async function main(): Promise<void> {
  assertScaffoldPresent();
  await runStep('pnpm', ['run', 'typecheck'], { cwd: appDir });
  console.log('[starter-quality] typecheck: tsc --noEmit passed');
  await runStep('pnpm', ['run', 'lint'], { cwd: appDir });
  console.log('[starter-quality] lint: oxlint passed');
  await runStep('pnpm', ['run', 'test'], { cwd: appDir });
  console.log('[starter-quality] test: node --test passed');
  await runStep('pnpm', ['run', 'build'], { cwd: appDir });
  console.log('[starter-quality] build: oe build passed');
  await smoke();
  console.log(
    '[starter-quality] the fresh-scaffold lifecycle is green (create → typecheck → lint → test → build → smoke)',
  );
}

await main();
