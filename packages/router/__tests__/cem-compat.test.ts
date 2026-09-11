import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { join } from 'node:path';
import {
  detectAndClassifyCemPackages,
  scanCemManifests,
} from '../src/vite/internal/ssg/cem-scanner.ts';
import { classifyCemManifest, parseCem } from '../src/vite/internal/ssg/cem-compat.ts';

const manifest = (modules: unknown[], packageName?: string): string =>
  JSON.stringify({ schemaVersion: '1.0.0', packageName, version: '1.2.3', modules });

const moduleWith = (path: string, declarations: unknown[], exports: unknown[] = []): unknown => ({
  kind: 'javascript-module',
  path,
  declarations,
  exports,
});

const element = (tagName: string, openElement?: Record<string, unknown>): unknown => ({
  kind: 'custom-element',
  tagName,
  ...(openElement ? { openElement } : {}),
});

Deno.test('CEM parser fails closed for malformed roots, modules, declarations, and exports', () => {
  assertEquals(parseCem('{broken').errors[0].code, 'CEM_PARSE_ERROR');
  assertEquals(parseCem('[]').errors[0].code, 'CEM_INVALID_ROOT');
  assertEquals(parseCem('{}').errors[0].code, 'CEM_NO_MODULES');

  const result = parseCem(JSON.stringify({
    modules: [
      null,
      {
        declarations: [
          { kind: 'class', name: 'Ignored' },
          { kind: 'custom-element' },
          element('Invalid'),
          element('duplicate-tag'),
          element('duplicate-tag'),
        ],
        exports: [{}, null],
      },
    ],
  }));
  assertEquals(result.success, false);
  assertEquals(result.manifest, undefined);
  assert(result.warnings.some((warning) => warning.code === 'CEM_NO_SCHEMA_VERSION'));
  assert(result.warnings.some((warning) => warning.code === 'CEM_MODULE_NO_KIND'));
  for (
    const code of [
      'CEM_MODULE_NO_PATH',
      'CEM_CE_NO_TAG_NAME',
      'CEM_CE_INVALID_TAG_NAME',
      'CEM_CE_DUPLICATE_TAG',
      'CEM_EXPORT_NO_DECLARATION',
    ]
  ) {
    assert(result.errors.some((error) => error.code === code), code);
  }
});

Deno.test('CEM classifier preserves conservative defaults and explicit delivery declarations', () => {
  const parsed = parseCem(manifest([
    moduleWith('./elements.js', [
      element('plain-element'),
      element('explicit-client', { ssr: false, hydrate: 'visible' }),
      element('missing-layer', { ssr: true }),
      element('server-element', {
        ssr: true,
        dsd: true,
        layer: 'third-party-adapter',
        hydrate: 'load',
      }),
      { kind: 'class', name: 'Ignored' },
    ], [{ declaration: { name: 'ServerElement' } }]),
  ], '@scope/components'));
  assertEquals(parsed.success, true);
  const classified = classifyCemManifest(parsed.manifest!);
  assertEquals(classified.stats, {
    totalComponents: 4,
    ssrCapableCount: 1,
    clientOnlyCount: 3,
    rejectedCount: 0,
    experimentalDomCount: 0,
  });
  assertEquals(classified.ssrCapableTags, ['server-element']);
  assertEquals(classified.clientOnlyTags, [
    'plain-element',
    'explicit-client',
    'missing-layer',
  ]);
  assertStringIncludes(classified.classifications[0].reason, '@scope/components');
  assertEquals(classified.classifications[1].hydrate, 'visible');
  assertStringIncludes(classified.classifications[2].reason, 'no adapter/layer');
  assertEquals(classified.classifications[3].dsd, true);

  // Classification remains fail-closed if a caller supplies an already-decoded
  // manifest containing a duplicate instead of using parseCem first.
  const duplicateManifest = parseCem(
    manifest([moduleWith('./a.js', [element('same-element')])]),
  ).manifest!;
  duplicateManifest.modules.push({
    path: './b.js',
    declarations: [...(duplicateManifest.modules[0].declarations ?? [])],
  });
  const duplicate = classifyCemManifest(duplicateManifest);
  assertEquals(duplicate.rejectedTags, ['same-element']);
  assertEquals(duplicate.stats.rejectedCount, 1);
});

Deno.test('CEM scanner discovers scoped and unscoped packages without executing them', async () => {
  const root = await Deno.makeTempDir({ prefix: 'oe-cem-' });
  try {
    await Deno.mkdir(join(root, 'plain'), { recursive: true });
    await Deno.mkdir(join(root, '@scope', 'package'), { recursive: true });
    await Deno.mkdir(join(root, '.cache'), { recursive: true });
    await Deno.mkdir(join(root, '@scope', '.hidden'), { recursive: true });
    await Deno.writeTextFile(
      join(root, 'plain', 'custom-elements.json'),
      manifest([moduleWith('./plain.js', [element('plain-element')])]),
    );
    await Deno.writeTextFile(
      join(root, '@scope', 'package', 'custom-elements.json'),
      manifest([
        moduleWith('./server.js', [
          element('server-element', { ssr: true, layer: 'adapter', hydrate: 'load' }),
        ]),
      ]),
    );

    const scanned = await scanCemManifests(root);
    assertEquals(scanned.map((entry) => entry.packageName).sort(), [
      '@scope/package',
      'plain',
    ]);
    const classified = await detectAndClassifyCemPackages(root);
    assertEquals(classified.map((entry) => entry.tagName).sort(), [
      'plain-element',
      'server-element',
    ]);

    await Deno.writeTextFile(join(root, 'plain', 'custom-elements.json'), '{bad');
    assertEquals(
      (await detectAndClassifyCemPackages(root)).map((entry) => entry.tagName),
      ['server-element'],
    );
    assertEquals(await scanCemManifests(join(root, 'missing')), []);
    assertEquals(await detectAndClassifyCemPackages(join(root, 'missing')), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
