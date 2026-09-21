/**
 * @openelement/element — #1413 W3: the Vite adapter boundary hands the build
 * a STRUCTURED diagnostic ({id, loc, frame} + the diagnostics array), not a
 * pre-joined display string.
 *
 * The structured record already existed
 * (`internal/compiler/semantic-core/diagnostics/index.ts`) but the plugin
 * only forwarded `error.message`, so the build overlay could not underline
 * the authored line and no consumer could read the location without parsing
 * the message back apart. These steps pin the hand-off shape, the rendered
 * frame, and the message fallback at the same boundary the Vite dev server
 * and the Router `open:core` plugin both call.
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';

type PluginModule = typeof import('../src/internal/compiler/plugin.ts');

async function loadPluginModule(): Promise<PluginModule> {
  return await import('../src/internal/compiler/plugin.ts');
}

/** The shape Vite's `this.error()` receives for a Rollup-style build error. */
interface BuildError {
  id: string;
  loc: { file: string; line: number; column: number };
  frame: string;
  message: string;
  diagnostics: Array<{
    code: string;
    message: string;
    file: string;
    line: number;
    character: number;
  }>;
}

const SOURCE = [
  "import { element, OpenElement } from '@openelement/element';",
  "@element('oe-diag-proof')",
  'export class DiagProof extends OpenElement {',
  '  render() {',
  '    return <input {...this.attrs} />;',
  '  }',
  '}',
].join('\n');

const FILE = '/project/app/islands/diag-proof.tsx';

/** Capture what the hook reports through `this.error()` without throwing out. */
function captureBuildError(): { errors: unknown[]; context: { error(e: unknown): never } } {
  const errors: unknown[] = [];
  return {
    errors,
    context: {
      error(e: unknown): never {
        errors.push(e);
        throw new Error('build error captured');
      },
    },
  };
}

Deno.test('compiler plugin diagnostics (#1413): the adapter passes {id, loc, frame}', async () => {
  const { compiledElementPlugin } = await loadPluginModule();
  const transform = compiledElementPlugin().transform as unknown as (
    this: { error(e: unknown): never },
    code: string,
    id: string,
  ) => string | null;

  const { errors, context } = captureBuildError();
  let thrown = false;
  try {
    transform.call(context, SOURCE, FILE);
  } catch {
    thrown = true;
  }
  assert(thrown, 'unsupported spread must fail closed');
  assertEquals(errors.length, 1, 'exactly one build error is raised');

  const error = errors[0] as BuildError;
  assert(
    error !== null && typeof error === 'object',
    'the build error must be a structured object',
  );
  // `id` is the caller's own module id — the key module resolution/HMR use.
  assertEquals(error.id, FILE);
  // `loc` is the authored position: named file, 1-based line and column. With
  // no project/workspace root in this harness the compiler's stable module id
  // is the id unchanged, so the diagnostic names the same file as `id`.
  assertEquals(error.loc.file, FILE);
  assertEquals(error.loc.line, 5, 'the spread attribute sits on source line 5');
  assert(error.loc.column > 0, 'the column is 1-based');
  // `frame` renders the authored line and carets the offending range.
  assertStringIncludes(error.frame, '{...this.attrs}');
  assertStringIncludes(error.frame, '^');
  assertStringIncludes(error.frame, '5 |');
  // The display message survives for log-only consumers.
  assertStringIncludes(error.message, 'diag-proof.tsx:5:');
  assertStringIncludes(error.message, 'OEC9011');
  // The machine-readable array rides along, so no consumer parses the string.
  assertEquals(error.diagnostics.length, 1);
  assertEquals(error.diagnostics[0].code, 'OEC9011');
  assertEquals(error.diagnostics[0].line, error.loc.line);
});

Deno.test('compiler plugin diagnostics (#1413): a clean module still transforms', async () => {
  const { compiledElementPlugin } = await loadPluginModule();
  const transform = compiledElementPlugin().transform as unknown as (
    this: { error(e: unknown): never },
    code: string,
    id: string,
  ) => string | null;
  const { errors, context } = captureBuildError();
  const clean = [
    "import { element, OpenElement, property } from '@openelement/element';",
    "@element('oe-diag-clean')",
    'export class DiagClean extends OpenElement {',
    '  @property({ reflect: true }) count = 0;',
    '  render() { return <p>{this.count}</p>; }',
    '}',
  ].join('\n');
  const emitted = transform.call(context, clean, '/project/app/islands/diag-clean.tsx');
  assertEquals(errors, []);
  assert(typeof emitted === 'string' && emitted.includes('__partProgram'));
});
