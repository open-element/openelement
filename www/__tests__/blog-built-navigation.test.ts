import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { extractBuiltLinks, resolveBuiltPath } from '../tools/lib/site-links.ts';

// Consumer form: checks the links actually serialized by the multi-post route.
test('built multi-post Blog navigation uses canonical locale paths including dotted slugs', () => {
  const root = new URL('../dist/', import.meta.url).pathname;
  const slugs = [
    'alpha16-18-a-clearer-direction',
    'alpha16-18-a-clearer-direction.zh',
    '1-0-0-alpha-1-baseline',
  ];
  for (const prefix of ['', 'zh/']) {
    for (const slug of slugs) {
      const file = `${prefix}blog/${slug}/index.html`;
      const html = readFileSync(resolve(root, file), 'utf8');
      const links = extractBuiltLinks(file, html).filter((link) =>
        link.path.startsWith(`/${prefix}blog/`),
      );
      expect(
        links.some((link) => slugs.some((other) => other !== slug && link.path.includes(other))),
      ).toBe(true);
      for (const link of links) {
        expect(link.path).not.toContain('/blog//');
        expect(
          resolveBuiltPath(link.path, (path) => existsSync(resolve(root, path))),
        ).not.toBeNull();
      }
    }
  }
});
