/**
 * Four-entry resume compatibility (post-K architecture integration).
 *
 * Reconnecting an already-activated element is a RESUME: the kernel binds the
 * DOM the runtime itself produced. That is not a claim of unknown DOM and must
 * not require the SSR hydration executor — but `CompiledElementKernel.connect()`
 * routes every reconnect of an activated instance through `#claim()`, which
 * resolves the claim executor seam. The two minimal entries
 * (`./client-only`, `./base`) do not install that executor, so a legitimately
 * fresh-created CSR component fails on reconnect with
 * `OE_CLAIM_EXECUTOR_MISSING` — the capability the component never needed.
 *
 * Each case runs in its own subprocess (the installs are module side effects,
 * so a shared graph would report false positives — see hydrate-entry-split).
 *
 * Pinned here:
 *
 *   A. Full entry: fresh → resume works (the existing contract).
 *   B. client-only: a CSR component WITH blocks survives fresh → update →
 *      disconnect → update → resume → update, keeping its nodes, state and
 *      exactly one listener.
 *   C. no-blocks: fresh, initial claim and resume all work; a Block program
 *      still fails closed (the blocks axis is untouched by resume).
 *   D. base: a blocks-free CSR component survives fresh → resume with neither
 *      optional capability installed.
 *   E. Un-activated foreign DOM through the minimal entries still fails
 *      closed — "the DOM of an activated instance" and "unknown DOM on a
 *      first connect" must never be conflated.
 */
import { expect, test } from 'vitest';
import { runEsmSubprocess } from './esm-subprocess.ts';
import * as defaultEntry from '../src/index.ts';
import * as clientOnlyEntry from '../src/client-only.ts';
import * as noBlocksEntry from '../src/no-blocks.ts';
import * as baseEntry from '../src/base.ts';

const ELEMENT_SRC = new URL('../src/', import.meta.url).href;
const KERNEL_SPECIFIER = `${ELEMENT_SRC}internal/compiled/runtime/kernel.ts`;
const FULL_ENTRY_SPECIFIER = `${ELEMENT_SRC}index.ts`;
const CLIENT_ONLY_ENTRY_SPECIFIER = `${ELEMENT_SRC}client-only.ts`;
const NO_BLOCKS_ENTRY_SPECIFIER = `${ELEMENT_SRC}no-blocks.ts`;
const BASE_ENTRY_SPECIFIER = `${ELEMENT_SRC}base.ts`;
const TEST_PROGRAM_SPECIFIER = new URL('./compiled-runtime/test-program.ts', import.meta.url).href;

/**
 * Platform surface the compiled runtime touches for a shadow-open root: node
 * trees, attributes (the claim validates attribute names), a listener registry
 * (so "exactly one listener" is observable), and shadow root resolution.
 */
const DOM_SHIM = `
  function makeNode(nodeType) {
    const node = {
      nodeType, childNodes: [], parentNode: null, ownerDocument: doc,
      get nextSibling() {
        const siblings = node.parentNode ? node.parentNode.childNodes : [];
        const at = siblings.indexOf(node);
        return at >= 0 && at + 1 < siblings.length ? siblings[at + 1] : null;
      },
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = node; node.childNodes.push(child); return child;
      },
      insertBefore(child, reference) {
        if (child.parentNode) child.parentNode.removeChild(child);
        const at = reference ? node.childNodes.indexOf(reference) : node.childNodes.length;
        child.parentNode = node;
        node.childNodes.splice(at < 0 ? node.childNodes.length : at, 0, child);
        return child;
      },
      removeChild(child) {
        const at = node.childNodes.indexOf(child);
        if (at >= 0) node.childNodes.splice(at, 1);
        child.parentNode = null; return child;
      },
      attributes: new Map(),
      setAttribute(name, value) { node.attributes.set(name, String(value)); },
      removeAttribute(name) { node.attributes.delete(name); },
      getAttribute(name) { return node.attributes.get(name) ?? null; },
      getAttributeNames() { return [...node.attributes.keys()]; },
      hasAttribute(name) { return node.attributes.has(name); },
      listeners: new Map(),
      addEventListener(type, fn) {
        const set = node.listeners.get(type) ?? new Set();
        set.add(fn); node.listeners.set(type, set);
      },
      removeEventListener(type, fn) { node.listeners.get(type)?.delete(fn); },
      listenerCount(type) { return node.listeners.get(type)?.size ?? 0; },
      querySelector() { return null; }, querySelectorAll() { return []; },
    };
    return node;
  }
  function makeElement(tag) {
    const element = makeNode(1);
    element.tagName = tag;
    return element;
  }
  const doc = {
    createElement: (tag) => makeElement(tag),
    createComment: (data) => { const node = makeNode(8); node.data = data; return node; },
    createTextNode: (data) => { const node = makeNode(3); node.data = data; return node; },
  };
  const host = makeElement('OE-PROBE');
  host.attachShadow = () => {
    if (!host.__root) {
      host.__root = makeNode(11);
      host.__root.host = host;
    }
    return host.__root;
  };
  Object.defineProperty(host, 'shadowRoot', { get: () => host.__root ?? null });
  function serialize(node) {
    if (node.nodeType === 3) return node.data;
    if (node.nodeType === 8) return '<!--' + node.data + '-->';
    if (node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      const attrs = [...node.attributes.entries()]
        .map(([name, value]) => ' ' + name + '="' + value + '"')
        .join('');
      return '<' + tag + attrs + '>' + node.childNodes.map(serialize).join('') + '</' + tag + '>';
    }
    if (node.nodeType === 11) return node.childNodes.map(serialize).join('');
    return '';
  }
  function text(node) { return serialize(node); }
  class ProbeSignal {
    #listeners = new Set();
    #value;
    constructor(value) { this.#value = value; }
    get value() { return this.#value; }
    set value(next) {
      this.#value = next;
      for (const listener of [...this.#listeners]) listener(next);
    }
    subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  }
`;

/** `{message}` text Part plus a static tail — blocks-free. */
const TEXT_PROGRAM_SPEC = `testProgram({
  tag: 'oe-probe',
  root: 'shadow-open',
  template: [{ k: 'el', tag: 'div', attrs: [], children: [
    { k: 'el', tag: 'button', attrs: [], children: [{ k: 'text', value: '+' }] },
    { k: 'part', index: 0 },
    { k: 'el', tag: 'span', attrs: [['data-slot', 'tail']], children: [{ k: 'text', value: 'tail' }] },
  ] }],
  parts: [
    { k: 'text', index: 0, signal: 'message' },
    {
      k: 'event',
      index: 1,
      event: 'click',
      handler: 'bump',
      action: { kind: 'method', name: 'bump' },
      path: [0, 0],
    },
  ],
})`;

/** The same behind a when Block — the client-only island shape. */
const BLOCK_PROGRAM_SPEC = `testProgram({
  tag: 'oe-probe',
  root: 'shadow-open',
  template: [{ k: 'el', tag: 'div', attrs: [], children: [
    { k: 'el', tag: 'button', attrs: [], children: [{ k: 'text', value: '+' }] },
    { k: 'part', index: 0 },
    { k: 'part', index: 1 },
  ] }],
  parts: [
    { k: 'text', index: 0, signal: 'message' },
    {
      k: 'when',
      index: 1,
      signal: 'visible',
      test: { signal: 'visible', op: 'truthy', value: true },
      on: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'text', value: 'on' }] }],
      off: [{ k: 'el', tag: 'em', attrs: [], children: [{ k: 'text', value: 'off' }] }],
    },
    {
      k: 'event',
      index: 2,
      event: 'click',
      handler: 'bump',
      action: { kind: 'method', name: 'bump' },
      path: [0, 0],
    },
  ],
})`;

function harness(programSpec: string): string {
  return `
  import { testProgram } from ${JSON.stringify(TEST_PROGRAM_SPECIFIER)};
  ${DOM_SHIM}
  const program = ${programSpec};
  `;
}

const BOOT_KERNEL = `
  const { CompiledElementKernel } = await import(${JSON.stringify(KERNEL_SPECIFIER)});
`;

/** Fresh → live update → disconnect → detached update → resume → update. */
function resumeDrive(options: { blocks: boolean }): string {
  return `
  const message = new ProbeSignal('one');
  const visible = new ProbeSignal(false);
  const kernel = new CompiledElementKernel(host, program, {
    signals: { message, visible },
    handlers: { bump: () => {} },
    rootMode: 'shadow-open',
  });
  host.attachShadow();
  const first = kernel.connect();
  message.value = 'two';
  ${options.blocks ? 'visible.value = true;' : ''}
  const beforeMove = text(host.shadowRoot);
  kernel.disconnect();
  message.value = 'three';
  ${options.blocks ? 'visible.value = false;' : ''}
  let resumeMode = 'THREW';
  let resumeError = '';
  try {
    resumeMode = kernel.connect().mode;
  } catch (error) {
    resumeError = error.message;
  }
  message.value = 'four';
  const button = host.shadowRoot.childNodes[0].childNodes[0];
  console.log(JSON.stringify({
    firstMode: first.mode,
    resumeMode,
    resumeError,
    beforeMove,
    afterResume: text(host.shadowRoot),
    active: kernel.active,
    listeners: button.listenerCount('click'),
  }));
  `;
}

test('four-entry resume A: the full entry resumes an activated CSR instance', async () => {
  const { code, out, err } = await runEsmSubprocess(`
    ${harness(TEXT_PROGRAM_SPEC)}
    ${BOOT_KERNEL}
    await import(${JSON.stringify(FULL_ENTRY_SPECIFIER)});
    ${resumeDrive({ blocks: false })}
  `);
  expect(code, `probe should complete. stderr: ${err}`).toEqual(0);
  const state = JSON.parse(out.trim().split('\n').at(-1)!);
  expect(state.firstMode, 'a CSR component starts fresh').toEqual('fresh');
  expect(state.resumeError, 'the full entry resumes').toEqual('');
  expect(state.afterResume).toEqual(
    '<div><button>+</button><!--oe:p0-->four<span data-slot="tail">tail</span></div>',
  );
  expect(state.listeners, 'the resumed event binding is attached exactly once').toEqual(1);
});

test('four-entry resume B: client-only survives fresh → resume with blocks', async () => {
  const { code, out, err } = await runEsmSubprocess(`
    ${harness(BLOCK_PROGRAM_SPEC)}
    ${BOOT_KERNEL}
    await import(${JSON.stringify(CLIENT_ONLY_ENTRY_SPECIFIER)});
    ${resumeDrive({ blocks: true })}
  `);
  expect(code, `probe should complete. stderr: ${err}`).toEqual(0);
  const state = JSON.parse(out.trim().split('\n').at(-1)!);
  expect(state.firstMode, 'a CSR component starts fresh').toEqual('fresh');
  expect(
    state.resumeError,
    'resuming the runtime-owned DOM must not require the SSR hydration executor',
  ).toEqual('');
  expect(state.resumeMode).toEqual('claim');
  expect(state.afterResume, 'the resumed DOM shows the current values').toEqual(
    '<div><button>+</button><!--oe:p0-->four<!--oe:p1--><em>off</em><!--oe:/p1--></div>',
  );
  expect(state.listeners, 'the resumed event binding is attached exactly once').toEqual(1);
  expect(state.active, 'the resumed kernel is active').toEqual(true);
});

test('four-entry resume C: no-blocks claims, resumes and still rejects Block programs', async () => {
  const { code, out, err } = await runEsmSubprocess(`
    ${harness(TEXT_PROGRAM_SPEC)}
    ${BOOT_KERNEL}
    await import(${JSON.stringify(NO_BLOCKS_ENTRY_SPECIFIER)});
    const { createFreshDom } = await import(${JSON.stringify(
      `${ELEMENT_SRC}internal/compiled/runtime.ts`,
    )});
    // Seed the SSR-shaped artifact through the runtime itself, then claim it.
    createFreshDom(
      program,
      { signals: { message: new ProbeSignal('seed') }, handlers: { bump: () => {} } },
      host.attachShadow(),
    );
    const message = new ProbeSignal('seed');
    const kernel = new CompiledElementKernel(host, program, {
      signals: { message }, handlers: { bump: () => {} }, rootMode: 'shadow-open',
    });
    const claimMode = kernel.connect().mode;
    kernel.disconnect();
    message.value = 'resumed';
    const resumeMode = kernel.connect().mode;
    console.log(JSON.stringify({ claimMode, resumeMode, dom: text(host.shadowRoot) }));
  `);
  expect(code, `probe should complete. stderr: ${err}`).toEqual(0);
  const state = JSON.parse(out.trim().split('\n').at(-1)!);
  expect(state.claimMode, 'the no-blocks entry keeps the claim').toEqual('claim');
  expect(state.resumeMode, 'and it resumes').toEqual('claim');
  expect(state.dom).toEqual(
    '<div><button>+</button><!--oe:p0-->resumed<span data-slot="tail">tail</span></div>',
  );
});

test('four-entry resume C2: no-blocks keeps failing closed on a Block program', async () => {
  const { code, out, err } = await runEsmSubprocess(`
    ${harness(BLOCK_PROGRAM_SPEC)}
    ${BOOT_KERNEL}
    await import(${JSON.stringify(NO_BLOCKS_ENTRY_SPECIFIER)});
    const kernel = new CompiledElementKernel(host, program, {
      signals: { message: new ProbeSignal('x'), visible: new ProbeSignal(true) },
      handlers: {}, rootMode: 'shadow-open',
    });
    host.attachShadow();
    try { kernel.connect(); console.log('NO-ERROR'); }
    catch (error) { console.log('THREW ' + error.code + ' :: ' + error.message); }
  `);
  expect(code, `probe should complete. stderr: ${err}`).toEqual(0);
  expect(out.includes('NO-ERROR'), 'a Block program must fail closed without builders').toBe(false);
  expect(out).toContain('OE_RUNTIME_BLOCK_BUILDERS_MISSING');
});

test('four-entry resume D: base resumes a blocks-free CSR instance without either capability', async () => {
  const { code, out, err } = await runEsmSubprocess(`
    ${harness(TEXT_PROGRAM_SPEC)}
    ${BOOT_KERNEL}
    await import(${JSON.stringify(BASE_ENTRY_SPECIFIER)});
    ${resumeDrive({ blocks: false })}
  `);
  expect(code, `probe should complete. stderr: ${err}`).toEqual(0);
  const state = JSON.parse(out.trim().split('\n').at(-1)!);
  expect(state.firstMode).toEqual('fresh');
  expect(
    state.resumeError,
    'base must resume the DOM it built without the hydration executor',
  ).toEqual('');
  expect(state.resumeMode).toEqual('claim');
  expect(state.afterResume).toEqual(
    '<div><button>+</button><!--oe:p0-->four<span data-slot="tail">tail</span></div>',
  );
  expect(state.listeners, 'the resumed event binding is attached exactly once').toEqual(1);
});

test('four-entry resume E: un-activated foreign DOM still fails closed on the minimal entries', async () => {
  for (const entry of [
    { specifier: CLIENT_ONLY_ENTRY_SPECIFIER, name: 'client-only' },
    { specifier: BASE_ENTRY_SPECIFIER, name: 'base' },
  ]) {
    const { code, out, err } = await runEsmSubprocess(`
      ${harness(TEXT_PROGRAM_SPEC)}
      ${BOOT_KERNEL}
      await import(${JSON.stringify(entry.specifier)});
      host.attachShadow().appendChild(makeElement('DIV'));
      const kernel = new CompiledElementKernel(host, program, {
        signals: { message: new ProbeSignal('x') },
        handlers: { bump: () => {} },
        rootMode: 'shadow-open',
      });
      try { kernel.connect(); console.log('NO-ERROR'); }
      catch (error) { console.log('THREW ' + error.message); }
    `);
    expect(code, `${entry.name}: probe should complete. stderr: ${err}`).toEqual(0);
    expect(out.includes('NO-ERROR'), `${entry.name} must refuse unknown DOM`).toBe(false);
    expect(out).toContain('needs the hydration executor');
  }
});

test('four-entry resume: all four entries export the same names', () => {
  const names = Object.keys(defaultEntry).sort();
  for (const entry of [clientOnlyEntry, noBlocksEntry, baseEntry]) {
    expect(Object.keys(entry).sort()).toEqual(names);
  }
});
