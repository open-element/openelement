/**
 * Guard for the pre-paint theme boot generator.
 *
 * The artifact `www/public/theme-init.js` is a tracked classic script derived
 * from `packages/ui/src/theme-contract.ts`. Two properties keep that derivation
 * honest and both are pinned here:
 *
 *   determinism — the same contract renders the same bytes on every machine,
 *     so `--check` means something (a timestamp or machine path would make the
 *     byte comparison vacuous or unreproducible);
 *   fail-closed inputs — a contract that stopped being import-free, that has a
 *     syntax error, or that stopped EXPORTING the functions the shell calls,
 *     must throw instead of emitting a boot script that cannot work. The three
 *     negative cases are the holes a top-level scan, a diagnostic-free
 *     transpile and a substring `includes()` used to leave open; the last test
 *     runs the generator's output, so the positive path proves the artifact
 *     actually boots a document instead of merely being text.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { expect, test } from 'vitest';
import { renderThemeInit } from './generate-theme-init.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

async function tempRoot(contractSource: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'theme-init-'));
  await mkdir(join(root, 'packages/ui/src'), { recursive: true });
  await writeFile(join(root, 'packages/ui/src/theme-contract.ts'), contractSource);
  return root;
}

interface FakeDocumentRoot {
  style: { colorScheme?: string };
  dataset: Record<string, string>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

interface FakeDocument {
  attributes: Map<string, string>;
  documentElement: FakeDocumentRoot;
}

function makeFakeDocument(): FakeDocument {
  const attributes = new Map<string, string>();
  return {
    attributes,
    documentElement: {
      style: {},
      dataset: {},
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => {
        attributes.set(name, value);
      },
    },
  };
}

/** Parse the artifact exactly as a classic <script> (a module construct would
 * throw here), then execute it against a fake document. */
function bootArtifact(artifact: string, document: FakeDocument, saved: string | null): void {
  new Script(artifact).runInNewContext({
    document,
    localStorage: { getItem: (key: string) => (key === 'open-theme' ? saved : null) },
    matchMedia: () => ({ matches: false }),
  });
}

test('renders byte-identical output on every run', async () => {
  const first = await renderThemeInit(repoRoot);
  const second = await renderThemeInit(repoRoot);
  expect(second).toBe(first);
  expect(first).toContain('GENERATED FILE');
  // One write site for the seam attribute survives in the derived script.
  expect((first.match(/setAttribute\('data-theme'/g) ?? []).length).toBe(1);
  // No machine-dependent paths: the artifact is reproducible on any checkout.
  expect(first).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\\\/);
});

test('runs as a classic script: the generated artifact boots the document theme', async () => {
  const artifact = await renderThemeInit(repoRoot);

  const savedLight = makeFakeDocument();
  bootArtifact(artifact, savedLight, 'light');
  expect(savedLight.attributes.get('data-theme')).toBe('light');
  expect(savedLight.documentElement.style.colorScheme).toBe('light');
  expect(savedLight.documentElement.dataset.themeInit).toBe('1');

  // An unrecognised saved value falls back to the documented dark default.
  const garbage = makeFakeDocument();
  bootArtifact(artifact, garbage, 'legacy-truthy-garbage');
  expect(garbage.attributes.get('data-theme')).toBe('dark');
  expect(garbage.documentElement.style.colorScheme).toBe('dark');
});

test('refuses a contract that stopped being import-free', async () => {
  const root = await tempRoot(
    "import { helper } from './helper.ts';\nexport function resolveSiteTheme() { return helper(); }\nexport function applyDocumentTheme() { return true; }\n",
  );
  await expect(renderThemeInit(root)).rejects.toThrow(/import-free/);
});

test('refuses a contract with a dynamic import() (whole-tree scan, not top-level only)', async () => {
  const root = await tempRoot(
    "export const THEME_STORAGE_KEY = 'open-theme';\n" +
      'export async function resolveSiteTheme(saved: string | null, prefersLight: boolean) {\n' +
      "  const helper = await import('./helper.ts');\n" +
      '  return helper.resolve(saved, prefersLight);\n' +
      '}\n' +
      'export function applyDocumentTheme(root: unknown, theme: string) { return true; }\n',
  );
  await expect(renderThemeInit(root)).rejects.toThrow(/import-free.*dynamic import/);
});

test('refuses a contract with a syntax error instead of transpiling partial output', async () => {
  const root = await tempRoot(
    "export const THEME_STORAGE_KEY = 'open-theme';\n" +
      'export function resolveSiteTheme(saved: string | null {\n' +
      '  return saved;\n' +
      '}\n' +
      'export function applyDocumentTheme(root: unknown, theme: string) { return true; }\n',
  );
  await expect(renderThemeInit(root)).rejects.toThrow(/syntax error/);
});

test('ignores loader-looking text in comments (AST scan, not a string search)', async () => {
  const root = await tempRoot(
    "// require('./helper') and import('./helper') appear here as prose only.\n" +
      "export const THEME_STORAGE_KEY = 'open-theme';\n" +
      'export function resolveSiteTheme(saved: string | null, prefersLight: boolean) {\n' +
      "  return prefersLight ? 'light' : 'dark';\n" +
      '}\n' +
      'export function applyDocumentTheme(root: unknown, theme: string) { return true; }\n',
  );
  await expect(renderThemeInit(root)).resolves.toContain('GENERATED FILE');
});

test('refuses symbols that are declared but not exported (includes() is not an export check)', async () => {
  const root = await tempRoot(
    "export const THEME_STORAGE_KEY = 'open-theme';\n" +
      'function resolveSiteTheme(saved: string | null, prefersLight: boolean) {\n' +
      "  return prefersLight ? 'light' : 'dark';\n" +
      '}\n' +
      'function applyDocumentTheme(root: unknown, theme: string) { return true; }\n',
  );
  await expect(renderThemeInit(root)).rejects.toThrow(/vacuous.*resolveSiteTheme/);
});

test('refuses a contract that no longer exports the shell symbols (anti-vacuity)', async () => {
  const root = await tempRoot('export const THEME_STORAGE_KEY = "open-theme";\n');
  await expect(renderThemeInit(root)).rejects.toThrow(/vacuous/);
});
