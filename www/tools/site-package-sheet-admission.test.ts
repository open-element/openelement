/** Verify the stylesheet output of the admitted UI package in a production site build. */
import { expect, test } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(import.meta.dirname, '..', 'dist');
const RENDERED_SHEETS = ['open-button.css', 'open-code-block.css', 'open-theme-toggle.css'];
const CONTRACT_SHEETS = [
  'open-input.css',
  'open-dialog.css',
  'open-dropdown.css',
  'overlay-recipe.css',
] as const;
const SHEET_MARKERS: Readonly<Record<string, string>> = {
  'open-button.css': '.btn[hidden]{display:none}',
  'open-code-block.css': ':host(:state(copied))',
  'open-theme-toggle.css': '.theme-toggle{',
  'open-input.css': ':host{display:block}.control{',
  'open-dialog.css': '::slotted([slot=trigger])',
  'open-dropdown.css': 'anchor(bottom)',
  'overlay-recipe.css': '.overlay{color:var(--color-foreground)',
};

test('built site emits the admitted package sheets and links those its pages render', () => {
  expect(
    existsSync(DIST),
    `Build output is missing: ${DIST}. Run vp run site:build before testing.`,
  ).toBe(true);
  const assetsDir = join(DIST, 'client/assets');
  expect(existsSync(assetsDir), `emitted client assets are missing: ${assetsDir}`).toBe(true);
  const sheets = readdirSync(assetsDir)
    .filter((name) => name.endsWith('.css'))
    .map((name) => ({
      name,
      path: join(assetsDir, name),
      text: readFileSync(join(assetsDir, name), 'utf8'),
    }));
  expect(sheets.length, 'the component-style channel emits sheets').toBeGreaterThan(0);

  // Every text artifact in the build, gathered once: a sheet is reachable when
  // a built HTML/JS/CSS/JSON names it.
  const artifacts: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.(?:html|css|js|mjs|json|xml|txt|webmanifest)$/.test(entry.name)) {
        artifacts.push({ path, text: readFileSync(path, 'utf8') });
      }
    }
  };
  walk(DIST);

  const sheetByMarker = (marker: string): (typeof sheets)[number] => {
    const matches = sheets.filter((sheet) => sheet.text.includes(marker));
    expect(
      matches.map((match) => match.name),
      `exactly one emitted sheet carries ${marker}`,
    ).toHaveLength(1);
    return matches[0]!;
  };
  const referencing = (sheet: (typeof sheets)[number]): string[] =>
    artifacts
      .filter(
        (artifact) =>
          artifact.path !== sheet.path &&
          // The publish manifest is an index of every emitted byte, not a
          // consumer: it necessarily names every sheet, so counting it here
          // would make each admitted-but-unrendered contract sheet look
          // rendered. The row asserts render/import linkage, so the index is
          // excluded (and nothing else is).
          !artifact.path.endsWith('publish-manifest.json') &&
          artifact.text.includes(sheet.name),
      )
      .map((artifact) => artifact.path.slice(DIST.length + 1));

  for (const sheet of RENDERED_SHEETS) {
    const emitted = sheetByMarker(SHEET_MARKERS[sheet]!);
    expect(
      referencing(emitted),
      `${sheet} is rendered by www and must be referenced`,
    ).not.toHaveLength(0);
  }

  // Package admission emits the sheets for UI declarations this site does not render.
  const contractSheets = CONTRACT_SHEETS.map((sheet) => ({
    sheet,
    emitted: sheetByMarker(SHEET_MARKERS[sheet]!),
  }));
  for (const { sheet, emitted } of contractSheets) {
    expect(
      referencing(emitted),
      `${sheet} belongs to an admitted declaration that the site does not render`,
    ).toEqual([]);
  }

  const contractNames = new Set(contractSheets.map(({ emitted }) => emitted.name));
  const orphans = sheets.filter(
    (sheet) => !contractNames.has(sheet.name) && referencing(sheet).length === 0,
  );
  expect(
    orphans.map((orphan) => orphan.name),
    'every emitted sheet must be referenced by the build, or be one of the four sheets of the ' +
      'admitted-but-unrendered @openelement/ui declarations',
  ).toEqual([]);
});
