/**
 * Generate the ui token mirror from upstream open-props + the semantic layer.
 *
 * Reads the pinned open-props npm dependency (MIT) for the tokens we carry
 * verbatim, injects them at the `@upstream-tokens` anchor in
 * `packages/ui/src/semantic-tokens.css` (hand-maintained: tuned primitives,
 * semantic roles, both themes, :host fallback, CJK stacks), and writes:
 *
 *   packages/ui/src/open-props-tokens.css — the generated sheet (:host form)
 *   packages/ui/src/open-props-tokens.ts  — its CSSOM mirror (same exports)
 *
 * The `:host` -> `:root` document transform lives in the generated .ts
 * (toRootCss); consumers needing document-level tokens (www/vite.config.ts)
 * use the finished openPropsRootSheet — no consumer keeps its own regex copy.
 *
 * `--check` regenerates in memory and fails on drift.
 */

import { fromFileUrl } from '@std/path';
import { Gray, Indigo } from 'open-props/src/props.colors.js';
import borders from 'open-props/src/props.borders.js';
import fonts from 'open-props/src/props.fonts.js';

const OPEN_PROPS_VERSION = '1.7.23';
const ANCHOR = '/* @upstream-tokens */';

// fromFileUrl, not .pathname: paths with spaces or %-escapes break otherwise.
const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const semanticFile = `${repoRoot}packages/ui/src/semantic-tokens.css`;
const outCssFile = `${repoRoot}packages/ui/src/open-props-tokens.css`;
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

const semantic = await Deno.readTextFile(semanticFile);
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
const generatedCss =
  `/**\n * GENERATED — do not edit; source: open-props@${OPEN_PROPS_VERSION} (MIT) + semantic-tokens.css.\n * Regenerate with: deno task --cwd tools/repo generate:ui-tokens\n */\n\n${cssBody}`;

if (generatedCss.includes('`') || generatedCss.includes('${') || generatedCss.includes('\\')) {
  throw new Error('generated CSS must stay free of template-literal metacharacters');
}

const generatedTs = `/**
 * GENERATED — do not edit; source: open-props@${OPEN_PROPS_VERSION} (MIT) + semantic-tokens.css.
 * Regenerate with: deno task --cwd tools/repo generate:ui-tokens
 */

import { StyleSheet, type StyleSheetLike } from '@openelement/element';

function countDarkDecls(css: string, marker: string): number {
  const tail = css.split(marker)[1] ?? '';
  return (tail.match(/--[a-z0-9-]+\\s*:/g) ?? []).length;
}

export function toRootCss(hostCss: string): string {
  const darked = hostCss.replace(
    /:host\\(\\[data-theme=(['"])dark\\1\\]\\)/g,
    ":root[data-theme='dark']",
  );
  if (/:host-/.test(darked)) {
    throw new Error(
      "toRootCss: unhandled :host-* variant (e.g. :host-context) — extend the transform, do not ship a silent rewrite",
    );
  }
  const rooted = darked.replace(/:host/g, ':root');
  // Output assertions: replaceSync drops invalid selectors without
  // throwing, so a broken transform would silently delete tokens instead
  // of failing the build.
  const inputDarkDecls = countDarkDecls(hostCss, '[data-theme=');
  const outputDarkDecls = countDarkDecls(rooted, ':root[data-theme=');
  if (/:host/.test(rooted)) throw new Error('toRootCss: residual :host in output');
  if (!rooted.includes(':root[data-theme=')) throw new Error('toRootCss: dark block missing in output');
  if (inputDarkDecls === 0 || outputDarkDecls !== inputDarkDecls) {
    throw new Error('toRootCss: dark declarations changed ' + inputDarkDecls + ' -> ' + outputDarkDecls);
  }
  return rooted;
}

const OPEN_PROPS_TOKEN_CSS = \`${generatedCss}\`;

const sheet: StyleSheetLike = new StyleSheet();
sheet.replaceSync(OPEN_PROPS_TOKEN_CSS);
/** Pre-built stylesheet carrying the full Open Props token set (adopt into a shadow root). */
export const openPropsTokenSheet: StyleSheetLike = sheet;

/** Pre-built stylesheet exposing the Open Props tokens on \`:root\` (document-level adoption). */
export const openPropsRootSheet: StyleSheetLike = new StyleSheet();
openPropsRootSheet.replaceSync(toRootCss(OPEN_PROPS_TOKEN_CSS));
`;

if (Deno.args.includes('--check')) {
  const [currentCss, currentTs] = await Promise.all([
    Deno.readTextFile(outCssFile).catch(() => ''),
    Deno.readTextFile(outTsFile).catch(() => ''),
  ]);
  if (currentCss !== generatedCss || currentTs !== generatedTs) {
    console.error('ui tokens drift: regenerate with deno task --cwd tools/repo generate:ui-tokens');
    Deno.exit(1);
  }
  console.log('ui tokens check passed.');
} else {
  await Deno.writeTextFile(outCssFile, generatedCss);
  await Deno.writeTextFile(outTsFile, generatedTs);
  console.log(`ui tokens written from open-props@${OPEN_PROPS_VERSION} + semantic-tokens.css.`);
}
