/**
 * The declared-tag provider (`internal/ssg/declared-element-tags.ts`), the
 * generated-element site resolver's second source.
 *
 * The provider turns authored sidecar tags into one `moduleId -> tag` map. It
 * must NOT become a second sidecar reader (it calls the island scan's
 * `readIslandConfig`) and must not invent a second traversal (it calls
 * `walkModuleGraph`). These rows pin the bounded behavior around those two
 * owned pieces:
 *
 * - a page-local component reached through an importing page is admitted;
 * - a module that declares no tag contributes nothing;
 * - a package-owned module contributes nothing (a manifest owns its identity);
 * - island modules contribute nothing (the path convention owns them and the
 *   island scan refuses a disagreeing declaration, so an entry here would be a
 *   second parse of a file it already read);
 * - an unparseable sidecar is REPORTED as a note, never dropped silently;
 * - a truncated walk is reported.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath, extname } from 'node:path';
import { statSync } from 'node:fs';
import { afterEach, expect, test } from 'vitest';
import { scanDeclaredElementTags } from '../src/vite/internal/ssg/declared-element-tags.ts';
import type { ModuleWalkResolver } from '../src/vite/internal/module-graph-walk.ts';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function write(root: string, path: string, source: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
}

/** Relative-specifier resolver double (production resolution is the bundler's). */
function resolverFor(): ModuleWalkResolver {
  const extensions = ['.tsx', '.ts', '.jsx', '.js'];
  const probe = (base: string): string | undefined => {
    const candidates = extname(base) ? [base] : extensions.map((extension) => base + extension);
    for (const candidate of candidates) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // keep probing
      }
    }
    return undefined;
  };
  return {
    resolve(specifier: string, importer?: string) {
      if (!specifier.startsWith('.') || importer === undefined) return Promise.resolve(null);
      const id = probe(resolvePath(dirname(importer), specifier));
      return Promise.resolve(id === undefined ? null : { id });
    },
  };
}

const SIDECAR = (tag: string): string =>
  "import { defineIslandConfig } from '@openelement/router';\n" +
  `export const openElement = defineIslandConfig({ tag: '${tag}' });\n`;

const COMPONENT = (tag: string): string =>
  `${SIDECAR(tag)}function Panel() {\n  return <section><slot></slot></section>;\n}\nexport default Panel;\n`;

test('reads a page-local component reached through its importing page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-declared-tags-'));
  roots.push(root);
  await write(
    root,
    'app/routes/index.tsx',
    "import '../site-ui/open-artifact-panel.tsx';\n" +
      'export default function Page() {\n  return <main><open-artifact-panel></open-artifact-panel></main>;\n}\n',
  );
  await write(root, 'app/site-ui/open-artifact-panel.tsx', COMPONENT('open-artifact-panel'));

  const scanned = await scanDeclaredElementTags({
    root,
    resolve: resolverFor(),
    seeds: [join(root, 'app/routes/index.tsx')],
  });

  expect([...scanned.tags.entries()]).toEqual([
    ['app/site-ui/open-artifact-panel.tsx', 'open-artifact-panel'],
  ]);
  expect(scanned.notes).toEqual([]);
});

test('a module that declares no tag contributes nothing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-declared-tags-'));
  roots.push(root);
  await write(
    root,
    'app/routes/index.tsx',
    "import '../site-ui/no-tag.tsx';\nimport '../site-ui/plain.tsx';\nexport default function Page() {\n  return <main></main>;\n}\n",
  );
  await write(
    root,
    'app/site-ui/no-tag.tsx',
    "import { defineIslandConfig } from '@openelement/router';\n" +
      "export const openElement = defineIslandConfig({ hydrate: 'idle' });\n" +
      'function Panel() {\n  return <section></section>;\n}\nexport default Panel;\n',
  );
  await write(root, 'app/site-ui/plain.tsx', 'export const value = 1;\n');

  const scanned = await scanDeclaredElementTags({
    root,
    resolve: resolverFor(),
    seeds: [join(root, 'app/routes/index.tsx')],
  });
  expect(scanned.tags.size).toBe(0);
  expect(scanned.notes).toEqual([]);
});

test('a module outside the app root contributes nothing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-declared-tags-'));
  roots.push(root);
  await write(
    root,
    'app/routes/index.tsx',
    'export default function Page() {\n  return <main></main>;\n}\n',
  );
  // The resolver answers a module outside the root (a linked package path).
  const outside = join(root, '..', '..', 'package-owned-panel.tsx');
  const scanned = await scanDeclaredElementTags({
    root,
    resolve: { resolve: () => Promise.resolve({ id: outside }) },
    seeds: [join(root, 'app/routes/index.tsx')],
  });
  expect(scanned.tags.size).toBe(0);
});

test('an unparseable sidecar is reported, never silently dropped', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-declared-tags-'));
  roots.push(root);
  await write(
    root,
    'app/routes/index.tsx',
    "import '../site-ui/broken.tsx';\nexport default function Page() {\n  return <main></main>;\n}\n",
  );
  await write(
    root,
    'app/site-ui/broken.tsx',
    "import { defineIslandConfig } from '@openelement/router';\n" +
      'export const openElement = defineIslandConfig({ tag: configuredTag });\n' +
      'function Panel() {\n  return <section></section>;\n}\nexport default Panel;\n',
  );

  const scanned = await scanDeclaredElementTags({
    root,
    resolve: resolverFor(),
    seeds: [join(root, 'app/routes/index.tsx')],
  });
  expect(scanned.tags.size).toBe(0);
  expect(scanned.notes.map((note) => note.code)).toContain('OE_DECLARED_TAG_SIDECAR_UNREADABLE');
  expect(scanned.notes[0]!.file).toBe(join(root, 'app/site-ui/broken.tsx'));
});

test('a truncated walk is reported rather than read as a complete map', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-declared-tags-'));
  roots.push(root);
  await write(
    root,
    'app/routes/index.tsx',
    "import '../site-ui/open-artifact-panel.tsx';\nexport default function Page() {\n  return <main></main>;\n}\n",
  );
  await write(root, 'app/site-ui/open-artifact-panel.tsx', COMPONENT('open-artifact-panel'));

  const scanned = await scanDeclaredElementTags({
    root,
    resolve: resolverFor(),
    seeds: [join(root, 'app/routes/index.tsx')],
    maxModules: 1,
  });
  // The walk's bound is reported, never read as "this app declares nothing";
  // the map is what the bound allowed.
  expect(scanned.notes.map((note) => note.code)).toContain('OE_DECLARED_TAG_MODULE_BOUND_EXCEEDED');
  expect(scanned.tags.size).toBeLessThanOrEqual(1);
});

test('a seed the app no longer has is skipped, not reported as unreadable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-declared-tags-'));
  roots.push(root);
  const scanned = await scanDeclaredElementTags({
    root,
    resolve: resolverFor(),
    seeds: [join(root, 'app/routes/gone.tsx')],
  });
  expect(scanned.tags.size).toBe(0);
  expect(scanned.notes).toEqual([]);
});
