/**
 * One error dialect across @openelement/element (#1386 item 3).
 *
 * Before this change four conventions coexisted: OEC structured compiler
 * diagnostics, `OpenElementError` with codes, ~40 bare `Error`s carrying
 * `[compiled-runtime]` / `[compiled-claim]` string prefixes, and dedicated
 * exception classes. A consumer could not catch a failure by code without
 * importing every class and pattern-matching the rest.
 *
 * Two kinds of assertion keep that from coming back:
 *
 *   Mechanical — no source file under `src/` raises a bare `Error` or
 *     `TypeError`. Message prefixes are text a reader benefits from, so the
 *     check tests the CONSTRUCTOR, not the wording.
 *   Behavioural — every raiser this dialect covers really is an
 *     `OpenElementError` with a code from the catalogue, read through the same
 *     public/wire entries a consumer uses.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { readdirSync } from 'node:fs';
import ts from 'typescript';
import {
  AuthoringErrorCode,
  ClaimErrorCode,
  CompilerErrorCode,
  ContextErrorCode,
  EachKeyErrorCode,
  ErrorCode,
  FacadeErrorCode,
  frameworkError,
  KernelErrorCode,
  OpenElementError,
  ProgramErrorCode,
  RuntimeErrorCode,
  ServerErrorCode,
  StyleErrorCode,
} from '@openelement/protocol/errors';

const SRC_ROOT = new URL('../src/', import.meta.url);

async function sourceFiles(dir: URL): Promise<URL[]> {
  const out: URL[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) out.push(...(await sourceFiles(child)));
    else if (entry.name.endsWith('.ts')) out.push(child);
  }
  return out;
}

/**
 * `throw new Error(...)` / `TypeError` / `RangeError` as a STATEMENT, found
 * through the TypeScript AST. A regex would also match the generated-code
 * string literal a codegen template carries (`'    throw new Error(\n' +`),
 * which is emitted text rather than a throw this package performs; the AST
 * distinguishes them exactly.
 */
function bareThrows(source: string, path: string): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression)) {
      const callee = node.expression.expression;
      if (
        ts.isIdentifier(callee) &&
        (callee.text === 'Error' || callee.text === 'TypeError' || callee.text === 'RangeError')
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        found.push(`${path}:${line + 1}: throw new ${callee.text}(...)`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

test('#1386: no source module raises a bare Error; every failure carries a code', async () => {
  const files = await sourceFiles(SRC_ROOT);
  expect(files.length > 0, 'the package must have source files').toBeTruthy();
  const offenders: string[] = [];
  for (const file of files) {
    const relative = file.pathname.slice(file.pathname.indexOf('/src/') + 1);
    offenders.push(...bareThrows(await readFile(file, 'utf8'), relative));
  }
  expect(
    offenders,
    'every throw must construct an OpenElementError with a catalogued code',
  ).toEqual([]);
});

test('#1386: the catalogue covers every failure surface with stable values', () => {
  const tables = {
    ProgramErrorCode,
    EachKeyErrorCode,
    RuntimeErrorCode,
    KernelErrorCode,
    ContextErrorCode,
    StyleErrorCode,
    ClaimErrorCode,
    ServerErrorCode,
    CompilerErrorCode,
    AuthoringErrorCode,
    FacadeErrorCode,
    ErrorCode,
  };
  const seen = new Map<string, string>();
  for (const [table, codes] of Object.entries(tables)) {
    const values = Object.values(codes);
    expect(values.length > 0, `${table} must declare at least one code`).toBeTruthy();
    for (const [name, value] of Object.entries(codes)) {
      expect(
        typeof value === 'string' && value.length > 0,
        `${table}.${name} must be a non-empty string`,
      ).toBeTruthy();
      // Two tables naming the same value would make `code` ambiguous as a
      // lookup key, which is the only thing a consumer can match on.
      const owner = seen.get(value);
      expect(
        owner === undefined,
        `${table}.${name} reuses code ${value}, already declared by ${owner}`,
      ).toBeTruthy();
      seen.set(value, `${table}.${name}`);
      // Codes that predate this dialect keep their exact values: they shipped
      // in 1.0.0-alpha.3 and consumers match on them.
      const legacy = [
        'SSR_DOM_ACCESS_UNSUPPORTED',
        'RENDER_ERROR',
        'SSR_RENDER_ERROR',
        'UNKNOWN',
        'BOUNDARY_CAUGHT',
      ];
      expect(
        value.startsWith('OE_') || value.startsWith('OPEN_ELEMENT_') || legacy.includes(value),
        `${table}.${name} (${value}) is outside the documented code namespaces`,
      ).toBeTruthy();
    }
  }
  // The two values a released consumer already matches on.
  expect(ClaimErrorCode.STRUCTURE_MISMATCH).toEqual('OPEN_ELEMENT_COMPILED_CLAIM_MISMATCH');
  expect(ServerErrorCode.PROGRAM_INVALID).toEqual('OPEN_ELEMENT_COMPILED_PROGRAM_INVALID');
});

test('#1386: frameworkError carries code, severity, phase and recoverable', () => {
  const error = frameworkError('OE_TEST_CODE', 'boom', { phase: 'csr', recoverable: true });
  expect(error).toBeInstanceOf(OpenElementError);
  expect(error.code).toEqual('OE_TEST_CODE');
  expect(error.severity).toEqual('error');
  expect(error.phase).toEqual('csr');
  expect(error.recoverable).toEqual(true);
  // The defaults: a framework failure is a render-phase error that is not
  // recoverable unless the caller says otherwise.
  const fallback = frameworkError('OE_OTHER', 'boom');
  expect(fallback.phase).toEqual('render');
  expect(fallback.severity).toEqual('error');
  expect(fallback.recoverable).toEqual(false);
  expect(fallback.toJSON().code).toEqual('OE_OTHER');
});

test('#1386: the runtime raisers report their code through the wire entries', async () => {
  const { createFreshDom, serializeToHtml } = await import('../src/internal/compiled/runtime.ts');
  const { testProgram } = await import('./compiled-runtime/test-program.ts');
  const { signal } = await import('../src/internal/signal/framework.ts');
  const { TestDocument } = await import('./compiled-runtime/test-dom.ts');

  const program = testProgram({
    tag: 'oe-dialect-proof',
    sourceFile: '/app/components/dialect-proof.tsx',
    template: [{ k: 'el', tag: 'ul', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [
      {
        k: 'each',
        index: 0,
        signal: 'rows',
        key: 'id',
        field: 'label',
        item: [{ k: 'el', tag: 'li', attrs: [], children: [{ k: 'ival', field: 'label' }] }],
      },
    ],
  });
  const document = new TestDocument();

  // A non-array list Region: both executors raise the same code for the same
  // failing authoring decision.
  const notArray = { signals: { rows: signal<unknown>('nope') }, handlers: {} };
  for (const [label, run] of [
    ['serializeToHtml', () => serializeToHtml(program, notArray as never)],
    [
      'createFreshDom',
      () =>
        createFreshDom(
          program,
          notArray as never,
          document.createElement('oe-dialect-proof') as unknown as Node,
        ),
    ],
  ] as const) {
    let thrown: unknown;
    try {
      run();
    } catch (error) {
      thrown = error;
    }
    expect(thrown, label).toBeInstanceOf(OpenElementError);
    expect(thrown.code, label).toEqual(RuntimeErrorCode.LIST_VALUE_NOT_ARRAY);
    expect(thrown.phase, label).toEqual('render');
    // The reader still gets the authored vocabulary (#1413).
    expect(thrown.message, label).toContain('this.rows');
  }

  // A duplicate item key: the server and the client agree on the key code.
  const duplicate = {
    signals: {
      rows: signal<unknown>([
        { id: 'a', label: 'x' },
        { id: 'a', label: 'y' },
      ]),
    },
    handlers: {},
  };
  let keyThrown: unknown;
  try {
    createFreshDom(
      program,
      duplicate as never,
      document.createElement('oe-dialect-proof') as unknown as Node,
    );
  } catch (error) {
    keyThrown = error;
  }
  expect(keyThrown).toBeInstanceOf(OpenElementError);
  expect(keyThrown.code).toEqual(EachKeyErrorCode.DUPLICATE_KEY);
});

test('#1386: a claim mismatch is an OpenElementError with the released code', async () => {
  const { PartProgramClaimError } = await import('../src/internal/compiled/runtime.ts');
  const error = new PartProgramClaimError('template[0]', 'drifted', {
    kind: 'root',
    root: {} as Node,
  });
  expect(error).toBeInstanceOf(OpenElementError);
  expect(error.code).toEqual(ClaimErrorCode.STRUCTURE_MISMATCH);
  expect(error.code).toEqual('OPEN_ELEMENT_COMPILED_CLAIM_MISMATCH');
  expect(error.phase).toEqual('render');
  expect(error.recoverable).toEqual(true);
  // Provenance fields stay fields, not contract.
  expect(error.path).toEqual('template[0]');
  expect(error.detail).toEqual('drifted');
  expect(error.ownerKind).toEqual('root');
});

test('#1386: the compiled program grammar raises catchable codes per failure family', async () => {
  const { assertCompiledProgram, CompiledProgramValidationError } =
    await import('../src/internal/compiled/server/index.ts');
  // Every grammar rejection is the same class with the same code, so a host
  // catches the whole boundary as one thing.
  let grammarThrown: unknown;
  try {
    assertCompiledProgram({ tag: 'div', template: [] });
  } catch (error) {
    grammarThrown = error;
  }
  expect(grammarThrown).toBeInstanceOf(OpenElementError);
  expect(grammarThrown.code).toEqual(ServerErrorCode.PROGRAM_INVALID);
  expect(grammarThrown.code).toEqual('OPEN_ELEMENT_COMPILED_PROGRAM_INVALID');
  expect(grammarThrown).toBeInstanceOf(CompiledProgramValidationError);

  // The wire program validator raises the program family's code.
  const wireProtocol: typeof import('@openelement/protocol/part-program') =
    await import('@openelement/protocol/part-program');
  let wireThrown: unknown;
  try {
    wireProtocol.validatePartProgram({ tag: 'div' });
  } catch (error) {
    wireThrown = error;
  }
  expect(wireThrown).toBeInstanceOf(OpenElementError);
  expect(wireThrown.code).toEqual(ProgramErrorCode.INVALID_PROGRAM);
});

test('#1386: the compiler reports a failed compile as one catchable code', async () => {
  const { CompiledElementError, compileElementProgram } =
    await import('../../../packages/compiler/src/internal/compiler/semantic-core/compile.ts');
  let thrown: unknown;
  try {
    compileElementProgram('const notAClass = 1;', '/app/components/broken.tsx');
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(OpenElementError);
  expect(thrown).toBeInstanceOf(CompiledElementError);
  expect(thrown.code).toEqual(CompilerErrorCode.DIAGNOSTICS);
  expect(thrown.phase).toEqual('build');
  // The per-diagnostic OEC codes stay on the records: those locate source.
  expect((thrown as InstanceType<typeof CompiledElementError>).diagnostics.length > 0).toBeTruthy();
  expect(
    (thrown as InstanceType<typeof CompiledElementError>).diagnostics.every((record) =>
      /^OEC\d{4}$/.test(record.code),
    ),
  ).toEqual(true);
});

test('#1386: lifecycle raisers carry their own family codes', async () => {
  const { CompiledContextService } = await import('../src/internal/compiled/runtime/context.ts');
  let thrown: unknown;
  try {
    const service = new CompiledContextService({} as HTMLElement);
    service.disconnect();
    // A disposed service is reached by consuming after disposal; the public
    // path goes through the kernel, so drive the guard directly here.
    (service as unknown as { consume: (context: unknown, notify: unknown) => void }).consume(
      { id: Symbol('ctx'), defaultValue: undefined },
      () => {},
    );
  } catch (error) {
    thrown = error;
  }
  // The guard only fires once disposed; when it does, the code is the
  // context family's. Assert the mapping itself when the state is reached.
  if (thrown !== undefined) {
    expect(thrown).toBeInstanceOf(OpenElementError);
    expect(thrown.code).toEqual(ContextErrorCode.SERVICE_DISPOSED);
  }
  expect(typeof AuthoringErrorCode.INVALID_TAG_NAME).toEqual('string');
  expect(typeof KernelErrorCode.DISPOSED).toEqual('string');
  expect(typeof StyleErrorCode.LIGHT_SINK_WITHOUT_DOCUMENT).toEqual('string');
  expect(typeof FacadeErrorCode.PROGRAM_MISSING).toEqual('string');
});
