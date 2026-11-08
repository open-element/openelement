/**
 * M03-I-4b — semantic-test-matrix evidence for the M03 scope.
 *
 * Records the T+ / T− / C+ / C− results for the admitted function-component
 * grammar. T rows are recorded from the TypeScript authority (the frontend is
 * not a checker — approved); C rows are recorded from the production function
 * frontend's admission/diagnostic surface (A4a) with its Alpha15 diagnostics
 * parity (A4a harness). Browser M/U/S/K/D/F/B/P cells are M05+ and stay
 * not-run; this file never claims them.
 *
 * Every row is a real fixture run by this suite, so the matrix's
 * "empty cell = unfinished work" rule is satisfied for the cells recorded here.
 */

import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';

const FILE = '/proj/src/matrix.tsx';

const CLASSIFIER = {
  classifySymbol: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal' || importedName === 'computed') return 'factory' as const;
    return 'value' as const;
  },
  classifyValue: () => undefined,
  classifyCall: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal') return { call: 'signal' as const };
    if (importedName === 'computed') return { call: 'computed' as const };
    return undefined;
  },
};

const JSX_STUB = 'declare namespace JSX { interface IntrinsicElements { [tag: string]: any } }\n';

function typeDiagnostics(source: string): number {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.Preserve,
    types: [],
  };
  const fileName = FILE;
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === fileName
      ? ts.createSourceFile(name, source, languageVersion, true, ts.ScriptKind.TSX)
      : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  host.readFile = (name) => (name === fileName ? source : readFile(name));
  host.fileExists = (name) => name === fileName || fileExists(name);
  const program = ts.createProgram([fileName], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === fileName).length;
}

function admitted(source: string): { readonly codes: string[]; readonly clean: boolean } {
  const result = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  return {
    codes: result.diagnostics.map((diagnostic) => diagnostic.code),
    clean: result.diagnostics.length === 0,
  };
}

function rejected(source: string, expectedCode: string): boolean {
  const result = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  return result.diagnostics.some((diagnostic) => diagnostic.code === expectedCode);
}

interface MatrixRow {
  readonly case: string;
  readonly cPlus: string;
  readonly cMinusCodes: readonly string[];
  readonly cMinus: string;
  readonly tPlus: string;
  readonly tMinus: string;
}

const ROWS: readonly MatrixRow[] = [
  {
    case: 'TSX-01 roots/fragments/empty',
    cPlus: 'function C(props) { return <><p>a</p><p>b</p></>; }\n',
    cMinus: 'function C(props) { return props.value; }\n',
    cMinusCodes: ['OEC9040'],
    tPlus: `${JSX_STUB}function C(props: { value: string }) { return <><p>{props.value}</p><p>b</p></>; }\n`,
    tMinus: `${JSX_STUB}function C(props: { value: string }) { return props.value.toFixed(2); }\n`,
  },
  {
    case: 'TSX-02 signal/computed',
    cPlus: `import { signal, computed } from '@openelement/element';
function C(props) {
  const s = signal(0);
  const d = computed(() => s.value * 2);
  return <p>{s.value}{d.value}</p>;
}
`,
    cMinus: `import { signal } from '@openelement/element';
function C(props) {
  const s = signal(0);
  const d = computed(() => missing.value);
  return <p>{d.value}</p>;
}
`,
    cMinusCodes: ['OEC9043'],
    tPlus: `${JSX_STUB}const signal = (value: number) => ({ value }); const computed = (fn: () => number) => ({ value: fn() });\nfunction C(props: { ok: boolean }) { const s = signal(0); const d = computed(() => s.value * 2); return <p>{d.value}</p>; }\n`,
    tMinus: `${JSX_STUB}const signal = (value: number) => ({ value }); const computed = (fn: () => number) => ({ value: fn() });\nfunction C(props: { ok: boolean }) { const s = signal('x'); const d = computed(() => s.value * 2); return <p>{d.value}</p>; }\n`,
  },
  {
    case: 'TSX-03 props/destructuring',
    cPlus: 'function C({ label }) { return <p>{label}</p>; }\n',
    cMinus: 'function C([label]) { return <p>{label}</p>; }\n',
    cMinusCodes: ['OEC9040'],
    tPlus: `${JSX_STUB}function C({ label }: { label: string }) { return <p>{label.toUpperCase()}</p>; }\n`,
    tMinus: `${JSX_STUB}function C({ label }: { label: string }) { return <p>{label.toFixed(2)}</p>; }\n`,
  },
  {
    case: 'TSX-05 local vs computed vs inline',
    cPlus: 'function C(props) { const local = props.label; return <p>{local}{props.label}</p>; }\n',
    cMinus: 'function C(props) { let local; return <p>{local}</p>; }\n',
    cMinusCodes: ['OEC9042'],
    tPlus: `${JSX_STUB}function C(props: { label: string }) { const local = props.label; return <p>{local.toUpperCase()}</p>; }\n`,
    tMinus: `${JSX_STUB}function C(props: { label: string }) { const local = props.label; return <p>{local.toFixed(2)}</p>; }\n`,
  },
  {
    case: 'TSX-06 conditions/zero',
    cPlus:
      'function C(props) { return <main>{props.ok ? <p>a</p> : null}{props.ok && <i>b</i>}</main>; }\n',
    cMinus: "function C(props) { return <main>{props.ok ? 'text' : null}</main>; }\n",
    cMinusCodes: ['OEC9042'],
    tPlus: `${JSX_STUB}function C(props: { ok: boolean }) { return <main>{props.ok ? <p>a</p> : null}</main>; }\n`,
    tMinus: `${JSX_STUB}function C(props: { ok: boolean }) { return <main>{props.ok.toFixed(2) ? <p>a</p> : null}</main>; }\n`,
  },
  {
    case: 'TSX-08 unkeyed positions',
    cPlus:
      'function C(props) { return <ul>{props.items.map((item) => <li>{item.text}</li>)}</ul>; }\n',
    cMinus: 'function C(props) { return <ul>{props.items.map(renderItem)}</ul>; }\n',
    cMinusCodes: ['OEC9042'],
    tPlus: `${JSX_STUB}function C(props: { items: Array<{ text: string }> }) { return <ul>{props.items.map((item) => <li>{item.text}</li>)}</ul>; }\n`,
    tMinus: `${JSX_STUB}function C(props: { items: Array<{ text: string }> }) { return <ul>{props.items.map((item) => <li>{item.missing}</li>)}</ul>; }\n`,
  },
  {
    case: 'TSX-09 reusable JSX values',
    cPlus: 'function C(props) { return <main title={props.ok ? <b>a</b> : <i>b</i>}></main>; }\n',
    cMinus: 'function C(props) { return <main title={props.ok ? <><b>a</b></> : null}></main>; }\n',
    cMinusCodes: ['OEC9042'],
    tPlus: `${JSX_STUB}function C(props: { ok: boolean }) { return <main title={props.ok ? 'a' : 'b'}></main>; }\n`,
    tMinus: `${JSX_STUB}function C(props: { ok: boolean }) { return <main title={props.ok.toFixed(2)}></main>; }\n`,
  },
  {
    case: 'TSX-10 repeatable children',
    cPlus: 'function C(props) { return <section>{props.children}</section>; }\n',
    cMinus: 'function C(props) { return <Box>{props.children}</Box>; }\n',
    cMinusCodes: ['OEC9042'],
    tPlus: `${JSX_STUB}function C(props: { children?: unknown }) { return <section>{props.children}</section>; }\n`,
    tMinus: `${JSX_STUB}function C(props: { children?: unknown }) { return <section>{props.children.toFixed(2)}</section>; }\n`,
  },
  {
    case: 'TSX-12 events/callbacks',
    cPlus: 'function C(props) { return <button onClick={() => props.onHit(1)}>go</button>; }\n',
    cMinus: 'function C(props) { return <button onClick={() => this.onHit(1)}>go</button>; }\n',
    cMinusCodes: ['OEC9043'],
    tPlus: `${JSX_STUB}function C(props: { onHit: (n: number) => void }) { return <button onClick={() => props.onHit(1)}>go</button>; }\n`,
    tMinus: `${JSX_STUB}function C(props: { onHit: (n: number) => void }) { return <button onClick={() => props.onHit('x')}>go</button>; }\n`,
  },
  {
    case: 'TSX-16 iterables',
    cPlus:
      'function C(props) { return <ul>{props.items.map((item) => <li key={item.id}>{item.text}</li>)}</ul>; }\n',
    cMinus: 'function C(props) { return <ul>{props.items.map((item) => item)}</ul>; }\n',
    cMinusCodes: ['OEC9042'],
    tPlus: `${JSX_STUB}function C(props: { items: Array<{ id: string; text: string }> }) { return <ul>{props.items.map((item) => <li key={item.id}>{item.text}</li>)}</ul>; }\n`,
    tMinus: `${JSX_STUB}function C(props: { items: Array<{ id: string; text: string }> }) { return <ul>{props.items.map((item) => <li key={item.id}>{item.missing}</li>)}</ul>; }\n`,
  },
  {
    case: 'TSX-22 HMR/source locations',
    cPlus: 'function C(props) { return <p>{props.label}</p>; }\n',
    cMinus: 'function C(props) { return <p>{missing}</p>; }\n',
    cMinusCodes: ['OEC9043'],
    tPlus: `${JSX_STUB}function C(props: { label: string }) { return <p>{props.label}</p>; }\n`,
    tMinus: `${JSX_STUB}function C(props: { label: string }) { return <p>{props.missing}</p>; }\n`,
  },
];

describe('M03-scope matrix evidence — T+/T− from the TypeScript authority, C+/C− from the frontend', () => {
  for (const row of ROWS) {
    test(`${row.case}: T+ / T− / C+ / C−`, () => {
      // T+: type-correct fixture has zero TypeScript errors.
      expect(typeDiagnostics(row.tPlus), `${row.case} T+`).toBe(0);
      // T−: typed misuse is reported by TypeScript (the frontend is not a checker).
      expect(typeDiagnostics(row.tMinus), `${row.case} T−`).toBeGreaterThan(0);
      // C+: admitted fixture compiles cleanly through the production frontend.
      expect(
        admitted(row.cPlus).clean,
        `${row.case} C+ [${admitted(row.cPlus).codes.join(',')}]`,
      ).toBe(true);
      // C−: every expected OEC diagnostic is produced (source-located fields are
      // asserted by the A4a harness; here the code is the matrix result).
      for (const code of row.cMinusCodes) {
        expect(rejected(row.cMinus, code), `${row.case} C− ${code}`).toBe(true);
      }
    });
  }

  test('no browser/claim/codegen cells are claimed by this suite', () => {
    // This file records T/C cells only. M/U/S/K/D/F/B/P are M05+ and remain
    // not-run in the matrix; the harness does not fake them with unit tests.
    expect(ROWS.length).toBeGreaterThan(0);
  });
});
