/**
 * M11 prerequisite — the island scan carries the compiler-owned generated-host
 * fact (LOCAL, Node).
 *
 * The compiler emits a host producer (`<Name>__ssrHost`) only inside its one
 * `hostWrapper` decision and returns that emitted name as
 * `CompiledGeneratedElement.ssrHostExport` (return-only; the emitted bytes do
 * not carry the field). Entry generation runs before any module transform, so
 * this test pins the bounded scan-side carrier that makes the fact available
 * without a namespace suffix scan, a class static, a runtime module-shape
 * classification, or a second naming rule:
 *
 * - the ONE island scan (`scanIslandMeta`) reads every island source already;
 *   it produces the carrier in the same pass, so both the build and the dev
 *   rescan (`rescanIslands`) get the fact from the same producer;
 * - the hosted name is the compiler's returned string, NEVER re-derived by the
 *   router (the producer is the compiler's own decision);
 * - the carrier classifies what the compiler did: a host producer, a shadow
 *   module without one, a light/absent-root module without one (the emitter
 *   appends no host there by design), a module the lane declined (class-owned
 *   or structural opt-out — the shipping class path), and a compiler refusal
 *   (recorded with the authoritative diagnostics, never thrown from the scan
 *   and never presented as a valid identity);
 * - no consumer is wired here: nothing in this test asserts registration,
 *   fail-closed admission policy or entry codegen. The carrier is build
 *   metadata only.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, expect, test, vi } from 'vitest';
import {
  CompiledElementError,
  compileGeneratedElementIfAdmitted,
  stableModuleId,
} from '@openelement/compiler';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { createGeneratedElementSiteResolver } from '../src/vite/generated-element-site.ts';
import { scanIslandMeta, scanIslands } from '../src/vite/internal/ssg/island-scanner.ts';
import {
  readGeneratedElementHost,
  type GeneratedElementHostIdentity,
} from '../src/vite/internal/ssg/generated-element-host-metadata.ts';
import { rescanIslands } from '../src/vite/plugin-scanners.ts';
import { createOpenPluginState } from '../src/vite/plugin-config.ts';

const SHADOW_GENERATED = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ root: 'shadow', hydrate: 'idle' });
function ProfileCard() {
  return <div class="card"><slot></slot></div>;
}
export default ProfileCard;
`;

const LIGHT_GENERATED = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ root: 'light', hydrate: 'idle' });
function ProfileCard() {
  return <div class="card"><slot></slot></div>;
}
export default ProfileCard;
`;

const LIGHT_CLASS = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ root: 'light', hydrate: 'idle' });
export default class ProfileCard extends HTMLElement {
  connectedCallback() {
    this.textContent = 'class-owned';
  }
}
`;

/**
 * A shadow root whose leaf emits no `<Field>__ssr`: a condition branch inside a
 * restricted parser context (`<table>`) stays mount-only, because the branch
 * markers are comments that the table parser would relocate, making the claim
 * wire unreadable. The component is admitted and emits no producer — the
 * carrier must keep that "admitted, but no host producer" state distinct from a
 * light root and from a declined module.
 *
 * The shape used to be the declared `value` property channel, which kept the
 * component mount-only until F16 admitted it (a server render has no live DOM to
 * preserve, and `value="x"` is the honest server artifact). The property shape
 * therefore has a producer now and can no longer stand in for this state.
 */
const SHADOW_WITHOUT_SSR = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ root: 'shadow', hydrate: 'idle' });
function Field() {
  const on = true;
  return <table><tbody>{on ? <tr><td>y</td></tr> : <tr><td>n</td></tr>}</tbody></table>;
}
export default Field;
`;

/**
 * The same missing-producer shape on a `ssr: false` (client-only) island. The
 * classification is admission-independent: the scan records what the compiler
 * did, and the existing client-only admission stays the consumer's decision.
 */
const SHADOW_WITHOUT_SSR_CLIENT_ONLY = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ root: 'shadow', hydrate: 'only', properties: { value: { default: '' } } });
function Field(props: { value: string }) {
  return <input value={props.value} />;
}
export default Field;
`;

/**
 * A shadow root the compiler lane refuses: the root takes a props parameter
 * without a declared property table (the M09-1a undeclared-props refusal). The
 * scan must record the compiler's diagnostics and leave the authoritative
 * transform to report them rather than throwing a second, source-less copy.
 */
/**
 * A shadow-root island with a real host producer that is still `ssr: false`
 * (client-only). Admission does not change the compiler fact: the scan must
 * record the producer, not hide it behind the client-only policy.
 *
 * The declared sheet is what keeps the producer: since F16 a client-only island
 * is producerless only when it declares NO sheet (its `styleLinks` channel is the
 * one thing a `<link>`-less island still needs a template for). Without the
 * sheet this fixture would be the `missing-producer` shape, not a producer.
 */
const SHADOW_PRODUCER_CLIENT_ONLY = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ root: 'shadow', hydrate: 'only', styles: ['./client-card.css'] });
function ClientCard() {
  return <div class="card"><slot></slot></div>;
}
export default ClientCard;
`;

/** A shadow sidecar on a class-owned module: the generated lane declines it. */
const SHADOW_CLASS = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ root: 'shadow', hydrate: 'idle' });
export default class ShadowClass extends HTMLElement {
  connectedCallback() {
    this.textContent = 'class-owned';
  }
}
`;

const SHADOW_REFUSED = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ root: 'shadow', hydrate: 'idle' });
function Refused(props: { label: string }) {
  return <div>{props.label}</div>;
}
export default Refused;
`;

const NON_TSX_ISLAND = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ root: 'shadow' });
export default function Widget() {
  return null;
}
`;

const cleanupDirs: string[] = [];
const originalCwd = process.cwd();

afterEach(async () => {
  process.chdir(originalCwd);
  for (const dir of cleanupDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** One temp project with the given project-relative files; returns its root. */
async function project(files: Record<string, string>): Promise<string> {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'oe-generated-host-')));
  cleanupDirs.push(root);
  for (const [relative, source] of Object.entries(files)) {
    const fullPath = join(root, relative);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, source, 'utf8');
  }
  return root;
}

async function scanProject(files: Record<string, string>): Promise<{
  root: string;
  islandsRoot: string;
  meta: Awaited<ReturnType<typeof scanIslandMeta>>;
}> {
  const root = await project(files);
  const islandsRoot = join(root, 'app', 'islands');
  // The scan anchors compiler module ids on the project root
  // (`stableModuleId(fullPath, process.cwd())`, the same anchoring
  // island-blocks-scan uses). CLI/dev both run from the app root, so chdir
  // keeps the fixture faithful and proves no machine path reaches the carrier.
  process.chdir(root);
  const islandFiles = await scanIslands(islandsRoot);
  return { root, islandsRoot, meta: await scanIslandMeta(islandsRoot, islandFiles) };
}

function identityOf(
  meta: Awaited<ReturnType<typeof scanIslandMeta>>,
  tagName: string,
): GeneratedElementHostIdentity | undefined {
  return readGeneratedElementHost(meta[tagName]);
}

test('scan carries the compiler-owned host export name for a shadow generated island', async () => {
  const { islandsRoot, meta } = await scanProject({
    'app/islands/profile-card.tsx': SHADOW_GENERATED,
  });
  const identity = identityOf(meta, 'profile-card');
  expect(identity).toBeDefined();
  expect(identity!.kind).toBe('producer');

  // The name is the compiler's returned decision over the SAME source, read
  // through the same host-side site fact the transform uses. The test never
  // spells the emitted name itself.
  const site = createGeneratedElementSiteResolver('app/islands')('app/islands/profile-card.tsx');
  expect(site).toEqual({ tag: 'profile-card' });
  // The authoritative call uses the same stable module id the scan uses, not
  // the absolute machine path.
  const moduleId = stableModuleId(
    normalizeSeparators(join(islandsRoot, 'profile-card.tsx')),
    process.cwd(),
  );
  expect(moduleId).toBe('app/islands/profile-card.tsx');
  const compiled = compileGeneratedElementIfAdmitted(SHADOW_GENERATED, moduleId, { site: site! });
  expect(compiled).not.toBeNull();
  expect(identity).toEqual({
    kind: 'producer',
    component: compiled!.component,
    ssrHostExport: compiled!.ssrHostExport,
  });
  // The reported string IS an export the compiler's emitted module declares.
  expect(compiled!.ssrHostExport).not.toBeNull();
  expect(compiled!.code).toContain(`export function ${compiled!.ssrHostExport}(`);
  // The scan key and the host helper's derived tag are one identity.
  expect(meta['profile-card']).toBeDefined();
});

test('a shadow island without a host producer is recorded as missing-producer', async () => {
  const { meta } = await scanProject({ 'app/islands/field-card.tsx': SHADOW_WITHOUT_SSR });
  const identity = identityOf(meta, 'field-card');
  expect(identity).toEqual({ kind: 'missing-producer', component: 'Field' });
  // The static sidecar facts are unchanged by the carrier: the scan still
  // records the authored root and delivery metadata for every consumer.
  expect(meta['field-card']!.root).toBe('shadow');
  expect(meta['field-card']!.ssr).toBeUndefined();
  expect((meta['field-card'] as { ssrHostExport?: unknown }).ssrHostExport).toBeUndefined();
});

test('scan carries the absence of a producer for a light island with an unsupported SSR shape', async () => {
  const { meta } = await scanProject({
    'app/islands/light-table.tsx': SHADOW_WITHOUT_SSR.replace(
      "root: 'shadow'",
      "root: 'light', ssr: true",
    ),
  });
  expect(identityOf(meta, 'light-table')).toEqual({
    kind: 'light-no-producer',
    component: 'Field',
  });
});

test('light generated and light class islands stay distinguishable', async () => {
  const { meta } = await scanProject({
    'app/islands/light-card.tsx': LIGHT_GENERATED,
    'app/islands/light-class.tsx': LIGHT_CLASS,
  });
  // The light constructor supplies a static render producer.
  expect(identityOf(meta, 'light-card')).toEqual({
    kind: 'light-producer',
    component: 'ProfileCard',
  });
  // A class-owned light island was declined by the generated lane; it must
  // never be recorded as "no host producer" (that would blur the shipping
  // class path into the generated-host classification).
  expect(identityOf(meta, 'light-class')).toEqual({
    kind: 'lane-declined',
    reason: 'compiler-declined',
  });
  expect(meta['light-class']!.root).toBe('light');
});

test('a non-TSX island cannot enter the generated lane and is recorded as declined', async () => {
  const { meta } = await scanProject({ 'app/islands/widget-island.ts': NON_TSX_ISLAND });
  expect(identityOf(meta, 'widget-island')).toEqual({ kind: 'lane-declined', reason: 'non-tsx' });
  // The sidecar facts still reach the admission plan (existing behavior).
  expect(meta['widget-island']!.root).toBe('shadow');
});

test('a compiler refusal is recorded with diagnostics, never thrown nor treated as valid', async () => {
  const { root, islandsRoot, meta } = await scanProject({
    'app/islands/refused-card.tsx': SHADOW_REFUSED,
  });
  const identity = identityOf(meta, 'refused-card');
  expect(identity).toBeDefined();
  expect(identity!.kind).toBe('lane-refused');
  if (identity!.kind !== 'lane-refused') throw new Error('unreachable');
  // The carrier diagnostics are pinned against the authoritative compiler call
  // over the SAME source and the SAME stable module id the scan uses — never
  // hardcoded offsets and never a re-derived message.
  const site = createGeneratedElementSiteResolver('app/islands')('app/islands/refused-card.tsx');
  expect(site).toEqual({ tag: 'refused-card' });
  const moduleId = stableModuleId(
    normalizeSeparators(join(islandsRoot, 'refused-card.tsx')),
    process.cwd(),
  );
  expect(moduleId).toBe('app/islands/refused-card.tsx');
  let authoritative: Array<{
    code: string;
    message: string;
    file: string;
    line: number;
    character: number;
  }>;
  try {
    compileGeneratedElementIfAdmitted(SHADOW_REFUSED, moduleId, { site: site! });
    throw new Error('expected the generated lane to refuse the fixture');
  } catch (error) {
    if (!(error instanceof CompiledElementError)) throw error;
    authoritative = error.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      file: diagnostic.file,
      line: diagnostic.line,
      character: diagnostic.character,
    }));
  }
  expect(identity!.diagnostics).toEqual(authoritative!);
  expect(identity!.diagnostics.length).toBeGreaterThan(0);
  // No machine path enters the carrier: the compiler id is anchored on the
  // project root (the temp fixture root), so the file stays project-relative.
  for (const diagnostic of identity!.diagnostics) {
    expect(diagnostic.file.startsWith(root)).toBe(false);
    expect(diagnostic.file.startsWith('/')).toBe(false);
  }
  // A refusal is not a pass: it is neither a producer nor a no-host fact.
  expect(identity!.kind === 'producer' || identity!.kind === 'light-no-producer').toBe(false);
  // The static sidecar facts are still produced for the rest of the build.
  expect(meta['refused-card']!.root).toBe('shadow');
});

test('an explicit project root anchors refusal diagnostics when cwd is not the project root', async () => {
  const root = await project({ 'app/islands/refused-card.tsx': SHADOW_REFUSED });
  const islandsRoot = join(root, 'app', 'islands');
  const islandFiles = await scanIslands(islandsRoot);
  // Deliberately no chdir: the scan's project root is the fixture while the
  // process cwd stays the repository checkout. The explicit root argument is
  // the only identity anchor, so the carrier cannot inherit a machine path
  // from cwd.
  expect(process.cwd()).not.toBe(root);
  const meta = await scanIslandMeta(islandsRoot, islandFiles, root);
  const identity = readGeneratedElementHost(meta['refused-card']);
  expect(identity?.kind).toBe('lane-refused');
  if (identity?.kind !== 'lane-refused') throw new Error('expected a refusal');
  expect(identity.diagnostics.length).toBeGreaterThan(0);
  // Pinned against the authoritative call over the same explicit-root stable
  // id, and the file is project-relative, never the machine path.
  const moduleId = stableModuleId(normalizeSeparators(join(islandsRoot, 'refused-card.tsx')), root);
  expect(moduleId).toBe('app/islands/refused-card.tsx');
  const site = createGeneratedElementSiteResolver('app/islands')('app/islands/refused-card.tsx');
  let authoritative: Array<{
    code: string;
    message: string;
    file: string;
    line: number;
    character: number;
  }>;
  try {
    compileGeneratedElementIfAdmitted(SHADOW_REFUSED, moduleId, { site: site! });
    throw new Error('expected the generated lane to refuse the fixture');
  } catch (error) {
    if (!(error instanceof CompiledElementError)) throw error;
    authoritative = error.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      file: diagnostic.file,
      line: diagnostic.line,
      character: diagnostic.character,
    }));
  }
  expect(identity.diagnostics).toEqual(authoritative!);
  for (const diagnostic of identity.diagnostics) {
    expect(diagnostic.file.startsWith('/')).toBe(false);
    expect(diagnostic.file.startsWith(root)).toBe(false);
  }
});

test('ssr:false islands are still classified (one extra compile per island per scan)', async () => {
  // The carrier records the compiler's decision independent of admission: a
  // client-only shadow island with no host producer is still "admitted, no
  // host", not silently absent. Cost note: this scan compiles every `.tsx`
  // island with a canonical sidecar once, including ssr:false ones; that is
  // the bounded cost of one scan-side compile per island, recorded here so a
  // later consumer can decide whether client-only islands need the fact.
  const { meta } = await scanProject({
    'app/islands/field-client-only.tsx': SHADOW_WITHOUT_SSR_CLIENT_ONLY,
  });
  expect(meta['field-client-only']!.ssr).toBe(false);
  expect(identityOf(meta, 'field-client-only')).toEqual({
    kind: 'missing-producer',
    component: 'Field',
  });
});

test('an ssr:false island with a real host producer is still classified as producer', async () => {
  const { islandsRoot, meta } = await scanProject({
    'app/islands/card-client-only.tsx': SHADOW_PRODUCER_CLIENT_ONLY,
  });
  expect(meta['card-client-only']!.ssr).toBe(false);
  const identity = identityOf(meta, 'card-client-only');
  expect(identity?.kind).toBe('producer');
  if (identity?.kind !== 'producer') throw new Error('expected a host producer');
  // The name is the compiler's decision over the same stable module id, not a
  // re-derivation from the client-only island's path.
  const site = createGeneratedElementSiteResolver('app/islands')(
    'app/islands/card-client-only.tsx',
  );
  const moduleId = stableModuleId(
    normalizeSeparators(join(islandsRoot, 'card-client-only.tsx')),
    process.cwd(),
  );
  const compiled = compileGeneratedElementIfAdmitted(SHADOW_PRODUCER_CLIENT_ONLY, moduleId, {
    site: site!,
  });
  expect(compiled?.ssrHostExport).toBe(identity.ssrHostExport);
  expect(identity.ssrHostExport.length).toBeGreaterThan(0);
});

test('a shadow class island is declined by the generated lane, not recorded as no-host', async () => {
  const { meta } = await scanProject({ 'app/islands/shadow-class.tsx': SHADOW_CLASS });
  // The shipping class lane owns the module; the generated lane declines it.
  // This stays distinct from `missing-producer` (lane admitted, host absent).
  expect(identityOf(meta, 'shadow-class')).toEqual({
    kind: 'lane-declined',
    reason: 'compiler-declined',
  });
  expect(meta['shadow-class']!.root).toBe('shadow');
});

test('the carrier is absent rather than invented for a record the scan did not produce', () => {
  expect(readGeneratedElementHost(undefined)).toBeUndefined();
  expect(readGeneratedElementHost({})).toBeUndefined();
});

test('dev rescan regenerates the carrier from the same scan (no stale identity)', async () => {
  const root = await project({ 'app/islands/live-card.tsx': SHADOW_GENERATED });
  process.chdir(root);
  const state = createOpenPluginState({ islandsDir: 'app/islands', routesDir: 'app/routes' });

  // buildStart() and the dev watcher's rescanIslands() share this one producer
  // (scanIslandsIntoCtx -> scanIslandMeta); ctx.reset() clears the previous
  // record, so a source edit cannot leave a stale host identity behind.
  await rescanIslands(state);
  expect(readGeneratedElementHost(state.ctx.phase1.islandMeta['live-card'])).toEqual({
    kind: 'producer',
    component: 'ProfileCard',
    ssrHostExport: expect.any(String),
  });

  await writeFile(join(root, 'app', 'islands', 'live-card.tsx'), LIGHT_GENERATED, 'utf8');
  await rescanIslands(state);
  expect(readGeneratedElementHost(state.ctx.phase1.islandMeta['live-card'])).toEqual({
    kind: 'light-producer',
    component: 'ProfileCard',
  });
});

test('an unexpected compiler failure propagates instead of being recorded as a refusal', async () => {
  // A crash is not a refusal: only the compiler error dialect is converted to
  // `lane-refused` data. The compiler module is mocked in isolation so the
  // real generated-host resolver is exercised without a second test file.
  vi.resetModules();
  vi.doMock('@openelement/compiler', () => ({
    compileGeneratedElementIfAdmitted: () => {
      throw new Error('injected compiler crash');
    },
    CompiledElementError: class InjectedCompiledElementError extends Error {},
  }));
  try {
    const isolated = await import('../src/vite/internal/ssg/generated-element-host-metadata.ts');
    expect(() =>
      isolated.resolveGeneratedElementHost({
        source: SHADOW_GENERATED,
        moduleId: 'app/islands/profile-card.tsx',
        filePath: 'profile-card.tsx',
        root: 'shadow',
        site: { tag: 'profile-card' },
      }),
    ).toThrow('injected compiler crash');
  } finally {
    vi.doUnmock('@openelement/compiler');
    vi.resetModules();
  }
});
