import { assertEquals, assertStringIncludes } from '@std/assert';
import { classifySsrCapability, loadInteropCorpus, validateCemManifest } from './qualify.ts';

const fixtureRoot = new URL('./', import.meta.url);

Deno.test('interop corpus covers the four framework origins and every required probe', async () => {
  const corpus = await loadInteropCorpus(fixtureRoot);

  assertEquals(corpus.components.map((component) => component.framework), [
    'native',
    'lit',
    'fast',
    'stencil',
  ]);
  for (const component of corpus.components) {
    assertEquals(component.probes, [
      'property',
      'attribute',
      'event',
      'slot',
      'css-part',
      'root',
      'upgrade-order',
    ]);
    assertEquals(component.placements, ['child', 'application-dependency']);
  }
});

Deno.test('interop qualification validates the regenerated CEM output and rejects malformed manifests', async () => {
  const corpus = await loadInteropCorpus(fixtureRoot);
  assertEquals(validateCemManifest(corpus.cem), []);

  const malformed = structuredClone(corpus.cem) as Record<string, unknown>;
  malformed.modules = [];
  const diagnostics = validateCemManifest(malformed);
  assertEquals(diagnostics.length > 0, true);
  assertStringIncludes(diagnostics[0], 'modules');
});

Deno.test('CEM validation fails closed for empty module paths and declaration names', async () => {
  const corpus = await loadInteropCorpus(fixtureRoot);

  const emptyPath = structuredClone(corpus.cem) as {
    modules: Array<{ path: string; declarations: Array<Record<string, unknown>> }>;
  };
  emptyPath.modules[0].path = '';
  const pathDiagnostics = validateCemManifest(emptyPath);
  assertEquals(pathDiagnostics.some((diagnostic) => diagnostic.includes('.path')), true);

  const emptyName = structuredClone(corpus.cem) as {
    modules: Array<{ declarations: Array<Record<string, unknown>> }>;
  };
  emptyName.modules[0].declarations[0].name = '';
  const nameDiagnostics = validateCemManifest(emptyName);
  assertEquals(nameDiagnostics.some((diagnostic) => diagnostic.includes('.name')), true);
});

Deno.test('unknown SSR capability fails closed to documented client-only behavior', () => {
  const result = classifySsrCapability('not-a-capability');

  assertEquals(result.renderPath, 'client-only');
  assertEquals(result.code, 'OEI2001');
  assertStringIncludes(result.message, 'client-only');
});
