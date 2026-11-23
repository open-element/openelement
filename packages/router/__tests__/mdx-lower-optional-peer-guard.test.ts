/**
 * Optional-peer boundary (`marked`; measured 2026-11-24). Product rule:
 *
 * `marked` is an OPTIONAL peer of @openelement/router — plugin-mdx.ts's own
 * contract: only consumers with `.mdx` routes resolve it. The lowering module
 * plugin-mdx-lower.ts imports `marked` at top level, so it is reachable ONLY
 * through plugin-mdx.ts's single-flight dynamic `import()` (`loadLower`). One
 * static import anywhere else on the config-load path makes EVERY consumer
 * resolve the peer: gate:packed's starter leg measured exactly that — the
 * declared-tag scan's static import killed a marked-less scaffold at dev
 * config load ("Cannot find package 'marked'" from plugin-mdx-lower.js), a
 * cell the packed-consumer gate had never reached before installs succeeded.
 *
 * This guard fails closed on the regression class, not on one file: no
 * non-test module under src may name plugin-mdx-lower.ts in a static
 * import/export form (type-only included — a type import still names the
 * module to every graph reader), and plugin-mdx.ts keeps the one dynamic
 * loader with its coded OPTIONAL_PEER_MISSING diagnostic.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'pathe';
import { expect, test } from 'vitest';

const ROUTER_DIR = fileURLToPath(new URL('../', import.meta.url));
const SRC_DIR = join(ROUTER_DIR, 'src');

/** Every source file under the router's src/ (recursively). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** The STATIC import/export forms that pin a module into the config-load graph. */
const STATIC_LOWER = /^\s*(import|export)\b[^;]*\bfrom\s+['"][^'"]*plugin-mdx-lower\.ts['"]/;

test('no module statically imports the mdx lowering — the marked peer stays optional', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC_DIR)) {
    const source = readFileSync(file, 'utf8');
    for (const [index, line] of source.split('\n').entries()) {
      if (STATIC_LOWER.test(line)) {
        offenders.push(`${relative(ROUTER_DIR, file)}:${index + 1}: ${line.trim()}`);
      }
    }
  }
  expect(
    offenders,
    `static plugin-mdx-lower imports (the marked peer would resolve for every consumer):\n${offenders.join('\n')}`,
  ).toEqual([]);
});

test('plugin-mdx.ts owns the one dynamic loader with the coded peer diagnostic', async () => {
  const source = readFileSync(join(SRC_DIR, 'vite/plugin-mdx.ts'), 'utf8');
  expect(source).toMatch(/export function loadLower\(\)/);
  expect(source).toMatch(/import\('\.\/plugin-mdx-lower\.ts'\)/);
  expect(source).toContain('OPTIONAL_PEER_MISSING');
  const mod = await import('../src/vite/plugin-mdx.ts');
  expect(typeof mod.loadLower, 'the exported loader exists for every lowering consumer').toBe(
    'function',
  );
});
