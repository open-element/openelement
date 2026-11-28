import { expect, test } from 'vitest';
import { resolvePackageIslandProvider } from '../src/vite/internal/package-island-provider.ts';
import { resolveIslandModuleId } from '../src/vite/client-asset-manifest.ts';
import { createIslandActivationModules } from '../src/vite/internal/ssg/entry-client-codegen.ts';

const facadeId = '/node_modules/@proof/ui/entry.js';
const providerId = '/node_modules/@proof/ui/compiler-output.js';
const otherId = '/node_modules/@proof/ui/another-output.js';
const facade = {
  id: facadeId,
  code: `
    export { LocalButton as Button, LocalInput as Input } from './compiler-output.js';
    export { LocalDialog as Dialog } from './another-output.js';
    export const authoring = {};
  `,
  importedIds: [providerId, otherId],
};

const targets = new Map([
  ['./compiler-output.js', { id: providerId, exportNames: ['LocalButton', 'LocalInput'] }],
  ['./another-output.js', { id: otherId, exportNames: ['LocalDialog'] }],
]);

function resolveTarget(source: string, importer: string) {
  expect(importer).toBe(facadeId);
  return Promise.resolve(targets.get(source));
}

test.each([false, true])(
  'attributes the named provider with facade retained = %s',
  async (retained) => {
    const provider = await resolvePackageIslandProvider(facade, ['Button', 'Input'], resolveTarget);
    expect(provider).toBe(providerId);
    const chunks = new Map<string, string>([[providerId, 'compiled.js']]);
    if (retained) chunks.set(facadeId, 'authoring.js');
    expect(resolveIslandModuleId(chunks, '@proof/ui/entry', 'proof', provider)).toBe(providerId);
  },
);

test('refuses ambiguity, a different resolved edge, or a missing binding', async () => {
  await expect(
    resolvePackageIslandProvider(facade, ['Button', 'Dialog'], resolveTarget),
  ).resolves.toBeUndefined();
  await expect(
    resolvePackageIslandProvider({ ...facade, importedIds: [otherId] }, ['Button'], resolveTarget),
  ).resolves.toBeUndefined();
  await expect(
    resolvePackageIslandProvider(facade, ['Button'], () =>
      Promise.resolve({ id: providerId, exportNames: ['LocalInput'] }),
    ),
  ).resolves.toBeUndefined();
});

test('a retained facade is insufficient when its selected provider is absent', async () => {
  const provider = await resolvePackageIslandProvider(facade, ['Button'], resolveTarget);
  expect(provider).toBe(providerId);
  expect(() =>
    resolveIslandModuleId(
      new Map([[facadeId, 'authoring.js']]),
      '@proof/ui/entry',
      'proof',
      provider,
    ),
  ).toThrow('the emitted client graph carries no such module');
});

test('retains dynamic activation for generated packages that declare multiple tags', () => {
  const activation = createIslandActivationModules([
    {
      tagName: 'proof-button',
      modulePath: '@proof/ui/entry',
      isPackage: true,
      generatedLane: true,
      exportName: 'Button',
      strategy: 'load',
    },
    {
      tagName: 'proof-dialog',
      modulePath: '@proof/ui/entry',
      isPackage: true,
      generatedLane: true,
      exportName: 'Dialog',
      strategy: 'load',
    },
  ]);
  expect([...activation.values()]).toMatchObject([
    { direct: false, tags: ['proof-button', 'proof-dialog'] },
  ]);
});
