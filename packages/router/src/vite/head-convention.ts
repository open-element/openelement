/**
 * @openelement/router — the `app/head.tsx` convention loader (alpha.4).
 *
 * `app/head.tsx` is the structural document-head module: font preloads, icon
 * and feed links, inline critical CSS, and site-wide meta tags — the head
 * content that a URL list cannot express and that must not be written as raw
 * HTML in the config file.
 *
 * It is compiled INTO THE APP'S MODULE GRAPH, not read as text: the module may
 * import CSS with Vite's `?inline` suffix, import local helpers, and import
 * first-party packages (the tokens stylesheet of `@openelement/ui`, a site's own
 * stylesheet). The host's config loader cannot do that — `loadConfigFromFile`
 * refuses a `?inline` CSS import (`Expected a JavaScript or TypeScript module,
 * but identified a Css module`), which is exactly why the head convention is a
 * module in the build graph rather than a config-file value.
 *
 * The module must not use host APIs (no Deno, no Node): it is evaluated during
 * the build and its output is data, so a runtime read would make the document
 * depend on the machine that built it. The nested build below runs with
 * `ssr.noExternal` so the emitted bundle is self-contained and importable in
 * the host process.
 *
 * The emitted value is validated and serialized by head-channel.ts: attribute
 * names, URL protocols and inline CSS all pass the same fail-closed checks as
 * every other head fragment.
 */

import { existsSync } from '../internal/host-path.ts';
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
  /**
   * The build's resolved alias list, so the head module resolves the app's own
   * specifiers (the `@openelement/site-ui`-style aliases in vite.config.ts)
   * exactly as the rest of the app does.
   */
  alias?: unknown;
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
  // Vite's own alias shape, or null when the app has none.
  const alias = (input.alias ?? null) as
    | Array<{ find: string | RegExp; replacement: string }>
    | Record<string, string>
    | null;
  try {
    await viteBuild({
      configFile: false,
      root,
      logLevel: 'error',
      // The head bundle is a build-time artifact: copying public/ would
      // duplicate every static asset next to it.
      publicDir: false,
      resolve: alias ? { alias } : undefined,
      build: {
        ssr: true,
        outDir,
        emptyOutDir: true,
        rollupOptions: {
          input: { head: file },
          output: { format: 'esm', entryFileNames: '[name].js' },
        },
      },
      // Bundle everything: the emitted file must import in the host process
      // without inheriting this machine's import map.
      ssr: { noExternal: true },
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
