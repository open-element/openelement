/**
 * route-scanner: enhanced-form detection follows relative imports (#577).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { join } from '@std/path';
import { scanRoutes } from '../src/vite/internal/ssg/index.ts';

test('scanRoutes detects data-open-enhance inside an imported component (#577)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-scan-enhance-'));
  try {
    const routesDir = join(dir, 'routes');
    const componentsDir = join(dir, 'components');
    await mkdir(routesDir, { recursive: true });
    await mkdir(componentsDir, { recursive: true });
    await writeFile(
      join(componentsDir, 'the-form.tsx'),
      `export function TheForm() {
  return (
    <form method='post' data-open-enhance>
      <button type='submit'>Go</button>
    </form>
  );
}
`,
    );
    // The route's own source carries NO enhance attribute — only the import.
    await writeFile(
      join(routesDir, 'index.tsx'),
      `import { TheForm } from '../components/the-form.tsx';
export const tagName = 'page-index';
export default function Page() {
  return <TheForm />;
}
`,
    );
    // A prose mention in an unrelated route must NOT trigger.
    await writeFile(
      join(routesDir, 'about.tsx'),
      `export const tagName = 'page-about';
// data-open-enhance is mentioned here only as prose.
export default function Page() {
  return <p>about</p>;
}
`,
    );

    const entries = await scanRoutes(routesDir);
    const index = entries.find((e) => e.path === '/');
    const about = entries.find((e) => e.path === '/about');
    expect(index?.hasEnhancedForms, 'imported component form must be detected').toEqual(true);
    expect(about?.hasEnhancedForms, 'prose mention must not trigger').toEqual(undefined);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});
