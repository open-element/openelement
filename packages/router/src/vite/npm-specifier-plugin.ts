import type { Plugin } from 'vite';

/** Convert Deno `npm:` specifiers into the bare package ids understood by Vite. */
export function rewriteNpmSpecifiers(source: string): string {
  return source.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])npm:(@?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)@[^'"/]+(\/[^'"]*)?\2/g,
    (_match, prefix: string, quote: string, pkg: string, subpath = '') =>
      `${prefix}${quote}${pkg}${subpath}${quote}`,
  );
}

/** npm-only adapter transform; package resolution remains Vite's responsibility. */
export function createNpmSpecifierPlugin(): Plugin {
  return {
    name: 'open:npm-specifiers',
    enforce: 'pre',
    transform(code) {
      if (!code.includes('npm:')) return null;
      const rewritten = rewriteNpmSpecifiers(code);
      return rewritten === code ? null : { code: rewritten, map: null };
    },
  };
}
