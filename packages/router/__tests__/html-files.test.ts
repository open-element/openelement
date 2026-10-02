/**
 * @openelement/router - internal/html-files.ts tests (#710)
 *
 * The single directory walker shared by SSG post-processing, sitemap
 * generation, island manifests, and build artifact collection.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  visitHtmlFiles,
  walkFileEntries,
  walkHtmlFileEntries,
} from '../src/vite/internal/html-files.ts';

async function withTempTree(
  files: Record<string, string>,
  fn: (root: string) => void | Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), ''));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const path = `${root}/${rel}`;
      await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      await writeFile(path, content);
    }
    await fn(root);
  } finally {
    await rm(root, { recursive: true });
  }
}

test('walkHtmlFileEntries - recurses, skips dotfiles, and sorts deterministically', async () => {
  await withTempTree(
    {
      'b/page.html': '<html>b</html>',
      'a/index.html': '<html>a</html>',
      '.hidden/skip.html': '<html>skip</html>',
      'a/.partial.html': '<html>skip</html>',
      'a/style.css': 'body{}',
    },
    (root) => {
      const entries = walkHtmlFileEntries(root);
      expect(entries.map((e) => e.relativePath)).toEqual(['a/index.html', 'b/page.html']);
      expect(entries[0].absolutePath).toEqual(`${root}/a/index.html`);
    },
  );
});

test('walkHtmlFileEntries - returns [] for a missing directory', () => {
  expect(walkHtmlFileEntries('/nonexistent-open-dir')).toEqual([]);
});

test('walkFileEntries - filters by extension and walks all files without one', async () => {
  await withTempTree(
    {
      'x/app.js': 'js',
      'x/app.css': 'css',
      'x/y/deep.js': 'js',
    },
    (root) => {
      expect(walkFileEntries(root, '.js').map((e) => e.relativePath)).toEqual([
        'x/app.js',
        'x/y/deep.js',
      ]);
      expect(walkFileEntries(root).map((e) => e.relativePath)).toEqual([
        'x/app.css',
        'x/app.js',
        'x/y/deep.js',
      ]);
    },
  );
});

test('visitHtmlFiles - overwrites only files the visitor rewrites', async () => {
  await withTempTree(
    {
      'index.html': '<html><body>home</body></html>',
      'about/index.html': '<html><body>about</body></html>',
    },
    async (root) => {
      const visited: string[] = [];
      visitHtmlFiles(root, (content, fullPath) => {
        visited.push(fullPath);
        return content.includes('home') ? content.replace('home', 'HOME') : null;
      });
      expect(visited).toEqual([`${root}/about/index.html`, `${root}/index.html`]);
      expect(await readFile(`${root}/index.html`, 'utf8')).toEqual(
        '<html><body>HOME</body></html>',
      );
      expect(await readFile(`${root}/about/index.html`, 'utf8')).toEqual(
        '<html><body>about</body></html>',
      );
    },
  );
});
