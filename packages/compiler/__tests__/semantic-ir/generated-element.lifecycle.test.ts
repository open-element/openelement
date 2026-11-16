/**
 * `16b-LC` author lifecycle intrinsics (owner-approved option 1a) — compiler
 * contract (LOCAL, Node).
 *
 * The compiler half of the author surface, without a browser:
 *
 * - `onConnect` / `onDispose` are admitted ONLY as direct top-level statements
 *   of the ROOT setup of a generated element module, recognized by binding
 *   provenance (canonical named import of `@openelement/element`, aliases
 *   followed). The callback is lowered exactly like any other authored
 *   expression and emitted as an ordinary closure; the intrinsic call itself
 *   is ERASED (the emitted module imports/calls neither name).
 * - the ROOT factory (`__oe_rootInstance`) RECORDS the connect callbacks in its
 *   returned record (`__oe_connect`) and registers each `onDispose` callback on
 *   the instance owner the shell passes (`__oe_owner.add`) — no runtime hook
 *   dispatcher and no second lifecycle engine;
 * - the root mount AND claim PROLOGUES replay the retained connect callbacks on
 *   the per-connection scope and register each returned cleanup on it, so the
 *   existing shell disconnect/rollback disposal releases them (once per
 *   connection, no repeated setup);
 * - a root with hooks but no local setup still emits the factory and the
 *   descriptor `createInstance` row; an `onDispose`-only root emits the owner
 *   registration and NO connect replay; a hook callback that reads `props`
 *   gets the live frozen props alias in the factory;
 * - the SSR producer is untouched by hooks (same bytes as the same component
 *   without hooks, no invocation text);
 * - hook-free modules are byte-identical to the pre-change tree (SHA-256 pins
 *   captured at clean HEAD `6bd3667d4` before the change);
 * - the admitted slice fails closed with the EXISTING diagnostic vocabulary:
 *   nested/hostless/not-marker placements keep the unchanged `OEC9041`
 *   component-body refusal, malformed hook calls use the existing `OEC9042`
 *   form code, a host-binding read keeps the leaf `UNBOUND_BINDING` gate, and an
 *   emitter invariant uses `OEIR_LEAF_INVALID_ARTIFACT` / the existing
 *   `OEIR_LEAF_UNSUPPORTED_BINDING`. No new public error code and no new
 *   diagnostic identity.
 * - the source map still decodes the callback placements that moved into the
 *   factory chunk.
 *
 * LOCAL Node evidence. Not M09 exit, not the M13 matrix, no nested/hostless
 * hook admission, no connection-scope helper channel, no public API freeze.
 */

import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import {
  compileFunctionModule,
  type FunctionModelModule,
} from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { createGeneratedElementSiteResolver } from '../../../router/src/vite/generated-element-site.ts';
import { FacadeErrorCode, OpenElementError } from '../../../protocol/src/errors.ts';
import { onConnect, onDispose } from '../../../element/src/index.ts';

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

function frontModule(source: string, file: string): FunctionModelModule {
  const front = compileFunctionModule(source, file, {
    importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  });
  expect(front.diagnostics, front.diagnostics.map((item) => item.message).join('\n')).toEqual([]);
  return front.module!;
}

function frontModuleWithRoot(
  source: string,
  file: string,
  lifecycleRoot: string,
): FunctionModelModule {
  const front = compileFunctionModule(source, file, {
    importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
    lifecycleAdmission: { admission: 'root', root: lifecycleRoot },
  });
  expect(front.diagnostics, front.diagnostics.map((item) => item.message).join('\n')).toEqual([]);
  return front.module!;
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

interface FunctionRange {
  /** 0-based inclusive start line index into the module. */
  readonly start: number;
  /** 0-based inclusive end line index into the module. */
  readonly end: number;
}

const FUNCTION_HEADER = /^\s*(?:export\s+)?function\s+([\w$]+)\s*\(/;

/** Remove quoted literals so braces inside strings cannot move a range end. */
function stripQuoted(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** Locate one emitted function by brace slicing (test-side, no generator help). */
function functionRange(module: string, name: string): FunctionRange {
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

/** The connect-replay prologue emitted into both root mount and root claim. */
const CONNECT_REPLAY_LINES = [
  'const __oe_lifecycleHooks = __oe_host.bindings.__oe_connect;',
  'if (__oe_lifecycleHooks !== undefined) {',
  'for (const __oe_lifecycleHook of __oe_lifecycleHooks) {',
  'const __oe_lifecycleCleanup = __oe_lifecycleHook();',
  'if (typeof __oe_lifecycleCleanup === "function") __oe_scope.add(__oe_lifecycleCleanup);',
];

/** One admitted root with two connect hooks (authored order matters) and one dispose hook. */
const LIFECYCLE_SOURCE =
  SIDECAR +
  "import { onConnect, onDispose } from '@openelement/element';\n" +
  'function LifeCard(props: { seed: number }) {\n' +
  '  const snapshot = props.seed;\n' +
  '  onConnect(() => { globalThis.__oeConnectRuns = (globalThis.__oeConnectRuns ?? 0) + 1; });\n' +
  '  onConnect(() => { globalThis.__oeSecondConnect = snapshot; });\n' +
  '  onDispose(() => { globalThis.__oeDisposeRuns = (globalThis.__oeDisposeRuns ?? 0) + 1; });\n' +
  '  return <span className="seed">{snapshot}</span>;\n' +
  '}\n' +
  'export default LifeCard;\n';

/** The same component with hook statements replaced by same-line-count comments. */
const LIFECYCLE_SOURCE_NO_HOOKS =
  SIDECAR +
  "import { onConnect, onDispose } from '@openelement/element';\n" +
  'function LifeCard(props: { seed: number }) {\n' +
  '  const snapshot = props.seed;\n' +
  '  // onConnect(() => { globalThis.__oeConnectRuns = 1; });\n' +
  '  // onConnect(() => { globalThis.__oeSecondConnect = 1; });\n' +
  '  // onDispose(() => { globalThis.__oeDisposeRuns = 1; });\n' +
  '  return <span className="seed">{snapshot}</span>;\n' +
  '}\n' +
  'export default LifeCard;\n';

describe('16b-LC lifecycle hooks — emitted artifact contract (Node)', () => {
  test('A1 the root factory records connect callbacks and registers onDispose on the instance owner', () => {
    const module = compileIsland('lifecycle-shape', LIFECYCLE_SOURCE);
    const factory = functionText(module, '__oe_rootInstance');
    // Authored order: setup local, then the connect record, then the disposal
    // registration, then the record return.
    const local = factory.indexOf('const snapshot = (props . seed);');
    const connectRecord = factory.indexOf('const __oe_connect = [];');
    const firstPush = factory.indexOf('__oe_connect.push((');
    const secondPush = factory.indexOf('__oe_connect.push((', firstPush + 1);
    const disposeRegister = factory.indexOf('__oe_owner.add((');
    const returned = factory.indexOf('return { snapshot, __oe_connect };');
    expect(local).toBeGreaterThanOrEqual(0);
    expect(connectRecord).toBeGreaterThan(local);
    expect(firstPush).toBeGreaterThan(connectRecord);
    expect(secondPush).toBeGreaterThan(firstPush);
    expect(disposeRegister).toBeGreaterThan(secondPush);
    expect(returned).toBeGreaterThan(disposeRegister);
    expect(occurrences(factory, '__oe_connect.push((')).toBe(2);
    expect(occurrences(factory, '__oe_owner.add((')).toBe(1);
    // Two connect callbacks + one dispose callback, kept in authored order.
    expect(factory.indexOf('__oeConnectRuns')).toBeLessThan(factory.indexOf('__oeSecondConnect'));
    // The compiler-owned record row is the call-once/retain site the shell owns.
    expect(module).toContain('  createInstance: __oe_rootInstance,');
    expect(module).not.toContain('createBindings');
  });

  test('A2 the intrinsic calls and their public import are erased from the emitted module', () => {
    const module = compileIsland('lifecycle-erased', LIFECYCLE_SOURCE);
    expect(module).not.toContain('onConnect');
    expect(module).not.toContain('onDispose');
    // The only ESM import is the compiler-private runtime surface; the authored
    // public import never reaches generated code.
    expect(module).not.toMatch(/from\s+"@openelement\/element"/);
    expect(module).not.toMatch(/from\s+'@openelement\/element'/);
  });

  test('A3 mount AND claim prologues replay the retained callbacks exactly once per connection', () => {
    const module = compileIsland('lifecycle-replay', LIFECYCLE_SOURCE);
    for (const body of ['LifeCard__mount', 'LifeCard__claim']) {
      const text = functionText(module, body);
      expect(
        occurrences(text, 'const __oe_lifecycleHooks = __oe_host.bindings.__oe_connect;'),
      ).toBe(1);
      for (const line of CONNECT_REPLAY_LINES) {
        expect(text, `${body}: ${line}`).toContain(line);
      }
      expect(occurrences(text, '__oe_lifecycleHook()')).toBe(1);
      expect(occurrences(text, '__oe_scope.add(__oe_lifecycleCleanup)')).toBe(1);
      // The replay is a PROLOGUE: it runs before the retained-setup alias and
      // before any mount/claim DOM work.
      expect(text.indexOf(CONNECT_REPLAY_LINES[0]!)).toBeLessThan(
        text.indexOf('__oe_requireRootSetup'),
      );
      const firstDomWork = body.endsWith('__mount')
        ? 'document.createElement'
        : 'assertElementInHtmlNamespace(';
      expect(text.indexOf(CONNECT_REPLAY_LINES[0]!), body).toBeLessThan(text.indexOf(firstDomWork));
    }
  });

  test('A4 a hook-only root still emits the factory and the descriptor createInstance row', () => {
    const source =
      SIDECAR +
      "import { onConnect, onDispose } from '@openelement/element';\n" +
      'function HookOnly(props: { seed: number }) {\n' +
      '  onConnect(() => { globalThis.__oeConnect = 1; });\n' +
      '  onDispose(() => { globalThis.__oeDispose = 1; });\n' +
      '  return <p>{props.seed}</p>;\n' +
      '}\n' +
      'export default HookOnly;\n';
    const module = compileIsland('lifecycle-hook-only', source);
    const factory = functionText(module, '__oe_rootInstance');
    expect(factory).toContain('const __oe_connect = [];');
    expect(factory).toContain('__oe_connect.push((');
    expect(factory).toContain('__oe_owner.add((');
    expect(factory).toContain('return { __oe_connect };');
    expect(module).toContain('  createInstance: __oe_rootInstance,');
    // No local setup snapshot: no retained-record alias is emitted at all.
    expect(module).not.toContain('__oe_requireRootSetup');
    // The replay still runs (the factory is the only carrier of the callbacks).
    expect(functionText(module, 'HookOnly__mount')).toContain('__oe_host.bindings.__oe_connect');
    expect(functionText(module, 'HookOnly__claim')).toContain('__oe_host.bindings.__oe_connect');
  });

  test('A5 an onDispose-only root registers on the owner and emits NO connect replay', () => {
    const source =
      SIDECAR +
      "import { onDispose } from '@openelement/element';\n" +
      'function DisposeOnly(props: { seed: number }) {\n' +
      '  onDispose(() => { globalThis.__oeDispose = 1; });\n' +
      '  return <p>{props.seed}</p>;\n' +
      '}\n' +
      'export default DisposeOnly;\n';
    const module = compileIsland('lifecycle-dispose-only', source);
    const factory = functionText(module, '__oe_rootInstance');
    expect(occurrences(factory, '__oe_owner.add((')).toBe(1);
    expect(factory).toContain('return {};');
    expect(factory).not.toContain('__oe_connect');
    expect(module).toContain('  createInstance: __oe_rootInstance,');
    for (const body of ['DisposeOnly__mount', 'DisposeOnly__claim']) {
      expect(functionText(module, body)).not.toContain('__oe_lifecycleHooks');
    }
  });

  test('A6 a callback that reads props gets the live props alias in the factory', () => {
    const source =
      SIDECAR +
      "import { onConnect } from '@openelement/element';\n" +
      'function PropsHook(props: { seed: number }) {\n' +
      '  onConnect(() => { globalThis.__oeSeen = props.seed; });\n' +
      '  return <p>{props.seed}</p>;\n' +
      '}\n' +
      'export default PropsHook;\n';
    const module = compileIsland('lifecycle-props-hook', source);
    const factory = functionText(module, '__oe_rootInstance');
    expect(factory).toContain('const props = __oe_host.props;');
    expect(factory).toContain('__oe_connect.push((');
  });

  test('A7 SSR producer is byte-identical to the same component without hooks and invokes nothing', () => {
    const hookModule = compileIsland('lifecycle-ssr-hook', LIFECYCLE_SOURCE);
    const plainModule = compileIsland('lifecycle-ssr-plain', LIFECYCLE_SOURCE_NO_HOOKS);
    const hookSsr = functionText(hookModule, 'LifeCard__ssr');
    const plainSsr = functionText(plainModule, 'LifeCard__ssr');
    expect(hookSsr).toBe(plainSsr);
    for (const marker of [
      '__oe_connect',
      '__oe_owner',
      '__oe_lifecycleHooks',
      'globalThis',
      'onConnect',
      'onDispose',
    ]) {
      expect(hookSsr).not.toContain(marker);
    }
  });

  test('A8 hook-free modules stay byte-identical to clean HEAD 6bd3667d4 (SHA-256 pins)', () => {
    // Captured by running the clean HEAD generator on the same sources before
    // the lifecycle change: these pins are the "uses neither hook keeps the
    // exact bytes" obligation, covering a hostless leaf, a generated element
    // root with setup, one without setup, and a depth-1 nested-retention root.
    const hostlessWithSetup = frontModule(
      "import { signal } from '@openelement/element';\n" +
        'function Hostless(props) { const s = props.seed; return <span>{s}</span>; }\n',
      '/proj/src/leaf.tsx',
    );
    const hostlessWithSetupLeaf = generateLeafModule(hostlessWithSetup);
    expect(sha256(hostlessWithSetupLeaf.module!)).toBe(
      '121b63fd46ae0b4997a4fb9683c6dd4ddf57d9e9814e8b9044892d56ab317d71',
    );
    const hostlessPlain = frontModule(
      'function Plain(props) { return <p>{props.x}</p>; }\n',
      '/proj/src/leaf.tsx',
    );
    expect(sha256(generateLeafModule(hostlessPlain).module!)).toBe(
      'd6eb754c315b6cf859bc5aff1c6ad3af29b38a099714aaf2d0d87c0d8b2d5025',
    );
    const hostlessSetupSsr = functionText(hostlessWithSetupLeaf.module!, 'Hostless__ssr');
    expect(sha256(hostlessSetupSsr)).toBe(
      '87ae3b6b19ce0205c105f3b2bb7be75c83416ea96debb2e0a206c626558018b0',
    );

    const rootSetup = compileIsland(
      'root-setup',
      SIDECAR +
        'function SeedCard(props: { seed: number }) {\n' +
        '  const snapshot = props.seed;\n' +
        '  return <span className="seed">{snapshot}</span>;\n' +
        '}\n' +
        'export default SeedCard;\n',
    );
    expect(sha256(rootSetup)).toBe(
      'f5c4423d117ec97aca862066bc5affab24a4486cb413bfdfaf29bb2224d3bc76',
    );
    expect(sha256(functionText(rootSetup, 'SeedCard__ssr'))).toBe(
      '328059b07b89719ed2fc03f659a041a022982e21a5837f7628046bae6b473d50',
    );

    const rootPlain = compileIsland(
      'root-plain',
      SIDECAR +
        'function PlainCard(props: { seed: number }) {\n' +
        '  return <p className="plain">{props.seed}</p>;\n' +
        '}\n' +
        'export default PlainCard;\n',
    );
    expect(sha256(rootPlain)).toBe(
      '5e78893e33aee71c7a95dc322cc170edee29666f76397e33e15a064cd5e77b8a',
    );
    expect(sha256(functionText(rootPlain, 'PlainCard__ssr'))).toBe(
      '16e96344e5dc9cd26db72789d8bab36f12c2b815b15c646be3da4c383f28bef1',
    );

    const rootChild = compileIsland(
      'root-child',
      SIDECAR +
        'function Child(props: { seed: number }) {\n' +
        '  const childSnapshot = props.seed;\n' +
        '  return <em className="child">{childSnapshot}</em>;\n' +
        '}\n' +
        'function Host(props: { seed: number }) {\n' +
        '  const rootSnapshot = props.seed;\n' +
        '  return <span className="root"><b>{rootSnapshot}</b><Child seed={props.seed} /></span>;\n' +
        '}\n' +
        'export default Host;\n',
    );
    expect(sha256(rootChild)).toBe(
      '8c39f5542cfbbf0ce646a79ff8fc10cb8090b08643b1751f0538f66de1815dc3',
    );
    expect(sha256(functionText(rootChild, 'Host__ssr'))).toBe(
      'd361eae8d21a2959954c5ca83cf12b68887ed2fe5e4da21a21fd335259526863',
    );
  });

  test('A9 the admitted slice fails closed with the existing diagnostics (no new code)', () => {
    const hook = 'onConnect(() => { globalThis.__oeX = 1; });';
    const importLine = "import { onConnect, onDispose } from '@openelement/element';\n";

    const frontendCodes = (
      source: string,
      admission: { admission: 'root'; root: string } | { admission: 'module' } | undefined,
    ): string[] => {
      const front = compileFunctionModule(source, '/proj/src/refused.tsx', {
        importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
        ...(admission === undefined ? {} : { lifecycleAdmission: admission }),
      });
      return front.diagnostics.map((diagnostic) => diagnostic.code);
    };
    const moduleAdmission = { admission: 'module' } as const;
    const rootAdmission = { admission: 'root', root: 'Root' } as const;

    // Nested component hooks are admitted MODULE-WIDE by the frontend now; the
    // generator owns the placement verdict (authored-span refusal), so the
    // frontend reports no diagnostic here. `A9b` pins the placement gate.
    expect(
      frontendCodes(
        importLine +
          'function Child(props) {\n  ' +
          hook +
          '\n  return <em>{props.x}</em>;\n}\n' +
          'function Root(props) { return <p><Child x={props.x} /></p>; }\n',
        moduleAdmission,
      ),
    ).toEqual([]);
    // No lifecycle marker (function-page / hostless lane): same unchanged refusal.
    expect(
      frontendCodes(
        importLine + `function Root(props) {\n  ${hook}\n  return <p>{props.x}</p>;\n}\n`,
        undefined,
      ),
    ).toEqual(['OEC9041']);
    // Malformed admitted shapes use the existing OEC9042 form code.
    for (const malformed of [
      'onConnect(async () => { globalThis.__oeX = 1; });',
      'onConnect((a, b) => { globalThis.__oeX = a + b; });',
      'onConnect((...rest) => { globalThis.__oeX = rest; });',
      'onConnect((env?) => { globalThis.__oeX = env; });',
      'onConnect((env = 1) => { globalThis.__oeX = env; });',
      'onConnect(([a]) => { globalThis.__oeX = a; });',
      'onConnect();',
      'onConnect(fn);',
      'onDispose(async () => { globalThis.__oeX = 1; });',
    ]) {
      const source =
        'const fn = () => { globalThis.__oeX = 1; };\n' +
        importLine +
        `function Root(props) {\n  ${malformed}\n  return <p>{props.x}</p>;\n}\n`;
      expect(frontendCodes(source, moduleAdmission), malformed).toEqual(['OEC9042']);
    }
    // A same-named foreign import or a local declaration is NOT an intrinsic.
    expect(
      frontendCodes(
        "import { onConnect } from 'somewhere-else';\n" +
          `function Root(props) {\n  ${hook}\n  return <p>{props.x}</p>;\n}\n`,
        rootAdmission,
      ),
    ).toEqual(['OEC9041']);
    expect(
      frontendCodes(
        `function onConnect(cb: () => void) { cb(); }\n` +
          `function Root(props) {\n  ${hook}\n  return <p>{props.x}</p>;\n}\n`,
        rootAdmission,
      ),
    ).toEqual(['OEC9041']);
  });

  test('A10 alias-followed import provenance is admitted', () => {
    const source =
      SIDECAR +
      "import { onConnect as connect, onDispose as dispose } from '@openelement/element';\n" +
      'function Aliased(props: { seed: number }) {\n' +
      '  connect(() => { globalThis.__oeConnect = 1; });\n' +
      '  dispose(() => { globalThis.__oeDispose = 1; });\n' +
      '  return <p>{props.seed}</p>;\n' +
      '}\n' +
      'export default Aliased;\n';
    const module = compileIsland('lifecycle-alias', source);
    expect(functionText(module, '__oe_rootInstance')).toContain('__oe_connect.push((');
    expect(module).not.toContain('connect(() =>');
    expect(module).not.toContain('dispose(() =>');
    expect(module).not.toContain('@openelement/element"');
  });

  test('A11 host-binding reads keep the existing fail-closed gates', () => {
    // A signal is a host binding in the generated element lane (unchanged M09
    // boundary): a hook reading it is refused by the existing gate.
    const signalHook =
      SIDECAR +
      "import { onConnect, signal } from '@openelement/element';\n" +
      'function SignalHook(props: { seed: number }) {\n' +
      '  const count = signal(0);\n' +
      '  onConnect(() => { globalThis.__oeCount = count.value; });\n' +
      '  return <p>{props.seed}</p>;\n' +
      '}\n' +
      'export default SignalHook;\n';
    const fact = site('lifecycle-signal');
    try {
      compileGeneratedElementIfAdmitted(signalHook, fact.file, { site: fact.site });
      throw new Error('expected the generated element lane to refuse a host binding');
    } catch (error) {
      expect(codes(error)).toContain(GENERATED_ELEMENT_DIAGNOSTIC.UNBOUND_BINDING);
    }
    // A root setup local that reads a host binding cannot host the factory: the
    // emitter keeps its existing fail-closed binding identity instead of
    // silently dropping the admitted hooks.
    const localReadsBinding =
      SIDECAR +
      "import { onConnect, signal } from '@openelement/element';\n" +
      'function LocalHook(props: { seed: number }) {\n' +
      '  const count = signal(0);\n' +
      '  const snapshot = count.value;\n' +
      '  onConnect(() => { globalThis.__oeSnapshot = snapshot; });\n' +
      '  return <p>{snapshot}</p>;\n' +
      '}\n' +
      'export default LocalHook;\n';
    const localFact = site('lifecycle-local-binding');
    try {
      compileGeneratedElementIfAdmitted(localReadsBinding, localFact.file, {
        site: localFact.site,
      });
      throw new Error('expected the generated element lane to refuse the setup shape');
    } catch (error) {
      expect(codes(error)).toContain('OEIR_LEAF_UNSUPPORTED_BINDING');
    }
    // Defensive emitter invariant: a model compiled with the root marker but
    // generated without the root instance option must not drop the hooks.
    const front = frontModuleWithRoot(
      SIDECAR +
        "import { onConnect } from '@openelement/element';\n" +
        'function Direct(props: { seed: number }) {\n' +
        '  onConnect(() => { globalThis.__oeConnect = 1; });\n' +
        '  return <p>{props.seed}</p>;\n' +
        '}\n' +
        'export default Direct;\n',
      '/proj/src/direct.tsx',
      'Direct',
    );
    const leaf = generateLeafModule(front);
    expect(leaf.module).toBeNull();
    expect(leaf.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'OEIR_LEAF_INVALID_ARTIFACT',
    ]);
  });

  test('A13 the standalone public imports fail closed outside the compiler (no new error code)', () => {
    // Evaluated WITHOUT the compiler the intrinsic has no dispatcher: silently
    // dropping the callback would be a lie, so the public imports throw the
    // existing "outside the compiler pipeline" identity with a lifecycle-
    // specific message. This is the one runtime behaviour the author surface
    // carries; it is not a hook engine.
    for (const [intrinsic, call] of [
      ['onConnect', () => onConnect(() => undefined)],
      ['onDispose', () => onDispose(() => undefined)],
    ] as const) {
      let thrown: unknown;
      try {
        call();
      } catch (error) {
        thrown = error;
      }
      expect(thrown, intrinsic).toBeInstanceOf(OpenElementError);
      expect((thrown as OpenElementError).code, intrinsic).toBe(
        FacadeErrorCode.JSX_OUTSIDE_COMPILER,
      );
      expect((thrown as OpenElementError).phase, intrinsic).toBe('build');
      expect((thrown as OpenElementError).message, intrinsic).toContain(intrinsic);
    }
  });

  test('A12 the source map still decodes the callback placements that moved into the factory', () => {
    const fact = site('lifecycle-sourcemap');
    const front = frontModuleWithRoot(LIFECYCLE_SOURCE, fact.file, 'LifeCard');
    const emitted = compileGeneratedElementIfAdmitted(LIFECYCLE_SOURCE, fact.file, {
      site: fact.site,
      authoredSource: LIFECYCLE_SOURCE,
    });
    expect(emitted.map).not.toBeNull();
    const leaf = generateLeafModule(front, {
      rootInstance: 'LifeCard',
      authoredSource: LIFECYCLE_SOURCE,
    });
    expect(leaf.sourceMap).not.toBeNull();
    const module = leaf.module!;
    const map = new TraceMap(
      leaf.sourceMap as unknown as ConstructorParameters<typeof TraceMap>[0],
    );
    const lines = module.split('\n');
    const records = new Map(front.expressions.expressions.map((record) => [record.id, record]));
    const factoryRange = functionRange(module, '__oe_rootInstance');
    let callbackPlacements = 0;
    for (const placement of leaf.placements) {
      const record = records.get(placement.exprId);
      expect(record, placement.exprId).toBeDefined();
      const firstLoweredLine = record!.lowered.split('\n')[0]!.trim();
      expect(lines[placement.generatedLine - 1], placement.exprId).toContain(firstLoweredLine);
      const decoded = originalPositionFor(map, {
        line: placement.generatedLine,
        column: placement.generatedColumn,
      });
      expect(decoded.source, placement.exprId).toBe(fact.file);
      expect(decoded.line, placement.exprId).toBe(placement.authoredLine);
      expect(decoded.column, placement.exprId).toBe(placement.authoredColumn);
      if (
        placement.generatedLine - 1 >= factoryRange.start &&
        placement.generatedLine - 1 <= factoryRange.end &&
        record!.lowered.includes('globalThis')
      ) {
        callbackPlacements += 1;
      }
    }
    expect(callbackPlacements).toBe(3);
  });

  test('A12 a depth-1 retained hostless child carries hooks in its own setup record', () => {
    const nested = (hooks: boolean): string =>
      SIDECAR +
      "import { onConnect, onDispose } from '@openelement/element';\n" +
      'function Child(props: { seed: number }) {\n' +
      '  const snapshot = props.seed;\n' +
      (hooks
        ? '  onConnect(() => {\n' +
          '    globalThis.__oeChildConnect = snapshot;\n' +
          '    return () => { globalThis.__oeChildCleanup = 1; };\n' +
          '  });\n' +
          '  onDispose(() => { globalThis.__oeChildDispose = 1; });\n'
        : '') +
      '  return <em className="child">{snapshot}</em>;\n' +
      '}\n' +
      'function Host(props: { seed: number }) {\n' +
      '  const rootSnapshot = props.seed;\n' +
      '  return <span className="root"><b>{rootSnapshot}</b><Child seed={props.seed} /></span>;\n' +
      '}\n' +
      'export default Host;\n';
    const module = compileIsland('lifecycle-nested', nested(true));
    // The depth-1 retained child's ONE setup factory carries both channels:
    // connect callbacks recorded in the retained record, dispose registrations
    // on the instance owner. No second lifecycle engine.
    const childSetup = functionText(module, 'Child__setup');
    expect(childSetup).toContain('__oe_connect.push((');
    expect(childSetup).toContain('__oe_owner.add((');
    expect(childSetup).toContain('return { snapshot, __oe_connect }');
    // The child replays from its OWN retained setup record...
    expect(functionText(module, 'Child__mount')).toContain('__oe_host.setup.__oe_connect');
    // ...while the root body (no hooks here) never invents the setup channel.
    expect(functionText(module, 'Host__mount')).not.toContain('setup.__oe_connect');
    // The SSR producer is untouched by hooks (no invocation text).
    const childSsr = functionText(module, 'Child__ssr');
    expect(childSsr).not.toContain('__oe_connect');
    expect(childSsr).not.toContain('__oe_owner');
    // Root/module bytes that do not carry the hooks are unchanged by them.
    const plain = compileIsland('lifecycle-nested-plain', nested(false));
    expect(functionText(module, 'Host__ssr')).toBe(functionText(plain, 'Host__ssr'));
    expect(functionText(module, 'Child__ssr')).toBe(functionText(plain, 'Child__ssr'));
    expect(functionText(plain, 'Child__setup')).not.toContain('__oe_connect');
    expect(functionText(plain, 'Child__setup')).not.toContain('__oe_owner.add');
  });

  test('A13 nested hook placement outside depth-1 fails closed at the AUTHORED span', () => {
    const importLine = "import { onConnect } from '@openelement/element';\n";
    const hookLine = '  onConnect(() => { globalThis.__oeNested = 1; });';
    const authoredLine = (source: string): number =>
      source.split('\n').findIndex((line) => line.includes('onConnect(')) + 1;
    const cases: Array<{ name: string; source: string; expected: RegExp }> = [
      {
        name: 'depth2',
        expected: /depth>=2|no lifecycle owner/,
        source:
          SIDECAR +
          importLine +
          'function Child(props: { seed: number }) {\n' +
          hookLine +
          '\n  return <em>{props.seed}</em>;\n}\n' +
          'function Mid(props: { seed: number }) {\n' +
          '  return <div><Child seed={props.seed} /></div>;\n}\n' +
          'function Host(props: { seed: number }) {\n' +
          '  return <span><Mid seed={props.seed} /></span>;\n}\n' +
          'export default Host;\n',
      },
      {
        name: 'recipe',
        expected: /recipe\/list bodies|no lifecycle owner/,
        source:
          SIDECAR +
          importLine +
          'function Child(props: { seed: number }) {\n' +
          hookLine +
          '\n  return <em>{props.seed}</em>;\n}\n' +
          'function Host(props: { seed: number }) {\n' +
          '  const card = <Child seed={props.seed} />;\n' +
          '  return <span>{card}</span>;\n}\n' +
          'export default Host;\n',
      },
      {
        name: 'list',
        expected: /recipe\/list bodies|no lifecycle owner/,
        source:
          SIDECAR +
          importLine +
          'function Child(props: { seed: number }) {\n' +
          hookLine +
          '\n  return <em>{props.seed}</em>;\n}\n' +
          'function Host(props: { seed: number }) {\n' +
          '  return <span>{[props.seed].map((item) => <Child seed={item} />)}</span>;\n}\n' +
          'export default Host;\n',
      },
      {
        name: 'non-retained-target',
        expected: /no lifecycle owner|depth>=2/,
        source:
          SIDECAR +
          importLine +
          'function Child(props: { seed: number }) {\n' +
          hookLine +
          '\n  return <em>{props.seed}</em>;\n}\n' +
          'function Host(props: { seed: number }) {\n' +
          '  return <span><Child seed={props.seed} /></span>;\n}\n' +
          'export function Outer() {\n  return <Host seed={1} />;\n}\n' +
          'export default Host;\n',
      },
    ];
    for (const item of cases) {
      const fact = site(`lifecycle-nested-refused-${item.name}`);
      let error: unknown = null;
      try {
        compileGeneratedElementIfAdmitted(item.source, fact.file, { site: fact.site });
      } catch (caught) {
        error = caught;
      }
      expect(error, item.name).not.toBeNull();
      const diagnostics = (error as CompiledElementError).diagnostics;
      const relevant = diagnostics.find(
        (diagnostic) => diagnostic.code === 'OEIR_LEAF_INVALID_ARTIFACT',
      );
      expect(relevant, item.name).toBeDefined();
      expect(relevant!.message, item.name).toMatch(item.expected);
      // Authored span: the refusal points at the author's hook line, never 1:1.
      expect(relevant!.file, item.name).toBe(fact.file);
      expect(relevant!.line, item.name).toBe(authoredLine(item.source));
    }
  });

  test('A14 a nested hook reading a host binding keeps the UNBOUND_BINDING refusal', () => {
    // A module-scope read is a host binding in this lane (same rule that makes
    // a root hook that reads one fail closed): the nested child cannot receive
    // it through the retained setup record, so the existing module gate keeps
    // the identity instead of emitting a factory with an undeclared name.
    const source =
      SIDECAR +
      "import { onConnect } from '@openelement/element';\n" +
      'const external = 1;\n' +
      'function Child(props: { seed: number }) {\n' +
      '  const snapshot = props.seed;\n' +
      '  onConnect(() => { globalThis.__oeNestedExt = external + snapshot; });\n' +
      '  return <em>{snapshot}</em>;\n' +
      '}\n' +
      'function Host(props: { seed: number }) {\n' +
      '  return <span><Child seed={props.seed} /></span>;\n' +
      '}\n' +
      'export default Host;\n';
    const fact = site('lifecycle-nested-binding');
    let error: unknown = null;
    try {
      compileGeneratedElementIfAdmitted(source, fact.file, { site: fact.site });
    } catch (caught) {
      error = caught;
    }
    expect(error).not.toBeNull();
    expect(codes(error)).toContain(GENERATED_ELEMENT_DIAGNOSTIC.UNBOUND_BINDING);
    // The binding refusal is the module gate, not an invalid-artifact drop.
    expect(codes(error)).not.toContain('OEIR_LEAF_INVALID_ARTIFACT');
    expect(String((error as CompiledElementError).diagnostics[0]!.message)).toContain('"external"');
  });

  test('A15 an env-form hook is recorded separately and replayed with {host, signal}', () => {
    const source =
      SIDECAR +
      "import { onConnect, onDispose } from '@openelement/element';\n" +
      'function EnvCard(props: { seed: number }) {\n' +
      '  const snapshot = props.seed;\n' +
      '  onConnect(({ host, signal }) => {\n' +
      '    globalThis.__oeHostTag = host.tagName;\n' +
      '    globalThis.__oeAbortedAtConnect = signal.aborted;\n' +
      '    return () => { globalThis.__oeAbortedAtCleanup = signal.aborted; };\n' +
      '  });\n' +
      '  onDispose((env) => { globalThis.__oeAbortedAtDispose = env.signal.aborted; });\n' +
      '  return <span className="seed">{snapshot}</span>;\n' +
      '}\n' +
      'export default EnvCard;\n';
    const module = compileIsland('lifecycle-env', source);
    const factory = functionText(module, '__oe_rootInstance');
    // The env form has its OWN retained record; no zero-argument record is
    // emitted in an env-only module, so the two byte paths never mix.
    expect(factory).toContain('const __oe_connectEnv = [];');
    expect(factory).toContain('__oe_connectEnv.push((');
    expect(factory).not.toContain('const __oe_connect = [];');
    expect(factory).toContain('const __oe_teardownSignal = __oe_owner.signal;');
    expect(factory).toContain('__oe_owner.add(() => (');
    expect(factory).toContain(
      ')({ host: __oe_host.__oe_hostElement, signal: __oe_teardownSignal }));',
    );
    expect(factory).toContain('return { snapshot, __oe_connectEnv };');
    for (const body of ['EnvCard__mount', 'EnvCard__claim']) {
      const text = functionText(module, body);
      expect(text).toContain('const __oe_lifecycleEnvHooks = __oe_host.bindings.__oe_connectEnv;');
      expect(text).toContain('for (const __oe_lifecycleEnvHook of __oe_lifecycleEnvHooks)');
      expect(text).toContain(
        '__oe_lifecycleEnvHook({ host: __oe_host.__oe_hostElement, signal: __oe_scope.signal })',
      );
      expect(text).toContain('__oe_scope.add(__oe_lifecycleEnvCleanup)');
      // The zero-argument replay is not emitted for an env-only module.
      expect(text).not.toContain('__oe_lifecycleHooks');
    }
    // The recipe's mount host forwards the shell-attached runtime property.
    expect(functionText(module, 'createEnvCardRecipe')).toContain(
      '__oe_hostElement: __oe_host.__oe_hostElement',
    );
    // The intrinsic calls, their import and the env parameter never reach the
    // emitted module.
    expect(module).not.toContain('onConnect');
    expect(module).not.toContain('onDispose');
    expect(module).not.toMatch(/from\s+"@openelement\/element"/);
  });

  test('A16 a zero-argument module keeps the pre-env host record and replay bytes', () => {
    const module = compileIsland('lifecycle-zero-arg', LIFECYCLE_SOURCE);
    const factory = functionText(module, '__oe_rootInstance');
    expect(factory).not.toContain('__oe_connectEnv');
    expect(factory).not.toContain('__oe_teardownSignal');
    expect(factory).toContain('const __oe_connect = [];');
    expect(factory).toContain('return { snapshot, __oe_connect };');
    for (const body of ['LifeCard__mount', 'LifeCard__claim']) {
      const text = functionText(module, body);
      expect(text).not.toContain('__oe_lifecycleEnv');
      expect(text).not.toContain('__oe_hostElement');
      for (const line of CONNECT_REPLAY_LINES) {
        expect(text, `${body}: ${line}`).toContain(line);
      }
    }
    // No host-record forwarding is added to a module without the env form.
    expect(functionText(module, 'createLifeCardRecipe')).not.toContain('__oe_hostElement');
  });

  test('A17 a depth-1 retained child receives the ancestor element and its own signal', () => {
    const source =
      SIDECAR +
      "import { onConnect, onDispose } from '@openelement/element';\n" +
      'function Child(props: { seed: number }) {\n' +
      '  const snapshot = props.seed;\n' +
      '  onConnect((env) => {\n' +
      '    globalThis.__oeChildHost = env.host;\n' +
      '    globalThis.__oeChildSignal = env.signal;\n' +
      '    return () => { globalThis.__oeChildAbort = env.signal.aborted; };\n' +
      '  });\n' +
      '  onDispose((env) => { globalThis.__oeChildDisposeAbort = env.signal.aborted; });\n' +
      '  return <em className="child">{snapshot}</em>;\n' +
      '}\n' +
      'function Host(props: { seed: number }) {\n' +
      '  const rootSnapshot = props.seed;\n' +
      '  return <span className="root"><b>{rootSnapshot}</b><Child seed={props.seed} /></span>;\n' +
      '}\n' +
      'export default Host;\n';
    const module = compileIsland('lifecycle-nested-env', source);
    const childSetup = functionText(module, 'Child__setup');
    expect(childSetup).toContain('const __oe_connectEnv = [];');
    expect(childSetup).toContain('__oe_owner.add(() => (');
    expect(childSetup).toContain(
      ')({ host: __oe_host.__oe_hostElement, signal: __oe_teardownSignal }));',
    );
    expect(childSetup).toContain('return { snapshot, __oe_connectEnv };');
    // The child replays from its OWN retained record and the per-projection
    // scope signal (the parent's connection signal only for the root body).
    const childMount = functionText(module, 'Child__mount');
    expect(childMount).toContain('__oe_host.setup.__oe_connectEnv');
    expect(childMount).toContain('signal: __oe_scope.signal');
    expect(childMount).toContain('host: __oe_host.__oe_hostElement');
    // The retaining site forwards the element into BOTH hosts it builds: the
    // setup host the factory reads and the mount/claim host the body reads.
    const hostMount = functionText(module, 'Host__mount');
    expect(occurrences(hostMount, '__oe_hostElement: __oe_host.__oe_hostElement')).toBe(2);
    // The root body itself has no hooks, so it invents no replay.
    expect(hostMount).not.toContain('__oe_lifecycleEnv');
  });

  test('A18 mixed forms in one component keep one record per form and both replays', () => {
    const source =
      SIDECAR +
      "import { onConnect } from '@openelement/element';\n" +
      'function Mixed(props: { seed: number }) {\n' +
      '  const snapshot = props.seed;\n' +
      '  onConnect(() => { globalThis.__oeLegacy = snapshot; });\n' +
      '  onConnect((env) => { globalThis.__oeHostTag = env.host.tagName; });\n' +
      '  return <span>{snapshot}</span>;\n' +
      '}\n' +
      'export default Mixed;\n';
    const module = compileIsland('lifecycle-mixed', source);
    const factory = functionText(module, '__oe_rootInstance');
    expect(factory).toContain('const __oe_connect = [];');
    expect(factory).toContain('const __oe_connectEnv = [];');
    expect(factory).toContain('return { snapshot, __oe_connect, __oe_connectEnv };');
    for (const body of ['Mixed__mount', 'Mixed__claim']) {
      const text = functionText(module, body);
      expect(text).toContain('__oe_lifecycleHooks');
      expect(text).toContain('__oe_lifecycleEnvHooks');
      // Zero-argument callbacks are still invoked with no argument.
      expect(text).toContain('__oe_lifecycleHook();');
    }
  });
});
