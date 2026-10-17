/**
 * A6 (alpha15 R3 closeout): the admitted package's declaration sheets are
 * BUILD OUTPUT by contract, not asset-reachability defects.
 *
 * The four sheets the review reported as orphans — `open-dialog`,
 * `open-dropdown`, `open-input`, `overlay-recipe` — are exactly the authored
 * sheets of the @openelement/ui declarations www does NOT render. Their
 * presence in `client/assets/` is the package-level admission contract:
 *
 *  - www admits the package wholesale (`packageIslands: ['@openelement/ui']`,
 *    www/openelement.config.ts) — admission is per PACKAGE, not per tag;
 *  - the client build seeds the server-rendered style-edge walk with every
 *    SSR-RENDERABLE declaration module of an admitted package "whether or not
 *    a page references it" (packages/router/src/cli/build-client.ts,
 *    `serverRenderedSeeds`: `for (const island of declared.packageDecls)` →
 *    `specifiers.add(island.modulePath)`), so each such module's authored
 *    `.css` edges are registered (packages/router/src/vite/internal/
 *    style-assets.ts, `registerStyleEdges`) and emitted, hashed and named
 *    exactly like an island's sheet;
 *  - the emitted sheet is delivered when the component renders (the DSD style
 *    link / the module's own sheet adapter). www renders no `<open-input>`,
 *    `<open-dialog>` or `<open-dropdown>` tag, so nothing in www's output
 *    references those four assets — the intended asymmetry of package-level
 *    admission. An app that DOES render them (or a packed consumer of
 *    @openelement/ui) gets the sheet from this same emission.
 *
 * Measured on the alpha15 build (www/dist, 2026-10-17 20:05): the four emitted
 * sheets had zero references anywhere in dist, while the sheets of the three
 * declarations www does render (`open-button`, `open-code-block`,
 * `open-theme-toggle`) were referenced by built HTML. The last test is the
 * built-output form of that fact; the ones above it pin the derivation so the
 * disposition cannot be inherited silently after a change to any half.
 *
 * GOVERNING WRITTEN CONTRACT (docs/architecture/seams.md — asserted below, so
 * the citation cannot rot):
 *   - "Package admission ↔ component delivery" (the admission boundary row) is
 *     the row that governs. Its criterion is admission, not page reference: the
 *     discovery pass compares the compiled ELEMENT modules the resolver walk
 *     reached against the admitted `packageIslands` manifests, and the boundary
 *     "is a WARNING naming the package and the fix, never a failure". Its proof
 *     form names an emitted-but-unreferenced CSS asset as a recognized artifact
 *     of that boundary. www admits @openelement/ui, so the four sheets sit on
 *     this boundary's admitted leg.
 *   - The case-specific contract is written in the code that row names:
 *     `serverRenderedSeeds` (packages/router/src/cli/build-client.ts) seeds
 *     every SSR-RENDERABLE declaration module of an admitted package "whether
 *     or not a page references it" — its own example is
 *     `@openelement/ui/open-input` — so each such module's authored `.css`
 *     edges are registered and emitted.
 *   - "Server function page lane" is NOT the governing row. It skips style
 *     edges for SERVER FUNCTION components because those "own no element class
 *     to hang the DSD `<link>` on", so a registered edge could never have a
 *     consumer. The four sheets belong to element-class declarations, whose
 *     consumer (the DSD style link) exists the moment the tag renders; they are
 *     consumer-PENDING, not consumer-LESS. Had those modules been function
 *     components, emitting them would be exactly the orphan that row forbids.
 *
 * RE-DECIDE, do not inherit: if admission narrows to a per-tag list, a
 * declaration is removed, or the router's seed rule starts filtering on page
 * references, the four assets stop being contract output and become the
 * defect the R3 ledger called "orphan-style-asset prevention" — these tests
 * fail to say so.
 */
import { expect, test } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WWW = join(import.meta.dirname, '..');
const REPO = join(WWW, '..');
const DIST = join(WWW, 'dist');
const UI_SRC = join(REPO, 'packages/ui/src');
const CONFIG = join(WWW, 'openelement.config.ts');
const BUILD_CLIENT = join(REPO, 'packages/router/src/cli/build-client.ts');
const STYLE_ASSETS = join(REPO, 'packages/router/src/vite/internal/style-assets.ts');

/** The three www-unreferenced declarations, and the four sheets under audit. */
const UNRENDERED = ['open-input', 'open-dialog', 'open-dropdown'] as const;
const CONTRACT_SHEETS = [
  'open-input.css',
  'open-dialog.css',
  'open-dropdown.css',
  'overlay-recipe.css',
] as const;
/** `overlay-recipe.css` is shared: both recipes import it. */
const SHEET_IMPORTERS: Readonly<Record<string, readonly string[]>> = {
  'open-input.css': ['open-input'],
  'open-dialog.css': ['open-dialog'],
  'open-dropdown.css': ['open-dropdown'],
  'overlay-recipe.css': ['open-dialog', 'open-dropdown'],
};

/**
 * Identifying selectors of the compiled sheets in `client/assets/`. A marker
 * is a selector the source sheet owns and the CSS minifier keeps verbatim, so
 * an emitted asset can be attributed without trusting a content hash. If one
 * of these tables stops matching, the sheet moved or was rewritten — update
 * the marker AND re-check the A6 disposition above.
 */
const SHEET_MARKERS: Readonly<Record<string, string>> = {
  'open-button.css': '.btn[hidden]{display:none}',
  'open-code-block.css': ':host(:state(copied))',
  'open-theme-toggle.css': '.theme-toggle{',
  'open-input.css': ':host{display:block}.control{',
  'open-dialog.css': '::slotted([slot=trigger])',
  'open-dropdown.css': 'anchor(bottom)',
  'overlay-recipe.css': '.overlay{color:var(--color-foreground)',
};

/** Every www source module under app/ (the generated data dir is not a source). */
function wwwSourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'data') continue;
        walk(path);
        continue;
      }
      if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(path);
    }
  };
  walk(join(WWW, 'app'));
  return files;
}

/** The `@openelement/ui/<subpath>` specifiers www actually imports. */
function importedUiSubpaths(): Set<string> {
  const subpaths = new Set<string>();
  for (const file of wwwSourceFiles()) {
    for (const match of readFileSync(file, 'utf8').matchAll(/@openelement\/ui\/([a-z0-9-]+)/g)) {
      subpaths.add(match[1]!);
    }
  }
  return subpaths;
}

/** The `./x.css` edges a declaration module declares. */
function authoredSheets(declaration: string): string[] {
  const text = readFileSync(join(UI_SRC, `${declaration}.tsx`), 'utf8');
  return [...text.matchAll(/from '\.\/([a-z0-9-]+\.css)'/g)].map((match) => match[1]!);
}

/**
 * The function body of `name` in a TS source file, exported or not. The
 * parameter list is consumed by paren depth first (type literals in the
 * parameters carry braces of their own), so the first `{` at depth zero after
 * it is the body.
 */
function functionBody(source: string, name: string): string {
  const signature = source.indexOf(`function ${name}(`);
  expect(signature, `${name} not found — the A6 disposition rests on it`).toBeGreaterThan(-1);
  let depth = 0;
  let bodyStart = -1;
  for (let i = source.indexOf('(', signature); i < source.length; i++) {
    const char = source[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === '{' && depth === 0) {
      bodyStart = i;
      break;
    }
  }
  expect(bodyStart, `${name}'s body brace not found`).toBeGreaterThan(-1);
  depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(bodyStart, i + 1);
  }
  throw new Error(`unterminated body for ${name}`);
}

test('A6 contract: www admits @openelement/ui at PACKAGE level', () => {
  const config = readFileSync(CONFIG, 'utf8');
  const declared = /packageIslands:\s*\[([^\]]*)\]/.exec(config);
  expect(
    declared,
    'www/openelement.config.ts no longer declares packageIslands as a literal array — ' +
      "the A6 disposition (package-level admission retains the unrendered declarations' sheets) " +
      'must be re-decided',
  ).not.toBeNull();
  expect(declared![1]).toContain("'@openelement/ui'");
});

test('A6 contract: the www-unrendered declarations are exactly the three reported', () => {
  const manifest = JSON.parse(readFileSync(join(UI_SRC, 'generated-manifest.json'), 'utf8')) as {
    declarations: { tagName: string }[];
  };
  const roster = manifest.declarations.map((declaration) => declaration.tagName).sort();
  expect(roster).toEqual([
    'open-button',
    'open-code-block',
    'open-dialog',
    'open-dropdown',
    'open-input',
    'open-theme-toggle',
  ]);
  const imported = importedUiSubpaths();
  const unrendered = roster.filter((tag) => !imported.has(tag));
  expect(unrendered).toEqual([...UNRENDERED].sort());
  for (const declaration of UNRENDERED) {
    expect(existsSync(join(UI_SRC, `${declaration}.tsx`)), `${declaration}.tsx exists`).toBe(true);
  }
});

test('A6 contract: the four reported sheets are those declarations’ authored edges', () => {
  const edges = new Map<string, string[]>();
  for (const declaration of UNRENDERED) {
    for (const sheet of authoredSheets(declaration)) {
      edges.set(sheet, [...(edges.get(sheet) ?? []), declaration]);
    }
  }
  expect([...edges.keys()].sort()).toEqual([...CONTRACT_SHEETS].sort());
  for (const [sheet, importers] of Object.entries(SHEET_IMPORTERS)) {
    expect(edges.get(sheet), `${sheet} importers`).toEqual([...importers]);
    expect(existsSync(join(UI_SRC, sheet)), `${sheet} exists`).toBe(true);
  }
});

test('A6 contract: the router seeds every renderable declaration, page reference or not', () => {
  const buildClient = readFileSync(BUILD_CLIENT, 'utf8');
  const seeds = functionBody(buildClient, 'serverRenderedSeeds');
  expect(
    seeds,
    'serverRenderedSeeds must keep seeding every renderable package declaration module — ' +
      "this seed IS the reason the unrendered declarations' sheets are emitted (A6)",
  ).toMatch(
    /for \(const island of declared\.packageDecls\)[\s\S]*?specifiers\.add\(island\.modulePath\)/,
  );
  expect(seeds, 'the renderable-tag gate is part of the contract').toMatch(
    /isRenderable\(deliveryTagsForPackage\(island\)\)/,
  );
  const jsdoc = buildClient.slice(0, buildClient.indexOf('function serverRenderedSeeds'));
  expect(
    jsdoc,
    'the seed rule\'s documented intent ("whether or not a page references it") is the A6 contract',
  ).toMatch(/whether or not a page references it/);

  const discovery = functionBody(
    readFileSync(STYLE_ASSETS, 'utf8'),
    'discoverServerRenderedModules',
  );
  expect(
    discovery,
    "the walk must register the reached module's authored .css edges for emission",
  ).toMatch(/registerStyleEdges\(file, compiled\.styleRequests/);
});

test('A6 anchoring: the written seam contract this disposition rests on', () => {
  // The disposition is anchored to docs/architecture/seams.md, not to
  // inference: the admission-boundary row governs, and the server-function-page
  // rule is cited only as the row that does NOT (its precondition — a module
  // with no possible style consumer — is absent here, asserted above). If
  // either row is rewritten, re-read the disposition instead of inheriting it.
  const seams = readFileSync(join(REPO, 'docs/architecture/seams.md'), 'utf8').split('\n');
  const admissionRow = seams.find((line) =>
    line.includes('Package admission ↔ component delivery'),
  );
  expect(
    admissionRow,
    'the admission-boundary row (the GOVERNING row for A6) is gone from seams.md — re-decide the disposition',
  ).toBeDefined();
  expect(admissionRow).toContain('never a failure');
  expect(
    admissionRow,
    'the row must keep naming unreferenced emission as a boundary artifact',
  ).toContain('emitted-but-unreferenced CSS asset');
  expect(admissionRow, 'the row must keep naming the admission key').toContain('packageIslands');

  const functionPageRow = seams.find((line) => line.includes('Server function page lane'));
  expect(functionPageRow, 'the function-page row (cited as NOT governing) is gone').toBeDefined();
  expect(
    functionPageRow,
    'the function-page rule is about modules with no element class — the precondition this disposition rules out',
  ).toContain('would emit an orphan CSS asset');
  expect(functionPageRow).toContain('no element class');
});

test('A6 evidence: built output carries no unreferenced sheet beyond the contract four', () => {
  expect(
    existsSync(DIST),
    `Build output is missing: ${DIST} — this test is the built-output form of the A6 ` +
      'disposition and needs a production build (site:build), like www/__tests__/build-output.test.ts',
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
      .filter((artifact) => artifact.path !== sheet.path && artifact.text.includes(sheet.name))
      .map((artifact) => artifact.path.slice(DIST.length + 1));

  // The three declarations www renders: their sheets must be reachable.
  for (const sheet of ['open-button.css', 'open-code-block.css', 'open-theme-toggle.css']) {
    const emitted = sheetByMarker(SHEET_MARKERS[sheet]!);
    expect(
      referencing(emitted),
      `${sheet} is rendered by www and must be referenced`,
    ).not.toHaveLength(0);
  }

  // The four contract sheets: emitted, and unreferenced BY DESIGN (no www page
  // renders those tags) — the fact the R3 review reported.
  const contractSheets = CONTRACT_SHEETS.map((sheet) => ({
    sheet,
    emitted: sheetByMarker(SHEET_MARKERS[sheet]!),
  }));
  for (const { sheet, emitted } of contractSheets) {
    expect(
      referencing(emitted),
      `${sheet} is contract output for an admitted but unrendered declaration: if a www page ` +
        'now renders the tag, this test must be updated deliberately (the asset became reachable)',
    ).toEqual([]);
  }

  // Orphan-style-asset prevention (the R3 ledger's task 6): a FIFTH
  // unreferenced emitted sheet is a real defect, not contract output.
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
