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

test('buildEntryDescriptor: SSR-admitted island entry bytes are unchanged by the carrier', () => {
  const withCarrier = buildLocalDescriptor({
    'profile-card': { generatedElementHost: producer() },
  });
  const withoutCarrier = buildLocalDescriptor({ 'profile-card': {} });

  // Local islands default to the SSR path; the class registration is the
  // existing one, byte for byte — this slice emits no host import and no
  // third registration argument.
  expect(withCarrier.ssrAdmissionPlan.renderableTags).toEqual(['profile-card']);
  expect(renderEntry(withCarrier)).toBe(renderEntry(withoutCarrier));
  expect(renderEntry(withCarrier)).toContain('__registerSsrComponent("profile-card"');
  expect(renderEntry(withCarrier)).not.toContain('__island_host_');
  expect(renderEntry(withCarrier)).not.toContain('__ssrHost');
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
