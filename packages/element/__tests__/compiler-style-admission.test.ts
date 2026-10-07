/**
 * Island style asset protocol — compiler-side static style admission and
 * style-resource request generation (ADR-0164 §4, #1553 compiler lane).
 *
 * Behavior-first coverage for the compiler half of the protocol:
 *   - the four statically provable shapes (bare template literal,
 *     compiledStyle()-marked call, static array, same-module constant) emit
 *     the reserved-suffix `.oe-style.css` resource request and the static
 *     styles reference shape
 *   - dynamic composition fails closed with OEC9028 and a migration hint —
 *     never a silent inline fallback
 *   - the legacy verbatim path is unchanged where the protocol says it stays:
 *     protocol off, and non-island modules with the protocol on
 *   - same-module style constants are erased from the generated module; a
 *     reference outside the styles channels fails closed
 *   - the style-request registry hands the request's CSS to the intercepting
 *     host build under the module id its resolver lands on (the consumer form
 *     the router's style-asset plugin reads — seams.md "CSS import
 *     compatibility" row)
 */

import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  CompiledElementError,
  compileElementProgram,
} from '../src/internal/compiler/semantic-core/compile.ts';
import type { StaticSidecarDescriptor } from '../src/internal/compiler/semantic-core/module-analysis.ts';
import { compiledElementPlugin } from '../src/internal/compiler/plugin.ts';
import {
  clearStyleRequests,
  getStyleRequest,
  styleRequestModuleId,
} from '../src/internal/compiler/style-requests.ts';

/**
 * The island sidecar descriptor the router injects (mirrored — element tests
 * cannot import the router package; matches
 * router/src/vite/internal/protocol/island-admission.ts).
 */
const ISLAND_SIDECAR: StaticSidecarDescriptor = {
  moduleSpecifier: '@openelement/router',
  exportName: 'defineIslandConfig',
  kind: 'static-sidecar',
};

const PROTOCOL_ON = { staticSidecars: [ISLAND_SIDECAR], styleAssetProtocol: true } as const;

/**
 * An island module whose `static styles` initializer is the given text.
 * `topLevel` rides between the island policy and the class; `members` land
 * inside the class body after the styles member.
 */
function islandSource(
  styles: string,
  { topLevel = [], members = [] }: { topLevel?: string[]; members?: string[] } = {},
): string {
  return [
    "import { element, OpenElement, type StyleSheetLike } from '@openelement/element';",
    "import { defineIslandConfig } from '@openelement/router';",
    "import { compiledStyle } from './site-ui/compiled-style.ts';",
    'export const openElement = defineIslandConfig({ hydrate: "idle" });',
    ...topLevel,
    "@element('oe-admit')",
    'export class StyleAdmit extends OpenElement {',
    `  ${styles}`,
    ...members,
    '  render() {',
    '    return <main>hello</main>;',
    '  }',
    '}',
  ].join('\n');
}

function compileWithProtocol(source: string) {
  return compileElementProgram(source, '/project/app/islands/admit.tsx', PROTOCOL_ON);
}

/** Compile expecting the fail-closed diagnostic; return the structured error. */
function compileFailing(source: string, options = PROTOCOL_ON): CompiledElementError {
  try {
    compileElementProgram(source, '/project/app/islands/admit.tsx', options);
  } catch (error) {
    if (error instanceof CompiledElementError) return error;
    throw error;
  }
  throw new Error('expected the compile to fail closed with a CompiledElementError');
}

/** The transform hook bound to a harness context (the vite container's shape). */
function transformHook(options: Parameters<typeof compiledElementPlugin>[0]) {
  const plugin = compiledElementPlugin(options);
  const transform = plugin.transform as unknown as (
    this: { error(message: string): never },
    code: string,
    id: string,
  ) => string | null;
  const context = {
    error(message: string): never {
      throw new Error(message);
    },
  };
  return (code: string, id: string): string | null => transform.call(context, code, id);
}

beforeEach(() => {
  clearStyleRequests();
});

describe('island style asset protocol — admission matrix (ADR-0164 §4)', () => {
  test('a bare template literal emits the reserved-suffix request and the reference shape', () => {
    const { code, styleRequest } = compileWithProtocol(
      islandSource('static override styles = `:host { display: block; }`;'),
    );
    expect(code).toContain("import __oeStyle from './oe-admit.oe-style.css';");
    expect(code).toContain('static override styles = [__oeStyle];');
    // The inlined sheet text is gone from the generated module.
    expect(code).not.toContain('display: block;');
    expect(styleRequest).toEqual({
      tag: 'oe-admit',
      specifier: './oe-admit.oe-style.css',
      css: ':host { display: block; }',
    });
  });

  test('compiledStyle() over a template literal and a string literal is admitted in order', () => {
    const { styleRequest } = compileWithProtocol(
      islandSource(
        'static override styles = [compiledStyle(`a { color: red; }`), compiledStyle("b { color: blue; }")];',
      ),
    );
    expect(styleRequest?.css).toBe('a { color: red; }\nb { color: blue; }');
    expect(styleRequest?.specifier).toBe('./oe-admit.oe-style.css');
  });

  test('the authored annotation is preserved on the reference shape', () => {
    const { code } = compileWithProtocol(
      islandSource('static override styles: StyleSheetLike[] = [compiledStyle(`:host {}`)];'),
    );
    expect(code).toContain('static override styles: StyleSheetLike[] = [__oeStyle];');
  });

  test('same-module style constants are admitted and erased from the generated module', () => {
    const { code, styleRequest } = compileWithProtocol(
      islandSource('static override styles = [SHEET];', {
        topLevel: ['const RAW = `:host { color: red; }`;', 'const SHEET = compiledStyle(RAW);'],
      }),
    );
    // The constants' bytes ride the emitted asset, not the generated module.
    expect(code).not.toContain('color: red;');
    expect(code).not.toContain('const RAW');
    expect(code).not.toContain('const SHEET');
    expect(code).toContain('static override styles = [__oeStyle];');
    expect(styleRequest?.css).toBe(':host { color: red; }');
  });

  test('style constants compose: a const of an array of admitted sheets', () => {
    const { styleRequest } = compileWithProtocol(
      islandSource('static override styles = INNER;', {
        topLevel: [
          'const BASE = `:host { color: red; }`;',
          'const INNER = [compiledStyle(BASE), compiledStyle(`a { color: blue; }`)];',
        ],
      }),
    );
    expect(styleRequest?.css).toBe(':host { color: red; }\na { color: blue; }');
  });

  test('emission is deterministic: byte-identical code, map and request across runs', () => {
    const source = islandSource(
      'static override styles = [compiledStyle(`:host { color: red; }`)];',
    );
    const first = compileWithProtocol(source);
    const second = compileWithProtocol(source);
    expect(first.code).toBe(second.code);
    expect(first.styleRequest).toEqual(second.styleRequest);
    expect(first.map.mappings).toBe(second.map.mappings);
  });

  test('the request import and the reference line map to the authored styles initializer', () => {
    const source = islandSource(
      'static override styles = [compiledStyle(`:host { color: red; }`)];',
    );
    const { code, map } = compileWithProtocol(source);
    const trace = new TraceMap(map);
    const generatedLines = code.split('\n');
    const importLine = generatedLines.findIndex((line) => line.includes('.oe-style.css'));
    const referenceLine = generatedLines.findIndex((line) => line.includes('[__oeStyle];'));
    expect(importLine).toBeGreaterThan(-1);
    expect(referenceLine).toBeGreaterThan(-1);
    const authoredLine =
      source
        .split('\n')
        .findIndex((line) => line.trimStart().startsWith('static override styles')) + 1;
    // The import line's segment sits at column 0; the reference line's at the
    // derived value's start (after the head, at the '[' of [__oeStyle]).
    const referenceColumn = generatedLines[referenceLine]!.indexOf('[');
    const resolvedImport = originalPositionFor(trace, { line: importLine + 1, column: 0 });
    const resolvedReference = originalPositionFor(trace, {
      line: referenceLine + 1,
      column: referenceColumn,
    });
    expect(resolvedImport.line).toBe(authoredLine);
    expect(resolvedReference.line).toBe(authoredLine);
  });
});

describe('island style asset protocol — dynamic composition fails closed', () => {
  test('interpolated template literal', () => {
    const error = compileFailing(
      islandSource('static override styles = [compiledStyle(`a { inset: ${1 + 1}px; }`)];'),
    );
    expect(error.diagnostics[0]?.code).toBe('OEC9028');
    expect(error.diagnostics[0]?.message).toContain('statically provable');
    expect(error.diagnostics[0]?.message).toContain('compiledStyle()');
  });

  test('a foreign sheet factory is not the marked convention', () => {
    const error = compileFailing(
      islandSource('static override styles = [recipe(`:host { color: red; }`)];', {
        topLevel: ["import { recipe } from './recipes.ts';"],
      }),
    );
    expect(error.diagnostics[0]?.code).toBe('OEC9028');
    expect(error.diagnostics[0]?.message).toContain('recipe');
  });

  test('runtime concatenation of a constant with a literal', () => {
    const error = compileFailing(
      islandSource('static override styles = [compiledStyle(BASE + `a { color: red; }`)];', {
        topLevel: ['const BASE = `:host { color: red; }`;'],
      }),
    );
    expect(error.diagnostics[0]?.code).toBe('OEC9028');
  });

  test('a cross-module constant is not statically provable', () => {
    const error = compileFailing(
      islandSource('static override styles = SHEET;', {
        topLevel: ["import { SHEET } from './sheet.ts';"],
      }),
    );
    expect(error.diagnostics[0]?.code).toBe('OEC9028');
    expect(error.diagnostics[0]?.message).toContain('same-module style constant');
  });

  test('spread in the styles array', () => {
    const error = compileFailing(
      islandSource('static override styles = [...SHEETS];', {
        topLevel: ["import { SHEETS } from './sheet.ts';"],
      }),
    );
    expect(error.diagnostics[0]?.code).toBe('OEC9028');
  });

  test('@import cannot ride a constructable sheet', () => {
    const error = compileFailing(
      islandSource('static override styles = [`@import url("./other.css");`];'),
    );
    expect(error.diagnostics[0]?.code).toBe('OEC9028');
    expect(error.diagnostics[0]?.message).toContain('@import');
  });

  test('a style constant referenced outside static styles fails closed', () => {
    const error = compileFailing(
      islandSource('static override styles = [compiledStyle(RAW)];', {
        topLevel: ['const RAW = `:host { color: red; }`;'],
        members: ['  ping(): void { void RAW; }'],
      }),
    );
    expect(error.diagnostics[0]?.code).toBe('OEC9028');
    expect(error.diagnostics[0]?.message).toContain('referenced outside static styles');
  });
});

describe('island style asset protocol — explicit legacy scope (ADR-0164 §4)', () => {
  test('protocol off: island modules keep the verbatim path, byte for byte', () => {
    const source = islandSource(
      'static override styles = [compiledStyle(`:host { color: red; }`)];',
    );
    const { code, styleRequest } = compileElementProgram(source, '/project/app/islands/admit.tsx', {
      staticSidecars: [ISLAND_SIDECAR],
    });
    expect(code).toContain('static override styles = [compiledStyle(`:host { color: red; }`)];');
    expect(code).not.toContain('.oe-style.css');
    expect(styleRequest).toBeUndefined();
  });

  test('protocol on, non-island module: the legacy verbatim path stays', () => {
    const source = [
      "import { element, OpenElement } from '@openelement/element';",
      "import { compiledStyle } from './site-ui/compiled-style.ts';",
      "@element('oe-legacy')",
      'export class Legacy extends OpenElement {',
      '  static override styles = [compiledStyle(`:host { color: red; }`)];',
      '  render() {',
      '    return <main>hello</main>;',
      '  }',
      '}',
    ].join('\n');
    const { code, styleRequest } = compileWithProtocol(source);
    expect(code).toContain('static override styles = [compiledStyle(`:host { color: red; }`)];');
    expect(code).not.toContain('.oe-style.css');
    expect(styleRequest).toBeUndefined();
  });

  test('a non-style const stays outside the compiled grammar (OEC9008, unchanged)', () => {
    const error = compileFailing(
      islandSource('static override styles = [compiledStyle(`:host { color: red; }`)];', {
        topLevel: ['const version = 3;'],
      }),
    );
    expect(error.diagnostics[0]?.code).toBe('OEC9008');
  });
});

describe('style-request payload registry — the intercepting build reads the request here', () => {
  // The request id stems from the component tag (the specifier's file name),
  // not the importing module's file name.
  const REQUEST_ID = '/project/app/islands/oe-admit.oe-style.css';

  test('the plugin registers the request under the resolver-landed module id', () => {
    const transform = transformHook({
      staticSidecars: [ISLAND_SIDECAR],
      styleAssetProtocol: true,
    });
    const emitted = transform(
      islandSource('static override styles = [compiledStyle(`:host { color: red; }`)];'),
      '/project/app/islands/admit.tsx',
    );
    expect(emitted).toContain("import __oeStyle from './oe-admit.oe-style.css';");
    expect(getStyleRequest(REQUEST_ID)).toEqual({
      tag: 'oe-admit',
      specifier: './oe-admit.oe-style.css',
      css: ':host { color: red; }',
      moduleId: REQUEST_ID,
      importer: '/project/app/islands/admit.tsx',
    });
  });

  test('a query-carrying importer id re-registers under one key', () => {
    expect(
      styleRequestModuleId('/project/app/islands/admit.tsx?v=2', './oe-admit.oe-style.css'),
    ).toBe(REQUEST_ID);
  });

  test('an unknown id carries no request, and clearing empties the registry', () => {
    const transform = transformHook({
      staticSidecars: [ISLAND_SIDECAR],
      styleAssetProtocol: true,
    });
    transform(
      islandSource('static override styles = [compiledStyle(`:host {}`)];'),
      '/project/app/islands/admit.tsx',
    );
    expect(getStyleRequest(REQUEST_ID)).toBeDefined();
    expect(getStyleRequest('/project/app/islands/other.oe-style.css')).toBeUndefined();
    clearStyleRequests();
    expect(getStyleRequest(REQUEST_ID)).toBeUndefined();
  });

  test('protocol off: the plugin registers nothing', () => {
    const transform = transformHook({ staticSidecars: [ISLAND_SIDECAR] });
    transform(
      islandSource('static override styles = [compiledStyle(`:host {}`)];'),
      '/project/app/islands/admit.tsx',
    );
    expect(getStyleRequest(REQUEST_ID)).toBeUndefined();
  });
});
