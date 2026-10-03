/**
 * Single first-party driver for every Nitro deploy build (1.0 Alpha baseline).
 *
 * Nitro selects its preset through its own CLI (`--preset`, also honored from
 * the official `NITRO_PRESET` env var), so first-party `nitro.config.ts`
 * files stay static and free of Node-only env reads. The driver runs the
 * pinned Nitro line (single-sourced in `tools/release/nitro-compatibility.ts`),
 * places the output directory, and optionally prunes a generated public
 * subdirectory (the SaaS build maps `dist/` as public assets for client
 * chunks, so the server bundle subdirectory must not stay publicly served).
 *
 * `--root` is resolved against the caller's working directory: member tasks
 * invoked through `pnpm --dir <app> run ...` pass `--root .`.
 *
 * Usage:
 *   node tools/release/nitro-build.ts --root . --preset cloudflare_module \
 *     --out .output-workers --prune-public server
 */
import { commandStatus } from '../repo/node-command.ts';
import { rename, rm } from 'node:fs/promises';
import { parseArgs } from '@std/cli/parse-args';
import { exists } from '../lib/std-fs.ts';
import { NITRO_VERSION } from './nitro-compatibility.ts';

const args = parseArgs(process.argv.slice(2), {
  string: ['root', 'preset', 'out', 'prune-public'],
});

const root = args.root ?? '.';
const preset = args.preset ?? '';
const out = args.out ?? '.output';
const prunePublic = args['prune-public'];

if (!preset) {
  console.error(
    'tools/release/nitro-build.ts requires --preset (e.g. node-server, cloudflare_module)',
  );
  process.exit(2);
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
}

async function runNitro(): Promise<void> {
  // The pinned nitro CLI runs through npx on the node host (Rolldown loads
  // its native binding directly; node has no FFI permission concept).
  const { code } = await commandStatus('npx', {
    args: ['--yes', `nitro@${NITRO_VERSION}`, 'build', '--dir', root, '--preset', preset],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (code !== 0) process.exit(code);
}

await removeIfExists(`${root}/.output`);
await removeIfExists(`${root}/${out}`);
await runNitro();
if (out !== '.output') {
  await rename(`${root}/.output`, `${root}/${out}`);
}
if (prunePublic) {
  await removeIfExists(`${root}/${out}/public/${prunePublic}`);
}
if (!(await exists(`${root}/${out}/nitro.json`))) {
  console.error(`Nitro build produced no manifest at ${root}/${out}/nitro.json`);
  process.exit(1);
}
console.log(`nitro build ok: preset=${preset} out=${root}/${out}`);
