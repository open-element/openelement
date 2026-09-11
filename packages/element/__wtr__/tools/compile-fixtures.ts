/**
 * Regenerate the browser-conformance compiled fixtures (#1333).
 *
 * Uses compileElementModule — the exact function the open:compiled-element
 * Vite plugin's transform hook calls (packages/element/src/internal/
 * compiler/plugin.ts) — so WTR consumes the same ESM the official build path
 * produces, including the embedded Source Map v3 back to the authored .tsx.
 * No second TSX transform is introduced: the emitted module keeps its TS
 * annotations, and the WTR dev server lowers them with esbuild, mirroring how
 * Vite's builtin TS/JSX lowering runs after the plugin in a real build.
 *
 * Run from the repository root:
 *   deno run -A packages/element/__wtr__/tools/compile-fixtures.ts
 */
// NOTE: __wtr__/package.json makes Deno treat this directory as outside the
// repo workspace, so no workspace import-map specifiers (@std/*) here —
// plain relative paths only. The compiler's own imports still resolve through
// the element workspace member map.
import { compileElementModule } from '../../src/internal/compiler/plugin.ts';

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
];

const outDir = join(suite, 'generated');
await Deno.mkdir(outDir, { recursive: true });

for (const fixture of fixtures) {
  const code = await Deno.readTextFile(fixture.source);
  const result = compileElementModule(code, fixture.id);
  if (!result) {
    throw new Error(`compiler returned null for ${fixture.id} (decorator admission failed)`);
  }
  const outPath = join(outDir, fixture.out);
  await Deno.writeTextFile(outPath, result.code);

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
