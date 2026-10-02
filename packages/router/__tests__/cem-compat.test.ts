import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { join } from '@std/path';
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

test('CEM parser fails closed for malformed roots, modules, declarations, and exports', () => {
  expect(parseCem('{broken').errors[0].code).toEqual('CEM_PARSE_ERROR');
  expect(parseCem('[]').errors[0].code).toEqual('CEM_INVALID_ROOT');
  expect(parseCem('{}').errors[0].code).toEqual('CEM_NO_MODULES');

  const result = parseCem(
    JSON.stringify({
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
    }),
  );
  expect(result.success).toEqual(false);
  expect(result.manifest).toEqual(undefined);
  expect(result.warnings.some((warning) => warning.code === 'CEM_NO_SCHEMA_VERSION')).toBeTruthy();
  expect(result.warnings.some((warning) => warning.code === 'CEM_MODULE_NO_KIND')).toBeTruthy();
  for (const code of [
    'CEM_MODULE_NO_PATH',
    'CEM_CE_NO_TAG_NAME',
    'CEM_CE_INVALID_TAG_NAME',
    'CEM_CE_DUPLICATE_TAG',
    'CEM_EXPORT_NO_DECLARATION',
  ]) {
    expect(
      result.errors.some((error) => error.code === code),
      code,
    ).toBeTruthy();
  }
});

test('CEM classifier preserves conservative defaults and explicit delivery declarations', () => {
  const parsed = parseCem(
    manifest(
      [
        moduleWith(
          './elements.js',
          [
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
          ],
          [{ declaration: { name: 'ServerElement' } }],
        ),
      ],
      '@scope/components',
    ),
  );
  expect(parsed.success).toEqual(true);
  const classified = classifyCemManifest(parsed.manifest!);
  expect(classified.stats).toEqual({
    totalComponents: 4,
    ssrCapableCount: 1,
    clientOnlyCount: 3,
    rejectedCount: 0,
    experimentalDomCount: 0,
  });
  expect(classified.ssrCapableTags).toEqual(['server-element']);
  expect(classified.clientOnlyTags).toEqual(['plain-element', 'explicit-client', 'missing-layer']);
  expect(classified.classifications[0].reason).toContain('@scope/components');
  expect(classified.classifications[1].hydrate).toEqual('visible');
  expect(classified.classifications[2].reason).toContain('no adapter/layer');
  expect(classified.classifications[3].dsd).toEqual(true);

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
  expect(duplicate.rejectedTags).toEqual(['same-element']);
  expect(duplicate.stats.rejectedCount).toEqual(1);
});

test('CEM scanner discovers scoped and unscoped packages without executing them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-cem-'));
  try {
    await mkdir(join(root, 'plain'), { recursive: true });
    await mkdir(join(root, '@scope', 'package'), { recursive: true });
    await mkdir(join(root, '.cache'), { recursive: true });
    await mkdir(join(root, '@scope', '.hidden'), { recursive: true });
    await writeFile(
      join(root, 'plain', 'custom-elements.json'),
      manifest([moduleWith('./plain.js', [element('plain-element')])]),
    );
    await writeFile(
      join(root, '@scope', 'package', 'custom-elements.json'),
      manifest([
        moduleWith('./server.js', [
          element('server-element', { ssr: true, layer: 'adapter', hydrate: 'load' }),
        ]),
      ]),
    );

    const scanned = await scanCemManifests(root);
    expect(scanned.map((entry) => entry.packageName).sort()).toEqual(['@scope/package', 'plain']);
    const classified = await detectAndClassifyCemPackages(root);
    expect(classified.map((entry) => entry.tagName).sort()).toEqual([
      'plain-element',
      'server-element',
    ]);

    await writeFile(join(root, 'plain', 'custom-elements.json'), '{bad');
    expect((await detectAndClassifyCemPackages(root)).map((entry) => entry.tagName)).toEqual([
      'server-element',
    ]);
    expect(await scanCemManifests(join(root, 'missing'))).toEqual([]);
    expect(await detectAndClassifyCemPackages(join(root, 'missing'))).toEqual([]);
  } finally {
    await rm(root, { recursive: true });
  }
});
