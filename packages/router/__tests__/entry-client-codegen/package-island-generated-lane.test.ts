import { expect, test } from 'vitest';
import type { IslandDecl } from '@openelement/protocol/ssg';
import { generateClientEntry } from '../../src/vite/internal/ssg/entry-client-codegen.ts';
import { buildClientIslandEntries } from '../../src/vite/internal/ssg/client-island-entries.ts';
import type { ClientIslandDeliveryEntry } from '../../src/vite/internal/ssg/delivery.ts';

type Carrier = { readonly kind: string; readonly component: string };

/**
 * Package-island branch: `buildPackageIslandDecls` (manifest declarations) and
 * `attachPackageIslandHostIdentities` (the scan's resolution) both hang the
 * compiler-owned `generatedElementHost` carrier on the `IslandDecl`. The branch
 * must read the SAME single verdict the local branch reads — before the fix it
 * never set the lane fact, so every `@openelement/ui` island was delivered as
 * class-lane and kept the full executor runtime alive.
 */
function packageEntries(carrier?: Carrier): ClientIslandDeliveryEntry[] {
  const decl = {
    tagName: 'op-button',
    modulePath: '@openelement/ui/open-button',
    source: 'package',
    exportName: 'OpenButton',
    hydrate: 'load',
    ...(carrier === undefined ? {} : { generatedElementHost: carrier }),
  } as unknown as IslandDecl;
  return buildClientIslandEntries({
    root: '/proj',
    islandsDir: 'app/islands',
    islandTagNames: [],
    islandFiles: [],
    islandMeta: {},
    packageIslandDecls: [decl],
    compilerBehaviorDecls: [],
  });
}

test('package-island branch propagates the generated lane fact from the same carrier', () => {
  for (const kind of ['producer', 'missing-producer', 'light-no-producer'] as const) {
    const [entry] = packageEntries({ kind, component: 'OpenButton' });
    expect(entry?.isPackage, kind).toBe(true);
    expect(entry?.generatedLane, kind).toBe(true);
  }
});

test('a package island the generated lane did not own carries no lane fact', () => {
  for (const kind of ['lane-declined', 'lane-refused'] as const) {
    const [entry] = packageEntries({ kind, component: 'OpenButton' });
    expect(entry?.generatedLane, kind).toBeUndefined();
  }
  // No carrier at all (a declaration the scan could not resolve) keeps the
  // class-lane delivery: absence of the fact is never read as generated.
  const [plain] = packageEntries();
  expect(plain?.generatedLane).toBeUndefined();
});

test('package island metadata does not require a separate runtime loader', () => {
  const generated = packageEntries({ kind: 'producer', component: 'OpenButton' });
  const foreign = packageEntries();
  const code = generateClientEntry(foreign);
  expect(code).toBe(generateClientEntry(generated));
  expect(code).toContain('var Ctor = mod["OpenButton"]');
  expect(code).not.toContain('__loadElementRuntime');
});
