/**
 * M09 intrinsic event/ref channels on the generated leaf — LOCAL Node contract.
 *
 * This is the bounded compiler-private codegen capability (not full authored CE
 * parity): the authored JSX stays `onClick` / `ref` on INTRINSIC elements, the
 * existing ownership idioms are reused (listener + `LifetimeScope.add(remove)`,
 * ref handler + cleanup + `ref(null)`), and no new callback API or package
 * export exists.
 *
 * Contract pinned here, driving the REAL frontend (`compileFunctionModule`) and
 * the REAL leaf generator (`generateLeafModule`) — plus the real
 * generated-element lane entry for the carry refusals:
 *
 * - admission: event/ref are intrinsic-only; component-reference props and
 *   custom-element hosts keep refusing them, and list entry templates refuse
 *   them (the M06b2c per-entry update hook owns that shape);
 * - installation: handler/ref values are evaluated once and validated callable
 *   BEFORE any listener/ref side effect; listeners and refs are owned by the
 *   mount/claim scope, so a throwing later step releases them through the
 *   existing owner rollback while borrowed DOM stays (bounded nontransactional);
 * - ref teardown: returned unsubscribe runs, then `ref(null)` runs even when the
 *   cleanup throws;
 * - claim ordering: installation is emitted after the structural mismatch walk
 *   (phase-2), so a claim mismatch installs nothing; the claim's static
 *   attribute seed does not treat event/ref names as DOM attributes;
 * - SSR exclusion: event/ref render no bytes, keep the M08-1a static
 *   no-argument form and bytes, and never request a handler callable via
 *   `requireBinding`;
 * - SSR resource closure: local setup resources are emitted only when the
 *   server output transitively reads them; a helper reachable only from an
 *   event handler is pruned, while a used helper's local reads stay;
 * - carry boundaries: an imported handler and a closure over an owned signal
 *   remain host bindings and the generated-element lane still refuses them
 *   (`OEIR_GENERATED_ELEMENT_UNBOUND_BINDING`); no fake runtime binding is
 *   invented and no production wiring is claimed.
 */

import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import {
  generateLeafModule,
  type GeneratedLeafModule,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { quoteGeneratedJavaScriptValue } from '../../src/internal/compiler/semantic-ir/generated-leaf/codegen-literals.ts';
import { ELEMENT_CLASSIFIER as CLASSIFIER } from './testlib/element-classifier.ts';

const FILE = '/proj/src/islands/event-ref.tsx';
const SITE: GeneratedElementSite = { tag: 'x-event-ref' };

interface LeafCompilation {
  readonly module: string | null;
  readonly diagnostics: GeneratedLeafModule['diagnostics'];
  readonly requiredBindings: readonly string[];
}

function compileLeaf(source: string): LeafCompilation {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  expect(
    front.diagnostics.map((diagnostic) => `${diagnostic.code}:${diagnostic.message}`),
    'frontend admission',
  ).toEqual([]);
  const leaf = generateLeafModule(front.module!);
  return {
    module: leaf.module,
    diagnostics: leaf.diagnostics,
    requiredBindings: leaf.requiredBindings,
  };
}

function codes(compilation: LeafCompilation): string[] {
  return compilation.diagnostics.map((diagnostic) => diagnostic.code);
}

/** One emitted top-level section by its declaration prefix. */
function section(moduleText: string, prefix: string): string {
  const start = moduleText.indexOf(prefix);
  if (start === -1) return '';
  const rest = moduleText.slice(start + prefix.length);
  const next = rest.search(/\n(?:export )?function /);
  return moduleText.slice(start, next === -1 ? moduleText.length : start + prefix.length + next);
}

function ssrSection(compilation: LeafCompilation): string {
  // A composition body lives in one module-local helper while the exported
  // wrapper delegates to it; reachability evidence lives in that body.
  return (
    section(compilation.module!, 'export function C__ssr(') +
    section(compilation.module!, 'function __oe_ssrComponent_C(')
  );
}

function claimSection(compilation: LeafCompilation): string {
  return section(compilation.module!, 'function C__claim(');
}

/** An island module: sidecar + the given component body. */
function island(component: string, sidecar = "root: 'light'"): string {
  return (
    "import { defineIslandConfig } from '@openelement/router';\n" +
    `export const openElement = defineIslandConfig({ ${sidecar} });\n` +
    component +
    'export default C;\n'
  );
}

function laneError(source: string): CompiledElementError {
  try {
    compileGeneratedElementIfAdmitted(source, FILE, { site: SITE });
  } catch (error) {
    if (error instanceof CompiledElementError) return error;
    throw error;
  }
  throw new Error('expected the generated element lane to refuse the module');
}

/** The frontend attribute record for one authored dynamic attribute. */
function frontendAttribute(
  source: string,
  channel: 'event' | 'ref',
): { readonly id: string; readonly mode: string } {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics).toEqual([]);
  const element = front.module!.components[0]!.roots[0] as {
    kind: string;
    attributes: readonly {
      kind: string;
      channel?: string;
      expression?: { id: string; mode: string };
    }[];
  };
  const attribute = element.attributes.find((candidate) => candidate.channel === channel);
  if (attribute?.expression === undefined) throw new Error(`no ${channel} attribute`);
  return attribute.expression;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admission and frontend mode
// ─────────────────────────────────────────────────────────────────────────────

describe('event/ref admission is intrinsic-only', () => {
  test('inline event handler is admitted with owned listener cleanup', () => {
    const compilation = compileLeaf(
      'function C() { return <button onClick={() => {}}>go</button>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    const moduleText = compilation.module!;
    expect(compilation.requiredBindings).toEqual([]);
    expect(moduleText).toContain('addEventListener("click"');
    expect(moduleText).toContain('removeEventListener("click"');
    expect(moduleText).toMatch(/__oe_scope\.add\(/);
    expect(moduleText).not.toContain('setAttribute("onClick"');
    // The single existing runtime import is unchanged; no new module/export.
    expect(moduleText.match(/^import /gm)?.length).toBe(1);
  });

  test('a component-local handler identifier needs no host binding', () => {
    const compilation = compileLeaf(
      'function C() { const inc = () => {}; return <button onClick={inc}>go</button>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    expect(compilation.requiredBindings).toEqual([]);
    expect(compilation.module!).toContain('removeEventListener("click"');
  });

  test('a props-only closure handler needs no host binding', () => {
    const compilation = compileLeaf(
      'function C(props) { return <button onClick={() => props.onHit()}>go</button>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    expect(compilation.requiredBindings).toEqual([]);
    expect(compilation.module!).toContain('addEventListener("click"');
  });

  test('component-reference event/ref props keep refusing', () => {
    for (const source of [
      'function Row(props) { return <li>{props.text}</li>; }\nfunction C() { return <Row onHit={() => {}} />; }\n',
      'function Row(props) { return <li>{props.text}</li>; }\nfunction C() { return <Row ref={(el) => {}} />; }\n',
    ]) {
      const compilation = compileLeaf(source);
      expect(compilation.module).toBeNull();
      expect(codes(compilation)).toEqual(['OEIR_LEAF_UNSUPPORTED_ATTRIBUTE']);
      expect(compilation.diagnostics[0]!.message).toContain("prop channel '");
    }
  });

  test('custom-element hosts keep refusing the intrinsic event/ref channels', () => {
    for (const source of [
      'function C() { return <my-widget onClick={() => {}} />; }\n',
      'function C() { return <my-widget ref={(el) => {}} />; }\n',
    ]) {
      const compilation = compileLeaf(source);
      expect(compilation.module).toBeNull();
      expect(codes(compilation)).toEqual(['OEIR_LEAF_UNSUPPORTED_ATTRIBUTE']);
      expect(compilation.diagnostics[0]!.message).toContain('custom-element host');
    }
  });

  test('list entry templates keep refusing event/ref (per-entry hook is out of scope)', () => {
    const source =
      'function C(props) { return <ul>{props.items.map((item) => ' +
      '<li key={item}><b onClick={() => {}}>{item}</b></li>)}</ul>; }\n';
    const compilation = compileLeaf(source);
    expect(compilation.module).toBeNull();
    expect(codes(compilation)).toEqual(['OEIR_LEAF_UNSUPPORTED_ATTRIBUTE']);
    expect(compilation.diagnostics[0]!.message).toContain('list entry template');
  });

  test('frontend lowers both channels in handler (attach-once) mode', () => {
    for (const [channel, source] of [
      ['event', 'function C() { return <button onClick={() => {}}>go</button>; }\n'],
      ['ref', 'function C() { const attach = (el) => {}; return <input ref={attach} />; }\n'],
    ] as const) {
      expect(frontendAttribute(source, channel).mode, channel).toBe('handler');
    }
    // Handler mode is not tracked: no dependency subscription is recorded.
    const front = compileFunctionModule(
      "import { signal } from '@openelement/element';\nfunction C() { const count = signal(0); return <button onClick={() => { count.value += 1; }}>{count.value}</button>; }\n",
      FILE,
      { importClassifier: CLASSIFIER },
    );
    expect(front.diagnostics).toEqual([]);
    const element = front.module!.components[0]!.roots[0] as {
      kind: string;
      attributes: readonly { channel?: string; expression?: { id: string } }[];
    };
    const event = element.attributes.find((attribute) => attribute.channel === 'event')!;
    expect(front.module!.expressions.get(event.expression!.id)!.dependencies).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Expression-local bindings are not host bindings
// ─────────────────────────────────────────────────────────────────────────────

describe('handler/ref parameters stay expression-local', () => {
  test('an event handler parameter is not a host binding', () => {
    const compilation = compileLeaf(
      'function C() { return <button onClick={(event) => (event.target.dataset.x = "1")}>go</button>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    expect(compilation.requiredBindings).toEqual([]);
    expect(compilation.module!).not.toContain('requireBinding("event")');
    expect(compilation.module!).toContain('(event) =>');
  });

  test('a ref handler parameter is not a host binding', () => {
    const compilation = compileLeaf(
      'function C() { return <input ref={(el) => (el.dataset.seen = "1")} />; }\n',
    );
    expect(compilation.module).not.toBeNull();
    expect(compilation.requiredBindings).toEqual([]);
    expect(compilation.module!).not.toContain('requireBinding("el")');
  });

  test('a component-scope local read inside a handler is still declared', () => {
    const compilation = compileLeaf(
      'function C() { const helper = () => {}; return <button onClick={() => helper()}>go</button>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    expect(compilation.requiredBindings).toEqual([]);
    expect(compilation.module!).toContain('const helper =');
  });

  test('a nested arrow parameter inside a handler does not leak a binding', () => {
    const compilation = compileLeaf(
      'function C() { return <button onClick={() => ((item) => item)(1)}>go</button>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    expect(compilation.requiredBindings).toEqual([]);
    expect(compilation.module!).not.toContain('requireBinding("item")');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Callable validation and bounded installation failure
// ─────────────────────────────────────────────────────────────────────────────

describe('handler validation is emitted before installation', () => {
  test('event and ref values are screened for callability', () => {
    const event = compileLeaf('function C() { return <button onClick={() => {}}>go</button>; }\n');
    expect(event.module).toContain('leafRuntimeError("OEIR_LEAF_EVENT_HANDLER_INVALID"');
    expect(event.module).not.toContain('new Error("OEIR_LEAF_EVENT_HANDLER_INVALID');
    expect(
      event.module!.indexOf('leafRuntimeError("OEIR_LEAF_EVENT_HANDLER_INVALID"'),
    ).toBeLessThan(event.module!.indexOf('addEventListener("click"'));
    const ref = compileLeaf(
      'function C() { const attach = (el) => {}; return <input ref={attach} />; }\n',
    );
    expect(ref.module).toContain('leafRuntimeError("OEIR_LEAF_REF_HANDLER_INVALID"');
    expect(ref.module).not.toContain('new Error("OEIR_LEAF_REF_HANDLER_INVALID');
    expect(ref.module!.indexOf('leafRuntimeError("OEIR_LEAF_REF_HANDLER_INVALID"')).toBeLessThan(
      ref.module!.indexOf('__oe_refCleanup'),
    );
    // The reviewed contract is the shared coded-error helper + authored origin,
    // not a raw Error: the emitted call carries the compile-time origin literal.
    expect(ref.module).toContain(
      'leafRuntimeError("OEIR_LEAF_REF_HANDLER_INVALID", "ref handler is not callable", { file: "/proj/src/islands/event-ref.tsx"',
    );
    expect(ref.module).toMatch(/line: \d+, column: \d+ \}\);/);
    // The validation throw happens before the scope owned side effect, so the
    // failed connect has nothing of its own to install (the shell/claim owner
    // rollback releases anything earlier, borrowed DOM stays).
    expect(ref.module!).toMatch(/__oe_scope\.add\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Refs: attach + owned detach contract
// ─────────────────────────────────────────────────────────────────────────────

describe('ref callback contract', () => {
  test('an identifier ref gets attach + unsubscribe + ref(null) detach', () => {
    const compilation = compileLeaf(
      'function C() { const attach = (el) => {}; return <input ref={attach} />; }\n',
    );
    expect(compilation.module).not.toBeNull();
    expect(compilation.requiredBindings).toEqual([]);
    const moduleText = compilation.module!;
    expect(moduleText).toContain('const __oe_refCleanup');
    expect(moduleText).toContain('const __oe_refCleanup');
    expect(moduleText).toMatch(/__oe_refCleanup\d+\(\)/);
    expect(moduleText).toMatch(/__oe_refHandler\d+\(null\)/);
    expect(moduleText).toMatch(/__oe_scope\.add\(\(\) => \{ try \{/);
    expect(moduleText).not.toContain('setAttribute("ref"');
  });

  test('an inline ref gets the same attach/detach ownership', () => {
    const compilation = compileLeaf('function C() { return <input ref={(el) => {}} />; }\n');
    expect(compilation.module).not.toBeNull();
    expect(compilation.requiredBindings).toEqual([]);
    expect(compilation.module!).toMatch(/__oe_refHandler\d+\(null\)/);
    expect(compilation.module!).toMatch(/__oe_scope\.add\(\(\) => \{ try \{/);
  });

  test('refs render no SSR bytes', () => {
    const compilation = compileLeaf(
      'function C(props) { return <input title={props.t} ref={(el) => {}} />; }\n',
    );
    expect(compilation.module).not.toBeNull();
    const ssr = ssrSection(compilation);
    expect(ssr).not.toContain('ref');
    expect(ssr).not.toContain('requireBinding');
    expect(ssr).not.toContain('setAttribute("ref"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SSR exclusions and reachable-resource closure
// ─────────────────────────────────────────────────────────────────────────────

describe('SSR producer excludes client-only channels and prunes unreachable locals', () => {
  test('an event handler renders no bytes and keeps the static no-arg shape', () => {
    const plain = compileLeaf('function C(props) { return <p title={props.t}>{props.x}</p>; }\n');
    const withHandler = compileLeaf(
      'function C(props) { return <p title={props.t} onClick={() => {}}>{props.x}</p>; }\n',
    );
    expect(withHandler.module).not.toBeNull();
    expect(ssrSection(withHandler)).toBe(ssrSection(plain));
    expect(ssrSection(withHandler)).not.toContain('addEventListener');
    expect(ssrSection(withHandler)).not.toContain('requireBinding');
  });

  test('a static component with only a handler keeps the M08-1a __ssr() form', () => {
    const compilation = compileLeaf(
      'function C() { return <button onClick={() => {}}>go</button>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    expect(ssrSection(compilation)).toContain('export function C__ssr() {');
  });

  test('a helper reachable only from a client channel is pruned from SSR', () => {
    const compilation = compileLeaf(
      "import { format } from './util';\nfunction C(props) { const helper = () => format(); return <button title={props.t} onClick={() => helper()}>{props.x}</button>; }\n",
    );
    expect(compilation.module).not.toBeNull();
    // The mount still needs the callable (the handler may run), but the SSR
    // producer never evaluates or requests it.
    expect(compilation.requiredBindings).toEqual(['format']);
    const ssr = ssrSection(compilation);
    expect(ssr).not.toContain('const helper =');
    expect(ssr).not.toContain('requireBinding("format")');
    expect(ssr).not.toContain('helper(');
  });

  test('SSR keeps transitively reachable locals and drops only dead ones', () => {
    const compilation = compileLeaf(
      'function C(props) { ' +
        'const inner = () => props.x; ' +
        'const outer = () => inner(); ' +
        'const handlerOnly = () => props.y; ' +
        'return <button title={props.t} onClick={() => handlerOnly()}>{outer()}</button>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    const ssr = ssrSection(compilation);
    // Reached through the dynamic text record -> outer -> inner (transitive).
    expect(ssr).toContain('const outer =');
    expect(ssr).toContain('const inner =');
    // Only the event handler reads this one.
    expect(ssr).not.toContain('const handlerOnly =');
    // The mount still declares all three (client behavior unchanged).
    expect(compilation.module!).toContain('const handlerOnly =');
  });

  test('a dynamic event-bearing component keeps handler free SSR bytes', () => {
    const without = compileLeaf(
      'function C(props) { return <section title={props.t}>{props.x}</section>; }\n',
    );
    const withHandler = compileLeaf(
      'function C(props) { return <section title={props.t} onClick={() => {}}>{props.x}</section>; }\n',
    );
    expect(ssrSection(withHandler)).toBe(ssrSection(without));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SSR reachable-local closure (component-ref props, children recipe,
// insertion target, typed condition) + client-only pruning
// ─────────────────────────────────────────────────────────────────────────────

describe('SSR reachability covers every producer shape', () => {
  test('a local read through a component-reference prop record survives', () => {
    const compilation = compileLeaf(
      'function Row(props) { return <i>{props.label}</i>; }\n' +
        'function C(props) { const helper = () => props.label; return <div><Row label={helper()} /></div>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    expect(ssrSection(compilation)).toContain('const helper =');
  });

  test('a local read through a children recipe survives', () => {
    const compilation = compileLeaf(
      'function Frame(props) { return <div>{props.children}</div>; }\n' +
        'function C(props) { const helper = () => props.label; return <Frame>{helper()}</Frame>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    expect(ssrSection(compilation)).toContain('const helper =');
  });

  test('a local read through an insertion-site recipe target survives', () => {
    const compilation = compileLeaf(
      'function C(props) { const helper = () => props.label; ' +
        'const card = <span>{helper()}</span>; return <div>{card}</div>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    expect(ssrSection(compilation)).toContain('const helper =');
  });

  test('a local read by a typed condition test survives', () => {
    const compilation = compileLeaf(
      'function C(props) { const helper = () => props.label; ' +
        'return <div>{helper() ? <b>a</b> : <i>b</i>}</div>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    expect(ssrSection(compilation)).toContain('const helper =');
  });

  test('client-only and dead locals are pruned; surviving locals keep authored order', () => {
    const compilation = compileLeaf(
      'function C(props) { ' +
        'const first = () => props.label; ' +
        'const dead = () => props.other; ' +
        'const second = () => props.flag; ' +
        'return <div onClick={() => first()}>{first()}{second()}</div>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    const ssr = ssrSection(compilation);
    expect(ssr).toContain('const first =');
    expect(ssr).toContain('const second =');
    expect(ssr).not.toContain('const dead =');
    expect(ssr.indexOf('const first =')).toBeLessThan(ssr.indexOf('const second ='));
    // The mount still declares all three (client behavior unchanged).
    expect(compilation.module!).toContain('const dead =');
  });

  test('an event/ref inside a conditional branch is admitted (branch-owned scope)', () => {
    const compilation = compileLeaf(
      'function C(props) { return <div>{props.flag ' +
        '? <button onClick={() => {}} ref={(el) => {}}>on</button> ' +
        ': <b>off</b>}</div>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    const claim = claimSection(compilation);
    // The branch claim helper activates the listener/ref under the branch scope.
    expect(claim).toContain('function __oe_whenThenClaim');
    expect(claim).toContain('addEventListener("click"');
    expect(claim).toMatch(/__oe_whenThenClaimScope\d+\.add\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Claim: phase-2 installation only, attribute seed untouched
// ─────────────────────────────────────────────────────────────────────────────

describe('claim installs client-only channels only after the structural walk', () => {
  test('listener installation is emitted after the last structural mismatch', () => {
    const compilation = compileLeaf(
      'function C(props) { return <button title={props.t} onClick={() => {}}>{props.x}</button>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    const claim = claimSection(compilation);
    const lastMismatch = claim.lastIndexOf('leafClaimMismatch');
    const listener = claim.indexOf('addEventListener');
    expect(lastMismatch).toBeGreaterThanOrEqual(0);
    expect(listener).toBeGreaterThan(lastMismatch);
    expect(claim).toContain('removeEventListener("click"');
    expect(claim).toMatch(/__oe_scope\.add\(/);
  });

  test('the static attribute seed never treats event/ref as expected attributes', () => {
    const compilation = compileLeaf(
      'function C(props) { return <button title={props.t} onClick={() => {}} ref={(el) => {}}>{props.x}</button>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    const claim = claimSection(compilation);
    expect(claim).toContain('assertStaticAttributeSeed(');
    expect(claim).not.toContain('"onClick"');
    expect(claim).not.toContain('"ref"');
  });

  test('a ref handler is installed in the claim phase-2 tail, not before the walk', () => {
    const compilation = compileLeaf(
      'function C(props) { return <input title={props.t} ref={(el) => {}} />; }\n',
    );
    const claim = claimSection(compilation);
    const lastMismatch = claim.lastIndexOf('leafClaimMismatch');
    const refInstall = claim.indexOf('__oe_refHandler');
    expect(lastMismatch).toBeGreaterThanOrEqual(0);
    expect(refInstall).toBeGreaterThan(lastMismatch);
    expect(claim).toMatch(/__oe_refHandler\d+\(null\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Carry boundaries: imported handlers and owned signals stay refused
// ─────────────────────────────────────────────────────────────────────────────

describe('binding/import carry is not faked', () => {
  test('an imported handler is a host binding and the lane refuses UNBOUND_BINDING', () => {
    const component =
      "import { handler } from './util';\nfunction C() { return <button onClick={handler}>go</button>; }\n";
    const leaf = compileLeaf(component);
    expect(leaf.module).not.toBeNull();
    expect(leaf.requiredBindings).toEqual(['handler']);
    const error = laneError(island(component));
    expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      GENERATED_ELEMENT_DIAGNOSTIC.UNBOUND_BINDING,
    ]);
  });

  test('a handler closing over an owned signal keeps the signal-carry refusal', () => {
    const component =
      "import { signal } from '@openelement/element';\nfunction C() { const count = signal(0); return <button onClick={() => { count.value += 1; }}>{count.value}</button>; }\n";
    const leaf = compileLeaf(component);
    expect(leaf.module).not.toBeNull();
    expect(leaf.requiredBindings).toEqual(['count']);
    const error = laneError(island(component));
    expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      GENERATED_ELEMENT_DIAGNOSTIC.UNBOUND_BINDING,
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression surface: M08 static/dynamic shape and source-map-friendly text
// ─────────────────────────────────────────────────────────────────────────────

describe('existing leaf shape is preserved', () => {
  test('a handler-free component keeps its exact mount/SSR/claim shape', () => {
    const compilation = compileLeaf(
      'function C(props) { return <button title={props.t}>{props.x}</button>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    expect(compilation.requiredBindings).toEqual([]);
    expect(compilation.module!).not.toContain('addEventListener');
    expect(compilation.module!).not.toContain('refHandler');
    // The emitted module still parses as JavaScript.
    const source = ts.createSourceFile(
      'generated-leaf.js',
      compilation.module!,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.JS,
    );
    const parseDiagnostics = (source as unknown as { parseDiagnostics?: readonly unknown[] })
      .parseDiagnostics;
    expect(parseDiagnostics ?? []).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generated-code literal boundary (CodeQL js/bad-code-sanitization, alert 4254)
// ─────────────────────────────────────────────────────────────────────────────

describe('generated-code literal escaping', () => {
  test('quoted JS literals escape the script-breaking characters and round-trip', () => {
    const payload = [
      'x</script><script>alert(1)//',
      '"',
      '\\',
      '\n',
      '\r',
      '\t',
      '\u2028',
      '\u2029',
    ].join('');
    const quoted = quoteGeneratedJavaScriptValue(payload);
    expect(quoted).not.toMatch(/[<>\u2028\u2029]/);
    expect(quoted).toContain('\\u003C');
    expect(new Function('return ' + quoted)()).toBe(payload);
  });

  test('event/ref code construction uses the quoted boundary', () => {
    const compilation = compileLeaf(
      'function C() { return <button onClick={() => {}} onX-foo={() => {}} ref={(el) => {}}>b</button>; }\n',
    );
    expect(compilation.module).not.toBeNull();
    // DOM event names are embedded as JS string literals; the safe charset stays
    // byte-identical, and no raw line-separator character reaches the module.
    expect(compilation.module!).toContain('addEventListener("click",');
    expect(compilation.module!).toContain('removeEventListener("click",');
    expect(compilation.module!).toContain('addEventListener("x-foo",');
    expect(compilation.module!).not.toMatch(/[\u2028\u2029]/);
    expect(compilation.module!).not.toContain('x</script>');
  });

  test('a non-DOM-shaped event name is refused before code construction', () => {
    for (const name of ['onX$', 'onX_foo', 'onX:y']) {
      const compilation = compileLeaf(
        `function C() { return <button ${name}={() => {}}>b</button>; }\n`,
      );
      expect(codes(compilation)).toEqual(['OEIR_LEAF_UNSUPPORTED_ATTRIBUTE']);
      expect(compilation.module).toBeNull();
    }
  });
});
