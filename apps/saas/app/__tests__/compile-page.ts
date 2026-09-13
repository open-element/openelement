/**
 * Test helper: run the real element compiler over a page/island component
 * source (through the public `@openelement/element/compiler` entry) and
 * import the emitted module, so Deno tests exercise the actual compiled
 * class (Part Program + facade) instead of a hand-built double. Deno tests
 * must never import the authoring .tsx modules directly — the ambient
 * @element/@property decorators are compile-time-only input and throw at
 * module evaluation outside the adapter transform.
 */
import { compileElementProgram } from '@openelement/element/compiler';

// Resolved through the workspace (daily dev) or the installed packed
// tarballs (release qualification) — never a relative path into a package.
const ELEMENT_URL = import.meta.resolve('@openelement/element');
const APP_URL = import.meta.resolve('@openelement/router');

/** Compile + import the default-exported compiled class of one component module. */
export async function compileComponentClass(
  sourceUrl: string,
): Promise<CustomElementConstructor> {
  const absoluteSource = new URL(sourceUrl, import.meta.url);
  const source = await Deno.readTextFile(absoluteSource);
  const { code } = compileElementProgram(source, sourceUrl);
  // The emitted module imports the framework packages by bare specifier;
  // re-point them at the monorepo sources, and rebase the component's
  // relative imports onto its own directory. The rewritten module imports
  // through a data: URL so the test sandbox needs no write permission.
  const rewritten = code
    .replaceAll("from '@openelement/element'", `from '${ELEMENT_URL}'`)
    .replaceAll("from '@openelement/router'", `from '${APP_URL}'`)
    .replaceAll(
      /from '(\.[^']*)'/g,
      (_match, specifier: string) => `from '${new URL(specifier, absoluteSource).href}'`,
    );
  // The rewritten module imports through a data: URL so the test sandbox
  // needs no write permission; encode UTF-8-safe (component sources carry
  // non-ASCII copy) and declare the TypeScript media type so Deno parses the
  // emitted annotations.
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(rewritten)));
  const mod = await import(`data:application/typescript;base64,${encoded}`);
  return mod.default as CustomElementConstructor;
}
