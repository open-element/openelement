/**
 * `16b-REF` author-facing node handle — compiler contract (LOCAL, Node).
 *
 * `ref(cb?)` is the FIFTH compiler-erased intrinsic of the generated-element
 * lane. This suite is the compiler half; the runtime half (the handle's
 * lifetime across mount, claim, disconnect and reconnect in a real Chromium
 * element) is `generated-element.ref-handle.browser.test.ts`.
 *
 * WHAT THE SHAPE IS, AND WHY. The compiler already had an intrinsic `ref` JSX
 * CHANNEL (`m09-2c`): it attaches a callback to one intrinsic node, calls it
 * with the element, keeps the returned cleanup, and on detach runs that cleanup
 * then calls the callback with `null`. What it did NOT have was a handle that
 * SURVIVES a mount/claim/reconnect cycle: a `let field = null` written from the
 * callback is a per-body local, and the retained setup factory aliases setup
 * values through a `const`, so the author's `let` never survives (measured: the
 * emitted alias is `const`, so the assignment throws `TypeError`). The slice
 * therefore adds a HANDLE OBJECT built in the retained setup factory, whose
 * callable form is exactly what the existing `ref` channel already accepts. No
 * new sink kind, no protocol change, no second attachment mechanism.
 *
 * What is pinned here:
 *
 * - ADMISSION: `const handle = ref(cb?)` anywhere in an admitted component body
 *   (root setup OR a depth-1 retained hostless child setup), recognized by
 *   BINDING PROVENANCE — a named import of `@openelement/element` or
 *   `@openelement/element/lifecycle`, aliases followed. A wrong specifier, a
 *   local shadow, a namespace member and a `let` declaration are NOT the
 *   intrinsic and keep their existing refusals.
 * - ERASURE: the emitted module imports and calls neither `ref` nor
 *   `@openelement/element`; the handle is built in the compiler-owned
 *   `__oe_rootInstance` / `<Name>__setup` factory and alias-read by mount/claim.
 * - STABILITY: the handle object lives in the retained record, so the mount and
 *   claim bodies alias the SAME object across a reconnect instead of building a
 *   new one.
 * - SSR: the handle is CLIENT-only. `<Name>__ssr` bytes are unchanged and the
 *   notification never runs on the server.
 * - BYTE IDENTITY: a module without the intrinsic is byte-identical to its
 *   pre-slice output (SHA-256 pins captured from the clean tree before this
 *   change), including a module that already uses all four older intrinsics.
 * - FAIL CLOSED: a non-tracked-slot read of the handle is refused (its
 *   `current` notifies nothing, so a tracked slot would emit a stale snapshot);
 *   the standalone public import throws the existing `JSX_OUTSIDE_COMPILER`
 *   identity with no new error code.
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
import { ref } from '../../../element/src/index.ts';

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

function site(fragment: string): { file: string; site: GeneratedElementSite } {
  const file = `${ISLANDS_DIR}/${fragment}.tsx`;
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

function messages(error: unknown): string[] {
  expect(error).toBeInstanceOf(CompiledElementError);
  return (error as CompiledElementError).diagnostics.map((diagnostic) => diagnostic.message);
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
          if (opened && depth === 0) return { start: index, end: cursor };
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
 * Whether the module calls the AUTHORED intrinsic `ref(...)`. The emitted
 * channel variables are `__oe_refHandlerN` / `__oe_refCleanupN`, so a plain
 * substring check cannot answer this; the lookbehind excludes the `__oe_`
 * prefix and the handle's own `fn.current` writes are not calls.
 */
function callsAuthoredRef(module: string): boolean {
  return /(?<!__oe_)(?<!\.)\bref\s*\(/.test(module);
}

/** One root with a ref handle that has a notification, plus a tracked slot. */
const REF_SOURCE =
  SIDECAR +
  "import { ref } from '@openelement/element';\n" +
  'function RefCard(props: { seed: number }) {\n' +
  '  const field = ref<HTMLInputElement>((element) => {\n' +
  '    globalThis.__attached = element;\n' +
  '    return () => { globalThis.__detached = true; };\n' +
  '  });\n' +
  '  return <input id="field" ref={field} />;\n' +
  '}\n' +
  'export default RefCard;\n';

/** The same component with the handle declaration removed. */
const REF_SOURCE_NO_HANDLE =
  SIDECAR +
  "import { ref } from '@openelement/element';\n" +
  'function RefCard(props: { seed: number }) {\n' +
  '  return <input id="field" ref={(element) => { globalThis.__attached = element; }} />;\n' +
  '}\n' +
  'export default RefCard;\n';

/** A handle with no notification: the handle-only form. */
const HANDLE_ONLY_SOURCE =
  SIDECAR +
  "import { ref } from '@openelement/element';\n" +
  'function HandleOnly(props: { seed: number }) {\n' +
  '  const field = ref<HTMLInputElement>();\n' +
  '  return (\n' +
  '    <div>\n' +
  '      <input ref={field} />\n' +
  '      <button onClick={() => { globalThis.__read = field.current; }}>go</button>\n' +
  '    </div>\n' +
  '  );\n' +
  '}\n' +
  'export default HandleOnly;\n';

/**
 * A module that already uses ALL FOUR older intrinsics plus a tracked slot and
 * a DOM event handler. Its pin is the "adding a fifth admitted name changes no
 * existing module" obligation: not one byte of this output may move.
 */
const FOUR_INTRINSICS_SOURCE =
  SIDECAR +
  "import { onConnect, onDispose, onPropertyChange, onError } from '@openelement/element';\n" +
  'function Hooked(props: { seed: number }) {\n' +
  '  const snapshot = props.seed;\n' +
  '  onConnect((env) => { globalThis.__a = env.host; });\n' +
  '  onDispose(() => { globalThis.__b = snapshot; });\n' +
  '  onPropertyChange((event) => { globalThis.__c = event.name; });\n' +
  '  onError((env) => { globalThis.__d = env.error; });\n' +
  '  return <button onClick={() => { globalThis.__e = props.seed; }}>{props.seed}</button>;\n' +
  '}\n' +
  'export default Hooked;\n';

const PLAIN_SOURCE =
  SIDECAR +
  'function Plain(props: { seed: number }) {\n' +
  '  return <span className="x">{props.seed}</span>;\n' +
  '}\n' +
  'export default Plain;\n';

const LOCAL_SOURCE =
  SIDECAR +
  'function Local(props: { seed: number }) {\n' +
  '  const doubled = props.seed * 2;\n' +
  '  return <em>{doubled}</em>;\n' +
  '}\n' +
  'export default Local;\n';

describe('16b-REF node handle — emitted artifact contract (Node)', () => {
  test('R1 the intrinsic is erased: the module imports and calls neither ref nor the public entry', () => {
    const module = compileIsland('ref-erased', REF_SOURCE);
    expect(callsAuthoredRef(module)).toBe(false);
    expect(module).not.toMatch(/from\s+"@openelement\/element"/);
    expect(module).not.toMatch(/from\s+'@openelement\/element'/);
    // The notification body is present — it is erased as a CALL, not dropped.
    expect(module).toContain('__attached');
    expect(module).toContain('__detached');
  });

  test('R2 the handle is built in the retained factory and alias-read by mount and claim', () => {
    const module = compileIsland('ref-handle-shape', REF_SOURCE);
    const factory = functionText(module, '__oe_rootInstance');
    // One handle object, seeded to null, built once in the call-once factory.
    expect(factory).toContain('const field = (() => {');
    expect(factory).toContain('fn.current = null;');
    // The factory still RETURNS the handle, so mount/claim alias the record.
    expect(factory).toContain('return { field };');
    // The two bodies alias by own-property presence and hand the handle to the
    // existing `ref` channel, which does the attaching.
    for (const body of ['RefCard__mount', 'RefCard__claim']) {
      const text = functionText(module, body);
      expect(text, body).toContain('__oe_requireRootSetup("field")');
      expect(text, body).toContain('const __oe_refHandler');
    }
    // Exactly one construction site: a reconnect must not rebuild the handle.
    expect(occurrences(module, 'fn.current = null;')).toBe(1);
  });

  test('R3 the handle is the existing ref channel value, not a second mechanism', () => {
    const module = compileIsland('ref-channel-reuse', REF_SOURCE);
    const mount = functionText(module, 'RefCard__mount');
    // The pre-existing channel text, unchanged: callable validation, the attach
    // call, and the cleanup-then-null detach owned by the connection scope.
    expect(mount).toContain('leafRuntimeError("OEIR_LEAF_REF_HANDLER_INVALID"');
    expect(mount).toContain('const __oe_refCleanup');
    expect(mount).toContain(
      '__oe_scope.add(() => { try { if (typeof __oe_refCleanup2 === "function") __oe_refCleanup2(); } finally { __oe_refHandler1(null); } });',
    );
    // No new sink kind, no new runtime helper, no new package export: the only
    // ref-shaped generated names remain the pre-existing channel locals.
    expect(module).not.toMatch(/import \{[^}]*\brefHandle\b/);
    // No React-shaped handle API is introduced (the recipe names below contain
    // "createRef" as a substring of `create<Name>Recipe`, so match the CALL).
    expect(module).not.toMatch(/(?<!\.)\bcreateRef\s*\(/);
    expect(module).not.toMatch(/(?<!\.)\buseRef\s*\(/);
  });

  test('R4 the handle-only form (no notification) is admitted and still callable', () => {
    const module = compileIsland('ref-handle-only', HANDLE_ONLY_SOURCE);
    const factory = functionText(module, '__oe_rootInstance');
    expect(factory).toContain('const field = (() => {');
    expect(factory).toContain('fn.current = element;');
    expect(factory).toContain('return { field };');
    // A read from an EVENT HANDLER (a handler-mode expression) is admitted: the
    // handle is readable where the read is attach-time by construction.
    expect(functionText(module, 'HandleOnly__mount')).toContain('field . current');
    expect(callsAuthoredRef(module)).toBe(false);
  });

  test('R5 a module WITHOUT the intrinsic keeps the exact pre-16b-REF bytes (SHA-256 pins)', () => {
    // Pins captured from the CLEAN tree before this change; the rule they guard
    // is "admitting a fifth name moves nobody else's output".
    expect(sha256(compileIsland('rbase-four', FOUR_INTRINSICS_SOURCE))).toBe(
      '827b9c30395462ca535a5cdfcba9fe063f0abbeb9597842bbd1bfde11f043079',
    );
    expect(sha256(compileIsland('rbase-plain', PLAIN_SOURCE))).toBe(
      'f42169e087cb7fbb66ac5007244126501eddf2770fd91ce9ab8798375c39b097',
    );
    expect(sha256(compileIsland('rbase-local', LOCAL_SOURCE))).toBe(
      '11d72ce142ddf6a0895cf1bd137db0ead351b6642e8af4922e7a541a749bf5f1',
    );
    const hooked = compileIsland('rbase-four-shape', FOUR_INTRINSICS_SOURCE);
    expect(hooked).not.toContain('fn.current');
    expect(hooked).not.toContain('const field = (() =>');
  });

  test('R6 the SSR producer is byte-identical to the same component without the handle', () => {
    const handleModule = compileIsland('ref-ssr-handle', REF_SOURCE);
    const plainModule = compileIsland('ref-ssr-plain', REF_SOURCE_NO_HANDLE);
    expect(functionText(handleModule, 'RefCard__ssr')).toBe(
      functionText(plainModule, 'RefCard__ssr'),
    );
    // The handle and its notification are client-only: no handle text, no
    // notification text, no runtime channel in the server producer.
    const ssr = functionText(handleModule, 'RefCard__ssr');
    for (const marker of ['fn.current', '__attached', '__detached', '__oe_refHandler']) {
      expect(ssr, marker).not.toContain(marker);
    }
  });

  test('R7 a handle declared in a depth-1 retained hostless child rides its own setup factory', () => {
    const source =
      SIDECAR +
      "import { ref } from '@openelement/element';\n" +
      'function Child(props: { seed: number }) {\n' +
      '  const inner = ref<HTMLElement>();\n' +
      '  return <em ref={inner}>{props.seed}</em>;\n' +
      '}\n' +
      'function ChildHost(props: { seed: number }) {\n' +
      '  return <span><Child seed={props.seed} /></span>;\n' +
      '}\n' +
      'export default ChildHost;\n';
    const module = compileIsland('ref-retained-child', source);
    const setup = functionText(module, 'Child__setup');
    expect(setup).toContain('const inner = (() => {');
    expect(setup).toContain('return { inner };');
    // The child's own mount/claim alias the retained record, so a parent
    // reconnect does not rebuild the handle.
    expect(functionText(module, 'Child__mount')).toContain('__oe_requireRootSetup("inner")');
    expect(functionText(module, 'Child__claim')).toContain('__oe_requireRootSetup("inner")');
  });

  // ── admission: positives ────────────────────────────────────────────────

  test('R8 the aliased import and the lifecycle subpath are both admitted', () => {
    for (const [name, importLine] of [
      ['ref-alias', "import { ref as makeRef } from '@openelement/element';\n"],
      ['ref-subpath', "import { ref } from '@openelement/element/lifecycle';\n"],
    ] as const) {
      const local = name === 'ref-alias' ? 'makeRef' : 'ref';
      const source =
        SIDECAR +
        importLine +
        'function Aliased(props: { seed: number }) {\n' +
        `  const field = ${local}<HTMLInputElement>();\n` +
        '  return <input ref={field} />;\n' +
        '}\n' +
        'export default Aliased;\n';
      const module = compileIsland(name, source);
      expect(functionText(module, '__oe_rootInstance'), name).toContain('const field = (() => {');
      expect(module, name).not.toContain(local + '<');
    }
  });

  test('R9 the handle is a model resource with its own kind (distinct from local/signal)', () => {
    const front: FunctionModelModule = compileFunctionModule(
      REF_SOURCE,
      `${ISLANDS_DIR}/ref-kind.tsx`,
      {
        importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
        lifecycleAdmission: { admission: 'module' },
      },
    ).module!;
    const resources = front.components[0]!.resources;
    expect(resources.map((resource) => [resource.name, resource.kind])).toEqual([['field', 'ref']]);
    // The notification is carried as the resource's lowered expression; the
    // handle-only form carries none.
    expect(resources[0]!.expression).not.toBeNull();
    const handleOnly = compileFunctionModule(
      HANDLE_ONLY_SOURCE,
      `${ISLANDS_DIR}/ref-kind-only.tsx`,
      {
        importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
        lifecycleAdmission: { admission: 'module' },
      },
    ).module!;
    expect(handleOnly.components[0]!.resources[0]!.expression).toBeNull();
  });

  // ── admission: refusals ─────────────────────────────────────────────────

  test('R10 an indirect callback / arity / generator / async / parameter shape are refused with the existing code', () => {
    const frontendCodes = (source: string): string[] =>
      compileFunctionModule(source, `${ISLANDS_DIR}/ref-refusals.tsx`, {
        importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
        lifecycleAdmission: { admission: 'module' },
      }).diagnostics.map((diagnostic) => diagnostic.code);

    const importLine = "import { ref } from '@openelement/element';\n";
    const wrap = (declaration: string, prefix = ''): string =>
      prefix +
      importLine +
      `function Root(props) {\n  ${declaration}\n  return <input ref={null} />;\n}\n`;

    // An indirect callback reference is not the admitted inline form.
    expect(
      frontendCodes(wrap('const field = ref(handler);', 'const handler = () => {};\n')),
    ).toEqual(['OEC9042']);
    // More than one argument.
    expect(frontendCodes(wrap('const field = ref(() => {}, () => {});'))).toEqual(['OEC9042']);
    // A generator callback.
    expect(frontendCodes(wrap('const field = ref(function* () {});'))).toEqual(['OEC9042']);
    // An `async` callback (and therefore an async cleanup).
    expect(frontendCodes(wrap('const field = ref(async () => {});'))).toEqual(['OEC9042']);
    // Parameter shapes outside one plain identifier.
    for (const malformed of [
      'const field = ref((...rest) => { globalThis.__x = rest; });',
      'const field = ref((element?) => { globalThis.__x = element; });',
      'const field = ref((element = null) => { globalThis.__x = element; });',
      'const field = ref(([a]) => { globalThis.__x = a; });',
      'const field = ref((a, b) => { globalThis.__x = a + b; });',
    ]) {
      expect(frontendCodes(wrap(malformed)), malformed).toEqual(['OEC9042']);
    }
  });

  test('R10b a `ref(...)` call OUTSIDE a declaration is refused at build, not at mount', () => {
    // `ref(...)` is a DECLARATION form. In any other position it would survive
    // into the emitted module as a call to the fail-closed stand-in and throw
    // during mount — a build defect surfacing as a runtime one. The legal
    // spelling is `const handle = ref(cb)` then `ref={handle}`.
    const frontendCodes = (source: string): string[] =>
      compileFunctionModule(source, `${ISLANDS_DIR}/ref-misplaced.tsx`, {
        importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
        lifecycleAdmission: { admission: 'module' },
      }).diagnostics.map((diagnostic) => diagnostic.code);
    const importLine = "import { ref } from '@openelement/element';\n";
    // A) Inline in the ref attribute it is handed to.
    expect(
      frontendCodes(
        importLine +
          'function Root(props) {\n' +
          '  return <input ref={ref(() => {})} />;\n' +
          '}\n',
      ),
      'inline ref attribute value',
    ).toEqual(['OEC9042']);
    // B) Produced inside another expression (a property initializer).
    expect(
      frontendCodes(
        importLine +
          'function Root(props) {\n' +
          '  const holder = { field: ref(() => {}) };\n' +
          '  return <input ref={holder.field} />;\n' +
          '}\n',
      ),
      'produced inside an expression',
    ).toEqual(['OEC9042']);
    // C) Called from inside the notification body: still a value position.
    expect(
      frontendCodes(
        importLine +
          'function Root(props) {\n' +
          '  const outer = ref(() => { ref(() => {}); });\n' +
          '  return <input ref={outer} />;\n' +
          '}\n',
      ),
      'nested inside a notification',
    ).toEqual(['OEC9042']);
  });

  test('R11 a `let` handle is refused: the handle identity is the contract', () => {
    const frontendCodes = (source: string): string[] =>
      compileFunctionModule(source, `${ISLANDS_DIR}/ref-let.tsx`, {
        importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
        lifecycleAdmission: { admission: 'module' },
      }).diagnostics.map((diagnostic) => diagnostic.code);
    expect(
      frontendCodes(
        "import { ref } from '@openelement/element';\n" +
          'function Root(props) {\n' +
          '  let field = ref<HTMLElement>();\n' +
          '  return <input ref={field} />;\n' +
          '}\n',
      ),
    ).toEqual(['OEC9042']);
  });

  test('R12 a wrong specifier / a local shadow / no admission is NOT the intrinsic', () => {
    const frontendCodes = (
      source: string,
      admission: { admission: 'root'; root: string } | { admission: 'module' } | undefined,
    ): string[] =>
      compileFunctionModule(source, `${ISLANDS_DIR}/ref-provenance.tsx`, {
        importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
        ...(admission === undefined ? {} : { lifecycleAdmission: admission }),
      }).diagnostics.map((diagnostic) => diagnostic.code);

    // A same-named import from a DIFFERENT module lowers as an ordinary setup
    // local reading a value (never the intrinsic handle).
    const foreign =
      "import { ref } from 'somewhere-else';\n" +
      'function Root(props) {\n' +
      '  const field = ref<HTMLElement>();\n' +
      '  return <input ref={field} />;\n' +
      '}\n';
    expect(frontendCodes(foreign, { admission: 'root', root: 'Root' })).toEqual([]);
    // A local shadow is not an import binding.
    const shadow =
      'function ref() { return () => {}; }\n' +
      'function Root(props) {\n' +
      '  const field = ref();\n' +
      '  return <input ref={field} />;\n' +
      '}\n';
    expect(frontendCodes(shadow, { admission: 'root', root: 'Root' })).toEqual([]);
    // A namespace member is not a value-position identifier binding.
    const namespace =
      "import * as element from '@openelement/element';\n" +
      'function Root(props) {\n' +
      '  const field = element.ref();\n' +
      '  return <input ref={field} />;\n' +
      '}\n';
    expect(frontendCodes(namespace, { admission: 'root', root: 'Root' })).toEqual([]);
  });

  test('R13 a tracked-slot read of the handle is refused at the authored span', () => {
    // The rule, stated as a test: `current` is written on attach, cleared on
    // detach and notifies nothing, so a tracked slot reading it would emit a
    // one-shot value that never refreshes — the "silently SSR-only surface"
    // class. The refusal is at the READ, and the message names the fix.
    const source =
      SIDECAR +
      "import { ref } from '@openelement/element';\n" +
      'function Tracked(props: { seed: number }) {\n' +
      '  const field = ref<HTMLInputElement>();\n' +
      '  return (\n' +
      '    <div>\n' +
      '      <input ref={field} />\n' +
      "      <span>{field.current === null ? 'none' : 'node'}</span>\n" +
      '    </div>\n' +
      '  );\n' +
      '}\n' +
      'export default Tracked;\n';
    const fact = site('ref-tracked-read');
    let thrown: unknown;
    try {
      compileGeneratedElementIfAdmitted(source, fact.file, { site: fact.site });
    } catch (error) {
      thrown = error;
    }
    expect(codes(thrown)).toEqual(['OEC9042']);
    expect(messages(thrown).join('\n')).toContain('attach/detach-only value');
    expect(messages(thrown).join('\n')).toContain('field');
  });

  test('R14 a model compiled with an admission the generator cannot carry never drops the handle', () => {
    // The frontend admits module-wide; the GENERATOR owns placement. A handle in
    // a component the retention plan does not carry as a retained setup body has
    // no instance owner, so `generateLeafModule` without the root marker must
    // not emit a factory the mount body would then alias from nowhere.
    const front: FunctionModelModule = compileFunctionModule(
      REF_SOURCE,
      '/proj/src/ref-direct.tsx',
      {
        importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
        lifecycleAdmission: { admission: 'root', root: 'RefCard' },
      },
    ).module!;
    const leaf = generateLeafModule(front);
    // Without a root marker the component is a plain leaf body: its mount
    // evaluates the handle itself (per body, not retained), which is the
    // documented non-retained shape. The important invariant is that the handle
    // is not silently dropped: it is still constructed.
    expect(leaf.module).not.toBeNull();
    expect(leaf.module).toContain('const field = (() => {');
    expect(leaf.module).not.toContain('__oe_requireRootSetup("field")');
  });

  test('R15 the standalone public import fails closed outside the compiler (no new error code)', () => {
    let thrown: unknown;
    try {
      ref<HTMLElement>(() => undefined);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OpenElementError);
    expect((thrown as OpenElementError).code).toBe(FacadeErrorCode.JSX_OUTSIDE_COMPILER);
    expect((thrown as OpenElementError).phase).toBe('build');
    expect((thrown as OpenElementError).message).toContain('ref');
    // A handle-only call fails closed the same way: there is no "inert handle".
    let handleOnly: unknown;
    try {
      ref();
    } catch (error) {
      handleOnly = error;
    }
    expect(handleOnly).toBeInstanceOf(OpenElementError);
    expect((handleOnly as OpenElementError).code).toBe(FacadeErrorCode.JSX_OUTSIDE_COMPILER);
  });

  test('R16 the notification may read setup locals and a ROOT signal resource (ADR-0183 D-4)', () => {
    // Admitted: the notification reads a setup local (a closure capture).
    const localRead =
      SIDECAR +
      "import { ref } from '@openelement/element';\n" +
      'function LocalRead(props: { seed: number }) {\n' +
      '  const label = String(props.seed);\n' +
      '  const field = ref<HTMLInputElement>((element) => {\n' +
      '    globalThis.__label = label;\n' +
      '    globalThis.__element = element;\n' +
      '  });\n' +
      '  return <input ref={field} />;\n' +
      '}\n' +
      'export default LocalRead;\n';
    const module = compileIsland('ref-local-read', localRead);
    expect(functionText(module, '__oe_rootInstance')).toContain('__label');

    // Refused: the notification reads a `signal`, which is a host binding the
    // retained setup scope cannot resolve. The lane's existing gate answers.
    const hostBinding =
      SIDECAR +
      "import { ref, signal } from '@openelement/element';\n" +
      'function HostBinding(props: { seed: number }) {\n' +
      '  const count = signal(0);\n' +
      '  const field = ref<HTMLInputElement>(() => { globalThis.__count = count; });\n' +
      '  return <input ref={field} />;\n' +
      '}\n' +
      'export default HostBinding;\n';
    const fact = site('ref-host-binding');
    // ADR-0183 D-4: the root factory creates `count` and returns it, so the ref
    // notification can capture it like any other setup value.
    const compiled = compileGeneratedElementIfAdmitted(hostBinding, fact.file, {
      site: fact.site,
    });
    expect(compiled).not.toBeNull();
    expect(compiled!.code).toContain('const count = signal((');
  });
});
