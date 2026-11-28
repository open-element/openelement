/**
 * Test helper: run a real page/island compiler lane over a component source
 * (through the public `@openelement/compiler` entry) and import the emitted
 * module, so vitest tests exercise the actual compiled output instead of a
 * hand-built double.
 *
 * WHY ONLY TWO LANES. The class/decorator lane was retired with the Alpha16
 * closeout (its `compileElementProgram` entry no longer exists), so the class
 * form this helper used to compile has no surviving implementation to call.
 * Two lanes remain and each helper below is one of them: the generated
 * element lane (`compileGeneratedIsland`) for an authored island module, and
 * the server function page lane (`compileFunctionPage`) for a route module's
 * page function. A test that needs a page picks the lane the page actually
 * ships through; there is no compatibility wrapper, because a wrapper would
 * keep a retired author form reachable from the test seam.
 *
 * vitest tests must never import the authoring .tsx modules directly — the
 * island sidecar and JSX are compile-time-only input and the source does not
 * evaluate as a browser module outside a compiler transform.
 */
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compileGeneratedElementIfAdmitted,
  compileServerComponentIfAdmitted,
} from '@openelement/compiler';

// Resolved through the workspace (daily dev) or the installed packed
// tarballs (release qualification) — never a relative path into a package.
const ELEMENT_URL = import.meta.resolve('@openelement/element');
const APP_URL = import.meta.resolve('@openelement/router');
const SERVER_URL = import.meta.resolve('@openelement/element/server');
// The generated leaf imports its primitives from a SUBPATH (M11-3), so the
// rewrite table needs that entry too — a bare-specifier-only rewrite leaves the
// temp module unable to resolve it.
const LEAF_RUNTIME_URL = import.meta.resolve('@openelement/element/internal/compiled/leaf-runtime');
const SHELL_URL = import.meta
  .resolve('@openelement/element/internal/compiled/generated-element/shell');

/**
 * Compile + import a GENERATED-lane island component (function component plus
 * its `defineIslandConfig` sidecar).
 *
 * A generated module has no class to compile: the lane emits the element class
 * from the sidecar, so the import surface is `{ default: ComponentFunction,
 * <Tag>Element }`. The island's tag comes from the scan in a real build; here it
 * is supplied directly, exactly as the site's island scanner would.
 */
export async function compileGeneratedIsland(
  sourceUrl: string,
  tag: string,
): Promise<{
  readonly element: CustomElementConstructor;
  /** The compiler-emitted `<Name>__ssrHost` DSD producer, when the lane made one. */
  readonly ssrHost?: (props?: unknown, lightChildren?: string) => string;
}> {
  const absoluteSource = new URL(sourceUrl, import.meta.url);
  const source = await readFile(absoluteSource, 'utf8');
  const compiled = compileGeneratedElementIfAdmitted(source, sourceUrl, {
    site: { tag },
  });
  if (compiled === null) {
    throw new Error(`${sourceUrl} is not admitted by the generated-element lane`);
  }
  const rewritten = compiled.code
    // The emitted JSON quotes subpath specifiers with DOUBLE quotes while the
    // authored body uses single quotes, so these replacements are literal
    // substring swaps (quote-agnostic). EVERY element subpath the emitted module
    // can name is listed: a missed one surfaces as an unresolvable import.
    .replaceAll('@openelement/element/internal/compiled/leaf-runtime', LEAF_RUNTIME_URL)
    .replaceAll('@openelement/element/internal/compiled/generated-element/shell', SHELL_URL)
    .replaceAll("from '@openelement/element'", `from '${ELEMENT_URL}'`)
    .replaceAll("from '@openelement/router'", `from '${APP_URL}'`)
    // Relative imports arrive with EITHER quote style (the emitted tail is
    // JSON-quoted, the authored body is not), so both are rebased.
    .replaceAll(
      /from (['"])(\.[^'"]*)\1/g,
      (_match, quote: string, specifier: string) =>
        `from ${quote}${new URL(specifier, absoluteSource).href}${quote}`,
    );
  const tempDir = await mkdtemp(join(tmpdir(), 'oe-saas-generated-page-'));
  const tempModule = join(tempDir, 'compiled-island.ts');
  await writeFile(tempModule, rewritten, 'utf8');
  const mod = (await import(pathToFileURL(tempModule).href)) as Record<string, unknown>;
  await rm(tempDir, { recursive: true, force: true });
  const element = Object.entries(mod).find(
    ([name, value]) => name.endsWith('Element') && typeof value === 'function',
  )?.[1];
  if (typeof element !== 'function') {
    throw new Error(`${sourceUrl} emitted no element class`);
  }
  const ssrHost = Object.entries(mod).find(
    ([name, value]) => name.endsWith('__ssrHost') && typeof value === 'function',
  )?.[1] as ((props?: unknown, lightChildren?: string) => string) | undefined;
  return {
    element: element as CustomElementConstructor,
    ...(ssrHost === undefined ? {} : { ssrHost }),
  };
}

/**
 * Compile + import a SERVER FUNCTION PAGE component declared in a route module.
 *
 * The page-authorship rule (execution-plan §19.9) puts the component function in
 * the route module itself, and the server-component lane lowers it into a
 * plain function that RETURNS the serialized markup for its projected props —
 * there is no element class and no `renderToString` call. This helper is that
 * lane's test seam: it runs the same compiler entry the build runs, imports the
 * emitted module, and hands back the named component function.
 */
export async function compileFunctionPage(
  sourceUrl: string,
  componentName: string,
): Promise<(props: Record<string, unknown>) => Promise<string>> {
  const absoluteSource = new URL(sourceUrl, import.meta.url);
  const source = await readFile(absoluteSource, 'utf8');
  const compiled = compileServerComponentIfAdmitted(source, sourceUrl);
  if (compiled === null) {
    throw new Error(`${sourceUrl} is not admitted by the server-component lane`);
  }
  const rewritten = compiled.code
    .replace(
      /from (['"])@openelement\/element\/server\1/g,
      (_match, quote: string) => `from ${quote}${SERVER_URL}${quote}`,
    )
    .replaceAll("from '@openelement/element'", `from '${ELEMENT_URL}'`)
    .replaceAll("from '@openelement/router'", `from '${APP_URL}'`)
    .replaceAll(
      /from (['"])(\.[^'"]*)\1/g,
      (_match, quote: string, specifier: string) =>
        `from ${quote}${new URL(specifier, absoluteSource).href}${quote}`,
    );
  const tempDir = await mkdtemp(join(tmpdir(), 'oe-saas-function-page-'));
  const tempModule = join(tempDir, 'compiled-function-page.ts');
  await writeFile(tempModule, rewritten, 'utf8');
  const mod = (await import(pathToFileURL(tempModule).href)) as Record<string, unknown>;
  await rm(tempDir, { recursive: true, force: true });
  const component = mod[componentName];
  if (typeof component !== 'function') {
    throw new Error(`${sourceUrl} emitted no function component named ${componentName}`);
  }
  return async (props) => String(await (component as (p: unknown) => unknown)(props));
}
