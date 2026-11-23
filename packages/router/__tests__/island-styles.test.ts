/**
 * Generated-island styles — authoring + static-scan admission and the
 * build-time declaration carrier (GH issue #1800, option a).
 *
 * The scan admits `IslandConfig.styles` on generated-element (function)
 * islands and records the build-time declaration carrier, which the client
 * build's style-edge plan turns into the existing content-addressed asset:
 *
 * - a LIGHT-root declaration carries the island tag as its `@scope` identity
 *   (document application is a later adoption slice, GH issue #1800);
 * - a SHADOW-root declaration whose module emitted the compiled DSD host
 *   producer carries root `shadow` (M09-2e / #1803): its sheet ships authored
 *   bytes verbatim and is declared inside the host's DSD template as the
 *   canonical marked `<link>` prefix;
 * - a shadow island with NO host producer, and a module the generated lane did
 *   not admit (a class island, a non-TSX island), fail closed: no carrier could
 *   deliver the sheet, so the declaration must not be silently dropped.
 *
 * Both readers of the sidecar (the runtime `defineIslandConfig()` face and the
 * static island scan) are exercised over ONE shape so the runtime descriptor
 * and the authored sidecar cannot admit different specifiers (P8).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, expect, test } from 'vitest';
import { OpenElementError } from '@openelement/element';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { defineIslandConfig } from '../src/authoring.ts';
import { compileGeneratedElementIfAdmitted } from '@openelement/compiler';
import { createGeneratedElementSiteResolver } from '../src/vite/generated-element-site.ts';
import { IslandErrorCode } from '../src/internal/error-codes.ts';
import {
  islandStyleDeclarationFor,
  islandStyleDeclarations,
} from '../src/vite/internal/island-style-declarations.ts';
import {
  readIslandConfig,
  scanIslandMeta,
  scanIslands,
} from '../src/vite/internal/ssg/island-scanner.ts';

const LIGHT_GENERATED = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({
  root: 'light',
  hydrate: 'idle',
  ssr: false,
  styles: ['./profile-card.css', '../shared/theme.css'],
});
function ProfileCard() {
  return <div class="card"><slot></slot></div>;
}
export default ProfileCard;
`;

const SHADOW_GENERATED = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({
  root: 'shadow',
  hydrate: 'idle',
  styles: ['./profile-card.css'],
});
function ProfileCard() {
  return <div class="card"><slot></slot></div>;
}
export default ProfileCard;
`;

const LIGHT_CLASS = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({
  root: 'light',
  hydrate: 'idle',
  styles: ['./profile-card.css'],
});
export default class ProfileCard extends HTMLElement {
  connectedCallback() {
    this.textContent = 'class-owned';
  }
}
`;

const NON_TSX_WITH_STYLES = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ root: 'light', styles: ['./widget.css'] });
export default function Widget() {
  return null;
}
`;

const REFUSED_WITH_STYLES = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({
  root: 'light',
  styles: ['./refused.css'],
});
function Refused(props: { label: string }) {
  return <div>{props.label}</div>;
}
export default Refused;
`;

/** A static sidecar shape reader over one `styles` expression. */
function staticStyles(expression: string): string {
  return `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ ${expression} });
`;
}

/** Assert the coded authoring error (code + one fragment of the message). */
function expectAuthoringError(run: () => unknown, code: string, includes: string): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'expected a coded authoring error').toBeInstanceOf(OpenElementError);
  expect((caught as OpenElementError).code).toEqual(code);
  expect((caught as Error).message).toContain(includes);
}

/** Assert the coded build error a scan refusal raises (code + message fragments). */
async function expectScanRefusal(
  files: Record<string, string>,
  code: string,
  includes: readonly string[],
): Promise<void> {
  const { scan } = await scanProject(files);
  let caught: unknown;
  try {
    await scan();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'expected the scan to refuse the declaration').toBeInstanceOf(OpenElementError);
  const message = (caught as Error).message;
  for (const fragment of includes) expect(message).toContain(fragment);
  expect(caught).toMatchObject({ phase: 'build', code, severity: 'error' });
  // A refusal records nothing: no declaration may survive for the build's
  // style plan, so no asset is ever emitted for a sheet nothing can deliver.
  expect(islandStyleDeclarations()).toHaveLength(0);
}

const cleanupDirs: string[] = [];
const originalCwd = process.cwd();

afterEach(async () => {
  process.chdir(originalCwd);
  for (const dir of cleanupDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** One temp project with the given project-relative files; returns its root. */
async function project(files: Record<string, string>): Promise<string> {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'oe-island-styles-')));
  cleanupDirs.push(root);
  for (const [relative, source] of Object.entries(files)) {
    const fullPath = join(root, relative);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, source, 'utf8');
  }
  return root;
}

/** Prepare one temp project's island scan (chdir keeps the compiler ids app-relative). */
async function scanProject(files: Record<string, string>): Promise<{
  root: string;
  islandsRoot: string;
  scan: () => Promise<Awaited<ReturnType<typeof scanIslandMeta>>>;
}> {
  const root = await project(files);
  const islandsRoot = join(root, 'app', 'islands');
  process.chdir(root);
  const scan = async (): Promise<Awaited<ReturnType<typeof scanIslandMeta>>> => {
    const islandFiles = await scanIslands(islandsRoot);
    return scanIslandMeta(islandsRoot, islandFiles);
  };
  return { root, islandsRoot, scan };
}

// ── Runtime authoring face (`defineIslandConfig`) ──────────────────────────

test('defineIslandConfig: admits a relative styles list on a light-root island, in authored order', () => {
  const config = defineIslandConfig({
    root: 'light',
    styles: ['./profile-card.css', '../shared/theme.css'],
  });
  expect(config.styles).toEqual(['./profile-card.css', '../shared/theme.css']);
});

test('defineIslandConfig: admits styles when the root is omitted (the generated lane defaults to light)', () => {
  const config = defineIslandConfig({ hydrate: 'idle', styles: ['./card.css'] });
  expect(config.styles).toEqual(['./card.css']);
});

test('defineIslandConfig: an island without styles keeps its exact config shape', () => {
  expect(defineIslandConfig({ ssr: true, hydrate: 'idle' })).toEqual({
    ssr: true,
    hydrate: 'idle',
  });
});

const MALFORMED_STYLES: ReadonlyArray<readonly [string, unknown, string]> = [
  ['not an array', './card.css', 'must be an array of relative .css specifiers'],
  ['empty array', [], 'must not be empty'],
  ['non-string entry', [1], 'entry 0 must be a string'],
  ['empty string entry', [''], 'entry 0 must not be empty'],
  ['bare package specifier', ['card.css'], 'must be a relative specifier'],
  ['absolute path', ['/app/card.css'], 'must be a relative specifier'],
  ['scheme URL', ['https://cdn.example.com/card.css'], 'must be a relative specifier'],
  ['non-css extension', ['./card.scss'], "must name a '.css' file"],
  ['query suffix', ['./card.css?inline'], 'must not carry a query or fragment'],
  ['fragment suffix', ['./card.css#x'], 'must not carry a query or fragment'],
  ['backslash separator', ['.\\card.css'], 'must use "/" path separators'],
  ['leading whitespace', [' ./card.css'], 'must not carry leading or trailing whitespace'],
  ['control character', ['./card\u0000.css'], 'must not contain control characters'],
  ['oversized specifier', [`./${'a'.repeat(300)}.css`], 'must stay under 256 characters'],
  ['duplicate entry', ['./card.css', './card.css'], 'entry 1 repeats "./card.css"'],
  [
    'too many sheets',
    Array.from({ length: 17 }, (_, index) => `./card-${index}.css`),
    'must declare at most 16 sheets',
  ],
];

for (const [label, value, fragment] of MALFORMED_STYLES) {
  test(`defineIslandConfig: refuses styles — ${label} (coded)`, () => {
    expectAuthoringError(
      () => defineIslandConfig({ root: 'light', styles: value as never }),
      IslandErrorCode.DESCRIPTOR_SHAPE,
      fragment,
    );
  });
}

test('defineIslandConfig: ADMITS styles on a shadow-root island (carrier exists)', () => {
  // The DSD carrier is implemented: the compiler emits the typed `styleLinks`
  // channel on the host producer and the serializer declares the canonical
  // marked `<link>` prefix inside the template (M09-2e / #1803). This face used
  // to refuse the combination as "not wired yet", which the build-time
  // admission (`island-scanner.ts`, `producer` → root `shadow`) contradicted —
  // two faces reading one fact differently. The carrier is the later fact, so
  // the authoring face admits it.
  //
  // The one case that stays refused belongs to the BUILD, not here: a
  // shadow-root island whose leaf emits no host producer has no template to
  // declare the sheet in, and only the scan knows the producer identity.
  const config = defineIslandConfig({ root: 'shadow', styles: ['./card.css'] });
  expect(config.styles).toEqual(['./card.css']);
});

// ── Static island scan (`readIslandConfig`) ───────────────────────────────

test('readIslandConfig: reads the styles array as static string literals', () => {
  const config = readIslandConfig(
    staticStyles("root: 'light', styles: ['./profile-card.css', '../shared/theme.css']"),
  );
  expect(config).toEqual({ root: 'light', styles: ['./profile-card.css', '../shared/theme.css'] });
});

test('readIslandConfig: no styles key appears for an island that declares none', () => {
  expect(readIslandConfig(staticStyles("root: 'light', ssr: false"))).toEqual({
    root: 'light',
    ssr: false,
  });
});

const MALFORMED_STATIC_STYLES: ReadonlyArray<readonly [string, string, string]> = [
  [
    'dynamic list value',
    'const sheets = ["./card.css"];\n' + staticStyles('root: "light", styles: sheets'),
    'openElement.styles must be an array of string literals',
  ],
  [
    'dynamic entry value',
    'const sheet = "./card.css";\n' + staticStyles('root: "light", styles: [sheet]'),
    'must be a static array of string literals, got dynamic value',
  ],
  [
    'spread element',
    staticStyles('root: "light", styles: [...sheets]'),
    'must not contain spreads',
  ],
  ['non-array value', staticStyles('root: "light", styles: "./card.css"'), 'must be an array'],
  [
    'bare specifier',
    staticStyles('root: "light", styles: ["card.css"]'),
    'must be a relative specifier',
  ],
  [
    'duplicate specifier',
    staticStyles('root: "light", styles: ["./card.css", "./card.css"]'),
    'repeats "./card.css"',
  ],
];

for (const [label, source, fragment] of MALFORMED_STATIC_STYLES) {
  test(`readIslandConfig: refuses styles — ${label} (coded metadata error)`, () => {
    expectAuthoringError(() => readIslandConfig(source), 'ISLAND_METADATA_ERROR', fragment);
  });
}

// ── Scan admission + the build-time declaration carrier ───────────────────

test('scan: a light-root generated island carries and registers its styles', async () => {
  const { root, islandsRoot, scan } = await scanProject({
    'app/islands/profile-card.tsx': LIGHT_GENERATED,
  });
  const meta = await scan();
  expect(meta['profile-card']!.styles).toEqual(['./profile-card.css', '../shared/theme.css']);
  const declarations = islandStyleDeclarations();
  expect(declarations).toHaveLength(1);
  const declaration = declarations[0]!;
  expect(declaration.tagName).toBe('profile-card');
  expect(declaration.filePath).toBe('profile-card.tsx');
  expect(declaration.islandsDir).toBe(normalizeSeparators(islandsRoot));
  expect(declaration.specifiers).toEqual(['./profile-card.css', '../shared/theme.css']);
  // The carrier is looked up by the module id the bundler will process, and the
  // absolute module path is the one the scan resolved.
  const absoluteModuleId = normalizeSeparators(join(root, 'app', 'islands', 'profile-card.tsx'));
  expect(islandStyleDeclarationFor(absoluteModuleId)).toBe(declaration);
  // A query suffix (dev cache busting) answers the same declaration.
  expect(islandStyleDeclarationFor(`${absoluteModuleId}?t=1`)).toBe(declaration);
});

test('scan: an island without styles registers no declaration (authoritative reset)', async () => {
  const clean = await scanProject({
    'app/islands/plain-card.tsx': LIGHT_GENERATED.replace(
      "styles: ['./profile-card.css', '../shared/theme.css'],\n",
      '',
    ),
  });
  const meta = await clean.scan();
  expect(meta['plain-card']!.styles).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(meta['plain-card']!, 'styles')).toBe(false);
  expect(islandStyleDeclarations()).toHaveLength(0);

  // A later scan without styles must clear the earlier declaration, not keep a
  // stale record for the client build's style plan.
  const styled = await scanProject({ 'app/islands/temp-card.tsx': LIGHT_GENERATED });
  await styled.scan();
  expect(islandStyleDeclarations()).toHaveLength(1);
  const plain = await scanProject({
    'app/islands/temp-card.tsx': LIGHT_GENERATED.replace(
      "styles: ['./profile-card.css', '../shared/theme.css'],\n",
      '',
    ),
  });
  await plain.scan();
  expect(islandStyleDeclarations()).toHaveLength(0);
});

test('scan: a shadow-root generated island with a producer carries root shadow', async () => {
  const { root, scan } = await scanProject({
    'app/islands/profile-card.tsx': SHADOW_GENERATED,
  });
  const meta = await scan();
  expect(meta['profile-card']!.styles).toEqual(['./profile-card.css']);
  const declarations = islandStyleDeclarations();
  expect(declarations).toHaveLength(1);
  const declaration = declarations[0]!;
  expect(declaration.tagName).toBe('profile-card');
  expect(declaration.root).toBe('shadow');
  expect(declaration.specifiers).toEqual(['./profile-card.css']);
  const absoluteModuleId = normalizeSeparators(join(root, 'app', 'islands', 'profile-card.tsx'));
  expect(islandStyleDeclarationFor(absoluteModuleId)).toBe(declaration);
  // The light-root record is distinguishable by the same field.
  const light = await scanProject({ 'app/islands/light-card.tsx': LIGHT_GENERATED });
  await light.scan();
  expect(islandStyleDeclarations()[0]!.root).toBe('light');
});

test('scan: a shadow-root generated island without a host producer still fails closed', async () => {
  // A shadow-root function island with a shape the leaf generator cannot turn
  // into a claimable host producer: the identity is `missing-producer`, so no
  // template exists to declare the sheet in and the build must refuse.
  //
  // The shape is the generator's own branch-template rule: a condition branch
  // may only carry shapes that were already claimable, so a NESTED condition
  // inside a branch keeps the whole component mount-only
  // (`generated-leaf/generate.ts:4409`, the condition case's `insideTemplate`
  // gate). The compiler admits the module, but the leaf emits no `<Name>__ssr`,
  // so the emitter's `hostWrapper` decision appends no `<Name>__ssrHost`
  // (`generated-element/emit.ts:208` `exportsSsrFunction` → `:586`), and the
  // scan's identity is `missing-producer`
  // (`generated-element-host-metadata.ts:263`), refused at
  // `island-scanner.ts:1347`.
  //
  // REPLACED FIXTURE (2026-11-23): this row used to use a `value={props.value}`
  // property channel, which was `missing-producer` only while that channel
  // forced mount-only (at the row's introduction, cd7e9e065). F16 (d97a85c5a)
  // intentionally admits the property channel — it renders as an HTML attribute
  // in SSR (`generate.ts:7129`) and `attributesClaimable` no longer declines it
  // (`generate.ts:4359`) — so that fixture now resolves to `producer` and the
  // scan admits it. The nested-condition shape is still outside the claim
  // slice, so the refusal stays pinned by a real missing-producer identity.
  const missingProducer = `import { defineIslandConfig } from '@openelement/router';
import { signal } from '@openelement/element';
export const openElement = defineIslandConfig({
  root: 'shadow',
  hydrate: 'idle',
  styles: ['./profile-card.css'],
});
function Field() {
  const outer = signal(true);
  const inner = signal(false);
  return <div>{outer.value ? <span>{inner.value ? <i>inner</i> : null}</span> : null}</div>;
}
export default Field;
`;
  await expectScanRefusal(
    { 'app/islands/profile-card.tsx': missingProducer },
    'OE_ISLAND_STYLE_SHADOW_UNWIRED',
    ['emitted no compiled DSD host producer', 'GH issue #1800'],
  );
});

test('scan: a CLIENT-ONLY shadow island without a producer is admitted (the browser adopts the import)', async () => {
  // 2026-11-20 client style adoption: the `missing-producer` refusal exists
  // because a server-rendered shadow island needs the producer's template to
  // declare the sheet in. A client-only island has no server render at all:
  // the browser creates the root, the compiler emits the `.css` import for the
  // same declaration, and the shell adopts the sheet object. Refusing here
  // would reject a delivery that now works.
  const missingProducerClientOnly = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({
  root: 'shadow',
  ssr: false,
  dsd: false,
  hydrate: 'only',
  styles: ['./profile-card.css'],
  properties: { value: { default: '' } },
});
function Field(props: { value: string }) {
  return <input value={props.value} />;
}
export default Field;
`;
  const { root, scan } = await scanProject({
    'app/islands/profile-card.tsx': missingProducerClientOnly,
  });
  const meta = await scan();
  expect(meta['profile-card']!.styles).toEqual(['./profile-card.css']);
  const declarations = islandStyleDeclarations();
  expect(declarations).toHaveLength(1);
  // Authored bytes, no `@scope`: a shadow edge is isolated by its boundary.
  expect(declarations[0]!.root).toBe('shadow');
  expect(declarations[0]!.specifiers).toEqual(['./profile-card.css']);
  const absoluteModuleId = normalizeSeparators(join(root, 'app', 'islands', 'profile-card.tsx'));
  expect(islandStyleDeclarationFor(absoluteModuleId)).toBe(declarations[0]);
});

test('scan: a class island with styles fails closed — static styles is its channel', async () => {
  await expectScanRefusal(
    { 'app/islands/light-class.tsx': LIGHT_CLASS },
    'OE_ISLAND_STYLE_LANE_UNSUPPORTED',
    ['did not admit it as a generated-element island', 'static styles', '#1800'],
  );
});

test('scan: a non-TSX island with styles fails closed (the lane never admitted it)', async () => {
  await expectScanRefusal(
    { 'app/islands/widget-island.ts': NON_TSX_WITH_STYLES },
    'OE_ISLAND_STYLE_LANE_UNSUPPORTED',
    ['did not admit it as a generated-element island', 'non-tsx'],
  );
});

test('scan: a compiler-refused island with styles records no declaration and raises no second error', async () => {
  const { scan } = await scanProject({ 'app/islands/refused-card.tsx': REFUSED_WITH_STYLES });
  // The transform is the authoritative reporter of the compiler refusal; the
  // scan must not mask it with a style error, and must not register an edge for
  // a module that cannot compile.
  const meta = await scan();
  expect(meta['refused-card']!.styles).toBeUndefined();
  expect(islandStyleDeclarations()).toHaveLength(0);
});

test('the compiler derives the style-link fact from the sidecar, not scan order', async () => {
  // Regression for the reviewed ordering hazard: the scan compiles an island to
  // resolve its host identity BEFORE its style declaration is registered. The
  // fact must come from the authored sidecar (the lane's one metadata read), so
  // a compile taken before the scan and one taken after it are byte-identical.
  await scanProject({ 'app/islands/profile-card.tsx': SHADOW_GENERATED });
  const projectRoot = 'app/islands';
  const site = createGeneratedElementSiteResolver(projectRoot)(`${projectRoot}/profile-card.tsx`);
  expect(site).toEqual({ tag: 'profile-card' });
  expect(islandStyleDeclarations()).toHaveLength(0); // scan has not run yet
  const before = compileGeneratedElementIfAdmitted(
    SHADOW_GENERATED,
    `${projectRoot}/profile-card.tsx`,
    {
      site,
    },
  );
  expect(before).not.toBeNull();
  expect(before!.code).toContain(
    'export function ProfileCard__ssrHost(props, lightChildren, attributes, styleLinks, nestedHost) {',
  );

  await scanProject({ 'app/islands/profile-card.tsx': SHADOW_GENERATED }).then(({ scan }) =>
    scan(),
  );
  expect(islandStyleDeclarations()).toHaveLength(1);
  const after = compileGeneratedElementIfAdmitted(
    SHADOW_GENERATED,
    `${projectRoot}/profile-card.tsx`,
    {
      site,
    },
  );
  expect(after).not.toBeNull();
  expect(after!.code).toBe(before!.code);
});
