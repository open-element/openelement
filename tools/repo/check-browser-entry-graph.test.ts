/**
 * check-browser-entry-graph.test.ts — the checker's failure directions.
 *
 * The checked artifact is produced by the router client build; the REAL-build
 * evidence (a real router CLI build that is VIOLATED, and a real Vite build
 * that is MET, plus observer purity and artifact determinism) lives in
 * `packages/router/__tests__/browser-entry-graph.test.ts`. This suite pins the
 * checker's own contract at the unit/process boundary:
 *
 *   - verdict mapping: MET exit 0, VIOLATED exit 1, UNPROVEN exit 2 (including
 *     mixed inputs, where a proven violation dominates);
 *   - fail-closed input handling: missing file, malformed JSON, incomplete
 *     capture, absolute id, unreachable chunk, dangling edge, unparsed entry,
 *     empty chunk list, drifted gate table, self-inconsistent summary,
 *     ambiguous module/chunk attribution → UNPROVEN with a stable reason;
 *   - report-only categories never gate: executor support, server-private,
 *     authoring and generated-leaf modules are reported but leave the verdict
 *     at MET; parsed-only executor residues are diagnosed, not gated;
 *   - the CLI contract: `--json` document shape, relative-path resolution,
 *     usage errors, and one real process spawn.
 *
 * The artifacts here are programmatically constructed fixtures for the
 * checker's unit boundary, NOT evidence about the tree: no claim about P1 or
 * any production app is made or implied by this file.
 *
 * Threat model (explicit, not over-claimed): the artifact is TRUSTED BUILD
 * OUTPUT, not authenticated JSON. Fail-closed shape/canonical-spelling checks
 * and summary recomputation catch writer bugs, partial writes, structural
 * forgery and accidental exact-match bypasses; they cannot authenticate
 * provenance or detect a coherently forged artifact. That trust comes from the
 * build/CI pipeline and the evidence record (exact SHA, clean tree, artifact
 * hash), never from this checker.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import {
  type BrowserEntryGraphArtifact,
  type BrowserEntryGraphCore,
  BROWSER_ENTRY_GRAPH_KIND,
  BROWSER_ENTRY_GRAPH_SCHEMA_VERSION,
  browserEntryGraphGateListDigest,
  deriveBrowserEntryGraphSummary,
  evaluateBrowserEntryGraphArtifact,
  executorEntryModuleIds,
  isNormalizedBrowserEntryGraphModuleId,
  isNormalizedBrowserEntryGraphRelativePath,
  isNormalizedBrowserEntryGraphVirtualModuleId,
  serializeBrowserEntryGraphArtifact,
} from '../../packages/router/src/vite/internal/browser-entry-graph-artifact.ts';
import {
  type BrowserEntryGraphCheckerIo,
  runBrowserEntryGraphCheck,
} from './check-browser-entry-graph.ts';

const REPO_ROOT = join(import.meta.dirname!, '..', '..');
const CHECKER_CLI = join(REPO_ROOT, 'tools', 'repo', 'check-browser-entry-graph.ts');
const TMP_PREFIX = join(REPO_ROOT, '.tmp-browser-entry-graph-check-');
const ELEMENT_PACKAGE_ROOT = 'packages/element';
const PRODUCER = { package: '@openelement/router', version: '0.0.0-checker-test' };

const temporaryRoots: string[] = [];

afterAll(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(TMP_PREFIX);
  temporaryRoots.push(root);
  return root;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Deterministic unit fixtures (checker boundary, not evidence)               */
/* ────────────────────────────────────────────────────────────────────────── */

const ENTRY_MODULE_ID = '\0virtual:open-client-entry';
const ENTRY_CHUNK = 'islands/client.js';
const RUNTIME_CHUNK = 'islands/element-runtime-ABC.js';
const ISLAND_CHUNK = 'islands/island-open-probe-ABC.js';
const ISLAND_MODULE_ID = 'www/app/islands/open-probe.tsx';
const LEAF_MODULE_ID = 'packages/element/src/internal/compiled/runtime/recipe.ts';
const FACADE_HOST_MODULE_ID = 'packages/element/src/internal/compiled/facade-host.ts';
const KERNEL_MODULE_ID = 'packages/element/src/internal/compiled/runtime/kernel.ts';
const PARTS_MODULE_ID = 'packages/element/src/internal/compiled/runtime/parts.ts';
const SERIALIZER_MODULE_ID =
  'packages/element/src/internal/compiled/serializer/serialize-program.ts';
const AUTHORING_MODULE_ID = 'packages/element/src/index.ts';

/** The base core used by every unit fixture: entry + island + runtime shell. */
function makeCore(): BrowserEntryGraphCore {
  return {
    schemaVersion: BROWSER_ENTRY_GRAPH_SCHEMA_VERSION,
    kind: BROWSER_ENTRY_GRAPH_KIND,
    status: 'complete',
    producer: PRODUCER,
    app: { root: 'www', outDir: 'dist/client', base: '/' },
    element: { packageRoot: ELEMENT_PACKAGE_ROOT, version: '0.0.0-checker-test' },
    entry: { moduleId: ENTRY_MODULE_ID, chunkFile: ENTRY_CHUNK },
    islands: [
      {
        tag: 'open-probe',
        specifier: './app/islands/open-probe.tsx',
        moduleId: ISLAND_MODULE_ID,
        strategy: 'load',
        chunkFile: ISLAND_CHUNK,
      },
    ],
    chunks: [
      {
        file: ENTRY_CHUNK,
        isEntry: true,
        isDynamicEntry: false,
        facadeModuleId: ENTRY_MODULE_ID,
        imports: [RUNTIME_CHUNK],
        dynamicImports: [ISLAND_CHUNK],
        implicitlyLoadedBefore: [],
        modules: [
          { id: ENTRY_MODULE_ID, renderedLength: 120 },
          { id: LEAF_MODULE_ID, renderedLength: 64 },
        ],
      },
      {
        file: RUNTIME_CHUNK,
        isEntry: false,
        isDynamicEntry: false,
        facadeModuleId: null,
        imports: [],
        dynamicImports: [],
        implicitlyLoadedBefore: [],
        modules: [],
      },
      {
        file: ISLAND_CHUNK,
        isEntry: false,
        isDynamicEntry: true,
        facadeModuleId: ISLAND_MODULE_ID,
        imports: [RUNTIME_CHUNK],
        dynamicImports: [],
        implicitlyLoadedBefore: [],
        modules: [{ id: ISLAND_MODULE_ID, renderedLength: 240 }],
      },
    ],
    parsedModuleIds: [ENTRY_MODULE_ID, LEAF_MODULE_ID, ISLAND_MODULE_ID, FACADE_HOST_MODULE_ID],
  };
}

/** Seal a core with the predicate summary the writer would store. */
function seal(core: BrowserEntryGraphCore): BrowserEntryGraphArtifact {
  const summary = deriveBrowserEntryGraphSummary(core);
  return {
    ...core,
    predicate: {
      gateListDigest: browserEntryGraphGateListDigest(),
      executorEntry: executorEntryModuleIds(core.element.packageRoot),
      loadedViolations: summary.loadedViolations,
      parsedOnlyExecutorResidues: summary.parsedOnlyExecutorResidues,
      diagnostics: summary.diagnostics,
    },
  };
}

/** MET: the gate is parsed (diagnostic) but not rendered/loaded. */
function metArtifact(): BrowserEntryGraphArtifact {
  return seal(makeCore());
}

/** VIOLATED: the executor kernel is rendered in the runtime chunk the entry/island load. */
function violatedArtifact(): BrowserEntryGraphArtifact {
  const core = makeCore();
  core.chunks[1]!.modules.push({ id: KERNEL_MODULE_ID, renderedLength: 900 });
  return seal(core);
}

/** Report-only categories loaded (support/server-private/authoring): still MET. */
function reportOnlyArtifact(): BrowserEntryGraphArtifact {
  const core = makeCore();
  core.chunks[0]!.modules.push(
    { id: PARTS_MODULE_ID, renderedLength: 300 },
    { id: SERIALIZER_MODULE_ID, renderedLength: 400 },
    { id: AUTHORING_MODULE_ID, renderedLength: 200 },
  );
  return seal(core);
}

/** A structurally well-formed artifact with one chunk unreachable from the entry. */
function unreachableChunkArtifact(): BrowserEntryGraphArtifact {
  const core = makeCore();
  core.chunks.push({
    file: 'islands/orphan-XYZ.js',
    isEntry: false,
    isDynamicEntry: false,
    facadeModuleId: null,
    imports: [],
    dynamicImports: [],
    implicitlyLoadedBefore: [],
    modules: [],
  });
  return seal(core);
}

function withJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* IO capture                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

interface CapturedRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCheckerInProcess(
  argv: readonly string[],
  cwd: string = REPO_ROOT,
): Promise<CapturedRun> {
  let stdout = '';
  let stderr = '';
  const io: BrowserEntryGraphCheckerIo = {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    cwd,
  };
  const code = await runBrowserEntryGraphCheck(argv, io);
  return { code, stdout, stderr };
}

async function writeArtifact(root: string, name: string, value: unknown): Promise<string> {
  const path = join(root, name);
  await writeFile(path, withJson(value), 'utf8');
  return path;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Canonical spelling / virtual-id validation (B3)                           */
/* ────────────────────────────────────────────────────────────────────────── */

test('the path validator rejects every non-canonical spelling (exact-match bypass)', () => {
  const valid = [
    'a/b.ts',
    'packages/element/src/internal/compiled/facade-host.ts',
    'node_modules/@scope/pkg/dist/index.js',
    '.tmp-fixture/app/islands/x.tsx',
    '.vite/oe-browser-entry-graph.json',
    'pkg:@openelement/element/src/x.ts',
  ];
  for (const value of valid)
    expect(isNormalizedBrowserEntryGraphRelativePath(value), value).toBe(true);

  const invalid = [
    '',
    '.',
    '..',
    './a',
    '../a',
    'a//b',
    'a/./b',
    'a/../b',
    'a/',
    'a//',
    '/a',
    'C:/a',
    'C:\\a',
    'a\\b',
    'a?query',
    'a\u0000b',
    'a\u0001b',
    'a/b/',
  ];
  for (const value of invalid) {
    expect(isNormalizedBrowserEntryGraphRelativePath(value), value).toBe(false);
    expect(isNormalizedBrowserEntryGraphModuleId(value), value).toBe(false);
  }
});

test('the virtual-id validator accepts only the frozen machine-independent schemes', () => {
  const valid = [
    '\0virtual:open-client-entry',
    '\0vite/preload-helper.js',
    '\0vite/modulepreload-polyfill.js',
    '\0rolldown/runtime.js',
    '\0empty-preact-rts',
    '\0oe-tailwind-components.js',
    '\0oe-style-asset:file:packages/ui/src/open-button.css',
    '\0oe-style-asset:file:packages/ui/src/open-button.css\0open-button',
  ];
  for (const value of valid)
    expect(isNormalizedBrowserEntryGraphVirtualModuleId(value), value).toBe(true);

  const encoded = `\0oe-style-asset:${Buffer.from(
    '/Users/machine/repo/packages/ui/src/open-button.css',
    'utf8',
  ).toString('base64url')}.js`;
  const invalid = [
    encoded, // the bundler's opaque, absolute-path-carrying spelling
    '\0oe-style-asset:file:../escape.css',
    '\0oe-style-asset:file:/abs/machine.css',
    '\0oe-style-asset:file:a//b.css',
    '\0oe-style-asset:file:packages/ui/src/open-button.css\0BAD TAG',
    '\0oe-unknown:<opaque>',
    '\0oe-compiled:L1VzZXJzL2Fic29sdXRl',
    '\0virtual:../../escape',
    '\0vite/../escape.js',
    '\0',
    'not-virtual',
  ];
  for (const value of invalid)
    expect(isNormalizedBrowserEntryGraphVirtualModuleId(value), value).toBe(false);
});

test('an artifact carrying the opaque style-asset id is malformed, not judged', async () => {
  const root = await makeTemporaryRoot();
  const legacyEncoded = `\0oe-style-asset:${Buffer.from(
    join(REPO_ROOT, 'packages', 'ui', 'src', 'open-button.css'),
    'utf8',
  ).toString('base64url')}.js`;
  const artifact = metArtifact();
  artifact.chunks[0]!.modules.push({ id: legacyEncoded, renderedLength: 12 });
  const path = await writeArtifact(root, 'legacy-style-id.json', artifact);
  // Run with a relative path so the only absolute spelling in the output would
  // have to come from the artifact itself.
  const human = await runCheckerInProcess([path.slice(REPO_ROOT.length + 1)]);
  expect(human.code, `${human.stdout}${human.stderr}`).toBe(2);
  expect(human.stdout).toContain('malformed-artifact');
  // Neither the opaque id nor the machine path it encodes is echoed.
  expect(human.stdout).not.toContain(legacyEncoded);
  expect(human.stdout).not.toContain('/Users/');
  expect(human.stdout).not.toContain(REPO_ROOT);
});

test('a canonical decoded style-asset id is accepted and does not gate', () => {
  const artifact = metArtifact();
  artifact.chunks[0]!.modules.push({
    id: '\0oe-style-asset:file:packages/ui/src/open-button.css',
    renderedLength: 32,
  });
  const evaluation = evaluateBrowserEntryGraphArtifact(artifact);
  expect(evaluation.verdict).toBe('MET');
  expect(evaluation.violations).toEqual([]);
});

test('non-canonical gate spellings and unknown virtual schemes are malformed, never MET', () => {
  // The exact-match gate is a string comparison; a spelling that renders the
  // same module under a different string must fail the artifact closed.
  const nonCanonicalGate = metArtifact();
  nonCanonicalGate.chunks[1]!.modules.push({
    id: 'packages//element/src/internal/compiled/runtime/kernel.ts',
    renderedLength: 900,
  });
  const nonCanonicalEvaluation = evaluateBrowserEntryGraphArtifact(nonCanonicalGate);
  expect(nonCanonicalEvaluation.verdict).toBe('UNPROVEN');
  expect(nonCanonicalEvaluation.reason).toBe('malformed-artifact');

  const unknownVirtual = metArtifact();
  unknownVirtual.chunks[0]!.modules.push({
    id: '\0oe-compiled:L1VzZXJzL2Fic29sdXRl',
    renderedLength: 8,
  });
  const unknownEvaluation = evaluateBrowserEntryGraphArtifact(unknownVirtual);
  expect(unknownEvaluation.verdict).toBe('UNPROVEN');
  expect(unknownEvaluation.reason).toBe('malformed-artifact');
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Verdicts                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

test('a MET artifact exits 0 and prints the report-only picture', async () => {
  const root = await makeTemporaryRoot();
  const artifactPath = await writeArtifact(root, 'met.json', metArtifact());

  const evaluation = evaluateBrowserEntryGraphArtifact(metArtifact());
  expect(evaluation.verdict).toBe('MET');
  expect(evaluation.parsedOnlyExecutorResidues).toContain(FACADE_HOST_MODULE_ID);

  const human = await runCheckerInProcess([artifactPath]);
  expect(human.code, human.stderr).toBe(0);
  expect(human.stdout).toContain('MET');
  expect(human.stdout).toContain('parsed-only executor residues');
  expect(human.stdout).toContain(FACADE_HOST_MODULE_ID);

  const json = await runCheckerInProcess(['--json', artifactPath]);
  expect(json.code).toBe(0);
  const report = JSON.parse(json.stdout) as {
    format: string;
    exitCode: number;
    summary: { met: number; violated: number; unproven: number };
    artifacts: Array<{ verdict: string; reason: string | null }>;
  };
  expect(report.format).toBe('openelement.browser-entry-graph-check/1');
  expect(report.exitCode).toBe(0);
  expect(report.summary).toEqual({ met: 1, violated: 0, unproven: 0 });
  expect(report.artifacts[0]).toMatchObject({ verdict: 'MET', reason: null });
});

test('a VIOLATED artifact exits 1 and names module, chunk and island attribution', async () => {
  const root = await makeTemporaryRoot();
  const artifactPath = await writeArtifact(root, 'violated.json', violatedArtifact());

  const evaluation = evaluateBrowserEntryGraphArtifact(violatedArtifact());
  expect(evaluation.verdict).toBe('VIOLATED');
  expect(evaluation.violations).toHaveLength(1);
  expect(evaluation.violations[0]).toMatchObject({
    moduleId: KERNEL_MODULE_ID,
    chunkFile: RUNTIME_CHUNK,
    islands: ['open-probe'],
  });
  expect(evaluation.diagnostics.leafSurface).toContain(LEAF_MODULE_ID);

  const human = await runCheckerInProcess([artifactPath]);
  expect(human.code, human.stderr).toBe(1);
  expect(human.stdout).toContain('VIOLATED');
  expect(human.stdout).toContain(KERNEL_MODULE_ID);
  expect(human.stdout).toContain(RUNTIME_CHUNK);
});

test('report-only categories are printed but never gate', async () => {
  const artifact = reportOnlyArtifact();
  const evaluation = evaluateBrowserEntryGraphArtifact(artifact);
  expect(evaluation.verdict).toBe('MET');
  expect(evaluation.violations).toEqual([]);
  expect(evaluation.diagnostics.executorSupport).toEqual([PARTS_MODULE_ID]);
  expect(evaluation.diagnostics.serverPrivate).toEqual([SERIALIZER_MODULE_ID]);
  expect(evaluation.diagnostics.authoring).toEqual([AUTHORING_MODULE_ID]);

  const root = await makeTemporaryRoot();
  const human = await runCheckerInProcess([
    await writeArtifact(root, 'report-only.json', artifact),
  ]);
  expect(human.code).toBe(0);
  expect(human.stdout).toContain(PARTS_MODULE_ID);
  expect(human.stdout).toContain(SERIALIZER_MODULE_ID);
});

test('implicitly loaded chunk edges count as loaded — they are never ignored', () => {
  // The runtime chunk is reachable ONLY through the entry's implicit edge (not
  // a static import, not a dynamic import). The evaluator must still walk it.
  const reachableCore = makeCore();
  reachableCore.chunks[0]!.imports = [];
  reachableCore.chunks[0]!.implicitlyLoadedBefore = [RUNTIME_CHUNK];
  reachableCore.chunks[2]!.imports = [];
  const metImplicit = seal(reachableCore);
  expect(evaluateBrowserEntryGraphArtifact(metImplicit).verdict).toBe('MET');

  const loadedCore = makeCore();
  loadedCore.chunks[0]!.imports = [];
  loadedCore.chunks[0]!.implicitlyLoadedBefore = [RUNTIME_CHUNK];
  loadedCore.chunks[2]!.imports = [];
  loadedCore.chunks[1]!.modules.push({ id: KERNEL_MODULE_ID, renderedLength: 800 });
  const violatedImplicit = seal(loadedCore);
  const evaluation = evaluateBrowserEntryGraphArtifact(violatedImplicit);
  expect(evaluation.verdict).toBe('VIOLATED');
  expect(evaluation.violations[0]!.moduleId).toBe(KERNEL_MODULE_ID);
});

test('the executor-entry gate list stays frozen: a renamed table is drift, not a verdict', async () => {
  // A moved clock: a checker from another revision must refuse to judge.
  expect(browserEntryGraphGateListDigest()).toBe(
    'sha256:626686d67c13c6708f7faec4a53862a43a268d61b2aedf445f7a4cc34d268ba7',
  );
  const root = await makeTemporaryRoot();
  const artifact = metArtifact();
  artifact.predicate.gateListDigest = 'sha256:another-revision';
  const human = await runCheckerInProcess([await writeArtifact(root, 'drift.json', artifact)]);
  expect(human.code).toBe(2);
  expect(human.stdout).toContain('gate-list-drift');
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Fail-closed input handling                                                */
/* ────────────────────────────────────────────────────────────────────────── */

test('missing, malformed and incomplete artifacts are UNPROVEN (exit 2)', async () => {
  const root = await makeTemporaryRoot();
  const malformedPath = join(root, 'malformed.json');
  await writeFile(malformedPath, '{"schemaVersion": 1,', 'utf8');
  const incomplete = {
    schemaVersion: BROWSER_ENTRY_GRAPH_SCHEMA_VERSION,
    kind: BROWSER_ENTRY_GRAPH_KIND,
    status: 'incomplete',
    reason: 'module-parsed-empty',
    diagnostics: ['module-parsed-empty'],
  };

  const cases: Array<[label: string, argv: string[], expectedReason: string]> = [
    ['missing file', [join(root, 'nowhere.json')], 'artifact-missing'],
    ['malformed JSON', [malformedPath], 'artifact-not-json'],
    [
      'incomplete capture',
      [await writeArtifact(root, 'incomplete.json', incomplete)],
      'artifact-incomplete',
    ],
    [
      'empty object',
      [await writeArtifact(root, 'empty-object.json', {})],
      'unsupported-schema-version',
    ],
    [
      'wrong kind',
      [await writeArtifact(root, 'kind.json', { schemaVersion: 1, kind: 'x', status: 'complete' })],
      'foreign-kind',
    ],
  ];
  for (const [label, argv, expectedReason] of cases) {
    const human = await runCheckerInProcess(argv);
    expect(human.code, `${label}: ${human.stdout}${human.stderr}`).toBe(2);
    expect(human.stdout, label).toContain('UNPROVEN');
    expect(human.stdout, label).toContain(expectedReason);
  }
});

test('structurally untrustworthy artifacts are UNPROVEN, never MET', async () => {
  const root = await makeTemporaryRoot();

  const absoluteId = metArtifact();
  absoluteId.chunks[0]!.modules[0]!.id = '/abs/machine/path.ts';

  const dangling = metArtifact();
  dangling.chunks[0]!.imports.push('islands/not-emitted.js');

  const unparsedEntry = metArtifact();
  unparsedEntry.parsedModuleIds = unparsedEntry.parsedModuleIds.filter(
    (id) => id !== ENTRY_MODULE_ID,
  );

  const emptyChunks = metArtifact();
  emptyChunks.chunks = [];

  const ambiguousModule = metArtifact();
  ambiguousModule.chunks[2]!.modules.push({ id: ENTRY_MODULE_ID, renderedLength: 0 });

  const duplicatedIsland = metArtifact();
  duplicatedIsland.islands.push({ ...duplicatedIsland.islands[0]! });

  const missingEntryChunk = metArtifact();
  missingEntryChunk.entry.chunkFile = 'islands/not-emitted.js';

  const hiddenViolation = violatedArtifact();
  hiddenViolation.predicate.loadedViolations = [];

  const facadeMissing = metArtifact();
  facadeMissing.chunks[2]!.facadeModuleId = 'www/app/islands/unrelated.tsx';

  const cases: Array<[label: string, artifact: unknown, expectedReason: string]> = [
    ['absolute module id', absoluteId, 'malformed-artifact'],
    ['dangling chunk edge', dangling, 'chunk-reference-dangling'],
    ['entry not parsed', unparsedEntry, 'entry-not-parsed'],
    ['empty chunk list', emptyChunks, 'malformed-artifact'],
    ['module in two chunks', ambiguousModule, 'module-chunk-ambiguous'],
    ['duplicate island tag', duplicatedIsland, 'malformed-artifact'],
    ['missing entry chunk', missingEntryChunk, 'entry-chunk-missing'],
    ['forged green summary', hiddenViolation, 'predicate-summary-mismatch'],
    ['chunk facade not parsed', facadeMissing, 'chunk-facade-not-parsed'],
    ['unreachable chunk', unreachableChunkArtifact(), 'chunk-unreachable'],
  ];
  let index = 0;
  for (const [label, artifact, expectedReason] of cases) {
    const path = await writeArtifact(root, `forged-${index++}.json`, artifact);
    const human = await runCheckerInProcess([path]);
    expect(human.code, `${label}: ${human.stdout}${human.stderr}`).toBe(2);
    expect(human.stdout, label).toContain(expectedReason);
  }
});

test('evaluator never throws on non-artifact inputs', () => {
  const values: unknown[] = [
    null,
    undefined,
    0,
    'text',
    [],
    {},
    { schemaVersion: 2 },
    [{ status: 'complete' }],
  ];
  for (const value of values) {
    const evaluation = evaluateBrowserEntryGraphArtifact(value);
    expect(evaluation.verdict).toBe('UNPROVEN');
    expect(evaluation.reason).not.toBeNull();
  }
});

/* ────────────────────────────────────────────────────────────────────────── */
/* CLI contract                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

test('usage errors are exit 2 (no vacuous pass), unknown flags are rejected', async () => {
  const empty = await runCheckerInProcess([]);
  expect(empty.code).toBe(2);
  expect(empty.stderr).toContain('no artifact supplied');
  expect(empty.stderr).toContain('usage:');

  const flag = await runCheckerInProcess(['--all']);
  expect(flag.code).toBe(2);
  expect(flag.stderr).toContain('unknown flag');

  const jsonOnly = await runCheckerInProcess(['--json']);
  expect(jsonOnly.code).toBe(2);
});

test('a proven violation dominates mixed inputs; unproven still blocks a green claim', async () => {
  const root = await makeTemporaryRoot();
  const metPath = await writeArtifact(root, 'mixed-met.json', metArtifact());
  const violatedPath = await writeArtifact(root, 'mixed-violated.json', violatedArtifact());
  const missingPath = join(root, 'mixed-missing.json');

  expect((await runCheckerInProcess([metPath, metPath])).code).toBe(0);
  expect((await runCheckerInProcess([metPath, missingPath])).code).toBe(2);
  const mixed = await runCheckerInProcess([metPath, violatedPath, missingPath]);
  expect(mixed.code).toBe(1);
  const report = JSON.parse(
    (await runCheckerInProcess(['--json', metPath, violatedPath, missingPath])).stdout,
  ) as {
    exitCode: number;
    summary: { met: number; violated: number; unproven: number };
  };
  expect(report.exitCode).toBe(1);
  expect(report.summary).toEqual({ met: 1, violated: 1, unproven: 1 });
});

test('the real CLI process resolves relative artifact paths and exits with the verdict', async () => {
  const root = await makeTemporaryRoot();
  const metPath = await writeArtifact(root, 'spawn-met.json', metArtifact());
  const relativePath = metPath.slice(REPO_ROOT.length + 1);

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(process.execPath, [CHECKER_CLI, relativePath], { cwd: REPO_ROOT });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('exit', (code) => resolve({ code, stdout, stderr }));
    },
  );
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain('MET');
  expect(result.stdout).toContain('this is not an app-completeness claim');

  // Keep the serializer honest: an artifact written by this contract round-trips
  // through the checker without a schema surprise.
  await writeFile(metPath, serializeBrowserEntryGraphArtifact(metArtifact()), 'utf8');
  const roundTrip = await runCheckerInProcess([metPath]);
  expect(roundTrip.code).toBe(0);

  // pnpm appends a literal `--` separator to a `run <script> -- <args>` call;
  // the CLI must not treat it as an unknown flag (the documented
  // `browser-graph:check` script passes arguments through this way).
  const viaPackageScript = await runCheckerInProcess(['--', '--json', metPath]);
  expect(viaPackageScript.code, viaPackageScript.stderr).toBe(0);
  expect(JSON.parse(viaPackageScript.stdout)).toMatchObject({ exitCode: 0 });
});

test('checker output repeats no machine path beyond the caller-supplied artifact path', async () => {
  const root = await makeTemporaryRoot();
  const path = await writeArtifact(root, 'no-machine-path.json', metArtifact());
  const human = await runCheckerInProcess([path.slice(REPO_ROOT.length + 1)]);
  expect(human.code, human.stderr).toBe(0);
  // Every path the CHECKER introduces is normalized; the only absolute
  // spelling in a relative-path run is whatever the caller passed.
  expect(human.stdout).not.toContain(REPO_ROOT);
  expect(human.stdout).toContain('MET');
});
