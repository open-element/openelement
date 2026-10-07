/**
 * Regenerate the browser-conformance compiled fixtures (#1333).
 *
 * Uses compileElementModule — the exact function the open:compiled-element
 * Vite plugin's transform hook calls (packages/element/src/internal/
 * compiler/plugin.ts) — so the vitest browser suite consumes the same ESM the
 * official build path produces, including the embedded Source Map v3 back to
 * the authored .tsx. No second TSX transform is introduced: the emitted module
 * keeps its TS annotations, and Vite's oxc transform lowers them at serve
 * time, mirroring what the plugin-plus-Vite pipeline does in a real build.
 *
 * Run through the package task:
 *   pnpm --dir packages/element run browser:compile
 */
// NOTE: plain relative paths only — this directory sits outside the pnpm
// workspace import resolution, so no workspace specifiers are used here.
import { compileElementModule } from '../../../compiler/src/internal/compiler/plugin.ts';

const here = import.meta.dirname!; // packages/element/__wtr__/tools
const suite = join(here, '..');
const elementPkg = join(suite, '..');

function join(...segments: string[]): string {
  return segments.join('/').replace(/\/+/g, '/').replace(/\/$/, '');
}

interface FixtureSpec {
  /** Absolute path of the authored .tsx source. */
  source: string;
  /** Module id passed to the compiler (drives diagnostics and map sources). */
  id: string;
  /** Output file name inside generated/. */
  out: string;
}

const fixtures: FixtureSpec[] = [
  {
    // The repo's canonical compiler-v1 fixture, consumed byte-for-byte.
    source: join(elementPkg, '__fixtures__/compiled-element-v1/counter.tsx'),
    id: 'counter.tsx',
    out: 'oe-program-counter.ts',
  },
  {
    source: join(suite, 'fixtures/wtr-shadow-button.tsx'),
    id: 'wtr-shadow-button.tsx',
    out: 'wtr-shadow-button.ts',
  },
  {
    source: join(suite, 'fixtures/wtr-field.tsx'),
    id: 'wtr-field.tsx',
    out: 'wtr-field.ts',
  },
  {
    // packages/ui production overlay components (#1339 slice): compiled through
    // the same official path; their './component-recipes.ts' /
    // './instance-state.ts' imports resolve to packages/ui/src at vitest
    // serve time through the element-browser project's aliases (no copies
    // committed).
    source: join(elementPkg, '../ui/src/open-dialog.tsx'),
    id: 'open-dialog.tsx',
    out: 'open-dialog.ts',
  },
  {
    source: join(elementPkg, '../ui/src/open-dropdown.tsx'),
    id: 'open-dropdown.tsx',
    out: 'open-dropdown.ts',
  },
];

const outDir = join(suite, 'generated');
await import('node:fs/promises').then((fs) => fs.mkdir(outDir, { recursive: true }));

for (const fixture of fixtures) {
    const code = await import('node:fs/promises').then((fs) =>
    fs.readFile(fixture.source, 'utf8')
  );
  const result = compileElementModule(code, fixture.id);
  if (!result) {
    throw new Error(`compiler returned null for ${fixture.id} (decorator admission failed)`);
  }
  const outPath = join(outDir, fixture.out);
    await import('node:fs/promises').then((fs) => fs.writeFile(outPath, result.code));

  // Provenance check: the embedded v3 map must decode and point back at the
  // authored .tsx, or the debugging story silently degrades.
  const match = result.code.match(/sourceMappingURL=data:application\/json;base64,([^\n]+)/);
  if (!match) throw new Error(`${fixture.out}: inline source map missing`);
  const map = JSON.parse(atob(match[1]));
  if (!map.sources?.some((source: string) => source.endsWith(fixture.id))) {
    throw new Error(`${fixture.out}: map sources do not reference ${fixture.id}`);
  }
  console.log(`compiled ${fixture.id} -> generated/${fixture.out} (${result.code.length} bytes)`);
}
