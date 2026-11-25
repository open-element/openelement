/**
 * M11 prerequisite consumer — the internal entry descriptor carries the
 * compiler-owned generated-host identity.
 *
 * The island scan (`scanIslandMeta`) resolves each local island's
 * `generatedElementHost` identity (`generated-element-host-metadata.ts`) from
 * the compiler's own `ssrHostExport` return value. Before this slice the fact
 * stopped at `phase1.islandMeta`; `buildEntryDescriptor` is the existing
 * internal carrier between the scan and `renderEntry`, so the identity is
 * re-attached there for every local island declaration (and every delivery
 * alias) through the one typed accessor — never a suffix scan, never a
 * namespace property lookup, never a cast.
 *
 * This slice deliberately changes NO generated entry bytes: no admission
 * verdict, no unused named import, no registration call. The public
 * `IslandDecl`/`EntryDescriptor` protocol types stay unchanged (the identity
 * is build-only runtime metadata on the declaration object). The approved
 * registration/renderer slice consumes this carrier next.
 */

import { expect, test } from 'vitest';
import type { IslandDecl } from '@openelement/protocol/ssg';
import type { RouteEntry } from '@openelement/protocol/framework';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';
import {
  type GeneratedElementHostCarrier,
  type GeneratedElementHostIdentity,
  readGeneratedElementHost,
} from '../src/vite/internal/ssg/generated-element-host-metadata.ts';

const routes: RouteEntry[] = [
  { path: '/', filePath: 'index.ts', type: 'page', varName: 'pageIndex' },
];

/** The scan-side metadata record type, with the additive build-only carrier. */
type ScannedIslandMeta = Record<string, Partial<IslandDecl> & GeneratedElementHostCarrier>;

function producer(
  component = 'ProfileCard',
  ssrHostExport = 'ProfileCard__ssrHost',
): GeneratedElementHostIdentity {
  return { kind: 'producer', component, ssrHostExport };
}

function buildLocalDescriptor(
  islandMeta: ScannedIslandMeta,
  tagName = 'profile-card',
): ReturnType<typeof buildEntryDescriptor> {
  return buildEntryDescriptor(routes, {
    islandTagNames: [tagName],
    islandFiles: [`${tagName}.tsx`],
    islandMeta,
  });
}

test('buildEntryDescriptor: re-attaches the scanner-resolved generated-host identity', () => {
  const identity = producer();
  const desc = buildLocalDescriptor({ 'profile-card': { generatedElementHost: identity } });

  expect(desc.islands.map((island) => island.tagName)).toEqual(['profile-card']);
  // The one typed read (no local cast, no suffix inference).
  expect(readGeneratedElementHost(desc.islands[0])).toEqual(identity);
  // The identity is the compiler-returned name, carried verbatim.
  expect(readGeneratedElementHost(desc.islands[0])).toMatchObject({
    kind: 'producer',
    ssrHostExport: 'ProfileCard__ssrHost',
  });
});

test('buildEntryDescriptor: every scan identity kind is carried verbatim, never collapsed', () => {
  const identities: GeneratedElementHostIdentity[] = [
    producer(),
    { kind: 'missing-producer', component: 'ShadowCard' },
    { kind: 'light-no-producer', component: 'LightCard' },
    { kind: 'lane-declined', reason: 'non-tsx' },
    { kind: 'lane-declined', reason: 'site-not-admitted' },
    { kind: 'lane-declined', reason: 'compiler-declined' },
    {
      kind: 'lane-refused',
      diagnostics: [
        {
          code: 'OEC1001',
          message: 'authored shadow descriptor is invalid',
          file: 'app/islands/profile-card.tsx',
          line: 4,
          character: 3,
        },
      ],
    },
  ];

  for (const identity of identities) {
    const desc = buildLocalDescriptor({ 'profile-card': { generatedElementHost: identity } });
    expect(readGeneratedElementHost(desc.islands[0]), identity.kind).toEqual(identity);
  }
});

test('buildEntryDescriptor: delivery aliases each carry the one identity (expansion preserves it)', () => {
  const identity = producer();
  // `tags` is the delivery-metadata field the scan records; the descriptor build
  // expands one declaration into one declaration per alias.
  const islandMeta = {
    'profile-card': {
      tags: ['profile-card', 'profile-card-alt'],
      generatedElementHost: identity,
    },
  } as unknown as ScannedIslandMeta;

  const desc = buildEntryDescriptor(routes, {
    islandTagNames: ['profile-card'],
    islandFiles: ['profile-card.tsx'],
    islandMeta,
  });

  expect(desc.islands.map((island) => island.tagName)).toEqual([
    'profile-card',
    'profile-card-alt',
  ]);
  for (const island of desc.islands) {
    expect(readGeneratedElementHost(island), island.tagName).toEqual(identity);
  }
});

test('buildEntryDescriptor: ssr:false keeps the identity (admission-independent) and entry bytes', () => {
  const identity = producer();
  const withCarrier = buildLocalDescriptor(
    { 'client-only-widget': { ssr: false, generatedElementHost: identity } },
    'client-only-widget',
  );
  const withoutCarrier = buildLocalDescriptor(
    { 'client-only-widget': { ssr: false } },
    'client-only-widget',
  );

  // The carrier is a build fact about the compiler lane, not an admission
  // decision: a client-only island still carries it.
  expect(readGeneratedElementHost(withCarrier.islands[0])).toEqual(identity);
  expect(withCarrier.ssrAdmissionPlan.renderableTags).toEqual([]);
  expect(withCarrier.ssrAdmissionPlan.clientOnlyTags).toEqual(['client-only-widget']);

  // ... and it changes no class/entry bytes: the client-only island stays out
  // of the SSR registry exactly as before.
  expect(renderEntry(withCarrier)).toBe(renderEntry(withoutCarrier));
  expect(renderEntry(withCarrier)).not.toContain('__registerSsrComponent("client-only-widget"');
  expect(renderEntry(withCarrier)).not.toContain('__island_client_only_widget');
});

test('buildEntryDescriptor: an ssr-admitted producer island emits the static host import', () => {
  const desc = buildLocalDescriptor({ 'profile-card': { generatedElementHost: producer() } });
  const code = renderEntry(desc);

  // The compiler-returned name is the static named import; the namespace import
  // stays because the class registration still needs the module's default.
  expect(code).toContain(
    'import { ProfileCard__ssrHost as __ssrhost_profile_card } from "/app/islands/profile-card.tsx"',
  );
  expect(code).toContain('import * as __island_profile_card from "/app/islands/profile-card.tsx"');
  // One owner: the pairing call replaces the class-only register call, and every
  // emitted host import is referenced by that call (no import-only residue).
  expect(code).toContain('  registerSsrIsland: __registerSsrIsland,');
  expect(code).toContain(
    '__registerSsrIsland("profile-card", __island_component_profile_card, __ssrhost_profile_card)',
  );
  expect(code.includes('__registerSsrComponent("profile-card"')).toBe(false);
  expect(code.match(/__ssrhost_profile_card/g)?.length).toBe(2);
  // The classification is the build fact, not a runtime convention: no suffix
  // scan, no namespace keys probe, no class static / module-shape read.
  expect(code).not.toContain('.endsWith(');
  expect(code).not.toContain('Object.keys(__island_');
  expect(code).not.toContain('customElements.get');
  expect(code).not.toContain('__partProgram');
  expect(code).not.toContain('__ssrHost"');
});

test('buildEntryDescriptor: client-only admission keeps the producer out of the entry', () => {
  // ssr:false keeps its admission verdict: the identity is carried but the
  // island is not ssr renderable, so the entry bytes stay byte-identical.
  const withCarrier = buildLocalDescriptor(
    { 'client-only-widget': { ssr: false, generatedElementHost: producer() } },
    'client-only-widget',
  );
  const withoutCarrier = buildLocalDescriptor(
    { 'client-only-widget': { ssr: false } },
    'client-only-widget',
  );
  expect(withCarrier.ssrAdmissionPlan.renderableTags).toEqual([]);
  expect(renderEntry(withCarrier)).toBe(renderEntry(withoutCarrier));
  expect(renderEntry(withCarrier)).not.toContain('__ssrhost_');
});

test('buildEntryDescriptor: no-producer identities keep the existing class-only bytes', () => {
  // A light root has no host producer by design and a lane-declined module is
  // not a generated host at all: both keep today's registration bytes.
  for (const identity of [
    { kind: 'light-no-producer', component: 'LightCard' },
    { kind: 'lane-declined', reason: 'non-tsx' },
    { kind: 'lane-declined', reason: 'compiler-declined' },
    {
      kind: 'lane-refused',
      diagnostics: [
        {
          code: 'OEC1001',
          message: 'x',
          file: 'app/islands/profile-card.tsx',
          line: 1,
          character: 1,
        },
      ],
    },
  ] satisfies GeneratedElementHostIdentity[]) {
    const withCarrier = buildLocalDescriptor({
      'profile-card': { generatedElementHost: identity },
    });
    const withoutCarrier = buildLocalDescriptor({ 'profile-card': {} });
    expect(renderEntry(withCarrier), identity.kind).toBe(renderEntry(withoutCarrier));
    expect(renderEntry(withCarrier)).toContain('__registerSsrComponent("profile-card"');
    expect(renderEntry(withCarrier)).not.toContain('__ssrhost_');
  }
});

test('explicit light SSR requires a render producer and uses the constructor when present', () => {
  const absent = { kind: 'light-no-producer', component: 'LightCard' } as const;
  const refused = buildLocalDescriptor({
    'profile-card': { generatedElementHost: absent, ssr: true },
  });
  expect(() => renderEntry(refused)).toThrow(
    expect.objectContaining({
      code: 'OE_DESCRIPTOR_MODULE_IMPORT',
      message: expect.stringContaining('no compiler-emitted render producer'),
    }),
  );
  const clientOnly = buildLocalDescriptor({
    'profile-card': { generatedElementHost: absent, ssr: false },
  });
  expect(renderEntry(clientOnly)).not.toContain('__island_profile_card');
  const supported = buildLocalDescriptor({
    'profile-card': {
      generatedElementHost: { kind: 'light-producer', component: 'LightCard' },
      ssr: true,
    },
  });
  expect(renderEntry(supported)).toContain('__registerSsrComponent("profile-card"');
});

test('buildEntryDescriptor: an ssr-admitted missing producer fails closed with the coded build refusal', () => {
  const desc = buildLocalDescriptor({
    'profile-card': { generatedElementHost: { kind: 'missing-producer', component: 'ShadowCard' } },
  });
  let thrown: unknown;
  try {
    renderEntry(desc);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  // Existing coded descriptor refusal — no new error-catalog code in this slice.
  expect((thrown as { code?: string }).code).toBe('OE_DESCRIPTOR_MODULE_IMPORT');
  expect(String((thrown as Error).message)).toContain('profile-card');
  expect(String((thrown as Error).message)).toContain('no compiler-emitted host producer');
});

test('buildEntryDescriptor: a forged non-identifier host export is refused at build', () => {
  const desc = buildLocalDescriptor({
    'profile-card': {
      generatedElementHost: { kind: 'producer', component: 'Card', ssrHostExport: 'not a name' },
    },
  });
  expect(() => renderEntry(desc)).toThrow(/not a valid JavaScript identifier/);
});

test('buildEntryDescriptor: non-local and carrier-less declarations expose no identity', () => {
  const local = buildEntryDescriptor(routes, {
    islandTagNames: ['my-counter'],
    islandFiles: ['my-counter.ts'],
    islandMeta: { 'my-counter': { ssr: true } },
  });
  expect(readGeneratedElementHost(local.islands[0])).toBeUndefined();

  const packaged = buildEntryDescriptor(routes, {
    packageManifests: [
      {
        schemaVersion: '1.0.0',
        packageName: '@acme/components',
        version: '0.17.0',
        declarations: [
          {
            tagName: 'open-layout',
            className: 'OpenLayout',
            openElement: { module: '@acme/components/open-layout', hydrate: 'load', ssr: true },
          },
        ],
      },
    ],
  });
  const packageIsland = packaged.islands.find((island) => island.tagName === 'open-layout');
  expect(packageIsland).toBeDefined();
  expect(readGeneratedElementHost(packageIsland)).toBeUndefined();
});

test('readGeneratedElementHost: absent metadata reads as undefined (no cast at call sites)', () => {
  expect(readGeneratedElementHost(undefined)).toBeUndefined();
  expect(readGeneratedElementHost({})).toBeUndefined();
  expect(readGeneratedElementHost({ tagName: 'profile-card' })).toBeUndefined();
});
