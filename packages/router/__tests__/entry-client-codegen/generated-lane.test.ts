import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import type { IslandDecl } from '@openelement/protocol/ssg';
import {
  clientEntryHasClientJs,
  clientEntryNeedsElementRuntime,
  generateClientEntry,
} from '../../src/vite/internal/ssg/entry-client-codegen.ts';
import { buildClientIslandEntries } from '../../src/vite/internal/ssg/client-island-entries.ts';
import type { ClientIslandDeliveryEntry } from '../../src/vite/internal/ssg/delivery.ts';

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
  kind: 'producer' | 'missing-producer' | 'light-no-producer' = 'producer',
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
  for (const kind of ['producer', 'missing-producer', 'light-no-producer'] as const) {
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
