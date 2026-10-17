/**
 * The server function component lane's host bindings (alpha15 server lane).
 *
 * The compiler package stays node-free and filesystem-free: the class path
 * receives everything it needs from authored source, while the server lane's
 * nested composition needs the SOURCES of the modules a route imports
 * (compile-time resolution, so a nested server function component composes by
 * direct call). This module is the router host's binding of that capability —
 * one resolver and one admission-tag read, shared by every host that runs the
 * lane (the dev transform, the client build, the SSG bundle, the style-edge
 * discovery walk, and the class-candidate collection pass), so no host grows
 * a second source-resolution policy.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'pathe';

/** Module extensions whose text can carry (or import to) compiled programs. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'] as const;

/** Host inputs for the resolver factory. */
export interface ServerComponentHostOptions {
  /** The Vite project root; project-relative importer ids anchor here. */
  readonly root: string;
  /**
   * The workspace root when the caller knows it: a module id outside the
   * project root is typically a linked workspace package, so it resolves
   * back to a real path under this anchor.
   */
  readonly workspaceRoot?: string | undefined;
}

/** Resolve one specifier+importer pair to that module's source, or null. */
export type ServerComponentModuleResolver = (specifier: string, importer: string) => string | null;

/**
 * True when a path spelling can carry authored source text. A spelling whose
 * final segment ends in a non-source extension (a `.json` data module, a
 * `.css` sheet) is not a module this lane composes: its bytes cannot carry
 * server function components, and handing them to the parser would fail the
 * compile with an unrelated diagnostic. Extensionless spellings stay probed —
 * bundler-style resolution may answer them with a source file.
 */
function isSourceSpelling(path: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension)) || !/\.[^/]+$/.test(path);
}

/**
 * Probe a path without extension assumptions into an existing source file.
 *
 * Source extensions are only ever APPENDED to a spelling that can carry
 * source. An explicit non-source spelling (`./table.json`) names a module this
 * lane does not compose, and the files beside it are different module
 * identities: `table.json.ts` is not what the author imported, and answering
 * the JSON specifier with it makes the compiler parse a module the page never
 * named — which for a `.json` specifier crashes the parse seam outright (the
 * `.json`-suffixed synthetic name is read as JSON by the transpile step).
 * The one probing form such a spelling keeps is the directory index
 * (`table.json/index.ts`), the bundler's own answer for a directory of that
 * name.
 */
function probeSourceFile(base: string): string | null {
  const withoutExtension = /\.(?:[cm]?[tj]sx?)$/.test(base)
    ? base.replace(/\.(?:[cm]?[tj]sx?)$/, '')
    : base;
  const stems = withoutExtension === base ? [base] : [base, withoutExtension];
  for (const stem of stems) {
    const sourceSpelling = isSourceSpelling(stem);
    for (const candidate of [
      ...(sourceSpelling ? [stem] : []),
      ...(sourceSpelling ? SOURCE_EXTENSIONS.map((extension) => `${stem}${extension}`) : []),
      ...SOURCE_EXTENSIONS.map((extension) => `${stem}/index${extension}`),
    ]) {
      try {
        return readFileSync(candidate, 'utf8');
      } catch {
        // Not a readable file at this spelling; keep probing.
      }
    }
  }
  return null;
}

/**
 * Create the source resolver the server component lane composes through.
 *
 * Importer ids arrive as the compiler's stable ids (project-relative POSIX
 * spellings, absolute ones passed through): a relative specifier probes the
 * importer's directory (extension and index variants included), a
 * root-absolute one anchors at the project root, and a bare one resolves
 * through the importing file's own Node resolution — the same shapes the
 * bundler understands. An unreadable target answers null, which the compiler
 * turns into its coded unresolvable-import rejection; nothing here reads a
 * file the lane did not ask for.
 */
export function createServerComponentSourceResolver(
  options: ServerComponentHostOptions,
): ServerComponentModuleResolver {
  const root = options.root;
  return (specifier, importer) => {
    const clean = specifier.split('?', 1)[0]!.split('#', 1)[0]!;
    if (clean === '') return null;
    const importerFile = isAbsolute(importer) ? importer : resolve(root, importer);
    if (clean.startsWith('.')) return probeSourceFile(resolve(dirname(importerFile), clean));
    if (clean.startsWith('/')) return probeSourceFile(resolve(root, clean.slice(1)));
    try {
      return probeSourceFile(createRequire(importerFile).resolve(clean));
    } catch {
      return null;
    }
  };
}

/**
 * The tag set the server function component lane routes nested hosts through
 * `__ssr` with: the tags the SSR serializer itself admits for nested
 * expansion — the admission plan's renderable islands UNION the project's
 * static compiled components (the same union entry-orchestrator binds as the
 * render's `ssrRenderableTags`), so a function page's nested host renders
 * through byte-identical machinery to a class page's. A tag outside the set
 * (client-only island, foreign tag) emits as-is and upgrades through the
 * island pipeline, exactly as before.
 */
export function serverComponentAdmissionTags(
  staticComponents: readonly { tagName: string }[] | undefined,
  renderableIslandTags: readonly string[] | undefined = [],
): string[] {
  return [
    ...new Set([
      ...(staticComponents ?? []).map((component) => component.tagName),
      ...renderableIslandTags,
    ]),
  ].sort();
}
