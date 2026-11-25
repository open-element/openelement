/**
 * Regenerate the browser-conformance compiled fixtures (#1333).
 *
 * WHAT CHANGED, AND WHY IT IS ONE LANE. This script used to compile two
 * author forms: the class/decorator lane through `compileElementModule` (the
 * transform hook the `open:compiled-element` Vite plugin called) and the
 * generated-element lane for the function-component fixtures. The class lane
 * was deleted with the Alpha16 closeout — `compileElementModule` no longer
 * exists — so every fixture this suite consumes is authored as a generated
 * element and compiled through `compileGeneratedElementIfAdmitted`, the exact
 * entry the Vite plugin's transform calls for an admitted island. There is no
 * second path left to keep in sync: a fixture that the generated lane declines
 * is a hard error here, never a silently skipped output.
 *
 * WHY THE VERIFICATION IS DIFFERENT. The class lane emitted one module with the
 * Source Map v3 inline as a `sourceMappingURL` data URL, so the old script
 * decoded that comment. The generated lane reports `{ code, map }` separately
 * (the appended CE tail carries no segments, so no inline comment exists to
 * decode), so this script checks the returned map object's `sources` instead —
 * the same provenance fact, read from the field the lane actually returns.
 *
 * Run through the package task:
 *   pnpm --dir packages/element run browser:compile
 */
// Workspace source imports use relative paths because this directory is not a
// workspace member.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import ts from 'typescript';
import { compileGeneratedElementIfAdmitted } from '../../../compiler/src/internal/compiler/semantic-ir/generated-element/compile.ts';
import { readIslandMetadata } from '../../../compiler/src/internal/compiler/semantic-ir/generated-element/site.ts';

const here = import.meta.dirname!; // packages/element/__wtr__/tools
const suite = join(here, '..');
const elementPkg = join(suite, '..');

interface FixtureSpec {
  /** Absolute path of the authored .tsx source. */
  source: string;
  /** Module id passed to the compiler (drives diagnostics and map sources). */
  id: string;
  /** Output file name inside generated/. */
  out: string;
  /**
   * Host site fact for the module: the element tag the build's island scanner
   * would supply. Required, because the generated lane is inert without it
   * (site null returns null by design) and a fixture with no tag has no
   * element identity to test.
   */
  tag: string;
}

const fixtures: FixtureSpec[] = [
  {
    // The light-root counter the lifecycle and Lit-interop suites drive. It is
    // the generated-lane port of the retired class fixture's PUBLIC shape
    // (tag, reflected count, label, items) — the canonical authored class
    // fixture stays where it is for its own consumers; the browser suite must
    // consume the lane that ships.
    source: join(suite, 'fixtures/wtr-counter.tsx'),
    id: 'wtr-counter.tsx',
    out: 'oe-program-counter.ts',
    tag: 'oe-program-counter',
  },
  {
    source: join(suite, 'fixtures/wtr-shadow-button.tsx'),
    id: 'wtr-shadow-button.tsx',
    out: 'wtr-shadow-button.ts',
    tag: 'wtr-shadow-button',
  },
  {
    source: join(suite, 'fixtures/wtr-field.tsx'),
    id: 'wtr-field.tsx',
    out: 'wtr-field.ts',
    tag: 'wtr-field',
  },
  {
    // Production UI fixtures use the same compiler entry. Their helpers
    // resolve to packages/ui/src through the element-browser project's aliases.
    source: join(elementPkg, '../ui/src/open-dialog.tsx'),
    id: 'open-dialog.tsx',
    out: 'open-dialog.ts',
    tag: 'open-dialog',
  },
  {
    source: join(elementPkg, '../ui/src/open-dropdown.tsx'),
    id: 'open-dropdown.tsx',
    out: 'open-dropdown.ts',
    tag: 'open-dropdown',
  },
  {
    source: join(elementPkg, '../ui/src/open-input.tsx'),
    id: 'open-input.tsx',
    out: 'open-input.ts',
    tag: 'open-input',
  },
  {
    source: join(elementPkg, '../ui/src/open-button.tsx'),
    id: 'open-button.tsx',
    out: 'open-button.ts',
    tag: 'open-button',
  },
  {
    // The client-only style-adoption fixture (2026-11-20): `ssr: false` + a
    // shadow root + one declared sheet. The compiler emits a REAL `.css`
    // import for the sidecar declaration, so this fixture is the browser row's
    // proof that the import reaches the shell as a sheet object. Its sheet is
    // copied beside the output below (the same rule as the UI sheets).
    source: join(suite, 'fixtures/wtr-live-timer.tsx'),
    id: 'wtr-live-timer.tsx',
    out: 'wtr-live-timer.ts',
    tag: 'wtr-live-timer',
  },
];

const outDir = join(suite, 'generated');
await mkdir(outDir, { recursive: true });

for (const fixture of fixtures) {
  const code = await readFile(fixture.source, 'utf8');
  // The site fact is the host's tag decision (the real build reads it from the
  // island scan); the leaf map comes back as a separate object, so there is no
  // inline sourceMappingURL comment to decode.
  const compiled = compileGeneratedElementIfAdmitted(code, fixture.id, {
    site: { tag: fixture.tag },
    authoredSource: code,
  });
  if (compiled === null) {
    throw new Error(`compiler declined ${fixture.id} for the generated-element lane`);
  }
  await writeFile(join(outDir, fixture.out), compiled.code);
  // Provenance check: the returned map must decode and point back at the
  // authored .tsx, or the debugging story silently degrades.
  if (!compiled.map?.sources?.some((source: string) => source.endsWith(fixture.id))) {
    throw new Error(`${fixture.out}: leaf map sources do not reference ${fixture.id}`);
  }

  // Keep the authored relative paths for client-only sheet imports and DSD
  // stylesheet links. Use the compiler's sidecar reader for both channels.
  const sourceFile = ts.createSourceFile(fixture.id, code, ts.ScriptTarget.Latest);
  const metadata = readIslandMetadata(sourceFile);
  if (metadata.kind === 'read') {
    for (const specifier of metadata.facts.styles) {
      const destination = join(outDir, specifier);
      if (!destination.startsWith(outDir + sep)) {
        throw new Error(`${fixture.id}: stylesheet ${specifier} escapes generated/`);
      }
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(dirname(fixture.source), specifier), destination);
    }
  }
  console.log(
    `compiled ${fixture.id} -> generated/${fixture.out} (${compiled.code.length} bytes, generated-element lane)`,
  );
}
