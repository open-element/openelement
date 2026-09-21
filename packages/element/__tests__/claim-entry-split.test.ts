/**
 * The claim executor seam (#1416).
 *
 * Two entries of this package expose the same public surface and differ in one
 * capability: whether a connected element can claim existing DOM. That split is
 * invisible to a single-process test — the install is a module side effect, so
 * once ANY entry that installs it has been evaluated, the capability is
 * globally present. Each case therefore runs in its own subprocess, which is
 * also how a real page loads exactly one of the entries.
 *
 * What is pinned:
 *
 * 1. `@openelement/element/client-only` connects an element with an empty root
 *    (fresh creation) without the claim executor.
 * 2. The same entry fails closed when the root already has content, and the
 *    message names the entry that can handle it.
 * 3. The default entry claims that same content — so case 2 is about the entry,
 *    not about the program.
 * 4. Both entries export the same names (the surface cannot drift).
 */
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import * as defaultEntry from '../src/index.ts';
import * as clientOnlyEntry from '../src/client-only.ts';

const ELEMENT_SRC = new URL('../src/', import.meta.url).href;
const KERNEL_SPECIFIER = `${ELEMENT_SRC}internal/compiled/runtime/kernel.ts`;
const FULL_ENTRY_SPECIFIER = `${ELEMENT_SRC}index.ts`;
const CLIENT_ONLY_ENTRY_SPECIFIER = `${ELEMENT_SRC}client-only.ts`;
const TEST_PROGRAM_SPECIFIER = new URL('./compiled-runtime/test-program.ts', import.meta.url).href;

async function runInSubprocess(
  script: string,
): Promise<{ code: number; out: string; err: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['eval', '--no-lock', script],
    stdout: 'piped',
    stderr: 'piped',
  });
  const { code, stdout, stderr } = await command.output();
  return {
    code,
    out: new TextDecoder().decode(stdout),
    err: new TextDecoder().decode(stderr),
  };
}

const DOM_SHIM = `
  const doc = {
    createElement: () => makeElement('DIV'),
    createComment: () => makeNode(8),
    createTextNode: (data) => { const node = makeNode(3); node.data = data; return node; },
  };
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
      setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
      hasAttribute() { return false; }, addEventListener() {}, removeEventListener() {},
      querySelector() { return null; }, querySelectorAll() { return []; },
    };
    return node;
  }
  function makeElement(tag) { const element = makeNode(1); element.tagName = tag; return element; }

  // A host whose shadow root resolves like the platform's: attachShadow() is
  // idempotent for an 'open' root, and shadowRoot reads it back. Without that
  // the kernel would attach a SECOND root and never see pre-seeded content.
  const host = makeElement('OE-PROBE');
  host.tagName = 'OE-PROBE';
  host.attachShadow = () => {
    if (!host.__root) host.__root = makeElement('#shadow-root');
    return host.__root;
  };
  Object.defineProperty(host, 'shadowRoot', { get: () => host.__root ?? null });
`;

/** The program: one <div> child, so a seeded <div> is claimable content. */
const PROGRAM_SPEC = `testProgram({
  tag: 'oe-probe',
  root: 'shadow-open',
  template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
  parts: [],
})`;

function harness(): string {
  return `
  import { testProgram } from ${JSON.stringify(TEST_PROGRAM_SPECIFIER)};
  ${DOM_SHIM}
  const program = ${PROGRAM_SPEC};
  `;
}

const BOOT_KERNEL = `
  const { CompiledElementKernel } = await import(${JSON.stringify(KERNEL_SPECIFIER)});
`;

Deno.test('#1416: the client-only entry connects an empty root (fresh) without the claim', async () => {
  const { code, out, err } = await runInSubprocess(`
    ${harness()}
    ${BOOT_KERNEL}
    await import(${JSON.stringify(CLIENT_ONLY_ENTRY_SPECIFIER)});
    const kernel = new CompiledElementKernel(host, program, { rootMode: 'shadow-open' });
    console.log(kernel.connect().mode);
  `);
  assertEquals(code, 0, `fresh connect should work. stderr: ${err}`);
  assertEquals(out.trim(), 'fresh');
});

Deno.test('#1416: the client-only entry fails closed on content it cannot claim', async () => {
  const { code, out, err } = await runInSubprocess(`
    ${harness()}
    ${BOOT_KERNEL}
    await import(${JSON.stringify(CLIENT_ONLY_ENTRY_SPECIFIER)});
    host.attachShadow().appendChild(makeElement('DIV'));
    const kernel = new CompiledElementKernel(host, program, { rootMode: 'shadow-open' });
    try {
      kernel.connect();
      console.log('NO-ERROR');
    } catch (error) {
      console.log(error.message);
    }
  `);
  assertEquals(code, 0, `probe should complete. stderr: ${err}`);
  assert(
    !out.includes('NO-ERROR'),
    'connecting existing DOM through the client-only entry must throw',
  );
  assertStringIncludes(out, 'needs the claim executor');
  assertStringIncludes(out, '@openelement/element/client-only');
  assertStringIncludes(out, "Import '@openelement/element'");
});

Deno.test('#1416: the default entry claims the same content the client-only entry refuses', async () => {
  // The contrast case: identical setup, only the entry differs.
  const { code, out, err } = await runInSubprocess(`
    ${harness()}
    ${BOOT_KERNEL}
    await import(${JSON.stringify(FULL_ENTRY_SPECIFIER)});
    const root = host.attachShadow();
    const content = makeElement('DIV');
    root.appendChild(content);
    const kernel = new CompiledElementKernel(host, program, { rootMode: 'shadow-open' });
    const activation = kernel.connect();
    console.log(activation.mode, activation.root.childNodes.length, activation.root.childNodes[0] === content);
  `);
  assertEquals(code, 0, `claim through the default entry should work. stderr: ${err}`);
  assertEquals(out.trim(), 'claim 1 true', 'the claim keeps the existing node');
});

Deno.test('#1416: both entries export exactly the same names', () => {
  const defaultNames = Object.keys(defaultEntry).sort();
  const clientOnlyNames = Object.keys(clientOnlyEntry).sort();
  assertEquals(
    clientOnlyNames,
    defaultNames,
    'the client-only entry must not add, drop, or rename a public export',
  );
  // 35 runtime exports at the time of writing (types are erased, so this is
  // fewer than the 73 symbols the interface snapshot records). The pin is a
  // floor rather than an exact count: ADDING a name to the shared surface is a
  // deliberate change owned by the snapshot gate, which records every one.
  // What must never happen is the client-only entry exposing fewer.
  assert(defaultNames.length >= 30, 'the surface is the full package surface, not a subset');
});
