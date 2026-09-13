import { assertEquals, assertThrows } from '@std/assert';
import { fsPathToModuleSpecifier } from '../src/vite/internal/ssg/module-specifier.ts';
import { validateIslandModuleSpecifier } from '../src/vite/internal/ssg/entry-generators.ts';
import { scanIslands } from '../src/vite/internal/ssg/island-scanner.ts';
import { normalizeSeparators } from '@openelement/element/build-utils';

// #460: published starter builds rejected Windows island paths. These tests
// pin the path -> specifier conversion for both POSIX and Win32 input forms
// without needing a Windows host.

Deno.test('fsPathToModuleSpecifier keeps POSIX absolute paths unchanged', () => {
  assertEquals(
    fsPathToModuleSpecifier('/home/u/proj/app/islands/counter.ts', '/home/u/proj'),
    '/home/u/proj/app/islands/counter.ts',
  );
});

Deno.test('fsPathToModuleSpecifier rewrites Win32 paths under root as root-relative', () => {
  assertEquals(
    fsPathToModuleSpecifier(
      'C:\\Users\\u\\proj\\app\\islands\\counter.ts',
      'C:\\Users\\u\\proj',
    ),
    '/app/islands/counter.ts',
  );
});

Deno.test('fsPathToModuleSpecifier accepts mixed separators and trailing root slash', () => {
  assertEquals(
    fsPathToModuleSpecifier(
      'C:/Users/u/proj/app/islands/nested\\deep.tsx',
      'C:\\Users\\u\\proj\\',
    ),
    '/app/islands/nested/deep.tsx',
  );
});

Deno.test('fsPathToModuleSpecifier uses the Vite /@fs/ convention outside root', () => {
  assertEquals(
    fsPathToModuleSpecifier('D:\\shared\\islands\\widget.ts', 'C:\\Users\\u\\proj'),
    '/@fs/D:/shared/islands/widget.ts',
  );
});

Deno.test('validateIslandModuleSpecifier admits converted Win32 forms', () => {
  // Root-relative conversion output.
  validateIslandModuleSpecifier('/app/islands/counter.ts');
  // /@fs/ conversion output with a drive letter.
  validateIslandModuleSpecifier('/@fs/D:/shared/islands/widget.ts');
});

Deno.test('validateIslandModuleSpecifier still rejects raw Windows paths', () => {
  // Regression pin: the pre-fix build fed these straight into the validator.
  assertThrows(
    () => validateIslandModuleSpecifier('C:\\Users\\u\\proj\\app\\islands\\counter.ts'),
    Error,
    'Invalid island modulePath',
  );
  assertThrows(
    () => validateIslandModuleSpecifier('C:/Users/u/proj/app/islands/counter.ts'),
    Error,
    'Invalid island modulePath',
  );
});

Deno.test('normalizeSeparators turns scanned Win32 island segments into valid specifiers', () => {
  // scanIslands uses node:path join(), which emits backslashes on Windows.
  const scanned = 'posts\\archive\\counter.ts';
  const specifier = `/app/islands/${normalizeSeparators(scanned)}`;
  assertEquals(specifier, '/app/islands/posts/archive/counter.ts');
  validateIslandModuleSpecifier(specifier);
});

Deno.test('scanIslands returns POSIX-separator relative paths', async () => {
  const root = await Deno.makeTempDir({ prefix: 'island-scan-' });
  try {
    await Deno.mkdir(`${root}/posts/archive`, { recursive: true });
    await Deno.writeTextFile(`${root}/counter.ts`, 'export {}');
    await Deno.writeTextFile(`${root}/posts/archive/deep.ts`, 'export {}');

    const files = await scanIslands(root);
    assertEquals(files, ['counter.ts', 'posts/archive/deep.ts']);
    for (const file of files) {
      validateIslandModuleSpecifier(`/app/islands/${file}`);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
