/**
 * @openelement/router - internal/html-files.ts tests (#710)
 *
 * The single directory walker shared by SSG post-processing, sitemap
 * generation, island manifests, and build artifact collection.
 */
import { assertEquals } from '@std/assert';
import {
  visitHtmlFiles,
  walkFileEntries,
  walkHtmlFileEntries,
} from '../src/vite/internal/html-files.ts';

async function withTempTree(
  files: Record<string, string>,
  fn: (root: string) => void | Promise<void>,
) {
  const root = await Deno.makeTempDir();
  try {
    for (const [rel, content] of Object.entries(files)) {
      const path = `${root}/${rel}`;
      await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      await Deno.writeTextFile(path, content);
    }
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test('walkHtmlFileEntries - recurses, skips dotfiles, and sorts deterministically', async () => {
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
      assertEquals(
        entries.map((e) => e.relativePath),
        ['a/index.html', 'b/page.html'],
      );
      assertEquals(entries[0].absolutePath, `${root}/a/index.html`);
    },
  );
});

Deno.test('walkHtmlFileEntries - returns [] for a missing directory', () => {
  assertEquals(walkHtmlFileEntries('/nonexistent-open-dir'), []);
});

Deno.test('walkFileEntries - filters by extension and walks all files without one', async () => {
  await withTempTree(
    {
      'x/app.js': 'js',
      'x/app.css': 'css',
      'x/y/deep.js': 'js',
    },
    (root) => {
      assertEquals(
        walkFileEntries(root, '.js').map((e) => e.relativePath),
        ['x/app.js', 'x/y/deep.js'],
      );
      assertEquals(
        walkFileEntries(root).map((e) => e.relativePath),
        ['x/app.css', 'x/app.js', 'x/y/deep.js'],
      );
    },
  );
});

Deno.test('visitHtmlFiles - overwrites only files the visitor rewrites', async () => {
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
      assertEquals(visited, [`${root}/about/index.html`, `${root}/index.html`]);
      assertEquals(await Deno.readTextFile(`${root}/index.html`), '<html><body>HOME</body></html>');
      assertEquals(
        await Deno.readTextFile(`${root}/about/index.html`),
        '<html><body>about</body></html>',
      );
    },
  );
});
