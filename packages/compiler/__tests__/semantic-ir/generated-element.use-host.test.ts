/**
 * `16b-REF` / `useHost` — the owning element as a value.
 *
 * `useHost()` exposes the SAME fact the lifecycle/change/error callbacks already
 * receive as `env.host` (the owning generated element for a root, the nearest
 * enclosing generated element host for a depth-1 retained hostless child), but
 * through the expression position. So the lowering is ONE host-record field
 * read — no runtime channel, no allocation, no lifetime, and no reactivity (the
 * element identity never changes for an instance).
 */
import { expect, test } from 'vitest';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { GENERATED_ELEMENT_IMPORT_CLASSIFIER as CLASSIFIER } from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';

const FILE = '/proj/src/leaf.tsx';

function compile(source: string) {
  return compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
}

test('useHost lowers to one host-record field read, never a binding lookup', () => {
  const front = compile(`import { useHost } from '@openelement/element/lifecycle';
function Panel(props) {
  const host = useHost();
  return <div>{host.tagName}</div>;
}
`);
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  const module = generateLeafModule(front.module!);
  expect(module.diagnostics).toEqual([]);
  // The client halves read the host-record field directly.
  expect(module.module).toContain('const host = __oe_host.__oe_hostElement;');
  // The ONLY binding lookup of `host` in the whole module is the server
  // producer's fail-closed one: the client halves resolve it from the host
  // record, so a missing element is impossible there by construction.
  const lookups = module.module.split('__oe_requireBinding("host")').length - 1;
  expect(lookups).toEqual(1);
});

test('the server producer cannot resolve useHost: it stays fail-closed', () => {
  // The server has no bindings channel and no element (ADR-0181), so a component
  // whose rendered output depends on the host element is not server-renderable.
  // That must be a loud, named failure — never a silently empty slot.
  const front = compile(`import { useHost } from '@openelement/element/lifecycle';
function Panel(props) {
  const host = useHost();
  return <div>{host.tagName}</div>;
}
`);
  const module = generateLeafModule(front.module!).module!;
  const ssr = module.slice(module.indexOf('function Panel__ssr'));
  expect(ssr).toContain('__oe_requireBinding("host")');
  expect(ssr).toContain('OEIR_LEAF_MISSING_VALUE');
});

test('the root setup host literal forwards the element field when the module reads it', () => {
  const front = compile(`import { useHost } from '@openelement/element/lifecycle';
function Panel(props) {
  const host = useHost();
  return <div>{host.tagName}</div>;
}
`);
  const module = generateLeafModule(front.module!).module!;
  expect(module).toContain('__oe_hostElement: __oe_host.__oe_hostElement');
});

test('a module that never calls useHost keeps its pre-slice bytes (no forwarding)', () => {
  const front = compile(`function Plain(props) {
  return <div>plain</div>;
}
`);
  expect(front.diagnostics).toEqual([]);
  const module = generateLeafModule(front.module!).module!;
  expect(module).not.toContain('__oe_hostElement');
});

test('useHost refuses arguments, type arguments and a reassignable binding', () => {
  const withArgument = compile(`import { useHost } from '@openelement/element/lifecycle';
function Panel(props) { const host = useHost('x'); return <div>{host.tagName}</div>; }
`);
  expect(withArgument.diagnostics.length).toBeGreaterThan(0);

  const typed = compile(`import { useHost } from '@openelement/element/lifecycle';
function Panel(props) { const host = useHost<HTMLElement>(); return <div>{host.tagName}</div>; }
`);
  expect(typed.diagnostics.length).toBeGreaterThan(0);

  const reassignable = compile(`import { useHost } from '@openelement/element/lifecycle';
function Panel(props) { let host = useHost(); return <div>{host.tagName}</div>; }
`);
  expect(reassignable.diagnostics.length).toBeGreaterThan(0);
});

test('a local function named useHost is NOT the intrinsic', () => {
  const front = compile(`function useHost() { return 'not the intrinsic'; }
function Panel(props) { const value = useHost(); return <div>{value}</div>; }
`);
  // It falls through to the ordinary component-body grammar as a plain local.
  expect(front.diagnostics).toEqual([]);
  const module = generateLeafModule(front.module!);
  expect(module.module).toBeDefined();
  expect(module.module).not.toContain('__oe_host.__oe_hostElement');
});
