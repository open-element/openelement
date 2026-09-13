/**
 * route-scanner: enhanced-form detection follows relative imports (#577).
 */
import { assertEquals } from '@std/assert';
import { join } from 'jsr:@std/path@^1.0.0';
import { scanRoutes } from '../src/vite/internal/ssg/index.ts';

Deno.test('scanRoutes detects data-open-enhance inside an imported component (#577)', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'oe-scan-enhance-' });
  try {
    const routesDir = join(dir, 'routes');
    const componentsDir = join(dir, 'components');
    await Deno.mkdir(routesDir, { recursive: true });
    await Deno.mkdir(componentsDir, { recursive: true });
    await Deno.writeTextFile(
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
    await Deno.writeTextFile(
      join(routesDir, 'index.tsx'),
      `import { TheForm } from '../components/the-form.tsx';
export const tagName = 'page-index';
export default function Page() {
  return <TheForm />;
}
`,
    );
    // A prose mention in an unrelated route must NOT trigger.
    await Deno.writeTextFile(
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
    assertEquals(index?.hasEnhancedForms, true, 'imported component form must be detected');
    assertEquals(about?.hasEnhancedForms, undefined, 'prose mention must not trigger');
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
