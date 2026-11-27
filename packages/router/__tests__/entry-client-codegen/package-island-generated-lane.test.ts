import { expect, test } from 'vitest';
import type { IslandDecl } from '@openelement/protocol/ssg';
import {
  clientEntryHasClientJs,
  clientEntryNeedsElementRuntime,
  generateClientEntry,
} from '../../src/vite/internal/ssg/entry-client-codegen.ts';
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

test('the package-island lane fact changes the factory shape, not the class bytes', () => {
  // Consumer form: the generated package island loses the executor-runtime wait
  // and builds its factory import-then-define, exactly like a local one.
  const generated = packageEntries({ kind: 'producer', component: 'OpenButton' });
  const entry = generateClientEntry(generated);
  expect(clientEntryNeedsElementRuntime(generated)).toBe(false);
  expect(clientEntryHasClientJs(generated)).toBe(true);
  expect(entry).not.toContain('__loadElementRuntime');
  expect(entry).toContain(
    `return import(${JSON.stringify(generated[0]!.modulePath)}).then(function (mod) {`,
  );
  // A carrierless package island keeps the runtime-waiting class-lane factory.
  const classLane = packageEntries();
  expect(clientEntryNeedsElementRuntime(classLane)).toBe(true);
  expect(generateClientEntry(classLane)).toContain('__loadElementRuntime');
});

test('a carrierless package island defers its runtime until activation', () => {
  const code = generateClientEntry(packageEntries());
  expect(code).toContain('Promise.all([__island, __loadElementRuntime()])');
  expect(code).not.toMatch(/^__loadElementRuntime\(\);/m);
});
