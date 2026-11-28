import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('the seed attribute literal has exactly ONE owner (P6/P8 drift guard)', async () => {
  // The single source of the wire name is the DOM-free leaf. Both sides import
  // it; a quoted literal appearing anywhere else in `src/` means a second
  // hand-written copy is back, which is the C-1 defect class.
  const srcDir = new URL('../../src/', import.meta.url);
  const files = await walkTypeScript(srcDir);
  const quoted = /['"]data-oe-prop-seed['"]/;
  const offenders = files.filter((file) => quoted.test(file.source)).map((file) => file.path);
  expect(offenders).toEqual([
    'internal/compiled/generated-element/runtime-only-host-attributes.ts',
  ]);

  const byPath = new Map(files.map((file) => [file.path, file.source]));
  const claimSource = byPath.get('internal/compiled/runtime/claim-invariants.ts')!;
  expect(claimSource).toContain("from '../generated-element/runtime-only-host-attributes.ts'");
  const shellSource = byPath.get('internal/compiled/generated-element/shell.ts')!;
  expect(shellSource).toContain("from './runtime-only-host-attributes.ts'");
  expect(quoted.test(shellSource)).toBe(false);
});

interface SourceFile {
  path: string;
  source: string;
}

/** Recursively read every `.ts` file under `dir` (paths relative to `dir`). */
async function walkTypeScript(dir: URL, prefix = ''): Promise<SourceFile[]> {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dir, { withFileTypes: true });
  const files: SourceFile[] = [];
  for (const entry of entries) {
    const at = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) {
      files.push(...(await walkTypeScript(at, `${prefix}${entry.name}/`)));
    } else if (entry.name.endsWith('.ts')) {
      files.push({ path: `${prefix}${entry.name}`, source: await readFile(at, 'utf8') });
    }
  }
  return files;
}
