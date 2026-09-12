// tools/experiments/oxc/run.ts
//
// Oxc TSX→PartProgram frontend feasibility experiment for issue #1156
// (Beta.2.2 slice). Reproducible harness: runs the REAL semantic core
// (packages/adapter-vite/src/internal/compiler/semantic-core) and a minimal
// oxc-parser ESTree analysis (./oxc-analyze.ts) over the 7 pinned samples in
// ./samples/, then compares:
//   1. accept/reject verdicts and OEC9xxx diagnostic code/location parity
//   2. intrinsic-binding provenance facts (module-analysis parity)
//   3. accepted-program skeleton identity (parts/regions/dependencies/
//      locations/source records/property metadata)
//   4. the coordinate contract under CRLF / UTF-8 BOM / non-BMP perturbation
//   5. source-map consumer verification: oxc-derived spans feed the repo's
//      hand-rolled Source Map v3 emitter (source-map.ts) with identical output
// plus parse-time and memory measurements. Exits non-zero on ANY failure.
//
// Run from the repo root:  deno run -A tools/experiments/oxc/run.ts
// Optional:                deno run -A tools/experiments/oxc/run.ts --out results.json

import ts from 'typescript';
import { parseSync } from 'npm:oxc-parser@0.149.0';
import {
  CompiledElementError,
  compileElementProgram,
  type CompileElementResult,
} from '../../../packages/adapter-vite/src/internal/compiler/semantic-core/compile.ts';
import {
  analyzeModuleSemantics,
  type ModuleSemanticFacts,
} from '../../../packages/adapter-vite/src/internal/compiler/semantic-core/module-analysis.ts';
import { SourceMapSegmentBuilder } from '../../../packages/adapter-vite/src/internal/compiler/semantic-core/source-map.ts';
import {
  MiniCompileError,
  type MiniDiagnostic,
  type MiniProgram,
  oxcAnalyze,
  oxcModuleFacts,
  type SourceSpan,
} from './oxc-analyze.ts';

const OXC_PIN = '0.149.0';
const SAMPLES_DIR = new URL('./samples/', import.meta.url);

interface DiagnosticShape {
  code: string;
  message: string;
  file: string;
  line: number;
  character: number;
  start: number;
  end: number;
}

interface SideResult {
  verdict: 'accept' | 'reject';
  diagnostics?: DiagnosticShape[];
  program?: Record<string, unknown>;
  sourceRecords?: Array<{ id: string; kind: string; source: SourceSpan }>;
  moduleFacts?: Record<string, unknown>;
  mapV3?: boolean;
}

const failures: string[] = [];
const check = (ok: boolean, label: string, detail = ''): void => {
  if (!ok) failures.push(detail ? `${label}: ${detail}` : label);
};

/** Read sample bytes without BOM stripping or newline normalization. */
async function readSampleBytes(name: string): Promise<string> {
  const bytes = await Deno.readFile(new URL(name, SAMPLES_DIR));
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

/** Part-program skeleton extracted from the real compiler result. */
function tsSkeleton(result: CompileElementResult): Record<string, unknown> {
  const p = result.program;
  return {
    tag: p.tag,
    root: p.root,
    template: p.template,
    parts: p.parts,
    regions: p.regions,
    dependencies: p.dependencies,
    locations: p.locations,
    properties: p.metadata.properties,
    observedAttributes: p.metadata.observedAttributes,
  };
}

function runTsOracle(source: string, file: string): SideResult {
  const out: SideResult = { verdict: 'accept' };
  const facts: ModuleSemanticFacts = analyzeModuleSemantics(source, file);
  out.moduleFacts = {
    compiledElementDecorator: facts.compiledElementDecorator,
    unsupportedElementDecorator: facts.unsupportedElementDecorator,
    definedCustomElementTags: facts.definedCustomElementTags,
  };
  try {
    const result = compileElementProgram(source, file);
    out.verdict = 'accept';
    out.program = tsSkeleton(result);
    out.sourceRecords = result.program.sourceMap.records.map((r) => ({
      id: r.id,
      kind: r.kind,
      source: r.source,
    }));
    out.mapV3 = result.map.version === 3 && result.map.mappings.length > 0;
  } catch (error) {
    out.verdict = 'reject';
    if (error instanceof CompiledElementError) {
      out.diagnostics = error.diagnostics.map((d) => ({ ...d }));
    } else {
      throw error;
    }
  }
  return out;
}

function runOxc(source: string, file: string): SideResult {
  const out: SideResult = { verdict: 'accept' };
  const facts = oxcModuleFacts(source, file);
  out.moduleFacts = { ...facts };
  try {
    const program: MiniProgram = oxcAnalyze(source, file);
    out.verdict = 'accept';
    const { sourceRecords, ...skeleton } = program;
    out.program = skeleton;
    out.sourceRecords = sourceRecords;
  } catch (error) {
    if (error instanceof MiniCompileError) {
      out.verdict = 'reject';
      out.diagnostics = error.diagnostics.map((d: MiniDiagnostic) => ({ ...d }));
    } else {
      throw error;
    }
  }
  return out;
}

/** Deep structural diff with path reporting (JSON values only). */
function deepDiff(path: string, a: unknown, b: unknown, out: string[]): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) deepDiff(`${path}[${i}]`, a[i], b[i], out);
    return;
  }
  if (
    a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      deepDiff(
        `${path}.${k}`,
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        out,
      );
    }
    return;
  }
  out.push(`${path}: TS=${JSON.stringify(a)} OXC=${JSON.stringify(b)}`);
}

// Expected oracle matrix (fail-closed gate: if the repo compiler itself drifts,
// the experiment fails loudly instead of silently comparing two new behaviors).
// b2/b3 carry a leading deno-fmt-ignore-file comment line (+1 line vs the
// compact provenance-test strings they quote); c-samples add the same comment
// over the fixture line 33 spread site.
const EXPECTED: Record<string, { verdict: string; code?: string; line?: number; character?: number }> = {
  'a-counter.tsx': { verdict: 'accept' },
  'b1-spread.tsx': { verdict: 'reject', code: 'OEC9007', line: 12, character: 3 },
  'b2-type-only.tsx': { verdict: 'reject', code: 'OEC9027', line: 3, character: 1 },
  'b3-foreign-property.tsx': { verdict: 'reject', code: 'OEC9004', line: 6, character: 3 },
  'c1-counter-spread-crlf.tsx': { verdict: 'reject', code: 'OEC9011', line: 34, character: 13 },
  'c2-counter-spread-bom.tsx': { verdict: 'reject', code: 'OEC9011', line: 34, character: 13 },
  'c3-counter-spread-astral.tsx': { verdict: 'reject', code: 'OEC9011', line: 34, character: 13 },
};

// diskName vs virtual compile name: c2 is stored as .txt because deno fmt
// unconditionally strips a UTF-8 BOM from .tsx sources, and the BOM is the
// variable under test; b2 is stored as .txt because it is a deliberately
// invalid sample (OEC9027: type-only `element` import used as a decorator)
// and must not be scanned as executable repo source (CodeQL #4175). The
// compiler still sees a .tsx file name in both cases.
const SAMPLES: Array<{ disk: string; virtual: string }> = [
  { disk: 'a-counter.tsx', virtual: 'a-counter.tsx' },
  { disk: 'b1-spread.tsx', virtual: 'b1-spread.tsx' },
  { disk: 'b2-type-only.txt', virtual: 'b2-type-only.tsx' },
  { disk: 'b3-foreign-property.tsx', virtual: 'b3-foreign-property.tsx' },
  { disk: 'c1-counter-spread-crlf.tsx', virtual: 'c1-counter-spread-crlf.tsx' },
  { disk: 'c2-counter-spread-bom.txt', virtual: 'c2-counter-spread-bom.tsx' },
  { disk: 'c3-counter-spread-astral.tsx', virtual: 'c3-counter-spread-astral.tsx' },
];

interface SampleReport {
  sample: string;
  bytes: number;
  oracle: { verdict: string; code?: string; position?: string };
  oxc: { verdict: string; code?: string; position?: string };
  verdictParity: boolean;
  diagnosticParity: boolean | null;
  skeletonParity: boolean | null;
  moduleFactsParity: boolean;
  oracleMatrixOk: boolean;
}

// ---------------------------------------------------------------------------
// Phase 1: parity comparison
// ---------------------------------------------------------------------------
const reports: SampleReport[] = [];
const sampleTexts = new Map<string, string>();
let acceptRecordsTs: Array<{ id: string; kind: string; source: SourceSpan }> | undefined;
let acceptRecordsOxc: Array<{ id: string; kind: string; source: SourceSpan }> | undefined;

for (const { disk, virtual } of SAMPLES) {
  const source = await readSampleBytes(disk);
  sampleTexts.set(virtual, source);
  const file = `/project/app/islands/${virtual}`;
  const oracle = runTsOracle(source, file);
  const oxc = runOxc(source, file);

  const name = virtual;
  const expected = EXPECTED[name];
  let oracleMatrixOk = oracle.verdict === expected.verdict;
  if (expected.code) {
    const d = oracle.diagnostics?.[0];
    oracleMatrixOk = oracleMatrixOk && d?.code === expected.code && d.line === expected.line &&
      d.character === expected.character;
  }
  check(
    oracleMatrixOk,
    `[${name}] oracle drifted from expected matrix`,
    JSON.stringify({ expected, actual: { verdict: oracle.verdict, d: oracle.diagnostics?.[0] } }),
  );

  const verdictParity = oracle.verdict === oxc.verdict;
  check(verdictParity, `[${name}] verdict mismatch`, `TS=${oracle.verdict} OXC=${oxc.verdict}`);

  let diagnosticParity: boolean | null = null;
  if (oracle.verdict === 'reject' && oxc.verdict === 'reject') {
    const t = oracle.diagnostics![0];
    const o = oxc.diagnostics![0];
    diagnosticParity = t.code === o.code && t.line === o.line && t.character === o.character &&
      t.start === o.start && t.end === o.end;
    check(
      diagnosticParity,
      `[${name}] diagnostic mismatch`,
      `TS=${t.code}@${t.line}:${t.character}[${t.start},${t.end}] ` +
        `OXC=${o.code}@${o.line}:${o.character}[${o.start},${o.end}]`,
    );
  }

  let skeletonParity: boolean | null = null;
  if (oracle.verdict === 'accept' && oxc.verdict === 'accept') {
    const diffs: string[] = [];
    deepDiff('program', oracle.program, oxc.program, diffs);
    deepDiff('sourceRecords', oracle.sourceRecords, oxc.sourceRecords, diffs);
    skeletonParity = diffs.length === 0;
    check(skeletonParity, `[${name}] program skeleton mismatch`, diffs.slice(0, 5).join(' | '));
    acceptRecordsTs = oracle.sourceRecords;
    acceptRecordsOxc = oxc.sourceRecords;
  }

  const factDiffs: string[] = [];
  deepDiff('moduleFacts', oracle.moduleFacts, oxc.moduleFacts, factDiffs);
  const moduleFactsParity = factDiffs.length === 0;
  check(moduleFactsParity, `[${name}] module facts mismatch`, factDiffs.join(' | '));

  reports.push({
    sample: name,
    bytes: source.length,
    oracle: {
      verdict: oracle.verdict,
      code: oracle.diagnostics?.[0]?.code,
      position: oracle.diagnostics?.[0]
        ? `${oracle.diagnostics[0].line}:${oracle.diagnostics[0].character} [${
          oracle.diagnostics[0].start
        },${oracle.diagnostics[0].end}]`
        : undefined,
    },
    oxc: {
      verdict: oxc.verdict,
      code: oxc.diagnostics?.[0]?.code,
      position: oxc.diagnostics?.[0]
        ? `${oxc.diagnostics[0].line}:${oxc.diagnostics[0].character} [${
          oxc.diagnostics[0].start
        },${oxc.diagnostics[0].end}]`
        : undefined,
    },
    verdictParity,
    diagnosticParity,
    skeletonParity,
    moduleFactsParity,
    oracleMatrixOk,
  });
}

// ---------------------------------------------------------------------------
// Phase 2: source-map consumer verification
// Feed TS-derived and Oxc-derived program source records through the repo's
// real SourceMapSegmentBuilder; identical segment inputs must yield identical
// v3 mappings, and the builder's coordinate validation must accept both.
// ---------------------------------------------------------------------------
let sourceMapConsumerOk = false;
let sourceMapMappingsEqual = false;
if (acceptRecordsTs && acceptRecordsOxc) {
  const buildMappings = (records: Array<{ id: string; source: SourceSpan }>): string => {
    const builder = new SourceMapSegmentBuilder();
    records.forEach((record, i) => {
      builder.add({
        generatedLine: i + 1,
        generatedColumn: 0,
        sourceLine: record.source.start.line,
        sourceColumn: record.source.start.column - 1,
        name: record.id,
      });
    });
    return builder.build('consumer-check.tsx', '').mappings;
  };
  try {
    const tsMappings = buildMappings(acceptRecordsTs);
    const oxcMappings = buildMappings(acceptRecordsOxc);
    sourceMapMappingsEqual = tsMappings === oxcMappings;
    sourceMapConsumerOk = true;
  } catch (error) {
    failures.push(`source-map consumer check threw: ${String(error)}`);
  }
}
check(sourceMapConsumerOk && sourceMapMappingsEqual, 'source-map consumer verification failed');

// ---------------------------------------------------------------------------
// Phase 3: timing (median of 50, warmup 5) and memory (Deno.memoryUsage deltas)
// ---------------------------------------------------------------------------
interface TimingRow {
  sample: string;
  path: string;
  medianMs: number;
  minMs: number;
  maxMs: number;
}

function bench(sample: string, pathLabel: string, runs: number, fn: () => unknown): TimingRow {
  for (let i = 0; i < 5; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return {
    sample,
    path: pathLabel,
    medianMs: Number(times[Math.floor(times.length / 2)].toFixed(4)),
    minMs: Number(times[0].toFixed(4)),
    maxMs: Number(times[times.length - 1].toFixed(4)),
  };
}

const RUNS = 50;
const timings: TimingRow[] = [];
for (const { virtual: name } of SAMPLES) {
  const source = sampleTexts.get(name)!;
  const file = `/project/app/islands/${name}`;
  timings.push(
    bench(name, 'ts createSourceFile+transpileModule', RUNS, () => {
      ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
      ts.transpileModule(source, {
        fileName: file,
        reportDiagnostics: true,
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
      });
    }),
  );
  timings.push(
    bench(
      name,
      'ts createSourceFile only',
      RUNS,
      () => ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX),
    ),
  );
  timings.push(
    bench(name, 'oxc parseSync', RUNS, () => parseSync(file, source, { sourceType: 'module' })),
  );
}
// Full-pipeline row on the accept sample: real compiler vs minimal oxc analysis.
{
  const source = sampleTexts.get('a-counter.tsx')!;
  const file = '/project/app/islands/a-counter.tsx';
  timings.push(
    bench(
      'a-counter.tsx',
      'FULL compileElementProgram (real compiler)',
      RUNS,
      () => compileElementProgram(source, file),
    ),
  );
  timings.push(
    bench(
      'a-counter.tsx',
      'FULL oxcAnalyze (minimal analysis)',
      RUNS,
      () => oxcAnalyze(source, file),
    ),
  );
}

interface MemoryRow {
  path: string;
  iterations: number;
  rssDeltaBytes: number;
  heapUsedDeltaBytes: number;
  externalDeltaBytes: number;
}

function memoryRow(pathLabel: string, iterations: number, fn: () => unknown): MemoryRow {
  fn(); // settle one run outside the measurement window
  const before = Deno.memoryUsage();
  for (let i = 0; i < iterations; i++) fn();
  const after = Deno.memoryUsage();
  return {
    path: pathLabel,
    iterations,
    rssDeltaBytes: after.rss - before.rss,
    heapUsedDeltaBytes: after.heapUsed - before.heapUsed,
    externalDeltaBytes: after.external - before.external,
  };
}

const MEM_ITERATIONS = 200;
const counterSource = sampleTexts.get('a-counter.tsx')!;
const counterFile = '/project/app/islands/a-counter.tsx';
const memory: MemoryRow[] = [
  memoryRow(
    'oxc parseSync',
    MEM_ITERATIONS,
    () => parseSync(counterFile, counterSource, { sourceType: 'module' }),
  ),
  memoryRow(
    'ts createSourceFile only',
    MEM_ITERATIONS,
    () =>
      ts.createSourceFile(
        counterFile,
        counterSource,
        ts.ScriptTarget.ES2022,
        true,
        ts.ScriptKind.TSX,
      ),
  ),
  memoryRow('ts createSourceFile+transpileModule', MEM_ITERATIONS, () => {
    ts.createSourceFile(
      counterFile,
      counterSource,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TSX,
    );
    ts.transpileModule(counterSource, {
      fileName: counterFile,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    });
  }),
];

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const environment = {
  date: new Date().toISOString().slice(0, 10),
  deno: Deno.version.deno,
  v8: Deno.version.v8,
  typescriptApi: ts.version,
  oxcParserPin: OXC_PIN,
  os: Deno.build.os,
  arch: Deno.build.arch,
};

const summary = {
  environment,
  samples: reports,
  sourceMapConsumer: { ok: sourceMapConsumerOk, mappingsEqual: sourceMapMappingsEqual },
  timings,
  memory,
  memoryCaveat:
    'Deno.memoryUsage() deltas over 200 unforced-GC iterations; rss/heapUsed deltas are indicative only. ' +
    'oxc-parser N-API native (Rust) allocations are not broken out separately; no per-allocation tool was used.',
  failures,
};

console.log('=== environment ===');
console.log(JSON.stringify(environment, null, 2));
console.log('=== sample parity ===');
for (const r of reports) {
  console.log(
    `${r.sample} (${r.bytes}B)  oracle=${r.oracle.verdict}${
      r.oracle.code ? '/' + r.oracle.code : ''
    }` +
      `${r.oracle.position ? ' @' + r.oracle.position : ''}  oxc=${r.oxc.verdict}` +
      `${r.oxc.code ? '/' + r.oxc.code : ''}${r.oxc.position ? ' @' + r.oxc.position : ''}  ` +
      `verdict=${r.verdictParity ? 'MATCH' : 'FAIL'} diag=${
        r.diagnosticParity === null ? 'n/a' : r.diagnosticParity ? 'MATCH' : 'FAIL'
      } ` +
      `skeleton=${r.skeletonParity === null ? 'n/a' : r.skeletonParity ? 'MATCH' : 'FAIL'} facts=${
        r.moduleFactsParity ? 'MATCH' : 'FAIL'
      } ` +
      `oracleMatrix=${r.oracleMatrixOk ? 'OK' : 'DRIFT'}`,
  );
}
console.log('=== source-map consumer ===');
console.log(
  `builder accepted oxc-derived spans: ${sourceMapConsumerOk}; mappings identical: ${sourceMapMappingsEqual}`,
);
console.log('=== timings (median of 50, ms) ===');
for (const t of timings) {
  console.log(`${t.sample}  ${t.path}  median=${t.medianMs} min=${t.minMs} max=${t.maxMs}`);
}
console.log('=== memory (deltas over 200 iterations, bytes) ===');
for (const m of memory) {
  console.log(
    `${m.path}  rss=${m.rssDeltaBytes} heapUsed=${m.heapUsedDeltaBytes} external=${m.externalDeltaBytes}`,
  );
}
console.log('=== result ===');
if (failures.length > 0) {
  console.log(`FAIL (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  const outIndex = Deno.args.indexOf('--out');
  if (outIndex >= 0 && Deno.args[outIndex + 1]) {
    await Deno.writeTextFile(Deno.args[outIndex + 1], JSON.stringify(summary, null, 2));
  }
  Deno.exit(1);
}
console.log('PASS: 7/7 samples full parity; source-map consumer verified; oracle matrix stable');
const outIndex = Deno.args.indexOf('--out');
if (outIndex >= 0 && Deno.args[outIndex + 1]) {
  await Deno.writeTextFile(Deno.args[outIndex + 1], JSON.stringify(summary, null, 2));
  console.log(`wrote ${Deno.args[outIndex + 1]}`);
}
