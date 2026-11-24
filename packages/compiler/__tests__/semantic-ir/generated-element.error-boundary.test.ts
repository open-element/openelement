/**
 * `16b-EB` author-facing error boundary — compiler contract (LOCAL, Node).
 *
 * `onError(cb)` is the FOURTH compiler-erased intrinsic of the generated-element
 * lane. This suite is the compiler half; the runtime half (the shell's three
 * capture points in a real Chromium element) is
 * `generated-element.error-boundary.browser.test.ts`.
 *
 * What is pinned here:
 *
 * - ADMISSION is the same placement/provenance rule as `16b-LC` and the change
 *   channel: a direct top-level statement of an admitted generated-element setup,
 *   callee resolved by BINDING PROVENANCE (a named import of
 *   '@openelement/element', aliases followed), exactly one inline
 *   arrow/function-expression callback, no type arguments, no generator, no
 *   async form, zero or one `env` parameter. Every refusal keeps the existing
 *   `OEC9042` form code; a non-intrinsic statement keeps the existing `OEC9041`
 *   component-body refusal. NO new diagnostic identity.
 * - ERASURE: the emitted module imports and calls neither `onError` nor
 *   `@openelement/element`; the registration rides the compiler-private host
 *   record exactly like `__oe_onPropertyChange`.
 * - The UPDATE-phase sink: a module with the intrinsic routes its refresh
 *   subscriptions and its event listeners through the executor's existing
 *   `guardUpdate(fn, sink)`; a module WITHOUT it keeps the exact two-name
 *   `bindSignalWrites` call and the unwrapped listener.
 * - BYTE IDENTITY: a module without `onError` is byte-identical to its
 *   pre-`16b-EB` output (SHA-256 pins captured from the clean tree before this
 *   change), including a module that already uses all THREE older intrinsics.
 * - SSR: the producer bytes are unchanged and the handler is never invoked on
 *   the server.
 *
 * LOCAL Node evidence. Not an M13 matrix row, not a public API freeze.
 */

import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  compileFunctionModule,
  type FunctionModelModule,
} from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { createGeneratedElementSiteResolver } from '../../../router/src/vite/generated-element-site.ts';
import { FacadeErrorCode, OpenElementError } from '../../../protocol/src/errors.ts';
import { onError } from '../../../element/src/index.ts';

const ISLANDS_DIR = 'app/islands';
const siteFor = createGeneratedElementSiteResolver(ISLANDS_DIR);

function sidecar(properties: string): string {
  return (
    "import { defineIslandConfig } from '@openelement/router';\n" +
    'export const openElement = defineIslandConfig({\n' +
    "  root: 'light',\n" +
    `  properties: { ${properties} },\n` +
    '});\n'
  );
}

const SIDECAR = sidecar('seed: { default: 0 }');

function site(name: string): { file: string; site: GeneratedElementSite } {
  const file = `${ISLANDS_DIR}/${name}.tsx`;
  return { file, site: siteFor(file)! };
}

function compileIsland(name: string, source: string): string {
  const fact = site(name);
  return compileGeneratedElementIfAdmitted(source, fact.file, { site: fact.site }).code;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function codes(error: unknown): string[] {
  expect(error).toBeInstanceOf(CompiledElementError);
  return (error as CompiledElementError).diagnostics.map((diagnostic) => diagnostic.code);
}

const FUNCTION_HEADER = /^\s*(?:export\s+)?function\s+([\w$]+)\s*\(/;

function stripQuoted(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** Locate one emitted function by brace slicing (test-side, no generator help). */
function functionRange(module: string, name: string): { start: number; end: number } {
  const lines = module.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const match = FUNCTION_HEADER.exec(lines[index]!);
    if (match === null || match[1] !== name) continue;
    let depth = 0;
    let opened = false;
    for (let cursor = index; cursor < lines.length; cursor++) {
      for (const character of stripQuoted(lines[cursor]!)) {
        if (character === '{') {
          depth += 1;
          opened = true;
        } else if (character === '}') {
          depth -= 1;
          if (opened && depth === 0) {
            return { start: index, end: cursor };
          }
        }
      }
    }
    throw new Error(`unterminated function '${name}'`);
  }
  throw new Error(`function '${name}' not found in the emitted module`);
}

function functionText(module: string, name: string): string {
  const range = functionRange(module, name);
  return module
    .split('\n')
    .slice(range.start, range.end + 1)
    .join('\n');
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/**
 * Whether the module calls the AUTHORED intrinsic `onError(...)`. The compiled
 * channel name `__oe_onError` contains the same letters, so a plain substring
 * check cannot answer this; the lookbehind excludes the `__oe_` prefix.
 */
function callsAuthoredOnError(module: string): boolean {
  return /(?<!__oe_)onError\s*\(/.test(module);
}

/** One root with an env-form error handler, a tracked slot and an event handler. */
const ERROR_SOURCE =
  SIDECAR +
  "import { onError } from '@openelement/element';\n" +
  'function ErrCard(props: { seed: number }) {\n' +
  '  onError((env) => { globalThis.__oeCaught = env.error; });\n' +
  '  return <button onClick={() => { throw new Error("boom"); }}>{props.seed}</button>;\n' +
  '}\n' +
  'export default ErrCard;\n';

/** The same component with the hook statement replaced by a same-line comment. */
const ERROR_SOURCE_NO_HOOKS =
  SIDECAR +
  "import { onError } from '@openelement/element';\n" +
  'function ErrCard(props: { seed: number }) {\n' +
  '  // onError((env) => { globalThis.__oeCaught = env.error; });\n' +
  '  return <button onClick={() => { throw new Error("boom"); }}>{props.seed}</button>;\n' +
  '}\n' +
  'export default ErrCard;\n';

/**
 * A module that already uses ALL THREE older intrinsics plus a tracked slot and
 * a DOM event handler. Its pin is the "adding a fourth admitted name changes no
 * existing module" obligation: not one byte of this output may move.
 */
const THREE_INTRINSICS_SOURCE =
  SIDECAR +
  "import { onConnect, onDispose, onPropertyChange } from '@openelement/element';\n" +
  'function Hooked(props: { seed: number }) {\n' +
  '  const snapshot = props.seed;\n' +
  '  onConnect((env) => { globalThis.__a = env.host; });\n' +
  '  onDispose(() => { globalThis.__b = snapshot; });\n' +
  '  onPropertyChange((event) => { globalThis.__c = event.name; });\n' +
  '  return <button onClick={() => { globalThis.__d = props.seed; }}>{props.seed}</button>;\n' +
  '}\n' +
  'export default Hooked;\n';

const PLAIN_SOURCE =
  SIDECAR +
  'function Plain(props: { seed: number }) {\n' +
  '  return <span className="x">{props.seed}</span>;\n' +
  '}\n' +
  'export default Plain;\n';

describe('16b-EB error boundary — emitted artifact contract (Node)', () => {
  test('B1 the intrinsic is erased: the module imports and calls neither onError nor the public entry', () => {
    const module = compileIsland('error-erased', ERROR_SOURCE);
    expect(callsAuthoredOnError(module)).toBe(false);
    expect(module).not.toMatch(/from\s+"@openelement\/element"/);
    expect(module).not.toMatch(/from\s+'@openelement\/element'/);
    // The callback body itself is present — it is erased as a CALL, not dropped.
    expect(module).toContain('__oeCaught');
  });

  test('B2 the registration rides the compiler-private host record, like the change channel', () => {
    const module = compileIsland('error-registration', ERROR_SOURCE);
    const factory = functionText(module, '__oe_rootInstance');
    // Guarded registration on the instance host record, with the lowered
    // callback verbatim: no dispatcher, no hook-order slot, no context object.
    expect(factory).toContain(
      'if (__oe_host.__oe_onError !== undefined) __oe_host.__oe_onError(((',
    );
    // Exactly one registration: the guard's presence check + the call.
    expect(occurrences(factory, '__oe_onError')).toBe(2);
    // The factory still returns an empty record (no new retained field).
    expect(factory).toContain('return {};');
    // The descriptor row is the unchanged call-once/retain site.
    expect(module).toContain('  createInstance: __oe_rootInstance,');
  });

  test('B3 the update-phase sink reaches refresh subscriptions and event listeners', () => {
    const module = compileIsland('error-update', ERROR_SOURCE);
    const mount = functionText(module, 'ErrCard__mount');
    // A tracked slot's subscription is guarded; the refresh function itself is
    // unchanged, so the mount-time initial call still throws into the shell.
    expect(mount).toContain('bindSignalWrites(__oe_scope, __oe_propDep, "props", guardUpdate(');
    expect(mount).toContain('__oe_host.__oe_reportError');
    // The DOM event listener is guarded the same way.
    expect(mount).toContain('const __oe_eventListener2 = guardUpdate((event) => ');
    expect(mount).toContain('__oe_eventHandler1(event), __oe_host.__oe_reportError);');
    // The executor's existing helper is imported, not re-implemented.
    expect(module).toMatch(/import \{[^}]*\bguardUpdate\b[^}]*\} from "@openelement\/element/);
  });

  test('B4 a module WITHOUT the intrinsic keeps the exact pre-16b-EB bytes (SHA-256 pins)', () => {
    // Pins captured from the clean tree BEFORE the change; the rule they guard
    // is "admitting a fourth name moves nobody else's output".
    expect(sha256(compileIsland('pbase-hooked', THREE_INTRINSICS_SOURCE))).toBe(
      '6a5f8c697e4172135ea7a0f230f0dc079489b380687d1e452b98a0bf39cc84cf',
    );
    expect(sha256(compileIsland('pbase-plain', PLAIN_SOURCE))).toBe(
      'cf0343e9d45a8e8b3a99572c2860a217837e988e3430f832caa392059b094823',
    );
    const hooked = compileIsland('pbase-hooked-shape', THREE_INTRINSICS_SOURCE);
    expect(hooked).not.toContain('guardUpdate');
    expect(hooked).not.toContain('__oe_onError');
    expect(hooked).not.toContain('__oe_reportError');
    // The two-name subscription form is preserved verbatim.
    expect(functionText(hooked, 'Hooked__mount')).toContain(
      'bindSignalWrites(__oe_scope, __oe_propDep, "props", __oe_refresh',
    );
  });

  test('B5 the SSR producer is byte-identical to the same component without the hook and invokes nothing', () => {
    const hookModule = compileIsland('error-ssr-hook', ERROR_SOURCE);
    const plainModule = compileIsland('error-ssr-plain', ERROR_SOURCE_NO_HOOKS);
    const hookSsr = functionText(hookModule, 'ErrCard__ssr');
    const plainSsr = functionText(plainModule, 'ErrCard__ssr');
    expect(hookSsr).toBe(plainSsr);
    for (const marker of ['__oe_onError', '__oe_reportError', 'guardUpdate', 'onError']) {
      expect(hookSsr, marker).not.toContain(marker);
    }
  });

  test('B6 a hook-only root still emits the factory and the descriptor row', () => {
    const source =
      SIDECAR +
      "import { onError } from '@openelement/element';\n" +
      'function OnlyError(props: { seed: number }) {\n' +
      '  onError(() => { globalThis.__oeCaught = 1; });\n' +
      '  return <p>{props.seed}</p>;\n' +
      '}\n' +
      'export default OnlyError;\n';
    const module = compileIsland('error-hook-only', source);
    expect(functionText(module, '__oe_rootInstance')).toContain('__oe_onError');
    expect(module).toContain('  createInstance: __oe_rootInstance,');
  });

  // ── admission: positives ────────────────────────────────────────────────

  test('B7 all three admitted callback shapes are accepted (zero-arg, env identifier, env pattern)', () => {
    const source =
      SIDECAR +
      "import { onError } from '@openelement/element';\n" +
      'function Shapes(props: { seed: number }) {\n' +
      '  onError(() => { globalThis.__zero = 1; });\n' +
      '  onError((env) => { globalThis.__ident = env.error; });\n' +
      '  onError(({ error }) => { globalThis.__pattern = error; });\n' +
      '  onError(function (env) { globalThis.__fn = env.error; });\n' +
      '  return <p>{props.seed}</p>;\n' +
      '}\n' +
      'export default Shapes;\n';
    const module = compileIsland('error-shapes', source);
    const factory = functionText(module, '__oe_rootInstance');
    expect(occurrences(factory, '__oe_onError((')).toBe(4);
    expect(callsAuthoredOnError(module)).toBe(false);
  });

  test('B8 an aliased import is followed', () => {
    const source =
      SIDECAR +
      "import { onError as catchIt } from '@openelement/element';\n" +
      'function Aliased(props: { seed: number }) {\n' +
      '  catchIt((env) => { globalThis.__oeCaught = env.error; });\n' +
      '  return <p>{props.seed}</p>;\n' +
      '}\n' +
      'export default Aliased;\n';
    const module = compileIsland('error-alias', source);
    expect(functionText(module, '__oe_rootInstance')).toContain('__oe_onError');
    expect(module).not.toContain('catchIt');
  });

  test('B9 the error kind is carried as its own model kind (distinct from the change channel)', () => {
    const source =
      SIDECAR +
      "import { onError, onPropertyChange } from '@openelement/element';\n" +
      'function Both(props: { seed: number }) {\n' +
      '  onError(() => { globalThis.__a = 1; });\n' +
      '  onPropertyChange((event) => { globalThis.__b = event.name; });\n' +
      '  return <p>{props.seed}</p>;\n' +
      '}\n' +
      'export default Both;\n';
    const file = `${ISLANDS_DIR}/error-kinds.tsx`;
    const front = compileFunctionModule(source, file, {
      importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
      lifecycleAdmission: { admission: 'root', root: 'Both' },
    });
    expect(front.diagnostics).toEqual([]);
    const kinds = front.module!.components[0]!.lifecycle.map((hook) => hook.kind);
    expect(kinds).toEqual(['error', 'property-change']);
  });

  // ── admission: refusals ─────────────────────────────────────────────────

  test('B10 an indirect reference / type arguments / generator / non-top-level are refused with the existing code', () => {
    const file = `${ISLANDS_DIR}/error-refusals.tsx`;
    const frontendCodes = (source: string): string[] => {
      const front = compileFunctionModule(source, file, {
        importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
        lifecycleAdmission: { admission: 'module' },
      });
      return front.diagnostics.map((diagnostic) => diagnostic.code);
    };
    const importLine = "import { onError } from '@openelement/element';\n";
    const wrap = (statement: string, prefix = ''): string =>
      prefix +
      importLine +
      `function Root(props) {\n  ${statement}\n  return <p>{props.x}</p>;\n}\n`;

    // Indirect reference: an identifier that names a function, not an inline callback.
    expect(frontendCodes(wrap('onError(handler);', 'const handler = () => {};\n'))).toEqual([
      'OEC9042',
    ]);
    // Type arguments are outside the admitted slice.
    expect(frontendCodes(wrap('onError<void>(() => {});'))).toEqual(['OEC9042']);
    // A generator callback is refused.
    expect(frontendCodes(wrap('onError(function* () {});'))).toEqual(['OEC9042']);
    // Arity: zero arguments and two arguments are both refused.
    expect(frontendCodes(wrap('onError();'))).toEqual(['OEC9042']);
    expect(frontendCodes(wrap('onError(() => {}, () => {});'))).toEqual(['OEC9042']);
    // Parameter shape: rest / optional / default / destructuring-with-rest.
    for (const malformed of [
      'onError((...rest) => { globalThis.__x = rest; });',
      'onError((env?) => { globalThis.__x = env; });',
      'onError((env = 1) => { globalThis.__x = env; });',
      'onError(([a]) => { globalThis.__x = a; });',
      'onError((a, b) => { globalThis.__x = a + b; });',
    ]) {
      expect(frontendCodes(wrap(malformed)), malformed).toEqual(['OEC9042']);
    }
    // `async` is outside the slice, exactly like the other three names.
    expect(frontendCodes(wrap('onError(async () => {});'))).toEqual(['OEC9042']);

    // NON-TOP-LEVEL placement: inside a nested block/expression it is not a
    // direct setup statement, so the component-body grammar keeps its refusal.
    expect(
      frontendCodes(
        importLine +
          'function Root(props) {\n' +
          '  if (props.x) { onError(() => {}); }\n' +
          '  return <p>{props.x}</p>;\n' +
          '}\n',
      ),
    ).toEqual(['OEC9041']);
    // Statement-level but not a call at all: unchanged grammar refusal. (A
    // `const hook = onError;` declaration is NOT a refusal — it is an ordinary
    // setup local reading a value, exactly as it is for the other three names.)
    expect(frontendCodes(wrap('onError;'))).toEqual(['OEC9041']);
  });

  test('B11 a wrong specifier / a local shadow / no lifecycle admission is NOT the intrinsic', () => {
    const file = `${ISLANDS_DIR}/error-provenance.tsx`;
    const frontendCodes = (
      source: string,
      admission: { admission: 'root'; root: string } | { admission: 'module' } | undefined,
    ): string[] => {
      const front = compileFunctionModule(source, file, {
        importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
        ...(admission === undefined ? {} : { lifecycleAdmission: admission }),
      });
      return front.diagnostics.map((diagnostic) => diagnostic.code);
    };
    const statement = 'onError(() => { globalThis.__x = 1; });';
    // A same-named import from a DIFFERENT module.
    expect(
      frontendCodes(
        "import { onError } from 'somewhere-else';\n" +
          `function Root(props) {\n  ${statement}\n  return <p>{props.x}</p>;\n}\n`,
        { admission: 'root', root: 'Root' },
      ),
    ).toEqual(['OEC9041']);
    // A local declaration shadowing the name.
    expect(
      frontendCodes(
        'function onError(cb: () => void) { cb(); }\n' +
          `function Root(props) {\n  ${statement}\n  return <p>{props.x}</p>;\n}\n`,
        { admission: 'root', root: 'Root' },
      ),
    ).toEqual(['OEC9041']);
    // No lifecycle admission (function pages, hostless leaves, the facts
    // projection): the statement grammar is untouched.
    expect(
      frontendCodes(
        "import { onError } from '@openelement/element';\n" +
          `function Root(props) {\n  ${statement}\n  return <p>{props.x}</p>;\n}\n`,
        undefined,
      ),
    ).toEqual(['OEC9041']);
    // A namespace member is not a value-position identifier binding.
    expect(
      frontendCodes(
        "import * as element from '@openelement/element';\n" +
          `function Root(props) {\n  element.onError(() => { globalThis.__x = 1; });\n  return <p>{props.x}</p>;\n}\n`,
        { admission: 'root', root: 'Root' },
      ),
    ).toEqual(['OEC9041']);
  });

  test('B12 placement outside the admitted body shapes fails closed at the AUTHORED span', () => {
    // The frontend admits the intrinsic module-wide; the GENERATOR owns
    // placement. A depth>=2 / recipe / non-retained target has no lifecycle
    // owner and must not silently drop the handler.
    const source =
      SIDECAR +
      "import { onError } from '@openelement/element';\n" +
      'function Leaf(props: { seed: number }) {\n' +
      '  onError(() => { globalThis.__x = 1; });\n' +
      '  return <p>{props.seed}</p>;\n' +
      '}\n' +
      'function Root(props: { seed: number }) {\n' +
      '  const recipe = <Leaf seed={props.seed} />;\n' +
      '  return <div>{recipe}</div>;\n' +
      '}\n' +
      'export default Root;\n';
    const fact = site('error-placement');
    try {
      compileGeneratedElementIfAdmitted(source, fact.file, { site: fact.site });
      throw new Error('expected the non-retained placement to fail closed');
    } catch (error) {
      expect(codes(error)).toContain('OEIR_LEAF_INVALID_ARTIFACT');
    }
  });

  test('B13 a ROOT signal resource read inside the callback is admitted (ADR-0183 D-4)', () => {
    const source =
      SIDECAR +
      "import { onError, signal } from '@openelement/element';\n" +
      'function SignalError(props: { seed: number }) {\n' +
      '  const count = signal(0);\n' +
      '  onError(() => { globalThis.__count = count.value; });\n' +
      '  return <p>{props.seed}</p>;\n' +
      '}\n' +
      'export default SignalError;\n';
    const fact = site('error-host-binding');
    const compiled = compileGeneratedElementIfAdmitted(source, fact.file, { site: fact.site });
    expect(compiled).not.toBeNull();
    expect(compiled!.code).toContain('const count = signal((');
  });

  test('B14 a model compiled with the root marker but generated without the option never drops the handler', () => {
    const source =
      SIDECAR +
      "import { onError } from '@openelement/element';\n" +
      'function Direct(props: { seed: number }) {\n' +
      '  onError(() => { globalThis.__x = 1; });\n' +
      '  return <p>{props.seed}</p>;\n' +
      '}\n' +
      'export default Direct;\n';
    const front: FunctionModelModule = compileFunctionModule(source, '/proj/src/direct.tsx', {
      importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
      lifecycleAdmission: { admission: 'root', root: 'Direct' },
    }).module!;
    const leaf = generateLeafModule(front);
    expect(leaf.module).toBeNull();
    expect(leaf.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'OEIR_LEAF_INVALID_ARTIFACT',
    ]);
  });

  test('B15 the standalone public import fails closed outside the compiler (no new error code)', () => {
    let thrown: unknown;
    try {
      onError(() => undefined);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OpenElementError);
    expect((thrown as OpenElementError).code).toBe(FacadeErrorCode.JSX_OUTSIDE_COMPILER);
    expect((thrown as OpenElementError).phase).toBe('build');
    expect((thrown as OpenElementError).message).toContain('onError');
  });

  test('B16 a depth-1 retained child forwards BOTH channels, including the mount/claim sink', () => {
    // The child registers from its own `<Name>__setup`, which runs AFTER the
    // retaining reference site built the host literal — hence the getter-backed
    // report channel on the shell side.
    const source =
      SIDECAR.replace('seed: { default: 0 }', 'seed: { default: 0 }, show: { default: true }') +
      "import { onError } from '@openelement/element';\n" +
      'function Child(props: { seed: number }) {\n' +
      '  onError((env) => { globalThis.__child = env.error; });\n' +
      '  return <em>{props.seed}</em>;\n' +
      '}\n' +
      'function ChildHost(props: { seed: number; show: boolean }) {\n' +
      '  return <span>{props.show ? <Child seed={props.seed} /> : null}</span>;\n' +
      '}\n' +
      'export default ChildHost;\n';
    const module = compileIsland('error-retained-child', source);
    const setup = functionText(module, 'Child__setup');
    expect(setup).toContain('__oe_onError');
    // The retaining reference site forwards BOTH channels into the child's
    // SETUP host (registration + update-phase sink)...
    expect(module).toContain('__oe_onError: __oe_host.__oe_onError');
    // ...and the child's MOUNT/CLAIM host literal must ALSO carry the sink: the
    // refresh subscriptions are opened by the mount/claim body, not by setup, so
    // without it the child's refresh would guard with `undefined` and propagate
    // past the enclosing element's handler. (Regression guard: this line was
    // missing in the first draft and the Chromium D7 row caught it.)
    const childHostLine = module.split('\n').find((line) => line.includes('const __oe_childHost'));
    expect(childHostLine, 'the retained child mount/claim host literal').toBeDefined();
    expect(childHostLine).toContain('__oe_reportError: __oe_host.__oe_reportError');
    // The child's own refresh subscription is guarded with that sink.
    expect(functionText(module, 'Child__mount')).toContain('guardUpdate(__oe_refresh');
  });
});
