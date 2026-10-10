/**
 * Packed-artifact UI-appliance consumer walkthrough (#1558 / KR-10, alpha.13
 * I1 10c) — the leg that should have caught KR-10.
 *
 * The starter leg (consumer-packaged-starter.ts) qualifies the canonical
 * scaffold, and the starter consumes NO package islands at all: `packageIslands`
 * — the feature the @openelement/ui README teaches — had no packed consumer
 * anywhere, so its full-chain breakage (dev SSR `Unknown file extension
 * ".css"`, then client build MISSING_EXPORT) stayed invisible while www, a
 * workspace symlink consumer, stayed green. This leg closes that hole with the
 * same observational rule: qualify the PACKED artifact, never the workspace
 * source.
 *
 * It installs the six pack:dry-run tarballs into a scratch consumer OUTSIDE
 * the repository, scaffolds the canonical starter through the packed
 * @openelement/create CLI, appliances it into a package-island consumer —
 * `@openelement/ui` joins package.json, `packageIslands` joins
 * openelement.config.ts, and a prerendered page renders open-button +
 * open-dialog + open-code-block — and then runs the adopter lifecycle (ADR-0161):
 *
 *   install  the appliance's package.json resolves through a real pnpm install
 *            (the `vite-plus: "catalog:"` devDependency resolves through the
 *            scaffold's own pnpm-workspace.yaml catalog, and the `vite@*`
 *            override points the whole vite tree at the Vite+ core build)
 *   dev      the Vite+ dev server (`vp dev`) boots; /ui-lab SSR-renders the
 *            three UI hosts with their package sheets as DSD
 *            `<style data-oe-static-styles>` text
 *            (no `Unknown file extension ".css"` — the KR-10(a) detector)
 *   typecheck the starter's own `typecheck` script (tsc --noEmit) against the
 *            packed UI declarations
 *   build    real SSG build; must emit dist/ui-lab/index.html carrying the
 *            component sheets, the package island chunks, and the sheets as
 *            real content-addressed .css assets byte-equal to the installed
 *            package's own files — and the emitted client JS must contain no
 *            component CSS text (the KR-10(b) detector: without the style-edge
 *            intake the build fails at MISSING_EXPORT; a silent inline would
 *            fail the zero-inline scan instead)
 *   start    the `start` script (the router's `oe` bin) serves the
 *            appliance page over HTTP
 *
 * Gated in CI via the `consumer:packaged` root task, which chains this leg
 * after the starter leg (so the packed-consumer matrix in autoflow-ci.yml
 * covers both without workflow changes).
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runProcess } from './consumer-packaged-shared.ts';
import { PACKAGE_VERSION, RETAINED_PACKAGE_NAMES } from '../repo/project-constants.ts';
import { readPackages } from '../lib/package-graph.ts';
import { tarballPath } from '../lib/npm-tarball.ts';
import { CREATE_BIN } from './npm-manifest.ts';
import { CREATE_VERSION } from '../../packages/create/src/version.ts';

async function readJson<T = unknown>(path: string | URL): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

const repoRoot = resolve(import.meta.dirname!, '../..');
const BUILD_TIMEOUT_MS = 10 * 60_000;
const NPM_INSTALL_TIMEOUT_MS = 5 * 60_000;
const SERVER_READY_TIMEOUT_MS = 3 * 60_000;

function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
  env?: Record<string, string>,
): Promise<{ success: boolean; output: string }> {
  return runProcess(command, args, cwd, { timeoutMs, env });
}

async function assertConsumerDoesNotResolveIntoRepository(nodeModules: string): Promise<void> {
  const candidates: string[] = [];
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(nodeModules, entry.name);
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      for (const nested of readdirSync(path, { withFileTypes: true })) {
        candidates.push(join(path, nested.name));
      }
    } else {
      candidates.push(path);
    }
  }
  for (const path of candidates) {
    const resolvedReal = await realpath(path).catch(() => path);
    if (resolvedReal === repoRoot || resolvedReal.startsWith(`${repoRoot}/`)) {
      throw new Error(
        `Packed UI consumer resolved a dependency into the repository: ${path} -> ${resolvedReal}`,
      );
    }
  }
}

// Let the OS choose from its ephemeral range (fixed ranges collide with
// parallel CI jobs).
function reservePort(): Promise<number> {
  return new Promise((resolveProbe, reject) => {
    const probe = createServer();
    probe.once('listening', () => {
      const addr = probe.address() as { port: number };
      probe.close(() => resolveProbe(addr.port));
    });
    probe.once('error', reject);
    probe.listen({ port: 0, host: '127.0.0.1' });
  });
}

/**
 * Boot one lifecycle server (dev/start) over the packed output, wait for it to
 * answer HTTP, assert every [path, marker] probe over the wire, then stop it.
 * A green exit alone is not lifecycle evidence (same contract as the starter
 * leg).
 */
async function exerciseServer(
  label: string,
  argsFor: (port: number) => string[],
  cwd: string,
  probes: ReadonlyArray<readonly [string, string]>,
): Promise<void> {
  const port = await reservePort();
  const server = spawn('pnpm', argsFor(port), {
    cwd,
    env: { ...process.env, OPEN_ELEMENT_PORT: String(port), OPEN_ELEMENT_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group: the stop below must signal pnpm's node/sh
    // grandchildren (vite, cli/start) too, not just pnpm — orphaned
    // grandchildren keep the inherited stdio pipes open and the piped-output
    // pumps keep this process from ever exiting the success path (observed on
    // macOS; same teardown contract as the starter harness).
    detached: true,
  });
  let exited = false;
  server.addListener('exit', () => {
    exited = true;
  });
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  void (async () => {
    for await (const chunk of server.stdout!) stdoutChunks.push(chunk);
  })();
  void (async () => {
    for await (const chunk of server.stderr!) stderrChunks.push(chunk);
  })();
  const stdoutText = () =>
    new TextDecoder().decode(Buffer.concat(stdoutChunks.map((c) => Buffer.from(c))));
  const stderrText = () =>
    new TextDecoder().decode(Buffer.concat(stderrChunks.map((c) => Buffer.from(c))));
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    let ready = false;
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
    while (Date.now() < deadline && !exited) {
      try {
        const response = await fetch(`${baseUrl}${probes[0][0]}`);
        await response.text();
        ready = true;
        break;
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 150));
      }
    }
    if (!ready) {
      throw new Error(
        `${label} did not become ready within ${SERVER_READY_TIMEOUT_MS}ms:\n${stdoutText()}\n${stderrText()}`,
      );
    }
    for (const [path, marker] of probes) {
      const response = await fetch(`${baseUrl}${path}`);
      const body = await response.text();
      if (response.status !== 200 || !body.includes(marker)) {
        throw new Error(
          `${label} probe ${path} failed: status=${response.status}, missing marker ${marker}`,
        );
      }
    }
    console.log(`${label} passed (port ${port}).`);
  } catch (error) {
    // Preserve the server-side cause of a failed probe (the dev leg's KR-10
    // regression surfaces as SSR output, not as an exit code).
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.message = `${failure.message}\n${stdoutText().slice(-8000)}\n${stderrText().slice(-8000)}`;
    throw failure;
  } finally {
    if (!exited) {
      try {
        // Negative pid: signal the whole process group (see detached above).
        process.kill(-server.pid!, 'SIGTERM');
      } catch {
        // process group already gone
      }
    }
    await new Promise((resolveSettled) => {
      if (exited) resolveSettled(null);
      else server.addListener('exit', () => resolveSettled(null));
    });
  }
}

// ─── The appliance sources ──────────────────────────────────────────────────
//
// The prerendered page renders all three exercised UI components by tag; the
// compiled page module (components/ui-lab.tsx) references them, which is the
// reachability evidence the client build's island admission consumes. The
// sheet markers below are the authored bytes of the installed package's own
// files (not copies): the assertions read them back from the installed tree.

const UI_LAB_COMPONENT = `/**
 * UI appliance page for the packed-consumer gate (#1558/KR-10): the three
 * @openelement/ui components the package README's packageIslands recipe is
 * supposed to deliver.
 */
import { element, OpenElement } from '@openelement/element';
import '@openelement/ui/open-button';
import '@openelement/ui/open-dialog';
import '@openelement/ui/open-code-block';

@element('ui-lab', { root: 'light' })
export default class UiLab extends OpenElement {
  render() {
    return (
      <div class='ui-lab'>
        <h1>Packed UI appliance</h1>
        <open-button variant='primary'>packed button</open-button>
        <open-dialog>
          <span slot='label'>packed dialog</span>
          <p>dialog body from the packed tarball</p>
        </open-dialog>
        <open-code-block>
          <pre><code>const packed = true;</code></pre>
        </open-code-block>
      </div>
    );
  }
}
`;

const UI_LAB_ROUTE = `import { definePage } from '@openelement/router';
import UiLab from '../components/ui-lab.tsx';

export default definePage(UiLab, {
  head: { title: 'Packed UI appliance' },
});
`;

/** Anchors the appliance writes rely on; a template drift fails loudly here. */
const CONFIG_ANCHOR = 'export default defineConfig({';

const UI_SHEET_MARKERS = ['.control:focus-visible', '.btn[hidden]'] as const;

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function main(): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 'openelement-packaged-ui-app-'));
  try {
    const npmEnv = { NPM_CONFIG_CACHE: join(tmp, '.npm-cache') };
    const workspacePackages = await readPackages();
    const tarballFor = (name: string): string => {
      const pkg = workspacePackages.find((candidate) => candidate.name === name);
      if (!pkg) throw new Error(`Retained package missing from workspace graph: ${name}`);
      return join(repoRoot, tarballPath(pkg));
    };
    const tarballs = RETAINED_PACKAGE_NAMES.map(tarballFor);
    for (const tarball of tarballs) {
      if (!existsSync(tarball)) {
        throw new Error(
          `Missing packed release artifact: ${tarball} (run \`pnpm --dir tools/release run pack:dry-run\` first)`,
        );
      }
    }
    const uiTarball = tarballFor('@openelement/ui');
    const routerTarball = tarballFor('@openelement/router');
    const elementTarball = tarballFor('@openelement/element');

    const install = await run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--fetch-timeout=30000',
        ...tarballs,
      ],
      tmp,
      NPM_INSTALL_TIMEOUT_MS,
      npmEnv,
    );
    if (!install.success) throw new Error(`Packed package installation failed:\n${install.output}`);

    const createBinName = Object.keys(CREATE_BIN).sort()[0];
    const create = await run(
      'npm',
      ['exec', createBinName, '--', 'starter', '--no-install'],
      tmp,
      NPM_INSTALL_TIMEOUT_MS,
      npmEnv,
    );
    if (!create.success) throw new Error(`Packed starter generation failed:\n${create.output}`);
    if (!create.output.includes(`@openelement/create ${CREATE_VERSION}`)) {
      throw new Error(
        `Packed create CLI handoff box does not name its version ` +
          `(@openelement/create ${CREATE_VERSION}):\n${create.output}`,
      );
    }

    // --- Appliance 1: the ui dependency + the framework declaration ---
    const starter = join(tmp, 'starter');
    const manifestPath = join(starter, 'package.json');
    const manifest = (await readJson(manifestPath)) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    // The Vite+ lifecycle renames `check` to `typecheck` (`tsc --noEmit`);
    // `fmt`/`lint` exist too but this appliance does not drive them.
    for (const script of ['dev', 'typecheck', 'build', 'start']) {
      if (typeof manifest.scripts[script] !== 'string') {
        throw new Error(`Packed starter is missing the '${script}' script.`);
      }
    }
    manifest.dependencies['@openelement/router'] = pathToFileURL(routerTarball).href;
    manifest.dependencies['@openelement/element'] = pathToFileURL(elementTarball).href;
    // The appliance's own dependency: the package the README's recipe teaches.
    manifest.dependencies['@openelement/ui'] = pathToFileURL(uiTarball).href;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    // The scaffold's own pnpm-workspace.yaml is load-bearing for the Vite+
    // form: its catalog resolves `vite-plus: "catalog:"` in the manifest and
    // the `vite@*: "catalog:"` override points every peer's vite at the Vite+
    // core build. Assert the packed scaffold carries it (same fragments the
    // starter leg and the starter-smoke setup anchor) BEFORE this gate
    // touches the file. The read is itself the existence check
    // (read-and-expect-ENOENT, no existsSync shape probe): a missing file
    // fails the gate right here without opening a check-then-write race
    // window on the path below.
    const workspacePath = join(starter, 'pnpm-workspace.yaml');
    let workspaceYaml: string;
    try {
      workspaceYaml = await readFile(workspacePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new Error(
          'Packed starter is missing pnpm-workspace.yaml (the Vite+ catalog/override form ships it)',
        );
      }
      throw error;
    }
    for (const fragment of [
      'npm:@voidzero-dev/vite-plus-core@1.1.0',
      'vite-plus: 1.1.0',
      'vite@*: "catalog:"',
    ]) {
      if (!workspaceYaml.includes(fragment)) {
        throw new Error(
          `Packed starter pnpm-workspace.yaml is not the Vite+ form: missing ${fragment}`,
        );
      }
    }
    // Every framework package resolves to this checkout's tarballs (the #1557
    // transitive workspace pins), so the legs qualify the packed artifacts
    // end-to-end (same overrides contract as the starter leg). The file://
    // pins fold INTO the scaffold's own `overrides:` block so every shipped
    // entry stays verbatim: rebuilding the file would drop the catalog and
    // leave `vite-plus: "catalog:"` unresolvable at install (same fold the
    // starter leg performs).
    const frameworkTarballs: Array<[string, string]> = [
      ['@openelement/protocol', tarballFor('@openelement/protocol')],
      ['@openelement/element', elementTarball],
      ['@openelement/compiler', tarballFor('@openelement/compiler')],
      ['@openelement/router', routerTarball],
      ['@openelement/ui', uiTarball],
    ];
    const overridesKey = /^overrides:\n/m;
    // One deterministic pass over the in-memory read (same fold shape as the
    // starter leg): transform first, then validate the transformation against
    // the same string it was computed from (a no-op replace is exactly the
    // missing-overrides case), then write once — no shape check precedes the
    // write, so the check-then-write TOCTOU window CodeQL flags
    // (js/file-system-race) cannot open here.
    const foldedYaml = workspaceYaml.replace(
      overridesKey,
      `overrides:\n${frameworkTarballs
        .map(([name, path]) => `  "${name}": ${pathToFileURL(path).href}`)
        .join('\n')}\n`,
    );
    if (foldedYaml === workspaceYaml) {
      throw new Error(
        'Packed starter pnpm-workspace.yaml has no overrides block to extend; ' +
          'the Vite+ scaffold form changed under this gate',
      );
    }
    await writeFile(workspacePath, foldedYaml);

    const configPath = join(starter, 'openelement.config.ts');
    const config = await readFile(configPath, 'utf8');
    if (!config.includes(CONFIG_ANCHOR)) {
      throw new Error(
        `Packed starter openelement.config.ts lost its "${CONFIG_ANCHOR}" anchor — ` +
          'the appliance cannot declare packageIslands (file):\n' +
          config.slice(0, 500),
      );
    }
    await writeFile(
      configPath,
      config.replace(CONFIG_ANCHOR, `${CONFIG_ANCHOR}\n  packageIslands: ['@openelement/ui'],`),
    );

    await writeFile(join(starter, 'app', 'components', 'ui-lab.tsx'), UI_LAB_COMPONENT);
    await writeFile(join(starter, 'app', 'routes', 'ui-lab.tsx'), UI_LAB_ROUTE);

    const installStarter = await run(
      'pnpm',
      ['install', '--no-frozen-lockfile'],
      starter,
      NPM_INSTALL_TIMEOUT_MS,
    );
    if (!installStarter.success) {
      throw new Error(`UI-appliance dependency install failed:\n${installStarter.output}`);
    }
    await assertConsumerDoesNotResolveIntoRepository(join(tmp, 'node_modules'));
    await assertConsumerDoesNotResolveIntoRepository(join(starter, 'node_modules'));

    // Read the installed package's own sheet bytes: the emitted assets are
    // compared against THESE bytes (the package the appliance installed), never
    // against a repository copy.
    const starterRequire = createRequire(join(starter, 'package.json'));
    const uiModulePath = starterRequire.resolve('@openelement/ui/open-button');
    const uiSheetPath = uiModulePath.replace(/\.js$/, '.css');
    const uiSheet = await readFile(uiSheetPath, 'utf8');
    if (!uiSheet.includes('.btn[hidden]')) {
      throw new Error(
        `Installed @openelement/ui open-button sheet at ${uiSheetPath} lost its authored ` +
          'markers — the packed package is not the artifact this gate expects',
      );
    }

    // Lifecycle leg 1 — dev: the packed adapter must boot the real vite dev
    // server (the Vite+ core, through the starter's `vp dev` script) and
    // SSR-render the appliance page over HTTP. Without the
    // packageIslands → ssr.noExternal wiring (KR-10(a)) this leg dies with
    // `Unknown file extension ".css"` from Node's ESM loader; without the dev
    // style-edge intake it dies at the `.css` module's default export. The DSD
    // marker proves the component sheets reached the rendered shadow roots.
    await exerciseServer(
      'Packed UI appliance dev server',
      (port) => ['run', 'dev', '--port', String(port), '--host', '127.0.0.1', '--strictPort'],
      starter,
      [
        ['/', 'Rendered before JavaScript arrives'],
        ['/ui-lab', '<open-button'],
        ['/ui-lab', '<open-dialog'],
        ['/ui-lab', '<open-code-block'],
        ['/ui-lab', 'data-oe-static-styles'],
        ['/ui-lab', '.control {'],
      ],
    );

    // Lifecycle leg 2 — typecheck (the check→typecheck rename of the Vite+
    // lifecycle): the appliance's own `tsc --noEmit` against the packed UI
    // declarations.
    const typecheck = await run('pnpm', ['run', 'typecheck'], starter);
    if (!typecheck.success) {
      throw new Error(`Packed UI appliance typecheck failed:\n${typecheck.output}`);
    }
    console.log(`Packed UI appliance typecheck passed for ${PACKAGE_VERSION}.`);

    // Lifecycle leg 3 — build: the packed adapter must run the real SSG build.
    // This is the KR-10(b) detector: the package island's sheet imports reach
    // the bundler as module edges, and without the style-edge intake the build
    // fails at MISSING_EXPORT (`"default" is not exported by
    // ".../open-button.css"`).
    const build = await run('pnpm', ['run', 'build'], starter, BUILD_TIMEOUT_MS);
    if (!build.success) throw new Error(`Packed UI appliance SSG build failed:\n${build.output}`);

    const serverEntry = join(starter, 'dist', 'server', 'index.js');
    if (!existsSync(serverEntry)) {
      throw new Error(
        `Packed UI appliance build emitted no request-time server entry: ${serverEntry}`,
      );
    }

    // The prerendered appliance page carries the three hosts and the package
    // sheets as DSD text (the SSR half of the style protocol).
    const uiLabHtml = join(starter, 'dist', 'ui-lab', 'index.html');
    if (!existsSync(uiLabHtml)) {
      throw new Error('Packed UI appliance build did not prerender the /ui-lab page');
    }
    const uiLabBody = await readFile(uiLabHtml, 'utf8');
    for (const marker of ['<open-button', '<open-dialog', '<open-code-block', '.control {']) {
      if (!uiLabBody.includes(marker)) {
        throw new Error(`Packed UI appliance dist/ui-lab/index.html missing marker: ${marker}`);
      }
    }

    // The sheets left the JS: each installed sheet's exact bytes exist as a
    // content-addressed client asset (the client half of the protocol).
    const clientAssetsDir = join(starter, 'dist', 'client', 'assets');
    const emittedSheets = existsSync(clientAssetsDir)
      ? (await readdir(clientAssetsDir)).filter((name) => name.endsWith('.css'))
      : [];
    if (emittedSheets.length === 0) {
      throw new Error(
        `Packed UI appliance build emitted no client css assets under ${clientAssetsDir}`,
      );
    }
    const emittedHashes = new Set(
      await Promise.all(
        emittedSheets.map(async (name) =>
          sha256(await readFile(join(clientAssetsDir, name), 'utf8')),
        ),
      ),
    );
    if (!emittedHashes.has(sha256(uiSheet))) {
      throw new Error(
        'Packed UI appliance build emitted no client css asset byte-equal to the installed ' +
          `@openelement/ui open-button sheet (${uiSheetPath}) — the package sheet did not ` +
          'travel the style asset protocol',
      );
    }

    // Package island attribution: the client build's identity join produced a
    // chunk per exercised component (fail-closed in the build; asserted here
    // as the consumer form).
    const islandsDir = join(starter, 'dist', 'client', 'islands');
    const islandFiles = existsSync(islandsDir) ? await readdir(islandsDir) : [];
    for (const tag of ['open-button', 'open-dialog', 'open-code-block']) {
      if (!islandFiles.some((name) => name.startsWith(`island-${tag}`))) {
        throw new Error(
          `Packed UI appliance client build emitted no island-${tag} chunk ` +
            `(islands: ${islandFiles.join(', ')})`,
        );
      }
    }

    // Zero-inline scan: no emitted client JS may carry component CSS text — a
    // silent inline would deliver the styles as JS bytes instead of assets.
    for (const file of islandFiles.filter((name) => name.endsWith('.js'))) {
      const source = await readFile(join(islandsDir, file), 'utf8');
      for (const marker of UI_SHEET_MARKERS) {
        if (source.includes(marker)) {
          throw new Error(
            `Packed UI appliance island chunk ${file} carries component CSS text ` +
              `("${marker}") — the sheets must ship as emitted .css assets, not JS bytes`,
          );
        }
      }
    }
    console.log(`Packed UI appliance SSG build passed for ${PACKAGE_VERSION}.`);

    // Lifecycle leg 4 — start: serve the built output through the documented
    // local entry (cli/start) and assert the appliance page over HTTP.
    await exerciseServer('Packed UI appliance start server', () => ['run', 'start'], starter, [
      ['/', 'Rendered before JavaScript arrives'],
      ['/ui-lab', '<open-button'],
      ['/ui-lab', '.control {'],
    ]);
  } finally {
    await rm(tmp, { recursive: true }).catch(() => undefined);
  }
}

if (import.meta.main) await main();
