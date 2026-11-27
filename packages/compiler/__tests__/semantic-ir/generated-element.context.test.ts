/**
 * `16b-CTX` provider/consumer context — compiler contract (LOCAL, Node).
 *
 * `provideContext(token, () => value)` and `const value = useContext(token)` are
 * the SIXTH and SEVENTH compiler-erased intrinsics of the generated-element
 * lane. This suite is the compiler half; the runtime half (nested shadowing,
 * provider change, disconnect cleanup and reconnect re-registration in a real
 * Chromium element) is `generated-element.context.browser.test.ts`.
 *
 * WHAT THE SHAPE IS, AND WHY. ADR-0182 D-18b item 3 fixes the author surface as
 * `provideContext` / `useContext` over the generated OWNER tree, and leaves
 * "representation, provider lifetime and reactivity" to the implementation. The
 * semantics authority is `packages/element/src/internal/compiled/runtime/context.ts`,
 * whose two facts decided this shape:
 *
 * - a provider publishes a value by RE-PROVIDING on the same host/key (its
 *   existing record keeps one listener and reuses one signal), so "provider
 *   changed" is a repeated provide, not a new reactivity model. The generated
 *   lane therefore takes the value as a THUNK and re-reads it after a
 *   declared-property commit;
 * - a consumer's value lives in ONE consumer-local signal owned by the service,
 *   so a declaration must produce a SIGNAL the tracked-slot machinery already
 *   subscribes to. `useContext(token)` is that value, and it is a real reactive
 *   dependency — unlike a `ref` handle.
 *
 * What is pinned here:
 *
 * - ADMISSION: a direct top-level `provideContext(token, () => value)` statement
 *   and a `const s = useContext(token)` declaration, recognized by BINDING
 *   PROVENANCE (a named import of `@openelement/element` or
 *   `@openelement/element/lifecycle`, aliases followed).
 * - ERASURE: the emitted module imports and calls neither intrinsic; the
 *   provider registration and the consumer signal are built in the
 *   compiler-owned `__oe_rootInstance` / `<Name>__setup` factory.
 * - OWNERSHIP: a root provides/consumes on the element anchor; a nested hostless
 *   component owns a CHILD scope (`owner()`), so two siblings are isolated.
 * - SSR: a component that READS a consumer IS serializable and claimable. Its
 *   producer resolves the consumer at render time from the nearest provider the
 *   render's OWNER SCOPE holds (a parameter threaded through the producer call
 *   graph, never module state), so the server bytes carry the PROVIDED value and
 *   `<Name>__claim` adopts them with the existing static-seed discipline.
 * - BYTE IDENTITY: a module without the intrinsics is byte-identical to its
 *   pre-slice output — the `16b-REF` SHA pins are the proof, because they were
 *   captured from the clean tree before this change.
 * - FAIL CLOSED: depth >= 2 and every malformed call shape are refused at the
 *   authored span with an existing code; the standalone public import throws the
 *   existing `JSX_OUTSIDE_COMPILER` identity.
 *
 * LOCAL Node evidence. Not an M13 matrix row, not a public API freeze.
 */

import { hashBeforeFormFactorySplit } from './testlib/generated-element-baseline.ts';
import { describe, expect, test } from 'vitest';
import {
  compileFunctionModule,
  type FunctionModelModule,
} from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import {
  GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import { createGeneratedElementSiteResolver } from '../../../router/src/vite/generated-element-site.ts';
import { FacadeErrorCode, OpenElementError } from '../../../protocol/src/errors.ts';
import { useContext } from '../../../element/src/index.ts';
// The generated module's OWN runtime entry, so the harness supplies exactly the
// symbols an emitted island imports (the leaf entry, not the executor facade).
import * as LEAF_RUNTIME from '../../../element/src/internal/compiled/leaf-runtime.ts';
import { createContext } from '../../../element/src/internal/core/signal-context.ts';

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

/**
 * The `16b-REF` fixtures' pin uses the SAME module text that suite compiles, so
 * the byte-identity rows below re-spell it here rather than approximating it.
 */
const REF_TEST_SIDECAR = SIDECAR;

function site(fragment: string): { file: string; site: GeneratedElementSite } {
  const file = `${ISLANDS_DIR}/${fragment}.tsx`;
  return { file, site: siteFor(file)! };
}

function compileIsland(name: string, source: string): string {
  const fact = site(name);
  return compileGeneratedElementIfAdmitted(source, fact.file, { site: fact.site }).code;
}

function codes(error: unknown): string[] {
  expect(error).toBeInstanceOf(CompiledElementError);
  return (error as CompiledElementError).diagnostics.map((diagnostic) => diagnostic.code);
}

function messages(error: unknown): string[] {
  expect(error).toBeInstanceOf(CompiledElementError);
  return (error as CompiledElementError).diagnostics.map((diagnostic) => diagnostic.message);
}

function attempt(source: string, name = 'ctx-refusal'): unknown {
  const fact = site(name);
  try {
    compileGeneratedElementIfAdmitted(source, fact.file, { site: fact.site });
  } catch (error) {
    return error;
  }
  return null;
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
 * Whether the module calls the AUTHORED intrinsic `useContext(...)`. The emitted
 * channel locals are `__oe_contextScope`, so a plain substring check cannot
 * answer this; the lookbehind excludes the `__oe_` prefix.
 */
function callsAuthoredUseContext(module: string): boolean {
  return /(?<!__oe_)(?<!\.)\buseContext\s*\(/.test(module);
}

function callsAuthoredProvideContext(module: string): boolean {
  return /(?<!__oe_)(?<!\.)\bprovideContext\s*\(/.test(module);
}

/** A root that provides and consumes one token. */
const ROOT_SOURCE =
  SIDECAR +
  "import { provideContext, useContext } from '@openelement/element';\n" +
  "import { Theme } from '../tokens.ts';\n" +
  'function Root(props: { seed: number }) {\n' +
  '  provideContext(Theme, () => props.seed);\n' +
  '  const theme = useContext(Theme);\n' +
  '  return <p>{theme.value}</p>;\n' +
  '}\n' +
  'export default Root;\n';

/** A provider-only nested hostless child (renders no consumer value). */
const NESTED_PROVIDER_SOURCE =
  SIDECAR +
  "import { provideContext } from '@openelement/element';\n" +
  "import { Theme } from '../tokens.ts';\n" +
  'function Child(props: { seed: number }) {\n' +
  '  provideContext(Theme, () => props.seed);\n' +
  '  return <em>{props.seed}</em>;\n' +
  '}\n' +
  'function Root(props: { seed: number }) {\n' +
  '  return <div><Child seed={props.seed} /></div>;\n' +
  '}\n' +
  'export default Root;\n';

/** A depth-1 retained child that consumes; the root provides. */
const NESTED_CONSUMER_SOURCE =
  SIDECAR +
  "import { provideContext, useContext } from '@openelement/element';\n" +
  "import { Theme } from '../tokens.ts';\n" +
  'function Child(props: { seed: number }) {\n' +
  '  const theme = useContext(Theme);\n' +
  '  return <em>{theme.value}</em>;\n' +
  '}\n' +
  'function Root(props: { seed: number }) {\n' +
  '  provideContext(Theme, () => props.seed);\n' +
  '  return <div><Child seed={props.seed} /></div>;\n' +
  '}\n' +
  'export default Root;\n';

/** The token module every fixture imports as `../tokens.ts`. */
const TOKEN_MODULE = {
  Theme: createContext(Symbol('theme'), 'theme-default'),
  Shared: createContext(Symbol('shared'), 'shared-default'),
};

/**
 * Instantiate an emitted module against the REAL generated-leaf runtime entry.
 *
 * The emitted code imports from `@openelement/element/internal/compiled/leaf-runtime`
 * and from the authored token module; this rewrites exactly those two edges so
 * the producer runs in Node with the same primitives the browser bundle gets.
 * Nothing is stubbed: `createRenderContextScope`, the escaping pair and the
 * marker helpers are the shipped implementations.
 */
const SSR_EXPORT = /^export function ([\w$]+)\(/gm;
const RUNTIME_IMPORT = /^import \{([^}]+)\} from [^;]+;$/m;
const TOKEN_IMPORT = /^import \{([^}]+)\} from "\.\.\/tokens\.ts";$/m;

function instantiate(module: string): Record<string, unknown> {
  const exported = [...module.matchAll(SSR_EXPORT)].map((match) => match[1]!);
  const runtimeMatch = module.match(RUNTIME_IMPORT);
  if (runtimeMatch === null) throw new Error('generated module has no runtime import');
  const runtimeNames = runtimeMatch[1]!
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const tokenMatch = module.match(TOKEN_IMPORT);
  const tokenNames =
    tokenMatch === null
      ? []
      : tokenMatch[1]!
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name.length > 0);
  let body = module
    .replace(RUNTIME_IMPORT, `const { ${runtimeNames.join(', ')} } = __oe_runtime;`)
    .replace(/^export function /gm, 'function ')
    // The appended generated-element TAIL (shell import, descriptor, class,
    // exports) is host wiring, not producer code: the producer bytes and the
    // claim/mount bodies are the subject here, and running the tail would need a
    // DOM `customElements`.
    .replace(/\/\/ ---- generated native element[\s\S]*$/, '');
  if (tokenMatch !== null) {
    body = body.replace(TOKEN_IMPORT, `const { ${tokenNames.join(', ')} } = __oe_tokens;`);
  }
  const factory = new Function(
    '__oe_runtime',
    '__oe_tokens',
    `"use strict";\n${body}\nreturn { ${exported.join(', ')} };`,
  ) as (runtime: unknown, tokens: unknown) => Record<string, unknown>;
  return factory(LEAF_RUNTIME, TOKEN_MODULE);
}

type SsrFunction = (
  props?: Record<string, unknown>,
  host?: { readonly bindings: Record<string, unknown> },
  scope?: unknown,
) => string;

function ssrOf(loaded: Record<string, unknown>, name: string): SsrFunction {
  const value = loaded[`${name}__ssr`];
  if (typeof value !== 'function') throw new Error(`missing ${name}__ssr`);
  return value as SsrFunction;
}

/** The visible text of a producer's HTML, with its marker comments removed. */
function textOf(html: string): string {
  // Extraction, not sanitization: the output is built character-by-character
  // from the spans BETWEEN tags, so no substring of the input (including any
  // `<script` sequence) survives into the result as markup. This is why the
  // sanitizer lints stay quiet — there is no cleaned-up tainted string, there
  // is a freshly assembled plain-text one.
  let out = '';
  let inTag = false;
  for (const ch of html) {
    if (ch === '<') {
      inTag = true;
      continue;
    }
    if (ch === '>') {
      inTag = false;
      continue;
    }
    if (!inTag) out += ch;
  }
  return out.trim();
}

/**
 * A three-owner fixture for the SERVER render: an outer provider, a nested
 * provider that shadows it for its subtree, and a sibling consumer that must
 * keep seeing the OUTER value.
 *
 *   Root           provides Theme = `outer-<mode>`; renders Inner then Sibling
 *     ├─ Inner     provides Theme = `inner-<mode>`, consumes (its own)
 *     └─ Sibling   consumes (the root's)
 *
 * Server-side it is the same owner tree the Chromium row proves on the client:
 * a component reference gives the child producer an `owner()` scope, and a
 * sibling reference therefore cannot see it.
 */
const SSR_TREE_SOURCE =
  sidecar("mode: { default: 'outer' }, seed: { default: 0 }") +
  "import { provideContext, useContext } from '@openelement/element';\n" +
  "import { Theme } from '../tokens.ts';\n" +
  'function Inner(props: { mode: string; seed: number }) {\n' +
  "  provideContext(Theme, () => 'inner-' + props.mode);\n" +
  '  const theme = useContext(Theme);\n' +
  '  return <span id="inner">{theme.value}</span>;\n' +
  '}\n' +
  'function Sibling(props: { mode: string; seed: number }) {\n' +
  '  const theme = useContext(Theme);\n' +
  '  return <b id="sibling">{theme.value}</b>;\n' +
  '}\n' +
  'function Root(props: { mode: string; seed: number }) {\n' +
  "  provideContext(Theme, () => 'outer-' + props.mode);\n" +
  '  return (\n' +
  '    <section id="root">\n' +
  '      <Inner mode={props.mode} seed={props.seed} />\n' +
  '      <Sibling mode={props.mode} seed={props.seed} />\n' +
  '    </section>\n' +
  '  );\n' +
  '}\n' +
  'export default Root;\n';

/** A consumer with NO provider in the render: the declared default applies. */
const SSR_DEFAULT_SOURCE =
  SIDECAR +
  "import { useContext } from '@openelement/element';\n" +
  "import { Shared } from '../tokens.ts';\n" +
  'function Root(props: { seed: number }) {\n' +
  '  const shared = useContext(Shared);\n' +
  '  return <i>{shared.value}</i>;\n' +
  '}\n' +
  'export default Root;\n';

describe('16b-CTX context intrinsics — emitted artifact contract (Node)', () => {
  test('the configured feature imports leave authored binding names available', () => {
    const source =
      sidecar('') +
      "import { useContext } from '@openelement/element';\n" +
      "import { Theme } from '../ctx-tokens.ts';\n" +
      'export default function Reader() {\n' +
      '  const createGeneratedElementContext = useContext(Theme);\n' +
      '  return <p>{createGeneratedElementContext.value}</p>;\n' +
      '}\n';
    const module = compileIsland('ctx-author-binding', source);
    expect(module).toContain('createGeneratedElementContext as __oe_contextFeature');
    expect(module).toContain('{ context: __oe_contextFeature }');
    expect(module).toMatch(/createGeneratedElementContext\s*\.\s*value/);
    expect(
      attempt(source.replaceAll('createGeneratedElementContext', '__oe_contextFeature')),
    ).toBeInstanceOf(CompiledElementError);
  });

  test('C1 the intrinsics are erased: the module imports and calls neither one', () => {
    const module = compileIsland('ctx-erased', ROOT_SOURCE);
    expect(callsAuthoredUseContext(module)).toBe(false);
    expect(callsAuthoredProvideContext(module)).toBe(false);
    expect(module).not.toMatch(/from\s+"@openelement\/element"/);
    expect(module).not.toMatch(/from\s+'@openelement\/element'/);
    // The TOKEN import (a normal static module import) IS re-emitted: the
    // consumer and provider both read it, so it must survive the erasure.
    expect(module).toContain('from "../tokens.ts"');
  });

  test('C2 the consumer is ONE retained signal; the provider is one registration in the factory', () => {
    const module = compileIsland('ctx-factory-shape', ROOT_SOURCE);
    const factory = functionText(module, '__oe_rootInstance');
    // The root uses the element anchor directly: `__oe_context` is the channel.
    expect(factory).toContain('const __oe_contextScope = __oe_host.__oe_context;');
    // ONE consumer signal, built once in the call-once factory.
    expect(factory).toContain('const theme = __oe_contextScope.use((Theme));');
    expect(factory).toContain('__oe_contextScope.provider((Theme), (() =>');
    // One construction site per PHASE. The client factory builds the consumer and
    // registers the provider once for the element lifetime; the SSR producer
    // builds its own per-render pair (that is the whole point of the fix), and
    // the two never share an object because a render has no connection.
    expect(occurrences(factory, '__oe_contextScope.use(')).toBe(1);
    expect(occurrences(factory, '__oe_contextScope.provider(')).toBe(1);
    const ssr = functionText(module, 'Root__ssr');
    expect(occurrences(ssr, '__oe_contextScope.use('), 'the SSR producer resolves once').toBe(1);
    expect(occurrences(ssr, '__oe_contextScope.provider('), 'the SSR producer registers once').toBe(
      1,
    );
    // The retained record carries the scope and the consumer, so mount/claim
    // alias them rather than re-deriving a scope.
    expect(factory).toContain('return { theme, __oe_contextScope };');
    for (const body of ['Root__mount', 'Root__claim']) {
      const text = functionText(module, body);
      expect(text, body).toContain('__oe_requireRootSetup("__oe_contextScope")');
      expect(text, body).toContain('__oe_requireRootSetup("theme")');
    }
  });

  test('C3 the consumer is the lane\u2019s EXISTING subscription channel, not a second mechanism', () => {
    const module = compileIsland('ctx-subscription-reuse', ROOT_SOURCE);
    const mount = functionText(module, 'Root__mount');
    // The consumer refreshes through the one `bindSignalWrites` call every other
    // dependency uses. This is what makes `theme.value` a real reactive read
    // rather than the `ref` handle's attach-only behaviour.
    expect(mount).toContain('bindSignalWrites(__oe_scope, theme, "theme", __oe_refresh');
    // No new runtime helper, no new sink kind, no new package export.
    expect(module).not.toMatch(/import \{[^}]*\bcontextScope\b/);
    expect(module).not.toMatch(/(?<!\.)\bcreateContext\s*\(/);
    expect(module).not.toMatch(/(?<!\.)\buseSignal\s*\(/);
  });

  test("C4 the provider's value is a THUNK, so a property commit re-reads it", () => {
    const module = compileIsland('ctx-thunk', ROOT_SOURCE);
    const factory = functionText(module, '__oe_rootInstance');
    // The factory passes the authored arrow VERBATIM; it does not call it. That
    // is what lets the shell re-read the value after a declared-row commit.
    expect(factory).toContain('(() =>   props . seed)');
    // A snapshot call would be the defeat: `props.seed` evaluated once here.
    expect(factory).not.toContain('(() =>   props . seed)()');
    // The thunk is passed as an ARGUMENT to the provider registration, i.e.
    // stored for later re-reads, never invoked at registration time.
    expect(factory).toMatch(/provider\(\(Theme\), \(\(\) =>[^)]*\)\);/);
  });

  test('C5 a nested hostless provider owns a CHILD scope, so siblings are isolated', () => {
    const module = compileIsland('ctx-nested-owner', NESTED_PROVIDER_SOURCE);
    const setup = functionText(module, 'Child__setup');
    // `owner()` is a child of the element anchor: the child's provider cannot
    // reach a sibling, while both resolve the element's ancestors.
    expect(setup).toContain('const __oe_contextScope = __oe_host.__oe_context.owner();');
    expect(setup).toContain('__oe_contextScope.provider((Theme), (() =>');
    expect(setup).toContain('return { __oe_contextScope };');
    // The child's own mount/claim alias the retained record.
    expect(functionText(module, 'Child__mount')).toContain(
      '__oe_requireRootSetup("__oe_contextScope")',
    );
    // The SERVER keeps the same rule: the child producer joins its caller as
    // `owner()`, so the client and server owner shapes agree.
    expect(functionText(module, 'Child__ssr')).toContain(
      '__oe_ssrContext === undefined ? createRenderContextScope() : __oe_ssrContext.owner()',
    );
    // The root here has no setup work of its own, so no client factory is emitted
    // at all — which IS the statement that only the child owns a child scope.
    expect(module).not.toContain('function __oe_rootInstance');
    // Three `owner()` sites, one per owner shape and phase: the client retained
    // child setup, the root producer's nested branch, and the child producer's
    // nested branch. Each is the SAME rule, which is why the count is a fact
    // worth pinning rather than an incidental number.
    expect(occurrences(module, '.owner()')).toBe(3);
  });

  test('C6 a module WITHOUT the intrinsics keeps the exact pre-16b-CTX bytes (16b-REF SHA pins)', () => {
    // These pins are the `16b-REF` ones, captured from the CLEAN tree before that
    // change, over the SAME fixtures that suite pins. They still hold here,
    // which is the "adding two admitted names moves nobody else's output"
    // obligation. The shared-sidecar fixture is spelled exactly as the ref suite
    // spells it (the emitted bytes depend on it, so a re-spelling would pin a
    // different module).
    const FOUR_INTRINSICS_SOURCE =
      REF_TEST_SIDECAR +
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
    expect(hashBeforeFormFactorySplit(compileIsland('rbase-four', FOUR_INTRINSICS_SOURCE))).toBe(
      '827b9c30395462ca535a5cdfcba9fe063f0abbeb9597842bbd1bfde11f043079',
    );
    const PLAIN_SOURCE =
      REF_TEST_SIDECAR +
      'function Plain(props: { seed: number }) {\n' +
      '  return <span className="x">{props.seed}</span>;\n' +
      '}\n' +
      'export default Plain;\n';
    expect(hashBeforeFormFactorySplit(compileIsland('rbase-plain', PLAIN_SOURCE))).toBe(
      'f42169e087cb7fbb66ac5007244126501eddf2770fd91ce9ab8798375c39b097',
    );
    const LOCAL_SOURCE =
      REF_TEST_SIDECAR +
      'function Local(props: { seed: number }) {\n' +
      '  const doubled = props.seed * 2;\n' +
      '  return <em>{doubled}</em>;\n' +
      '}\n' +
      'export default Local;\n';
    expect(hashBeforeFormFactorySplit(compileIsland('rbase-local', LOCAL_SOURCE))).toBe(
      '11d72ce142ddf6a0895cf1bd137db0ead351b6642e8af4922e7a541a749bf5f1',
    );
    for (const source of [FOUR_INTRINSICS_SOURCE, PLAIN_SOURCE, LOCAL_SOURCE]) {
      const module = compileIsland('ctx-rbase-shape', source);
      expect(module).not.toContain('__oe_context');
      expect(module).not.toContain('__oe_contextScope');
    }
  });

  test('C7 SSR: a consumer reader IS claimable and serializable; the producer carries its own render scope', () => {
    // The consumer-reading component now emits BOTH artifacts. The producer
    // resolves its consumer from the nearest provider the render's owner scope
    // holds, so its bytes carry the PROVIDED value; the claim adopts those bytes
    // with the existing static-seed discipline.
    const reader = compileIsland('ctx-ssr-reader', ROOT_SOURCE);
    expect(reader).toContain('Root__claim');
    expect(reader).toContain('export function Root__ssr');
    expect(reader).toContain('ssrProducer: Root__ssr');
    // The render scope is a PARAMETER, never module state: two concurrent
    // renders cannot share it.
    expect(reader).toContain('export function Root__ssr(__oe_props, __oe_host, __oe_ssrContext)');
    expect(reader).toContain(
      '__oe_ssrContext === undefined ? createRenderContextScope() : __oe_ssrContext.owner()',
    );
    // The provider publishes before the consumer resolves, so the component reads
    // its OWN value exactly as the client factory does.
    const ssr = functionText(reader, 'Root__ssr');
    expect(ssr.indexOf('.provider(')).toBeLessThan(ssr.indexOf('.use('));
    // …and the consumer value IS the emitted server text, not a default.
    expect(ssr).toContain('escapeText(displayValue((theme . value)))');

    // A PROVIDER-only component renders no consumer value and keeps its
    // pre-existing producer shape — but its producer still declares a render
    // scope, because a nested PRODUCER of its subtree needs one to join.
    const providerOnly = compileIsland('ctx-ssr-provider', NESTED_PROVIDER_SOURCE);
    expect(providerOnly).toContain('Child__claim');
    expect(providerOnly).toContain('Child__ssr');
    // The composition helper carries the body (the exported `Root__ssr` is the
    // wrapper), so the declaration is asserted where it is emitted.
    expect(functionText(providerOnly, '__oe_ssrComponent_Root')).toContain(
      '__oe_ssrContext === undefined ? createRenderContextScope() : __oe_ssrContext.owner()',
    );
    // The child producer receives the caller's scope as its trailing argument,
    // so the render's owner chain is the call graph.
    expect(functionText(providerOnly, '__oe_ssrComponent_Root')).toMatch(
      /Child__ssr\([^;]*, __oe_contextScope\)/,
    );
  });

  test('C8 the depth-1 retained consumer rides its own setup factory', () => {
    const module = compileIsland('ctx-retained-consumer', NESTED_CONSUMER_SOURCE);
    const setup = functionText(module, 'Child__setup');
    expect(setup).toContain('const __oe_contextScope = __oe_host.__oe_context.owner();');
    expect(setup).toContain('const theme = __oe_contextScope.use((Theme));');
    expect(setup).toContain('return { theme, __oe_contextScope };');
    expect(functionText(module, 'Child__mount')).toContain('__oe_requireRootSetup("theme")');
    // The root's provider is on the ANCHOR, so the child resolves it.
    expect(functionText(module, '__oe_rootInstance')).toContain(
      'const __oe_contextScope = __oe_host.__oe_context;',
    );
  });

  // ── admission: positives ────────────────────────────────────────────────

  test('C9 the aliased import and the lifecycle subpath are both admitted', () => {
    for (const [name, importLine, local] of [
      [
        'ctx-alias',
        "import { provideContext as provide, useContext as use } from '@openelement/element';\n",
        { provide: 'provide', use: 'use' },
      ],
      [
        'ctx-subpath',
        "import { provideContext, useContext } from '@openelement/element/lifecycle';\n",
        { provide: 'provideContext', use: 'useContext' },
      ],
    ] as const) {
      const source =
        SIDECAR +
        importLine +
        "import { Theme } from '../tokens.ts';\n" +
        'function Aliased(props: { seed: number }) {\n' +
        `  ${local.provide}(Theme, () => props.seed);\n` +
        `  const theme = ${local.use}(Theme);\n` +
        '  return <p>{theme.value}</p>;\n' +
        '}\n' +
        'export default Aliased;\n';
      const module = compileIsland(name, source);
      expect(functionText(module, '__oe_rootInstance'), name).toContain(
        'const theme = __oe_contextScope.use((Theme));',
      );
      expect(module, name).not.toContain(`${local.use}(Theme)`);
    }
  });

  test('C10 the consumer is a model resource with its own kind', () => {
    const front: FunctionModelModule = compileFunctionModule(
      ROOT_SOURCE,
      `${ISLANDS_DIR}/ctx-kind.tsx`,
      {
        importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
        lifecycleAdmission: { admission: 'module' },
      },
    ).module!;
    const component = front.components[0]!;
    expect(component.resources.map((resource) => [resource.name, resource.kind] as const)).toEqual([
      ['theme', 'context'],
    ]);
    // The provider is a statement of its own, not a resource.
    expect(component.contextProviders).toHaveLength(1);
    expect(component.contextProviders[0]!.value).not.toBeNull();
  });

  // ── admission: refusals ─────────────────────────────────────────────────

  test('C11 an arity / type-argument / non-inline / async / parameter shape is refused with OEC9042', () => {
    const frontendCodes = (source: string): string[] =>
      compileFunctionModule(source, `${ISLANDS_DIR}/ctx-refusals.tsx`, {
        importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
        lifecycleAdmission: { admission: 'module' },
      }).diagnostics.map((diagnostic) => diagnostic.code);

    const importLine = "import { provideContext, useContext } from '@openelement/element';\n";
    const token = "import { Theme } from '../tokens.ts';\n";
    const wrap = (body: string, prefix = ''): string =>
      prefix + importLine + token + `function Root(props) {\n  ${body}\n  return <p />;\n}\n`;

    // PROVIDER shape refusals.
    for (const malformed of [
      'provideContext(Theme);',
      'provideContext(Theme, () => 1, () => 2);',
      'provideContext(Theme, props.seed);',
      'provideContext(Theme, handler);',
      'provideContext(Theme, function* () {});',
      'provideContext(Theme, async () => 1);',
      'provideContext(Theme, (value) => value);',
    ]) {
      expect(frontendCodes(wrap(malformed, 'const handler = () => 1;\n')), malformed).toEqual([
        'OEC9042',
      ]);
    }

    // CONSUMER shape refusals.
    for (const malformed of ['const v = useContext();', 'const v = useContext(Theme, Theme);']) {
      expect(frontendCodes(wrap(malformed))).toEqual(['OEC9042']);
    }
    // A `let` consumer is refused: the signal identity is the contract.
    expect(frontendCodes(wrap('let v = useContext(Theme);'))).toEqual(['OEC9042']);
  });

  test('C12 a wrong specifier / a local shadow / a namespace member is NOT the intrinsic', () => {
    // The invariant is NOT "no diagnostic": a non-intrinsic call is an ordinary
    // value whose kind the lane cannot classify, so the pre-existing tracked-slot
    // `OEIR_UNCLASSIFIED_BINDING` refusal applies (OEC9043). What matters is that
    // NONE of these three shapes is admitted as the context intrinsic — i.e. no
    // consumer resource, no provider statement, and no `__oe_contextScope`.
    const analyse = (source: string): { codes: string[]; module: FunctionModelModule | null } => {
      const result = compileFunctionModule(source, `${ISLANDS_DIR}/ctx-provenance.tsx`, {
        importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
        lifecycleAdmission: { admission: 'root', root: 'Root' },
      });
      return {
        codes: result.diagnostics.map((diagnostic) => diagnostic.code),
        module: result.module,
      };
    };

    const shapes: readonly (readonly [string, string])[] = [
      [
        'foreign import',
        "import { useContext } from 'somewhere-else';\n" +
          'function Root(props) {\n  const v = useContext();\n' +
          '  return <p>{String(v)}</p>;\n}\n',
      ],
      [
        'local shadow',
        'function useContext(x) { return x; }\n' +
          'function Root(props) {\n  const v = useContext(1);\n  return <p>{v}</p>;\n}\n',
      ],
      [
        'namespace member',
        "import * as element from '@openelement/element';\n" +
          'function Root(props) {\n  const v = element.useContext(1);\n' +
          '  return <p>{v}</p>;\n}\n',
      ],
    ];
    for (const [label, source] of shapes) {
      const { codes: found, module } = analyse(source);
      // Never a context admission: the consumer kind and the provider list stay
      // empty, so the emitted-marker assertions below are meaningful.
      if (module !== null) {
        const component = module.components[0]!;
        expect(
          component.resources.some((resource) => resource.kind === 'context'),
          label,
        ).toBe(false);
        expect(component.contextProviders, label).toEqual([]);
      }
      // A local shadow is fully legal JS (its call is an ordinary call), so it
      // produces NO diagnostic; the other two are refused by the pre-existing
      // tracked-slot kind gate, never by a context code.
      for (const code of found) {
        expect(code, label).toBe('OEC9043');
      }
      if (label === 'local shadow') expect(found, label).toEqual([]);
    }
  });

  test('C13 a depth-2 provider/consumer pair is ADMITTED and gets its owner scopes', () => {
    // Depth >= 2 (2026-11-21): the retained body that references its own
    // hostless child now carries the child's setup factory, so the grandchild
    // consumer resolves against the retained `Inner` owner scope. The refusal
    // that still exists is the placement one (a consumer in a body that owns no
    // scope) — see the recipe-body case below.
    const deep =
      SIDECAR +
      "import { provideContext, useContext } from '@openelement/element';\n" +
      "import { Theme } from '../tokens.ts';\n" +
      'function Leaf(props: { seed: number }) {\n' +
      '  const theme = useContext(Theme);\n' +
      '  return <em>{theme.value}</em>;\n' +
      '}\n' +
      'function Inner(props: { seed: number }) {\n' +
      "  provideContext(Theme, () => 'inner');\n" +
      '  return <Leaf seed={props.seed} />;\n' +
      '}\n' +
      'function Root(props: { seed: number }) {\n' +
      '  return <div><Inner seed={props.seed} /></div>;\n' +
      '}\n' +
      'export default Root;\n';
    const module = compileIsland('ctx-deep', deep);
    // Both bodies own a retained setup factory, and the grandchild consumer's
    // owner scope is the child's retained anchor.
    expect(module).toContain('function Inner__setup(');
    expect(module).toContain('function Leaf__setup(');
    const innerSetup = functionText(module, 'Inner__setup');
    expect(innerSetup).toContain('provider(');
    expect(innerSetup).toContain('.owner()');
    expect(functionText(module, 'Leaf__setup')).toContain('use(');
    // The child body JOINS the root attempt instead of opening its own pass.
    const innerMount = functionText(module, 'Inner__mount');
    expect(occurrences(innerMount, 'joinInstancePass(')).toBe(1);
    expect(occurrences(innerMount, 'beginInstancePass(')).toBe(0);
  });

  test('C13b a consumer in a RECIPE body is still refused at the authored span', () => {
    const recipeBody =
      SIDECAR +
      "import { provideContext, useContext } from '@openelement/element';\n" +
      "import { Theme } from '../tokens.ts';\n" +
      'function Leaf(props: { seed: number }) {\n' +
      '  const theme = useContext(Theme);\n' +
      '  return <em>{theme.value}</em>;\n' +
      '}\n' +
      'function Root(props: { seed: number }) {\n' +
      '  const card = <Leaf seed={props.seed} />;\n' +
      '  return <div><InnerCard seed={props.seed}>{card}</InnerCard></div>;\n' +
      '}\n' +
      'function InnerCard(props: { seed: number; children?: unknown }) {\n' +
      "  provideContext(Theme, () => 'inner');\n" +
      '  return <div>{props.children as any}</div>;\n' +
      '}\n' +
      'export default Root;\n';
    const thrown = attempt(recipeBody, 'ctx-recipe');
    expect(codes(thrown)).toEqual(['OEIR_LEAF_INVALID_ARTIFACT']);
    expect(messages(thrown).join('\n')).toContain('owner scope');
  });

  test('C14 the standalone public import fails closed outside the compiler (no new error code)', () => {
    // `useContext` is the one name whose meaning is shared by the root entry and
    // the `/lifecycle` subpath, so it is asserted from the root import. The
    // PROVIDER intrinsic is NOT: the root entry keeps the class lane's host-side
    // `provideContext(host, context, value)` under that name, and the author
    // imports the intrinsic from `@openelement/element/lifecycle`. That
    // divergence is pinned in `packages/element/__tests__/lifecycle-subpath.test.ts`
    // (both fail closed, with different identities because they are different
    // functions), which is why it is not re-asserted here.
    const cases: readonly [string, () => unknown][] = [
      ['useContext', () => useContext<number>({ key: Symbol('t'), defaultValue: 0 })],
    ];
    for (const [name, call] of cases) {
      let thrown: unknown;
      try {
        call();
      } catch (error) {
        thrown = error;
      }
      expect(thrown, name).toBeInstanceOf(OpenElementError);
      expect((thrown as OpenElementError).code, name).toBe(FacadeErrorCode.JSX_OUTSIDE_COMPILER);
      expect((thrown as OpenElementError).phase, name).toBe('build');
      expect((thrown as OpenElementError).message, name).toContain(name);
    }
  });

  test('C15 a provider whose thunk reads a ROOT signal resource is admitted (ADR-0183 D-4)', () => {
    // The retained setup scope has no bindings channel, so a thunk reading a
    // `signal` keeps the lane's existing `UNBOUND_BINDING` identity.
    const source =
      SIDECAR +
      "import { provideContext, signal } from '@openelement/element';\n" +
      "import { Theme } from '../tokens.ts';\n" +
      'function Root(props: { seed: number }) {\n' +
      '  const count = signal(0);\n' +
      '  provideContext(Theme, () => count.value);\n' +
      '  return <p>{props.seed}</p>;\n' +
      '}\n' +
      'export default Root;\n';
    const code = compileIsland('ctx-host-binding-admitted', source);
    expect(code).toContain('const count = signal((');
    expect(code).toMatch(/return \{[^}]*count/);
  });

  // ── server render: the value the bytes carry ──────────────────────────────

  test('C16 SSR renders the PROVIDED value, and a nested provider shadows it for its subtree only', () => {
    const module = compileIsland('ctx-ssr-tree', SSR_TREE_SOURCE);
    const loaded = instantiate(module);
    const html = ssrOf(loaded, 'Root')({ mode: 'm', seed: 0 }, { bindings: {} });
    // NESTED SHADOWING on the SERVER: Inner reads its own provider…
    expect(html).toContain('inner-m');
    // …and SIBLING ISOLATION: the sibling beside it reads the ROOT value, so one
    // owner's provider did not leak into the other through a shared render scope.
    expect(html).toContain('outer-m');
    // The declared default never appears: the PROVIDED value is what renders.
    expect(html).not.toContain('theme-default');
    // Structure is the producer's, so the claim has a fixed cursor to walk.
    expect(html.startsWith('<section id="root"')).toBe(true);
    expect(textOf(html)).toBe('inner-mouter-m');
  });

  test('C17 SSR resolves a consumer with NO provider to the declared default (the context contract)', () => {
    // A `Context` token cannot exist without a default (`createContext` requires
    // one), so "no provider and no default" is not representable — the declared
    // default IS the lawful answer, and the ADR's claim discipline treats a
    // diverging seed as the failure case, not a missing one.
    const module = compileIsland('ctx-ssr-default', SSR_DEFAULT_SOURCE);
    const loaded = instantiate(module);
    const html = ssrOf(loaded, 'Root')({ seed: 0 }, { bindings: {} });
    expect(textOf(html)).toBe('shared-default');
  });

  test('C18 the render scope is PER CALL: two concurrent renders never share a provider value', () => {
    // The mechanism is a PARAMETER, not module state, so two producer calls in
    // the same tick own two scopes. This is the TSX-13 per-request obligation,
    // now a delivered property rather than a vacuous one.
    const module = compileIsland('ctx-ssr-isolation', SSR_TREE_SOURCE);
    const loaded = instantiate(module);
    const render = ssrOf(loaded, 'Root');
    const first = render({ mode: 'one', seed: 0 }, { bindings: {} });
    const second = render({ mode: 'two', seed: 0 }, { bindings: {} });
    expect(textOf(first)).toBe('inner-oneouter-one');
    expect(textOf(second)).toBe('inner-twoouter-two');
    // Interleaved: start one render's provider/consumer pair and read the other
    // in between. Neither scope is consulted by the other, so each value stays
    // its own.
    const scopeOne = LEAF_RUNTIME.createRenderContextScope();
    const scopeTwo = LEAF_RUNTIME.createRenderContextScope();
    const Theme = TOKEN_MODULE.Theme as { key: symbol; defaultValue: unknown };
    scopeOne.provider(Theme, () => 'a');
    const readOne = scopeOne.use(Theme) as { value: unknown };
    scopeTwo.provider(Theme, () => 'b');
    const readTwo = scopeTwo.use(Theme) as { value: unknown };
    expect(readOne.value).toBe('a');
    expect(readTwo.value).toBe('b');
    // Re-reading after both scopes exist proves neither was mutated by the other.
    expect(readOne.value).toBe('a');
  });

  test('C19 the producer takes the scope as a PARAMETER, and a supplied scope is joined as owner()', () => {
    const module = compileIsland('ctx-ssr-owner', SSR_TREE_SOURCE);
    const loaded = instantiate(module);
    // A caller that supplies its own scope must see the child producer join it as
    // a CHILD owner, so the caller's providers are visible and the child's are
    // not visible to the caller.
    const scope = LEAF_RUNTIME.createRenderContextScope();
    const Theme = TOKEN_MODULE.Theme as { key: symbol; defaultValue: unknown };
    scope.provider(Theme, () => 'supplied');
    const html = ssrOf(loaded, 'Inner')({ mode: 'm', seed: 0 }, { bindings: {} }, scope);
    // Inner provides its OWN value, so it shadows the supplied one for itself.
    expect(textOf(html)).toBe('inner-m');
    // The SIBLING producer called against the same supplied scope reads the
    // supplied value: the child's provider stayed inside its own owner.
    const sibling = ssrOf(loaded, 'Sibling')({ mode: 'm', seed: 0 }, { bindings: {} }, scope);
    expect(textOf(sibling)).toBe('supplied');
  });
});
