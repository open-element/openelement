/**
 * The server function component XSS admission matrix (RED-first).
 *
 * The compiled server function component lowers to a generative HTML
 * constructor function (`__h`/`__t`/`__ssr`). The security property under test
 * is the SAME one the @element class path enforces through the shared lowering
 * walk (lower-program.ts): an untrusted value can enter the output only
 * through a boundary that escapes it (text → `__t`, attribute → `__h`'s
 * attribute escape, URL attribute → the shared URL screen), or through the
 * explicit trustedHtml brand. Every row asserts one of exactly two outcomes:
 *
 *   - the payload is AUTOMATICALLY ESCAPED in the rendered output, or
 *   - the compile/render is REJECTED WITH A CODE (an OEC build diagnostic or
 *     a coded OpenElementError at the render boundary).
 *
 * A bare string riding into markup through any other channel fails this file.
 *
 * The rows are driven against the REAL compiled artifact: the generated
 * constructor module is transpiled, imported, and executed with hostile props,
 * so the assertions see the wire bytes a browser would parse — not the
 * compiler's intent.
 */

import { execFile } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import ts from 'typescript';
import {
  compileServerComponentModule,
  type ServerComponentCompileOptions,
} from '../src/internal/compiler/semantic-core/server-component.ts';
import { CompiledElementError } from '../src/internal/compiler/semantic-core/compile.ts';

const FILE = '/proj/app/server/card.tsx';

/** One hostile-or-benign props record handed to the compiled function. */
type Props = Record<string, unknown>;

/** Compile one server function component module, failing loud on diagnostics. */
function compile(source: string, options: ServerComponentCompileOptions = {}): { code: string } {
  const result = compileServerComponentModule(source, FILE, options);
  if (result === null) throw new Error('the module compiled to nothing; a component was expected');
  return result;
}

/** Collect the ordered OEC diagnostics of a compile expected to fail. */
function diagnosticsOf(source: string): Array<{ code: string; message: string }> {
  try {
    compile(source);
  } catch (error) {
    if (error instanceof CompiledElementError) {
      return error.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        message: diagnostic.message,
      }));
    }
    throw error;
  }
  throw new Error('the module compiled; a coded rejection was expected');
}

// ─── Execution harness: transpile + import the REAL generated module ────

const execFileAsync = promisify(execFile);
let scratch: string;
let serial = 0;
/**
 * `trustedHtml` from the SAME native module instance the executed temp module
 * sees (the test file's own vite-node instance carries a different brand
 * WeakSet, so the brand must be minted across the boundary the temp module
 * resolves through).
 */
let nativeTrustedHtml: ((html: string) => unknown) | undefined;

beforeAll(async () => {
  // The generated module imports '@openelement/element/server' — a bare
  // specifier that only resolves inside the workspace. Node resolves bare
  // specifiers by walking up `node_modules` directories from the importing
  // file, so the scratch dir lives UNDER the repo's own node_modules (the
  // directory git never lints and the package manager never globs). The anchor
  // is this file's location, never `process.cwd()`: the canonical task runs
  // vitest from `packages/compiler`, where a cwd-anchored scratch dir both
  // breaks the `../../packages/...` brand import below and puts the walk-up
  // out of reach of the repo's own links.
  const root = join(import.meta.dirname, '..', '..', '..');
  scratch = join(root, 'node_modules', '.oe-server-component-matrix');
  await rm(scratch, { recursive: true, force: true });
  await execFileAsync('mkdir', ['-p', scratch]);
  // The brand must be minted in the SAME native module instance the executed
  // temp module sees (the test file's own module runner carries a different
  // brand WeakSet), so it is loaded through the identical scratch channel.
  await writeFile(
    join(scratch, 'brand.mjs'),
    "export { trustedHtml } from '../../packages/element/src/html.ts';\n",
  );
  nativeTrustedHtml = (
    (await import(pathToFileURL(join(scratch, 'brand.mjs')).href)) as {
      trustedHtml: (html: string) => unknown;
    }
  ).trustedHtml;
});

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

/**
 * Compile, transpile, import, and execute one fixture module. Returns the
 * named component's output HTML for `props` — the actual bytes the artifact
 * emits, not a model of them.
 */
async function renderOf(
  source: string,
  props: Props,
  name = 'Card',
  options: ServerComponentCompileOptions = {},
): Promise<string> {
  const { code } = compile(source, options);
  const js = ts.transpileModule(code, {
    fileName: FILE,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const file = join(scratch, `matrix-${serial++}.mjs`);
  await writeFile(file, js);
  const mod = (await import(pathToFileURL(file).href)) as Record<string, (props: Props) => string>;
  const component = mod[name];
  if (typeof component !== 'function') {
    throw new Error(`the generated module did not export the component ${name}`);
  }
  return component(props);
}

/** The coded render-boundary rejection a compiled function raised. */
async function renderErrorOf(
  source: string,
  props: Props,
  name = 'Card',
  options: ServerComponentCompileOptions = {},
): Promise<{ code: string; message: string }> {
  try {
    await renderOf(source, props, name, options);
  } catch (error) {
    // Duck-typed on purpose: the temp module loads the element package through
    // the NATIVE resolver while the test file loads it through vite-node —
    // two module instances, so `instanceof` cannot cross. OpenElementError
    // carries a stable `name` and a public readonly `code`.
    const candidate = error as { name?: string; code?: string; message?: string };
    if (candidate?.name === 'OpenElementError' && typeof candidate.code === 'string') {
      return { code: candidate.code, message: candidate.message ?? '' };
    }
    throw error;
  }
  throw new Error('the compiled component rendered; a coded rejection was expected');
}

// ─── The fixture every runtime row compiles ──────────────────────────

const TRUSTED_IMPORT = "import type { TrustedHtml } from '@openelement/element';";

/** One component whose every dynamic position is bound, per the args given. */
function card(body: string, propsType: string): string {
  return `${TRUSTED_IMPORT}
export function Card(props: { ${propsType} }) {
  return ${body};
}
`;
}

// ─── 1. Text position ─────────────────────────────────────────────────

describe('matrix: text position', () => {
  test('a <script> payload in dynamic text is escaped, never live markup', async () => {
    const html = await renderOf(card('<p>{props.bio}</p>', 'bio: string'), {
      bio: '<script>alert(1)</script>',
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script');
  });

  test('an <img onerror=> payload in dynamic text is escaped, never a live tag', async () => {
    const html = await renderOf(card('<p>{props.bio}</p>', 'bio: string'), {
      bio: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toMatch(/<img/);
    expect(html).toContain('&lt;img');
  });

  test('a bare onerror= payload in dynamic text stays inert text, outside any tag', async () => {
    const html = await renderOf(card('<p>{props.bio}</p>', 'bio: string'), {
      bio: 'onerror=alert(1)',
    });
    // The text is preserved (it is inert in text content) but no tag carries it.
    expect(html).toContain('onerror=alert(1)');
    expect(html).not.toMatch(/<[a-z][^>]*onerror/i);
  });

  test('re-injection: already-escaped text is double-escaped, never revived', async () => {
    const html = await renderOf(card('<p>{props.bio}</p>', 'bio: string'), {
      bio: '&lt;script&gt;alert(1)&lt;/script&gt;',
    });
    expect(html).toContain('&amp;lt;script&amp;gt;');
    expect(html).not.toContain('<script');
  });
});

/**
 * Strip every quoted attribute value, leaving only the tag skeleton — a
 * payload that survives INSIDE a quoted value is inert; this exposes any
 * payload that broke OUT into real markup.
 */
function tagSkeleton(html: string): string {
  return html.replace(/="[^"]*"/g, '=""');
}

// ─── 2. Attribute position ────────────────────────────────────────────

describe('matrix: attribute position', () => {
  test('a quote-escape payload cannot break out of a static-adjacent dynamic attribute', async () => {
    const html = await renderOf(card('<div class={props.cls}>x</div>', 'cls: string'), {
      cls: '"><img src=x onerror=alert(1)>',
    });
    // The value is attribute-escaped: quotes cannot close the attribute, so no
    // second tag can form.
    expect(html).toContain('&quot;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('"><img');
  });

  test('an onerror= payload as an attribute VALUE stays an inert quoted value', async () => {
    const html = await renderOf(card('<div title={props.cls}>x</div>', 'cls: string'), {
      cls: 'onerror=alert(1)',
    });
    expect(html).toContain('title="onerror=alert(1)"');
    // No handler attribute was introduced: onerror appears only inside the
    // quoted title value.
    expect(tagSkeleton(html)).not.toContain('onerror');
  });

  test('dynamic attribute NAMES are outside the grammar: spreads are coded rejections', () => {
    const diagnostics = diagnosticsOf(card('<div {...props.attrs}>x</div>', 'attrs: string'));
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('OEC9011');
    expect(diagnostics[0]?.message).toContain('write each attribute explicitly');
  });
});

// ─── 3. URL position ──────────────────────────────────────────────────

describe('matrix: URL position', () => {
  test('a quote-escape payload cannot break out of an href attribute value', async () => {
    const html = await renderOf(card('<a href={props.url}>x</a>', 'url: string'), {
      url: '" onerror="alert(1)',
    });
    const match = /href="([^"]*)"/.exec(html);
    expect(match, 'the href attribute must terminate with one quoted value').not.toBeNull();
    expect(match![1]).not.toContain('"');
    expect(html).toContain('&quot;');
    expect(tagSkeleton(html)).not.toContain('onerror');
  });

  test('a <script> payload in an href value is escaped, never markup', async () => {
    const html = await renderOf(card('<a href={props.url}>x</a>', 'url: string'), {
      url: '"><script>alert(1)</script>',
    });
    expect(html).not.toContain('<script');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  test('a script-bearing URL scheme is rejected with a code at the render boundary', async () => {
    const error = await renderErrorOf(card('<a href={props.url}>x</a>', 'url: string'), {
      url: 'javascript:alert(1)',
    });
    expect(error.code).toBe('OE_UNSAFE_URL_SINK');
  });
});

// ─── 4. The trustedHtml boundary ─────────────────────────────────────

describe('matrix: trustedHtml boundary', () => {
  test('an innerHTML sink without the trustedHtml marker is a coded rejection', () => {
    const diagnostics = diagnosticsOf(
      card('<div innerHTML={props.body}></div>', 'body: TrustedHtml'),
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('OEC9026');
  });

  test('an innerHTML sink over a plain string prop is a coded rejection', () => {
    const diagnostics = diagnosticsOf(
      card('<div trustedHtml innerHTML={props.body}></div>', 'body: string'),
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('OEC9026');
    expect(diagnostics[0]?.message).toContain('Object-typed');
  });

  test('a forged brand (plain object) is rejected with a code at the render boundary', async () => {
    const error = await renderErrorOf(
      card('<div trustedHtml innerHTML={props.body}></div>', 'body: TrustedHtml'),
      { body: { html: '<script>alert(1)</script>' } },
    );
    expect(error.code).toBe('OE_UNTRUSTED_HTML_SINK');
  });

  test('a forged brand (bare string) is rejected with a code at the render boundary', async () => {
    const error = await renderErrorOf(
      card('<div trustedHtml innerHTML={props.body}></div>', 'body: TrustedHtml'),
      { body: '<b>bold</b>' },
    );
    expect(error.code).toBe('OE_UNTRUSTED_HTML_SINK');
  });

  test('the branded value is the ONLY channel that renders raw markup', async () => {
    const html = await renderOf(
      card('<div trustedHtml innerHTML={props.body}></div>', 'body: TrustedHtml'),
      { body: nativeTrustedHtml!('<b>ok</b>') },
    );
    expect(html).toContain('<b>ok</b>');
  });
});

// ─── 5. Client-only constructs in a server function ──────────────────

describe('matrix: client-only constructs are coded rejections', () => {
  test('an event handler inside a server function component is a coded rejection', () => {
    const diagnostics = diagnosticsOf(
      card('<button onClick={() => {}}>x</button>', 'label: string'),
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('OEC9031');
    expect(diagnostics[0]?.message).toContain('client-only');
  });

  test('a ref inside a server function component is a coded rejection', () => {
    const diagnostics = diagnosticsOf(
      card('<div ref={props.anchor}>x</div>', 'anchor: TrustedHtml'),
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('OEC9031');
  });

  test('a this-read inside a server function component is a coded rejection', () => {
    const diagnostics = diagnosticsOf(card('<p>{this.label}</p>', 'label: string'));
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('OEC9032');
    expect(diagnostics[0]?.message).toContain('props.');
  });
});
