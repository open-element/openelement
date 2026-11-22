/**
 * The external-consumer diagnostics acceptance (#1612).
 *
 * A consumer app OUTSIDE this repository — node_modules laid out the way a
 * real install is (the layout `external-consumer-build.test.ts` and
 * `package-import-admission-probe.test.ts` establish), the CLI a plain Node
 * child process — fails its build on an authored mistake, and the consumer
 * harness READS the machine-readable envelope instead of grepping logs:
 *
 *   - the build CLI answers exit 1 with the human output untouched;
 *   - `--diagnostics-file=` hands the harness ONE aggregate document, and the
 *     harness JSON.parses the file (never a substring match on prose);
 *   - the aggregate contains EVERY code the failure produced: the family
 *     classification (OE_COMPILER_DIAGNOSTICS — why the build stopped) and
 *     the authored OEC9020 record (where, on the authored line);
 *   - `--diagnostics=json` rides the same run: exactly one parseable report
 *     line on stderr.
 *
 * Harness convention (the probe tests'): the CLI process launches from the
 * workspace checkout — Node refuses to type-strip anything under
 * `node_modules`, and the SHIPPED tree is the compiled JS the release lane's
 * vp-pack pipeline produces, whose `consumer:packaged` legs run this same
 * CLI surface against real packed tarballs. Every module the build resolves —
 * the plugin chain, the element runtime, the compiler, the protocol envelope
 * types — resolves through the app's own `node_modules`.
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { DIAGNOSTIC_REPORT_FORMAT, type DiagnosticReport } from '@openelement/protocol/diagnostics';

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');
const ROUTER_CLI = join(REPO_ROOT, 'packages', 'router', 'src', 'cli', 'cli.ts');

/** The authored line the broken `@property` default sits on (1-based). */
// The line the generated-lane refusal lands on (1-based, the `return` carrying the
// spread). Alpha16 retired the class grammar whose OEC9020 this fixture used to
// trigger, so the same envelope seam is proven with a surviving refusal instead.
const BROKEN_LINE = 7;

interface Fixture {
  appDir: string;
}

const fixtureRoots: string[] = [];

async function write(joinedPath: string, content: string): Promise<void> {
  await mkdir(joinedPath.slice(0, joinedPath.lastIndexOf('/')), { recursive: true });
  await writeFile(joinedPath, content, 'utf8');
}

async function buildFixture(): Promise<Fixture> {
  const created = await mkdtemp(join(tmpdir(), 'oe-consumer-diag-'));
  // Node resolution answers realpaths (macOS tmpdir() hands out /var/...).
  const root = await realpath(created);
  fixtureRoots.push(created);
  const appDir = join(root, 'app');

  // The consumer install: the packages under the app's own node_modules, the
  // vite the app resolves, exactly the external-consumer-build layout.
  await mkdir(join(appDir, 'node_modules', '@openelement'), { recursive: true });
  for (const name of ['router', 'element', 'protocol', 'compiler']) {
    await symlink(
      join(REPO_ROOT, 'packages', name),
      join(appDir, 'node_modules', '@openelement', name),
    );
  }
  await symlink(join(REPO_ROOT, 'node_modules', 'vite'), join(appDir, 'node_modules', 'vite'));

  await write(
    join(appDir, 'package.json'),
    JSON.stringify({ name: 'oe-consumer-diag-app', private: true, type: 'module' }),
  );
  await write(
    join(appDir, 'vite.config.ts'),
    [
      "import { openElement } from '@openelement/router/vite';",
      "import { defineConfig } from 'vite';",
      '',
      'export default defineConfig({ plugins: [openElement()] });',
      '',
    ].join('\n'),
  );
  // The authored mistake: a spread attribute, which the GENERATED lane refuses with
  // OEC9042 on the line BROKEN_LINE pins. The subject of this suite is the consumer
  // ENVELOPE (one JSON document, machine-readable codes, authored locations), not
  // any particular grammar, so it rides whichever lane still produces a coded
  // refusal with a location — the class grammar that used to answer OEC9020 retired
  // with the class lane in Alpha16.
  //
  // The broken module is an ISLAND the route imports, not the page component: a
  // module that cannot compile cannot be classified as a page either, and the route
  // scan would fail first with ROUTE_SCAN_ERROR — hiding the compiler refusal this
  // suite exists to observe.
  await write(
    join(appDir, 'app', 'components', 'broken-page.tsx'),
    [
      '/** The consumer diagnostics fixture: fails the build on purpose. */',
      "import { defineIslandConfig } from '@openelement/router';",
      '',
      "export const openElement = defineIslandConfig({ tag: 'oe-consumer-broken', root: 'shadow' });",
      'function BrokenProbe() {',
      '  const rest = {};',
      '  return <div {...rest}>consumer diagnostics</div>;',
      '}',
      'export default BrokenProbe;',
      '',
    ].join('\n'),
  );
  await write(
    join(appDir, 'app', 'routes', 'index.tsx'),
    [
      "import { definePage } from '@openelement/router';",
      "import BrokenProbe from '../components/broken-page.tsx';",
      '',
      'function Home() {',
      '  return (',
      '    <main>',
      '      <BrokenProbe />',
      '    </main>',
      '  );',
      '}',
      '',
      "export default definePage(Home, { renderIntent: { mode: 'static' } });",
      '',
    ].join('\n'),
  );
  return { appDir };
}

let fixture: Fixture;
let buildLogs = '';
let exitCode = -1;
let reportFromStream: DiagnosticReport | undefined;

beforeAll(async () => {
  fixture = await buildFixture();
  // The real CLI, plain Node child process — no test-runner resolver.
  const build = spawn(
    process.execPath,
    [ROUTER_CLI, 'build', '--diagnostics=json', '--diagnostics-file=oe-diagnostics.json'],
    { cwd: fixture.appDir },
  );
  build.stdout.on('data', (chunk) => (buildLogs += chunk));
  build.stderr.on('data', (chunk) => (buildLogs += chunk));
  exitCode = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? -1)));

  // The harness reads the STREAM as JSON (one report line), never by grep.
  for (const line of buildLogs.split('\n')) {
    if (!line.startsWith('{"format":')) continue;
    reportFromStream = JSON.parse(line) as DiagnosticReport;
  }
}, 300_000);

afterAll(async () => {
  // OE_KEEP_FIXTURE=1 keeps the temp tree for artifact inspection.
  if (process.env.OE_KEEP_FIXTURE) return;
  for (const root of fixtureRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

test('the consumer app’s failing build answers with the machine-readable envelope', async () => {
  expect(exitCode, `the consumer build failed differently:\n${buildLogs}`).toEqual(1);
  // The human output is still there for the human.
  expect(buildLogs).toContain('Build failed:');

  // THE read: the harness consumes the FILE as one JSON document.
  const wire = await readFile(join(fixture.appDir, 'oe-diagnostics.json'), 'utf8');
  const report = JSON.parse(wire) as DiagnosticReport;
  expect(report.format).toEqual(DIAGNOSTIC_REPORT_FORMAT);
  expect(report.ok).toEqual(false);

  // Every code the failure produced, in one aggregate.
  const codes = report.diagnostics.map((diagnostic) => diagnostic.code);
  expect(codes, `codes: ${codes.join(', ')}`).toContain('OE_COMPILER_DIAGNOSTICS');
  expect(codes, `codes: ${codes.join(', ')}`).toContain('OEC9042');

  // The authored record keeps its source location: the authored file, the
  // authored line — the envelope round-trips the compiler's structured data,
  // not a re-parsed display string.
  const authored = report.diagnostics.find((diagnostic) => diagnostic.code === 'OEC9042');
  expect(authored?.file?.endsWith('broken-page.tsx'), authored?.file).toBe(true);
  expect(authored?.line).toEqual(BROKEN_LINE);
  expect(authored?.severity).toEqual('error');
  expect(authored?.phase).toEqual('build');
  expect((authored?.message ?? '').length).toBeGreaterThan(0);
});

test('the same run’s stderr carried one parseable report line', () => {
  expect(exitCode).toEqual(1);
  expect(reportFromStream, 'stderr carried a diagnostics report line').toBeTruthy();
  expect(reportFromStream?.format).toEqual(DIAGNOSTIC_REPORT_FORMAT);
  expect(reportFromStream?.ok).toEqual(false);
  expect(reportFromStream?.diagnostics.map((diagnostic) => diagnostic.code)).toContain('OEC9042');
});
