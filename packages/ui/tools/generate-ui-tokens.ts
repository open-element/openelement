/**
 * Generate the ui token module from upstream open-props + the semantic layer.
 *
 * This is @openelement/ui's build-time adapter and lives with the package it
 * serves. Upstream open-props (MIT) is the canonical source for the tokens we
 * carry verbatim (gray ramp, indigo-6, border sizes, font weights, two
 * line-heights); `src/semantic-tokens.css` is the canonical source
 * for everything tuned. The adapter injects the upstream declarations at the
 * `@upstream-tokens` anchor and writes ONE generated artifact:
 *
 *   `src/open-props-tokens.ts` — the CSSOM module whose
 *   `openPropsTokenSheet` is adopted at :root or inside a shadow root (the
 *   token block selects `:root, :host`; no transform, no second export).
 *
 * JSR/npm consumers cannot import CSS from a dependency at runtime, which is
 * why the package ships the tokens inlined; the build itself needs no network
 * beyond the pinned dependency install, and the production site build reads
 * only committed files.
 *
 * `--check` regenerates in memory and fails on drift.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { Gray, Indigo } from 'open-props/src/props.colors.js';
import borders from 'open-props/src/props.borders.js';
import fonts from 'open-props/src/props.fonts.js';
import { parseOpenPropsVersion } from './open-props-version.ts';

const ANCHOR = '/* @upstream-tokens */';

// fileURLToPath, not .pathname: paths with spaces or %-escapes break otherwise.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// The package.json dependency declaration is the canonical dependency
// declaration; the generated provenance header must never disagree with what
// the build actually pins.
const packageJsonPath = join(repoRoot, 'packages/ui/package.json');
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
  dependencies?: unknown;
};
const OPEN_PROPS_VERSION = parseOpenPropsVersion(packageJson.dependencies, packageJsonPath);
const semanticFile = `${repoRoot}packages/ui/src/semantic-tokens.css`;
const outTsFile = `${repoRoot}packages/ui/src/open-props-tokens.ts`;

type Source = {
  file: string;
  module: Record<string, string>;
  vars: readonly string[];
};

/** Upstream per-topic files and the vars we carry verbatim, in order. */
const UPSTREAM: readonly Source[] = [
  { file: 'src/props.colors.js (Gray)', module: Gray, vars: Object.keys(Gray) },
  { file: 'src/props.colors.js (Indigo)', module: Indigo, vars: ['--indigo-6'] },
  {
    file: 'src/props.borders.js',
    module: borders as Record<string, string>,
    vars: ['--border-size-1', '--border-size-2'],
  },
  {
    file: 'src/props.fonts.js',
    module: fonts as Record<string, string>,
    vars: [
      '--font-weight-4',
      '--font-weight-5',
      '--font-weight-6',
      '--font-weight-7',
      '--font-weight-8',
      '--font-weight-9',
      '--font-lineheight-3',
      '--font-lineheight-4',
    ],
  },
];

function escReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let upstreamBlock = '';
const wanted = new Set<string>();
for (const { file, module, vars } of UPSTREAM) {
  upstreamBlock += `\n  /* ${file} — open-props@${OPEN_PROPS_VERSION} (MIT), verbatim */\n`;
  for (const name of vars) {
    const value = module[name];
    if (value === undefined) throw new Error(`open-props ${file} no longer defines ${name}`);
    wanted.add(name);
    upstreamBlock += `  ${name}: ${value};\n`;
  }
}

const semantic = await readFile(semanticFile, 'utf8');
const anchorCount = semantic.split(ANCHOR).length - 1;
if (anchorCount !== 1) {
  throw new Error(
    `anchor ${ANCHOR} must appear exactly once in semantic-tokens.css (found ${anchorCount})`,
  );
}
// Fail-closed: the semantic light layer must never shadow an
// upstream-verbatim token. (The dark block is our own inversion ramp, so it
// legitimately redefines the same names for the dark theme.)
const lightPart = semantic.slice(0, semantic.indexOf(':host([data-theme'));
for (const name of wanted) {
  if (new RegExp(`${escReg(name)}\\s*:`, 'g').test(lightPart)) {
    throw new Error(
      `${name} is upstream-verbatim and must not be redefined in the semantic light layer`,
    );
  }
}

// Replacer function, not a replacement string: upstream values flow through
// untouched even if one ever contains a $-pattern.
const cssBody = semantic.replace(ANCHOR, () => upstreamBlock.trim());
const generatedCss = `/**\n * GENERATED — do not edit; source: open-props@${OPEN_PROPS_VERSION} (MIT) + semantic-tokens.css.\n * Regenerate with: pnpm --filter @openelement/ui run generate:ui-tokens\n */\n\n${cssBody}`;

if (generatedCss.includes('`') || generatedCss.includes('${') || generatedCss.includes('\\')) {
  throw new Error('generated CSS must stay free of template-literal metacharacters');
}

const generatedTs = `/**
 * GENERATED — do not edit; source: open-props@${OPEN_PROPS_VERSION} (MIT) + semantic-tokens.css.
 * Regenerate with: pnpm --filter @openelement/ui run generate:ui-tokens
 */

import { StyleSheet, type StyleSheetLike } from '@openelement/element';

const OPEN_PROPS_TOKEN_CSS = \`${generatedCss}\`;

/**
 * The full token set as one constructable sheet. The token block selects
 * \`:root, :host\`, so the same sheet serves a document-level adoption and a
 * shadow-root adoption; only the structural fallback is :host-exclusive.
 */
export const openPropsTokenSheet: StyleSheetLike = new StyleSheet();
openPropsTokenSheet.replaceSync(OPEN_PROPS_TOKEN_CSS);
`;

if (process.argv.slice(2).includes('--check')) {
  let current = '';
  try {
    current = await readFile(outTsFile, 'utf8');
  } catch {
    // Missing file is drift; fall through to the mismatch path.
  }
  if (current !== generatedTs) {
    console.error(
      'ui tokens drift: regenerate with pnpm --filter @openelement/ui run generate:ui-tokens',
    );
    process.exit(1);
  }
  console.log('ui tokens check passed.');
} else {
  await writeFile(outTsFile, generatedTs);
  console.log(`ui tokens written from open-props@${OPEN_PROPS_VERSION} + semantic-tokens.css.`);
}
