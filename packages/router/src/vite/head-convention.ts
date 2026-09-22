/**
 * @openelement/router — the `app/head.tsx` convention loader (alpha.4).
 *
 * `app/head.tsx` is the structural document-head module: font preloads, icon
 * and feed links, inline critical CSS, and site-wide meta tags — the head
 * content that a URL list cannot express and that must not be written as raw
 * HTML in the config file.
 *
 * It is compiled INTO THE APP'S MODULE GRAPH, not read as text: the module may
 * import CSS with Vite's `?inline` suffix and import local helpers and data
 * modules. The host's config loader cannot do that — `loadConfigFromFile`
 * refuses a `?inline` CSS import (`Expected a JavaScript or TypeScript module,
 * but identified a Css module`), which is exactly why the head convention is a
 * module compiled by Vite rather than a value read by the config loader.
 *
 * Resolution boundary: project-local files are compiled and inlined, while
 * BARE specifiers are externalized and left to the host import map — the same
 * contract the config file itself has (it imports `@openelement/router` by its
 * bare name). Bundling package sources would drag decompiled-without-compiler
 * component code into a data module, so the nested build deliberately does not
 * inherit the app's workspace aliases.
 *
 * The module must not use host APIs (no Deno, no Node): it is evaluated during
 * the build and its output is data, so a runtime read would make the document
 * depend on the machine that built it.
 *
 * The emitted value is validated and serialized by head-channel.ts: attribute
 * names, URL protocols and inline CSS all pass the same fail-closed checks as
 * every other head fragment.
 */

import { existsSync } from '../internal/host-path.ts';
import { isAbsolute } from '../internal/host-path.ts';
import { join } from '../internal/host-path.ts';
import { toFileUrl } from '../internal/host-path.ts';
import { OpenElementError } from '@openelement/element/authoring';
import { OPEN_ELEMENT_DIR } from './internal/paths.ts';
import { resolveHeadConventionExport, serializeHeadConvention } from './head-channel.ts';

/** Where the compiled head module is written, relative to the project root. */
export const HEAD_CONVENTION_BUILD_DIR = `${OPEN_ELEMENT_DIR}/head`;

export interface HeadConventionInput {
  /** Absolute project root (the build's cwd). */
  root: string;
  /** Project-relative path of the head module. */
  relativePath: string;
}

/**
 * Compile and serialize `app/head.tsx` into ordered head fragments. Throws
 * {@linkcode OpenElementError} when the module fails to build, exports no
 * default, or exports an invalid entry: a head module that cannot be read is a
 * build failure, never a silently head-less document.
 */
export async function resolveHeadConvention(
  input: HeadConventionInput,
): Promise<string[]> {
  const { root, relativePath } = input;
  const file = join(root, relativePath);
  if (!existsSync(file)) {
    throw new OpenElementError(
      `[openElement] ${relativePath} was resolved as the head convention but does not exist.`,
      { code: 'CONFIG_INVALID', severity: 'error', phase: 'build', recoverable: false },
    );
  }

  const outDir = join(root, HEAD_CONVENTION_BUILD_DIR);
  const { build: viteBuild } = await import('vite');
  try {
    await viteBuild({
      configFile: false,
      root,
      logLevel: 'error',
      // The head bundle is a build-time artifact: copying public/ would
      // duplicate every static asset next to it.
      publicDir: false,
      build: {
        ssr: true,
        outDir,
        emptyOutDir: true,
        rollupOptions: {
          input: { head: file },
          // Bare specifiers stay EXTERNAL (the host import map resolves them,
          // exactly as it resolves the config file's own `@openelement/router`
          // import); project-local files and Vite's own virtual/`?inline`
          // modules are compiled and inlined. Bundling a package's sources
          // would drag component code — which needs the compiled-element
          // transform — into a data module.
          external: (id: string) =>
            !id.startsWith('.') && !id.startsWith('/') &&
            !id.startsWith('\0') && !isAbsolute(id),
          output: { format: 'esm', entryFileNames: '[name].js' },
        },
      },
      esbuild: {
        jsx: 'automatic',
        jsxImportSource: '@openelement/element',
      },
    });
  } catch (error) {
    throw new OpenElementError(
      `[openElement] ${relativePath} failed to compile: ${
        error instanceof Error ? error.message : error
      }`,
      { code: 'CONFIG_INVALID', severity: 'error', phase: 'build', recoverable: false },
    );
  }

  const emitted = join(outDir, 'head.js');
  if (!existsSync(emitted)) {
    throw new OpenElementError(
      `[openElement] ${relativePath} compiled to no module (expected ${HEAD_CONVENTION_BUILD_DIR}/head.js).`,
      { code: 'CONFIG_INVALID', severity: 'error', phase: 'build', recoverable: false },
    );
  }

  let module: { default?: unknown };
  try {
    module = await import(`${toFileUrl(emitted)}?t=${Date.now()}`) as { default?: unknown };
  } catch (error) {
    throw new OpenElementError(
      `[openElement] ${relativePath} could not be evaluated: ${
        error instanceof Error ? error.message : error
      }`,
      { code: 'CONFIG_INVALID', severity: 'error', phase: 'build', recoverable: false },
    );
  }
  if (module.default === undefined) {
    throw new OpenElementError(
      `[openElement] ${relativePath} must default-export the head entries ` +
        `(an array, or a function returning one).`,
      { code: 'CONFIG_INVALID', severity: 'error', phase: 'build', recoverable: false },
    );
  }
  return serializeHeadConvention(resolveHeadConventionExport(module.default, relativePath));
}
