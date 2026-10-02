/**
 * route-scanner: varName collision detection (#1029).
 *
 * pathToVarName folds '/', '-', and '_' into '_', so /a-b, /a/b, and /a_b all
 * generate Route_A_b. Without a uniqueness check the virtual entry declares
 * the same import twice and Rollup fails with a bare "Identifier has already
 * been declared". scanRoutes must fail first, naming both source paths.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { dirname, join } from '@std/path';
import { scanRoutes } from '../src/vite/internal/ssg/index.ts';

const ROUTE_SOURCE = `import { definePage } from '@openelement/router';
export default definePage({
  render() { return null; },
});
`;

async function withRoutes(
  files: string[],
  fn: (routesDir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'oe-scan-varname-'));
  try {
    const routesDir = join(dir, 'routes');
    for (const file of files) {
      const path = join(routesDir, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, ROUTE_SOURCE);
    }
    await fn(routesDir);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
}

test('scanRoutes throws on varName collision between /a-b and /a/b (#1029)', async () => {
  await withRoutes(['a-b.tsx', join('a', 'b.tsx')], async (routesDir) => {
    const err = await scanRoutes(routesDir).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err instanceof Error).toEqual(true);
    expect(err!.message).toContain('Route_A_b');
    // Both source paths must be named so the author can find the pair.
    expect(err!.message).toContain('a-b.tsx');
    expect(err!.message).toContain(join('a', 'b.tsx'));
    expect(err!.message).toContain('Rename one of the route files');
  });
});

test('scanRoutes throws on varName collision between /a-b and /a_b (#1029)', async () => {
  await withRoutes(['a-b.tsx', 'a_b.tsx'], async (routesDir) => {
    const err = await scanRoutes(routesDir).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err instanceof Error).toEqual(true);
    expect(err!.message).toContain('Route_A_b');
    expect(err!.message).toContain('a-b.tsx');
    expect(err!.message).toContain('a_b.tsx');
  });
});

test('scanRoutes accepts non-colliding hyphen/slash/underscore routes', async () => {
  await withRoutes(['a-b.tsx', join('a', 'c.tsx'), 'a_c_d.tsx', 'index.tsx'], async (routesDir) => {
    const routes = await scanRoutes(routesDir);
    const varNames = routes.map((r) => r.varName);
    expect(new Set(varNames).size).toEqual(varNames.length);
  });
});
