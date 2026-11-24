/**
 * C-1 — the JSON prop seed is a RUNTIME-ONLY host attribute (consumer form).
 *
 * The generated host's SSR producer writes `data-oe-prop-seed` on its OWN tag
 * (a declared `array`/`object` row has no attribute wire, ADR-0182 D-18c) and
 * the generated shell removes it again at its own claim. A CLASS-LANE parent
 * that nests such a host — the supported author shape is a class component
 * admitted to the client graph (it has an interaction event) rendering an
 * idle/visible generated island child with a non-primitive prop, with the
 * parent hydrating FIRST — claims the same element from ITS Part Program. The
 * parent program declares only the rows it authored, never the generated
 * host's runtime slot, so the seed attribute reaches
 * `hydrateElementAttributes` as an undeclared name.
 *
 * Before this seam existed the runtime-only exemption listed exactly the
 * light-root marker and the theme broadcast, hand-written in hydrate.ts:
 * the seed reached it as `unexpected attribute "data-oe-prop-seed"` and the
 * parent's hydration failed closed. The names now live in ONE DOM-free owner
 * leaf (`internal/compiled/generated-element/runtime-only-host-attributes.ts`)
 * that BOTH the shell's writers and the hydration executor import — the shell
 * cannot be imported here (its module graph captures `HTMLElement`, which is
 * exactly why the runtime barrel must stay DOM-base-free). The last two tests
 * are the drift guard: hydrate must exempt every name in that set, and the one
 * literal may only be spelled in the owner leaf.
 *
 * The tests consume the wire the way hydration does, and they keep the
 * fail-closed directions: the exemption is scoped to CUSTOM-ELEMENT hosts, so
 * the same name on a plain element and any unlisted `data-oe-*` name remain
 * genuine server/client drift.
 */

import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { DATA_OE_LIGHT } from '@openelement/protocol/part-program';
import { parseHtml, installFacadeDom } from '../compiled-runtime/facade-dom.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';
import {
  seedGeneratedElementHostProperties,
  type GeneratedElementProperty,
} from '../../src/internal/compiled/generated-element/shell.ts';
import {
  DATA_OE_LIGHT_PROJECTION,
  GENERATED_RUNTIME_ONLY_ATTRIBUTES,
} from '../../src/internal/compiled/generated-element/runtime-only-host-attributes.ts';
import {
  hydrateExistingDom,
  PartProgramHydrationError,
} from '../../src/internal/compiled/runtime.ts';
import { serializeProgramContent } from '../../src/internal/compiled/server/index.ts';
import { THEME_ATTRIBUTE } from '../../src/open-element-theme.ts';

const dom = installFacadeDom();

/** The runtime host attribute the generated seeder writes. */
const SEED = 'data-oe-prop-seed';

const wireClaim = hydrateExistingDom as unknown as (
  program: unknown,
  host: unknown,
  root: Node,
) => { dispose(): void };
const serializeServer = serializeProgramContent as unknown as (
  program: unknown,
  host: unknown,
) => string;

const emptyHost = () => ({ signals: {} });

/** The generated host's declared rows: one array row (seed-only wire) + a control. */
const rows = (): GeneratedElementProperty[] => [
  { name: 'items', attribute: null, type: 'array', default: () => [] },
  { name: 'label', attribute: 'label', type: 'string', default: 'none' },
];

/**
 * The REAL generated-host wire for a supplied array row: the seeder's own
 * `__oeHostAttributes` pairs. This is the producer half of the seam; the parent
 * hydration below consumes it exactly as the browser DOM would.
 */
function generatedHostWire(): ReadonlyArray<readonly [string, string]> {
  const seeded = seedGeneratedElementHostProperties(rows(), {
    items: [{ id: 'a', label: 'First' }],
  }) as Record<string, unknown>;
  const pairs = seeded.__oeHostAttributes as ReadonlyArray<readonly [string, string]> | undefined;
  expect(pairs, 'the seeder must project the array row onto a host attribute pair').toBeDefined();
  const seed = pairs!.find(([name]) => name === SEED);
  expect(seed, `the seeder must carry the array row on ${SEED}`).toBeDefined();
  // The wire value is the JSON document the shell will consume.
  expect(JSON.parse(seed![1])).toEqual({ items: [{ id: 'a', label: 'First' }] });
  return pairs!;
}

/** A class-lane parent program: one nested custom-element host, no children. */
function parentProgram(nestedAttrs: Array<[string, string]> = []) {
  return testProgram({
    tag: 'oe-seed-hydrate-parent',
    template: [
      {
        k: 'el',
        tag: 'div',
        attrs: [['class', 'shell']],
        children: [{ k: 'el', tag: 'oe-seed-hydrate-child', attrs: nestedAttrs, children: [] }],
      },
    ],
    parts: [],
  });
}

/** The parent's SSR output. The nested host is opaque to the parent program. */
function parentHtml(nestedAttrs: Array<[string, string]> = []): string {
  return serializeServer(parentProgram(nestedAttrs), emptyHost());
}

/** The nested generated host the way the parent's serializer left it in the DOM. */
function nestedHost(root: Node): HTMLElement {
  return (root.childNodes[0] as unknown as { childNodes: Node[] }).childNodes[0] as HTMLElement;
}

/** The uncaught failure detail, or '' when the claim succeeded. */
function claimFailure(program: unknown, root: Node): string {
  try {
    wireClaim(program, emptyHost(), root).dispose();
    return '';
  } catch (error) {
    return (error as PartProgramHydrationError).detail ?? String(error);
  }
}

test('a class-lane parent claims a nested generated host that carries the real seed wire', () => {
  const wire = generatedHostWire();
  const root = parseHtml(dom.document, parentHtml());
  const child = nestedHost(root);
  // The generated host's own SSR artifact: the seeded pairs, then its light
  // ownership marker (the parent program declares neither).
  for (const [name, value] of wire) child.setAttribute(name, value);
  child.setAttribute(DATA_OE_LIGHT, '');

  // The nested host's generated content is opaque to the parent program
  // (`ownsExpandedSubtree`), so the child's DOM children stay out of the walk.
  child.appendChild(dom.document.createComment('generated content'));
  expect(claimFailure(parentProgram(), root)).toEqual('');
});

test('the seed attribute on a PLAIN element is still server/client drift', () => {
  // The exemption is scoped to custom-element hosts: every writer targets a
  // generated/compiled host, so a `data-oe-*` runtime name on a div is not a
  // runtime slot and must keep failing closed.
  const program = testProgram({
    tag: 'oe-seed-hydrate-plain',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [],
  });
  const root = parseHtml(dom.document, serializeServer(program, emptyHost()));
  (root.childNodes[0] as unknown as Element).setAttribute(SEED, '{"items":[]}');
  expect(claimFailure(program, root)).toContain(`unexpected attribute "${SEED}"`);
});

test('an unlisted data-oe-* attribute on the nested host still fails closed', () => {
  const root = parseHtml(dom.document, parentHtml());
  nestedHost(root).setAttribute('data-oe-not-a-runtime-slot', '1');
  expect(claimFailure(parentProgram(), root)).toContain(
    'unexpected attribute "data-oe-not-a-runtime-slot"',
  );
});

test('declared attributes on the nested host still drift-check', () => {
  // Runtime-only names are exempt from the REVERSE check only; an authored row
  // the program declares keeps the exact-value forward check.
  const root = parseHtml(dom.document, parentHtml([['data-static', 'kept']]));
  const child = nestedHost(root);
  child.setAttribute('data-static', 'drifted');
  child.setAttribute(SEED, '{"items":[]}');
  expect(claimFailure(parentProgram([['data-static', 'kept']]), root)).toContain(
    'attribute drift on "data-static"',
  );
});

test('hydrate exempts every name in the ONE runtime-only fact (and nothing else)', () => {
  // The owner leaf is the contract; hydration must consume it whole. A writer
  // that adds a name to the leaf without teaching hydration would fail here on
  // the FIRST assertion, and an over-broad exemption would fail the second.
  expect([...GENERATED_RUNTIME_ONLY_ATTRIBUTES].sort()).toEqual(
    [DATA_OE_LIGHT, DATA_OE_LIGHT_PROJECTION, THEME_ATTRIBUTE, SEED].sort(),
  );
  for (const name of GENERATED_RUNTIME_ONLY_ATTRIBUTES) {
    const onHost = parseHtml(dom.document, parentHtml());
    nestedHost(onHost).setAttribute(name, name === SEED ? '{"items":[]}' : 'runtime-value');
    expect(claimFailure(parentProgram(), onHost), `${name} on a custom-element host`).toEqual('');

    const plainProgram = testProgram({
      tag: 'oe-seed-hydrate-runtime-plain',
      template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
      parts: [],
    });
    const plainRoot = parseHtml(dom.document, serializeServer(plainProgram, emptyHost()));
    (plainRoot.childNodes[0] as unknown as Element).setAttribute(name, 'runtime-value');
    expect(
      claimFailure(plainProgram, plainRoot),
      `${name} on a plain element stays drift`,
    ).toContain(`unexpected attribute "${name}"`);
  }
  // Not a `data-oe-` wildcard: an unlisted runtime-looking name keeps failing.
  expect(GENERATED_RUNTIME_ONLY_ATTRIBUTES.has('data-oe-not-a-runtime-slot')).toBe(false);
  const wildcard = parseHtml(dom.document, parentHtml());
  nestedHost(wildcard).setAttribute('data-oe-not-a-runtime-slot', '1');
  expect(claimFailure(parentProgram(), wildcard)).toContain(
    'unexpected attribute "data-oe-not-a-runtime-slot"',
  );
});

test('the seed attribute literal has exactly ONE owner (P6/P8 drift guard)', async () => {
  // The single source of the wire name is the DOM-free leaf. Both sides import
  // it; a quoted literal appearing anywhere else in `src/` means a second
  // hand-written copy is back, which is the C-1 defect class.
  const srcDir = new URL('../../src/', import.meta.url);
  const files = await walkTypeScript(srcDir);
  const quoted = /['"]data-oe-prop-seed['"]/;
  const offenders = files.filter((file) => quoted.test(file.source)).map((file) => file.path);
  expect(offenders).toEqual([
    'internal/compiled/generated-element/runtime-only-host-attributes.ts',
  ]);

  // The layering that makes the leaf necessary is part of the contract too:
  // hydration imports the leaf, never the shell (the shell would capture
  // `HTMLElement` at module evaluation); the shell imports the leaf's name.
  const byPath = new Map(files.map((file) => [file.path, file.source]));
  const hydrateSource = byPath.get('internal/compiled/runtime/hydrate.ts')!;
  expect(hydrateSource).toContain("from '../generated-element/runtime-only-host-attributes.ts'");
  expect(hydrateSource).not.toContain("from '../generated-element/shell.ts'");
  const shellSource = byPath.get('internal/compiled/generated-element/shell.ts')!;
  expect(shellSource).toContain("from './runtime-only-host-attributes.ts'");
  expect(quoted.test(shellSource)).toBe(false);
});

interface SourceFile {
  path: string;
  source: string;
}

/** Recursively read every `.ts` file under `dir` (paths relative to `dir`). */
async function walkTypeScript(dir: URL, prefix = ''): Promise<SourceFile[]> {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dir, { withFileTypes: true });
  const files: SourceFile[] = [];
  for (const entry of entries) {
    const at = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) {
      files.push(...(await walkTypeScript(at, `${prefix}${entry.name}/`)));
    } else if (entry.name.endsWith('.ts')) {
      files.push({ path: `${prefix}${entry.name}`, source: await readFile(at, 'utf8') });
    }
  }
  return files;
}
