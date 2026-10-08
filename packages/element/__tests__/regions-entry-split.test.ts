/**
 * The Region builders seam (#1548).
 *
 * Four entries of this package expose the same public surface and differ in
 * which optional runtime installs they perform: `.` (claim + regions),
 * `./client-only` (regions only), `./no-regions` (claim only, #1548), and
 * `./base` (neither, #1548). Like the claim seam (#1416), the split is
 * invisible to a single-process test — the installs are module side effects,
 * so once ANY installing entry has been evaluated, the capability is
 * globally present. Each case therefore runs in its own subprocess, which is
 * also how a real page loads exactly one of the entries.
 *
 * What is pinned:
 *
 * 1. `./base` fails closed when a program with a when Region builds fresh —
 *    `OE_RUNTIME_REGION_BUILDERS_MISSING`, naming the entries that install.
 * 2. `./no-regions` fails closed the same way (claim presence says nothing
 *    about regions).
 * 3. The default entry builds the same program's Region.
 * 4. `./client-only` builds it too — a client-only island still builds fresh
 *    Regions from client state, so the regions axis is independent of the
 *    claim axis.
 * 5. All four entries export the same names (the surface cannot drift).
 */
import { expect, test } from 'vitest';
import { runEsmSubprocess } from './esm-subprocess.ts';
import * as defaultEntry from '../src/index.ts';
import * as baseEntry from '../src/base.ts';
import * as clientOnlyEntry from '../src/client-only.ts';
import * as noRegionsEntry from '../src/no-regions.ts';

const RUNTIME_URL = new URL('../src/internal/compiled/runtime.ts', import.meta.url).href;
const TEST_PROGRAM_URL = new URL('./compiled-runtime/test-program.ts', import.meta.url).href;
const BASE_ENTRY_URL = new URL('../src/base.ts', import.meta.url).href;
const NO_REGIONS_ENTRY_URL = new URL('../src/no-regions.ts', import.meta.url).href;
const DEFAULT_ENTRY_URL = new URL('../src/index.ts', import.meta.url).href;
const CLIENT_ONLY_ENTRY_URL = new URL('../src/client-only.ts', import.meta.url).href;

/** One when Region under a static div: the smallest program the seam guards. */
const PROGRAM_SPEC = `testProgram({
  tag: 'oe-region-probe',
  template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [
    {
      k: 'when',
      index: 0,
      signal: 'visible',
      test: { signal: 'visible', op: 'truthy', value: true },
      on: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'text', value: 'on' }] }],
      off: [{ k: 'el', tag: 'em', attrs: [], children: [{ k: 'text', value: 'off' }] }],
    },
  ],
})`;

const DOM_SHIM = `
  const doc = {
    createElement: () => makeElement('DIV'),
    createComment: () => makeNode(8),
    createTextNode: (data) => { const node = makeNode(3); node.data = data; return node; },
  };
  function makeNode(nodeType) {
    const node = {
      nodeType, childNodes: [], parentNode: null, ownerDocument: doc,
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = node; node.childNodes.push(child); return child;
      },
      insertBefore(child, reference) {
        if (child.parentNode) child.parentNode.removeChild(child);
        const at = reference ? node.childNodes.indexOf(reference) : node.childNodes.length;
        node.childNodes.splice(at < 0 ? node.childNodes.length : at, 0, child);
        child.parentNode = node; return child;
      },
      removeChild(child) {
        const at = node.childNodes.indexOf(child);
        if (at >= 0) node.childNodes.splice(at, 1);
        child.parentNode = null; return child;
      },
      setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
      hasAttribute() { return false; },
    };
    return node;
  }
  function makeElement(tag) { const element = makeNode(1); element.tagName = tag; return element; }
`;

/**
 * The probe: one entry import, then one fresh build of the when-Region
 * program. The static import of the entry runs before the runtime import
 * reads the seam — the same evaluation order a real page has (the entry
 * module evaluates before any element connects).
 */
function probe(entryUrl: string): string {
  return `
  import { testProgram } from ${JSON.stringify(TEST_PROGRAM_URL)};
  ${DOM_SHIM}
  const program = ${PROGRAM_SPEC};
  await import(${JSON.stringify(entryUrl)});
  const { createFreshDom } = await import(${JSON.stringify(RUNTIME_URL)});
  const host = {
    signals: { visible: { value: 1, subscribe: () => () => {} } },
    handlers: {},
  };
  const root = makeElement('div');
  try {
    createFreshDom(program, host, root);
    const host2 = root.childNodes[0];
    console.log(
      ['OK', ...host2.childNodes.map((node) => String(node.nodeType))].join(' '),
    );
  } catch (error) {
    console.log(['ERR', error.code ?? 'NO-CODE', error.message].join(' '));
  }
  `;
}

test('#1548: the base entry fails closed on a when Region (no builders installed)', async () => {
  const { code, out, err } = await runEsmSubprocess(probe(BASE_ENTRY_URL));
  expect(code, `probe should complete. stderr: ${err}`).toEqual(0);
  expect(out).toContain('ERR');
  expect(out).toContain('OE_RUNTIME_REGION_BUILDERS_MISSING');
  expect(out).toContain('does not install the Region builders');
  expect(out).toContain("'@openelement/element'");
});

test('#1548: the no-regions entry fails closed on a when Region (claim without regions)', async () => {
  const { code, out, err } = await runEsmSubprocess(probe(NO_REGIONS_ENTRY_URL));
  expect(code, `probe should complete. stderr: ${err}`).toEqual(0);
  expect(out).toContain('ERR');
  expect(out).toContain('OE_RUNTIME_REGION_BUILDERS_MISSING');
});

test('#1548: the default entry builds the same when Region', async () => {
  const { code, out, err } = await runEsmSubprocess(probe(DEFAULT_ENTRY_URL));
  expect(code, `probe should complete. stderr: ${err}`).toEqual(0);
  expect(out.trim(), 'anchor comment, branch element, end comment').toEqual('OK 8 1 8');
});

test('#1548: the client-only entry builds the same when Region (fresh regions without claim)', async () => {
  const { code, out, err } = await runEsmSubprocess(probe(CLIENT_ONLY_ENTRY_URL));
  expect(code, `probe should complete. stderr: ${err}`).toEqual(0);
  expect(out.trim(), 'the regions axis is independent of the claim axis').toEqual('OK 8 1 8');
});

test('#1548: all four entries export exactly the same names', () => {
  const surfaces = [defaultEntry, clientOnlyEntry, noRegionsEntry, baseEntry].map((entry) =>
    Object.keys(entry).sort(),
  );
  for (const surface of surfaces.slice(1)) {
    expect(surface, 'an entry must not add, drop, or rename a public export').toEqual(surfaces[0]);
  }
  // Same floor pin as the claim-split test: the shared surface is the full
  // package surface; additions are snapshot-owned, drops are always failures.
  expect(surfaces[0].length >= 30, 'the surface is the full package surface').toBeTruthy();
});
