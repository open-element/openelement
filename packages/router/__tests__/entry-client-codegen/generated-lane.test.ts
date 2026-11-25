import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import type { IslandDecl } from '@openelement/protocol/ssg';
import {
  clientEntryHasClientJs,
  clientEntryNeedsElementRuntime,
  generateClientEntry,
} from '../../src/vite/internal/ssg/entry-client-codegen.ts';
import { buildClientIslandEntries } from '../../src/vite/internal/ssg/client-island-entries.ts';
import type { ClientIslandDeliveryEntry } from '../../src/vite/internal/ssg/delivery.ts';
import {
  GENERATED_LANE_OWNED_KINDS,
  ownsGeneratedLaneKind,
  type GeneratedElementHostIdentity,
} from '../../src/vite/internal/ssg/generated-element-host-metadata.ts';
import {
  classifyPageModule,
  type PageModuleFacts,
} from '../../src/vite/internal/ssg/page-classification.ts';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** One scan-shaped local-island metadata record carrying a generated-lane fact. */
function islandMeta(generatedElementHost?: {
  readonly kind: string;
  readonly component: string;
}): Record<string, Partial<IslandDecl>> {
  if (generatedElementHost === undefined) return { 'gen-page': {} };
  return {
    'gen-page': { generatedElementHost } as unknown as Partial<IslandDecl>,
  };
}

function generatedEntries(
  kind: 'producer' | 'missing-producer' | 'light-producer' | 'light-no-producer' = 'producer',
): ClientIslandDeliveryEntry[] {
  return buildClientIslandEntries({
    root: '/proj',
    islandsDir: 'app/islands',
    islandTagNames: ['gen-page'],
    islandFiles: ['gen-page.tsx'],
    islandMeta: islandMeta({ kind, component: 'GenPage' }),
    packageIslandDecls: [],
    compilerBehaviorDecls: [],
  });
}

function classEntries(): ClientIslandDeliveryEntry[] {
  return buildClientIslandEntries({
    root: '/proj',
    islandsDir: 'app/islands',
    islandTagNames: ['class-card'],
    islandFiles: ['class-card.tsx'],
    islandMeta: islandMeta(),
    packageIslandDecls: [],
    compilerBehaviorDecls: [],
  });
}

test('buildClientIslandEntries propagates the generated lane fact from the scan carrier', () => {
  for (const kind of [
    'producer',
    'missing-producer',
    'light-producer',
    'light-no-producer',
  ] as const) {
    const [entry] = generatedEntries(kind);
    expect(entry?.generatedLane, kind).toBe(true);
  }
  // A class-lane island (no generated host identity) carries no lane fact.
  const [classIsland] = classEntries();
  expect(classIsland?.generatedLane).toBeUndefined();
});

test('generated-only entry keeps its factories but never waits for the executor runtime', () => {
  const entries = generatedEntries();
  const entry = generateClientEntry(entries);
  expect(clientEntryNeedsElementRuntime(entries)).toBe(false);
  expect(clientEntryHasClientJs(entries)).toBe(true);
  // The entry is not the island-free/style-only placeholder.
  expect(entry).not.toContain('no client islands');
  // No executor runtime loader or element-services dynamic import.
  expect(entry).not.toContain('__loadElementRuntime');
  expect(entry).not.toContain('element-services');
  expect(entry).not.toContain('registerGlobalStyles');
  // The generated factory is import-then-define, no Promise.all runtime wait.
  const generatedPath = entries[0]!.modulePath;
  expect(entry).toContain(`return import(${JSON.stringify(generatedPath)}).then(function (mod) {`);
  // Strategy scheduling still exists: the island activates on its strategy.
  expect(entry).toContain('createIslandScheduler');
  expect(entry).toContain('"gen-page": function () {');
});

test('class-only entry keeps the executor-runtime factory and its measured ABI bytes', () => {
  // The ABI pin below is the class-only entry emitted before the lane fact
  // landed; it is one guardrail, not the whole assertion (structural checks
  // below catch an intentional shape change that would make the hash stale).
  const baselineInput = [
    {
      tagName: 'class-card',
      modulePath: '/abs/app/islands/class-card.tsx',
      strategy: 'load' as const,
    },
  ];
  const code = generateClientEntry(baselineInput);
  expect(sha256(code)).toBe('929dbd80514dd613ebbf453f740cae12fa4762ada3d38c0270b377cf49485c92');
  expect(code).toContain('var __elementRuntimePromise = null;');
  expect(code).toContain('__loadElementRuntime');
  expect(code).toContain('var __island = import("/abs/app/islands/class-card.tsx");');
  expect(code).toContain('Promise.all([__island, __loadElementRuntime()])');
});

test('a mixed page waits for the runtime only in its class-lane factories', () => {
  const classIsland: ClientIslandDeliveryEntry = {
    tagName: 'class-card',
    modulePath: '/abs/app/islands/class-card.tsx',
    strategy: 'load',
  };
  const generated = generatedEntries()[0]!;
  const mixed = [classIsland, ...generatedEntries()];
  const entry = generateClientEntry(mixed);
  expect(clientEntryNeedsElementRuntime(mixed)).toBe(true);
  expect(entry).toContain('__loadElementRuntime');
  expect(entry).toContain('var __island = import("/abs/app/islands/class-card.tsx");');
  expect(entry).toContain('Promise.all([__island, __loadElementRuntime()])');
  expect(entry).toContain(
    `return import(${JSON.stringify(generated.modulePath)}).then(function (mod) {`,
  );
});

test('a generated island with hydrate:none stays zero-client-JS', () => {
  const entries = buildClientIslandEntries({
    root: '/proj',
    islandsDir: 'app/islands',
    islandTagNames: ['gen-page'],
    islandFiles: ['gen-page.tsx'],
    islandMeta: islandMeta({ kind: 'producer', component: 'GenPage' }),
    packageIslandDecls: [],
    compilerBehaviorDecls: [],
  });
  // hydrate:none is materialized by the scanner strategy; model it directly for
  // the zero-JS shape (the lane fact is orthogonal to the strategy).
  const noneEntry = { ...entries[0]!, strategy: 'none' as const };
  const entry = generateClientEntry([noneEntry]);
  expect(clientEntryHasClientJs([noneEntry])).toBe(false);
  expect(entry).toContain('All islands are hydrate:none');
});

// ─── M-4a: ONE generated-lane verdict, two consumers, drift guard ───────────

// .../packages/router/__tests__/entry-client-codegen -> repository root
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ROUTER_SRC = resolve(REPO_ROOT, 'packages/router/src');
const LANE_VERDICT_OWNER = resolve(
  ROUTER_SRC,
  'vite/internal/ssg/generated-element-host-metadata.ts',
);

/** The owned kinds (the one verdict's vocabulary). */
const OWNED_KINDS = [
  'producer',
  'missing-producer',
  'light-producer',
  'light-no-producer',
] as const;

/** The same kinds as source literals — the drift-guard scan input. */
const OWNED_KIND_LITERALS = OWNED_KINDS.map((kind) => `'${kind}'`);

/** Every `.ts` file under one directory tree. */
function routerSources(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...routerSources(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

/**
 * The smallest source span that holds all owned-kind literals, or
 * `undefined` when the file does not mention every kind. A duplicated kind
 * LIST (an owned-kind `Set`/array, or an OR-chain of `kind === …` tests) puts
 * the literals tens of characters apart; a legitimate `switch` over the
 * identity union mentions them across hundreds-to-thousands of characters
 * (see the anti-vacuity assertion in the guard below).
 */
function ownedKindLiteralSpan(source: string): number | undefined {
  const positions = OWNED_KIND_LITERALS.flatMap((literal) => {
    const hits: Array<{ literal: string; at: number }> = [];
    for (let at = source.indexOf(literal); at >= 0; at = source.indexOf(literal, at + 1)) {
      hits.push({ literal, at });
    }
    return hits;
  }).sort((left, right) => left.at - right.at);
  let smallest: number | undefined;
  const width = OWNED_KIND_LITERALS.length;
  for (let index = 0; index + width <= positions.length; index += 1) {
    const window = positions.slice(index, index + width);
    if (new Set(window.map((hit) => hit.literal)).size !== OWNED_KIND_LITERALS.length) continue;
    const span = window[width - 1]!.at - window[0]!.at;
    if (smallest === undefined || span < smallest) smallest = span;
  }
  return smallest;
}

/** One full identity per kind of the compiler-owned union (exhaustive). */
function identityFor(kind: GeneratedElementHostIdentity['kind']): GeneratedElementHostIdentity {
  switch (kind) {
    case 'producer':
      return { kind, component: 'GenPage', ssrHostExport: 'GenPage__ssrHost' };
    case 'missing-producer':
    case 'light-producer':
    case 'light-no-producer':
      return { kind, component: 'GenPage' };
    case 'lane-declined':
      return { kind, reason: 'compiler-declined' };
    case 'lane-refused':
      return { kind, diagnostics: [] };
  }
}

const PAGE_FACTS: PageModuleFacts = {
  definePage: true,
  mdx: false,
  compiledElement: false,
  functionPage: undefined,
  pageArgument: undefined,
};

test('M-4a: the owned-kind verdict is ONE exported owner, with no second copy in router source', () => {
  // The set itself and its predicate agree, and the predicate is total over the
  // identity union (an absent carrier is never owned).
  expect([...GENERATED_LANE_OWNED_KINDS].sort()).toEqual([...OWNED_KINDS].sort());
  for (const kind of [
    'producer',
    'missing-producer',
    'light-producer',
    'light-no-producer',
  ] as const) {
    expect(ownsGeneratedLaneKind(kind), kind).toBe(true);
  }
  for (const kind of ['lane-declined', 'lane-refused'] as const) {
    expect(ownsGeneratedLaneKind(kind), kind).toBe(false);
  }
  expect(ownsGeneratedLaneKind(undefined)).toBe(false);

  // Drift guard: a second owned-kind LIST must not exist anywhere in
  // `packages/router/src` outside the identity owner. The owner's own set spans
  // ~40 characters; the two legitimate multi-kind readers
  // (`island-scanner.ts`, `entry-orchestrator.ts`) switch over the union and
  // mention the literals about 1,000 characters apart — far above the bound.
  const OWNED_LIST_MAX_SPAN = 400;
  const scanned = routerSources(ROUTER_SRC).map((file) => ({
    file,
    span: ownedKindLiteralSpan(readFileSync(file, 'utf8')),
  }));
  const ownerSpan = scanned.find((entry) => entry.file === LANE_VERDICT_OWNER)?.span;
  expect(ownerSpan, 'the identity owner must carry the one owned-kind list').toBeLessThan(
    OWNED_LIST_MAX_SPAN,
  );
  const secondLists = scanned
    .filter(
      (entry) =>
        entry.file !== LANE_VERDICT_OWNER &&
        entry.span !== undefined &&
        entry.span <= OWNED_LIST_MAX_SPAN,
    )
    .map((entry) => relative(REPO_ROOT, entry.file));
  expect(secondLists).toEqual([]);
  // Anti-vacuity, both halves: the scan visited the real router source tree,
  // and it still SEES a legitimate multi-kind reader outside the owner (a
  // `switch` over the identity union) — so "no second list" cannot pass by
  // scanning nothing.
  expect(scanned.length).toBeGreaterThan(100);
  const legitimateMultiKindReaders = scanned.filter(
    (entry) => entry.file !== LANE_VERDICT_OWNER && entry.span !== undefined,
  );
  expect(legitimateMultiKindReaders.length).toBeGreaterThan(0);

  // Name guard: the constant's name lives in the owner only; a renamed copy is
  // caught by the list-span guard above.
  const nameCopies = routerSources(ROUTER_SRC)
    .filter((file) => file !== LANE_VERDICT_OWNER)
    .filter((file) => readFileSync(file, 'utf8').includes('GENERATED_LANE_OWNED_KINDS'))
    .map((file) => relative(REPO_ROOT, file));
  expect(nameCopies).toEqual([]);

  // Both consumers read the ONE predicate; neither keeps a kind list of its own.
  for (const consumer of ['client-island-entries.ts', 'page-classification.ts']) {
    const source = readFileSync(resolve(ROUTER_SRC, 'vite/internal/ssg', consumer), 'utf8');
    expect(source, `${consumer} must consume the shared predicate`).toContain(
      'ownsGeneratedLaneKind',
    );
    expect(source, `${consumer} must not declare the owned-kind set`).not.toContain(
      'GENERATED_LANE_OWNED_KINDS',
    );
  }
  // The old private copy in the client-entry builder is gone, not renamed.
  expect(
    readFileSync(resolve(ROUTER_SRC, 'vite/internal/ssg/client-island-entries.ts'), 'utf8'),
  ).not.toContain('light-no-producer');
});

test('M-4a: both consumers resolve every identity kind exactly as the ONE verdict says', () => {
  const kinds: GeneratedElementHostIdentity['kind'][] = [
    'producer',
    'missing-producer',
    'light-no-producer',
    'lane-declined',
    'lane-refused',
  ];
  for (const kind of kinds) {
    const owned = ownsGeneratedLaneKind(kind);

    // Consumer 1 (local branch): the client entry's lane fact.
    const [local] = buildClientIslandEntries({
      root: '/proj',
      islandsDir: 'app/islands',
      islandTagNames: ['gen-page'],
      islandFiles: ['gen-page.tsx'],
      islandMeta: {
        'gen-page': { generatedElementHost: identityFor(kind) } as unknown as Partial<IslandDecl>,
      },
      packageIslandDecls: [],
      compilerBehaviorDecls: [],
    });
    expect(local?.generatedLane === true, `local:${kind}`).toBe(owned);

    // Consumer 1 (package branch): the SAME verdict on the SAME predicate.
    const [packaged] = buildClientIslandEntries({
      root: '/proj',
      islandsDir: 'app/islands',
      islandTagNames: [],
      islandFiles: [],
      islandMeta: {},
      packageIslandDecls: [
        {
          tagName: 'gen-page',
          modulePath: '@acme/gen-page',
          source: 'package',
          exportName: 'GenPage',
          generatedElementHost: identityFor(kind),
        } as unknown as IslandDecl,
      ],
      compilerBehaviorDecls: [],
    });
    expect(packaged?.generatedLane === true, `package:${kind}`).toBe(owned);

    // Consumer 2 (page classification): the owning-lane membership test. An
    // owned kind claims the generated-element-page lane; the two refusal kinds
    // keep the legacy class-page answer.
    const classification = classifyPageModule(PAGE_FACTS, {
      filePath: 'gen-page.tsx',
      tagName: 'gen-page',
      generatedLaneKind: kind,
      generatedElementHost: identityFor(kind),
    });
    const classifiedOwned =
      classification.kind === 'unsupported-generated-page' ||
      (classification.kind === 'classified' &&
        classification.pageKind === 'generated-element-page');
    expect(classifiedOwned, `page:${kind}`).toBe(owned);
  }
});

// ─── M-4b: island declaration dedup includes the lane fact ──────────────────

test('M-4b: same tag and module on different lanes fails closed and names both sources', () => {
  // Only the lane differs: the lane fact decides whether the activation factory
  // waits for (and loads) the executor runtime, so these two declarations are
  // NOT interchangeable.
  const classLane: ClientIslandDeliveryEntry = {
    tagName: 'shared-card',
    modulePath: '/abs/app/islands/shared-card.tsx',
    strategy: 'idle',
  };
  const generatedLane: ClientIslandDeliveryEntry = {
    tagName: 'shared-card',
    modulePath: '/abs/app/islands/shared-card.tsx',
    strategy: 'idle',
    generatedLane: true,
  };

  // Order must not matter: neither declaration may win silently.
  for (const declarations of [
    [generatedLane, classLane],
    [classLane, generatedLane],
  ]) {
    let message = '';
    expect(() => {
      try {
        generateClientEntry(declarations);
      } catch (error) {
        message = (error as Error).message;
        throw error;
      }
    }, 'the conflict must fail the entry generation').toThrow(
      /Conflicting island capability declarations for shared-card/,
    );
    // Both sources are named with their lane and module identity — not just
    // the tag. A first-wins dedup would have produced an entry here.
    expect(message).toContain('generated-lane declaration');
    expect(message).toContain('class-lane declaration');
    expect(message).toContain('/abs/app/islands/shared-card.tsx');
    expect(message.split(' vs ')).toHaveLength(2);
  }

  // The runtime-lane question is fail-closed too: it is answered from the same
  // normalized declarations, so it cannot silently pick the first lane.
  expect(() => clientEntryNeedsElementRuntime([generatedLane, classLane])).toThrow(
    /Conflicting island capability declarations for shared-card/,
  );

  // Positive controls: declarations that AGREE on the lane still dedupe (the
  // guard is about disagreement, not a ban on repeated declarations).
  expect(() => generateClientEntry([classLane, classLane])).not.toThrow();
  expect(() => generateClientEntry([generatedLane, generatedLane])).not.toThrow();
  expect(clientEntryNeedsElementRuntime([generatedLane, generatedLane])).toBe(false);
});
