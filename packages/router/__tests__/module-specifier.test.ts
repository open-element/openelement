import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { fsPathToModuleSpecifier } from '../src/vite/internal/ssg/module-specifier.ts';
import { validateIslandModuleSpecifier } from '../src/vite/internal/ssg/entry-generators.ts';
import { scanIslands } from '../src/vite/internal/ssg/island-scanner.ts';
import { normalizeSeparators } from '@openelement/element/build-utils';

// #460: published starter builds rejected Windows island paths. These tests
// pin the path -> specifier conversion for both POSIX and Win32 input forms
// without needing a Windows host.

test('fsPathToModuleSpecifier keeps POSIX absolute paths unchanged', () => {
  expect(fsPathToModuleSpecifier('/home/u/proj/app/islands/counter.ts', '/home/u/proj')).toEqual(
    '/home/u/proj/app/islands/counter.ts',
  );
});

test('fsPathToModuleSpecifier rewrites Win32 paths under root as root-relative', () => {
  expect(
    fsPathToModuleSpecifier('C:\\Users\\u\\proj\\app\\islands\\counter.ts', 'C:\\Users\\u\\proj'),
  ).toEqual('/app/islands/counter.ts');
});

test('fsPathToModuleSpecifier accepts mixed separators and trailing root slash', () => {
  expect(
    fsPathToModuleSpecifier('C:/Users/u/proj/app/islands/nested\\deep.tsx', 'C:\\Users\\u\\proj\\'),
  ).toEqual('/app/islands/nested/deep.tsx');
});

test('fsPathToModuleSpecifier uses the Vite /@fs/ convention outside root', () => {
  expect(fsPathToModuleSpecifier('D:\\shared\\islands\\widget.ts', 'C:\\Users\\u\\proj')).toEqual(
    '/@fs/D:/shared/islands/widget.ts',
  );
});

test('validateIslandModuleSpecifier admits converted Win32 forms', () => {
  // Root-relative conversion output.
  validateIslandModuleSpecifier('/app/islands/counter.ts');
  // /@fs/ conversion output with a drive letter.
  validateIslandModuleSpecifier('/@fs/D:/shared/islands/widget.ts');
});

test('validateIslandModuleSpecifier still rejects raw Windows paths', () => {
  // Regression pin: the pre-fix build fed these straight into the validator.
  assertThrowsIncludes(
    () => validateIslandModuleSpecifier('C:\\Users\\u\\proj\\app\\islands\\counter.ts'),
    Error,
    'Invalid island modulePath',
  );
  assertThrowsIncludes(
    () => validateIslandModuleSpecifier('C:/Users/u/proj/app/islands/counter.ts'),
    Error,
    'Invalid island modulePath',
  );
});

test('normalizeSeparators turns scanned Win32 island segments into valid specifiers', () => {
  // scanIslands uses node:path join(), which emits backslashes on Windows.
  const scanned = 'posts\\archive\\counter.ts';
  const specifier = `/app/islands/${normalizeSeparators(scanned)}`;
  expect(specifier).toEqual('/app/islands/posts/archive/counter.ts');
  validateIslandModuleSpecifier(specifier);
});

test('scanIslands returns POSIX-separator relative paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'island-scan-'));
  try {
    await mkdir(`${root}/posts/archive`, { recursive: true });
    await writeFile(`${root}/counter.ts`, 'export {}');
    await writeFile(`${root}/posts/archive/deep.ts`, 'export {}');

    const files = await scanIslands(root);
    expect(files).toEqual(['counter.ts', 'posts/archive/deep.ts']);
    for (const file of files) {
      validateIslandModuleSpecifier(`/app/islands/${file}`);
    }
  } finally {
    await rm(root, { recursive: true });
  }
});
