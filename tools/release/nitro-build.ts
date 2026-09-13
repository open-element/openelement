/**
 * Single first-party driver for every Nitro deploy build (1.0 Alpha baseline).
 *
 * Nitro selects its preset through its own CLI (`--preset`, also honored from
 * the official `NITRO_PRESET` env var), so first-party `nitro.config.ts`
 * files stay static and free of Node-only env reads. The driver runs the
 * pinned Nitro line (single-sourced in `tools/nitro-compatibility.ts`),
 * places the output directory, and optionally prunes a generated public
 * subdirectory (the SaaS build maps `dist/` as public assets for client
 * chunks, so the server bundle subdirectory must not stay publicly served).
 *
 * `--root` is resolved against the caller's working directory: member tasks
 * invoked through `deno task --cwd <app>` pass `--root .`.
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-run --allow-env --allow-net \
 *     tools/release/nitro-build.ts --root . --preset cloudflare_module \
 *     --out .output-workers --prune-public server
 */
import { parseArgs } from '@std/cli/parse-args';
import { exists } from '@std/fs';
import { NITRO_VERSION } from './nitro-compatibility.ts';

const args = parseArgs(Deno.args, {
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
  Deno.exit(2);
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

async function runNitro(): Promise<void> {
  const command = new Deno.Command('deno', {
    args: [
      'run',
      '--node-modules-dir=auto',
      '--allow-read',
      '--allow-write',
      '--allow-run',
      '--allow-env',
      '--allow-net',
      '--allow-sys',
      // Rolldown loads its native binding through FFI under Deno.
      '--allow-ffi',
      `npm:nitro@${NITRO_VERSION}`,
      'build',
      '--dir',
      root,
      '--preset',
      preset,
    ],
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const { code } = await command.output();
  if (code !== 0) Deno.exit(code);
}

await removeIfExists(`${root}/.output`);
await removeIfExists(`${root}/${out}`);
await runNitro();
if (out !== '.output') {
  await Deno.rename(`${root}/.output`, `${root}/${out}`);
}
if (prunePublic) {
  await removeIfExists(`${root}/${out}/public/${prunePublic}`);
}
if (!(await exists(`${root}/${out}/nitro.json`))) {
  console.error(
    `Nitro build produced no manifest at ${root}/${out}/nitro.json`,
  );
  Deno.exit(1);
}
console.log(`nitro build ok: preset=${preset} out=${root}/${out}`);
