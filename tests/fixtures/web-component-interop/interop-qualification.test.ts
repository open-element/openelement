import { expect, test } from 'vitest';
import { classifySsrCapability, loadInteropCorpus, validateCemManifest } from './qualify.ts';

const fixtureRoot = new URL('./', import.meta.url);

test('interop corpus covers the four framework origins and every required probe', async () => {
  const corpus = await loadInteropCorpus(fixtureRoot);

  expect(corpus.components.map((component) => component.framework)).toEqual([
    'native',
    'lit',
    'fast',
    'stencil',
  ]);
  for (const component of corpus.components) {
    expect(component.probes).toEqual([
      'property',
      'attribute',
      'event',
      'slot',
      'css-part',
      'root',
      'upgrade-order',
    ]);
    expect(component.placements).toEqual(['child', 'application-dependency']);
  }
});

test('interop qualification validates the regenerated CEM output and rejects malformed manifests', async () => {
  const corpus = await loadInteropCorpus(fixtureRoot);
  expect(validateCemManifest(corpus.cem)).toEqual([]);

  const malformed = structuredClone(corpus.cem) as unknown as Record<string, unknown>;
  malformed.modules = [];
  const diagnostics = validateCemManifest(malformed);
  expect(diagnostics.length > 0).toEqual(true);
  expect(diagnostics[0]).toContain('modules');
});

test('CEM validation fails closed for empty module paths and declaration names', async () => {
  const corpus = await loadInteropCorpus(fixtureRoot);

  const emptyPath = structuredClone(corpus.cem) as unknown as {
    modules: Array<{ path: string; declarations: Array<Record<string, unknown>> }>;
  };
  emptyPath.modules[0].path = '';
  const pathDiagnostics = validateCemManifest(emptyPath);
  expect(pathDiagnostics.some((diagnostic) => diagnostic.includes('.path'))).toEqual(true);

  const emptyName = structuredClone(corpus.cem) as unknown as {
    modules: Array<{ declarations: Array<Record<string, unknown>> }>;
  };
  emptyName.modules[0].declarations[0].name = '';
  const nameDiagnostics = validateCemManifest(emptyName);
  expect(nameDiagnostics.some((diagnostic) => diagnostic.includes('.name'))).toEqual(true);
});

test('unknown SSR capability fails closed to documented client-only behavior', () => {
  const result = classifySsrCapability('not-a-capability');

  expect(result.renderPath).toEqual('client-only');
  expect(result.code).toEqual('OEI2001');
  expect(result.message).toContain('client-only');
});

test('generated-host block covers every framework id and the host shape', async () => {
  const corpus = await loadInteropCorpus(fixtureRoot);
  const generatedHost = corpus.generatedHost;

  // The host is the real generated island's derived tag, not a component tag.
  expect(generatedHost.tag).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/);
  expect(generatedHost.tag).not.toBe(corpus.application.fixtureTag);
  for (const component of corpus.components) {
    expect(generatedHost.tag).not.toBe(component.tag);
  }

  // One generated-host placement id per canonical framework origin, in order,
  // with no duplicate DOM ids.
  expect(Object.keys(generatedHost.ids)).toEqual(['native', 'lit', 'fast', 'stencil']);
  const generatedIds = Object.values(generatedHost.ids);
  expect(new Set(generatedIds).size).toEqual(generatedIds.length);
  for (const component of corpus.components) {
    expect(generatedHost.ids[component.framework]).toMatch(/^generated-/);
  }
  expect(generatedIds).not.toContain(generatedHost.id);
  expect(generatedIds).not.toContain(generatedHost.lightCaptionId);
  expect(generatedIds).not.toContain(generatedHost.controlId);

  // The host-level probe facts the browser qualification asserts are declared
  // as corpus data, not duplicated as literals inside the harness.
  expect(generatedHost.captionSlotName.length > 0).toEqual(true);
  expect(generatedHost.controlPart.length > 0).toEqual(true);
  expect(generatedHost.hitsStateKey.length > 0).toEqual(true);
});
