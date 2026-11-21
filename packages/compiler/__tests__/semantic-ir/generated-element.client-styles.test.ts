/**
 * 2026-11-20 — the `ssr: false` client style-adoption slice, LOCAL Node.
 *
 * The measured gap: the generated lane replaced the class lane's
 * `import sheet from './x.css'` + `static styles = [sheet]` with the sidecar
 * string list `styles: ['./x.css']`. That list is a BUILD-TIME declaration —
 * the island scan turns it into an emitted asset and (for SSR) a DSD `<link>`,
 * but it produces no module-graph edge. An `ssr: false` shadow island has no
 * DSD template and its root is created by the browser, so nothing delivered
 * the sheet: the island rendered completely unstyled.
 *
 * The fix has three parts and this file pins the first two at the compiler
 * boundary:
 *
 * 1. the sidecar reader exposes the EXPLICIT `ssr: false` literal as
 *    `clientOnly` (only that literal; `true` and absent are the same case);
 * 2. the emitter turns a client-only island's declared specifiers into real
 *    `import sheet from '<specifier>'` statements plus a descriptor `styles`
 *    row, adds the new identifiers to the collision list, and fails closed
 *    when a client-only island declares `styles` but no static specifier
 *    reaches it;
 * 3. the shell adopts those sheet objects into the root it created — covered
 *    by the element-browser rows and the starter computed-style proof.
 *
 * The router scanner remains the author-facing authority for the sidecar shape
 * and for the specifier list. These rows assert the COMPILER's half: the same
 * authored sidecar facts, the emitted bytes, and the coded refusals.
 */

import { describe, expect, test } from 'vitest';
import type ts from 'typescript';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { typescriptParser } from '../../src/internal/compiler/semantic-core/parse-module.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import { GENERATED_ELEMENT_DIAGNOSTIC } from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { readIslandMetadata } from '../../src/internal/compiler/semantic-ir/generated-element/site.ts';

const FILE = '/proj/src/islands/live-timer.tsx';
const SITE = { tag: 'live-timer' } as const;

function parse(source: string): ts.SourceFile {
  const parsed = typescriptParser.parseModule(source, FILE);
  expect(parsed.syntaxDiagnostics).toEqual([]);
  return parsed.sourceFile;
}

/** One plain producer-capable island with the given sidecar entry list. */
function island(entries: string): string {
  return (
    "import { defineIslandConfig } from '@openelement/router';\n" +
    `export const openElement = defineIslandConfig({ ${entries} });\n` +
    'function LiveTimer() {\n' +
    '  return <div class="row"><span id="elapsed">0.0</span></div>;\n' +
    '}\n' +
    'export default LiveTimer;\n'
  );
}

function factsOf(source: string): { clientOnly: boolean } {
  const read = readIslandMetadata(parse(source));
  expect(read.kind).toBe('read');
  return read.kind === 'read' ? read.facts : { clientOnly: false };
}

function laneError(source: string): CompiledElementError {
  try {
    compileGeneratedElementIfAdmitted(source, FILE, { site: SITE });
  } catch (error) {
    if (error instanceof CompiledElementError) return error;
    throw error;
  }
  throw new Error('expected the generated element lane to refuse the module');
}

function compile(source: string): string {
  const emitted = compileGeneratedElementIfAdmitted(source, FILE, { site: SITE });
  expect(emitted, 'the lane must admit this module').not.toBeNull();
  return emitted!.code;
}

describe('client-only sidecar fact (explicit ssr: false only)', () => {
  test('ssr: false is the client-only fact', () => {
    expect(factsOf(island("ssr: false, root: 'shadow'")).clientOnly).toBe(true);
  });

  test('a string-literal key reads identically', () => {
    expect(factsOf(island('"ssr": false, "root": "shadow"')).clientOnly).toBe(true);
  });

  test('ssr: true and an absent key are the same (SSR) case', () => {
    expect(factsOf(island("ssr: true, root: 'shadow'")).clientOnly).toBe(false);
    expect(factsOf(island("root: 'shadow'")).clientOnly).toBe(false);
  });

  test("hydrate: 'only' is the other client-only spelling (the scan's own coercion)", () => {
    // `resolveIslandSsrDsd` forces ssr/dsd off for hydrate 'only'. The compiler
    // mirrors that resolution, otherwise the scan would admit a client-only
    // island whose sheet the compiler never emits — the silent unstyled render
    // this slice exists to close.
    const source = island("hydrate: 'only', root: 'shadow', styles: ['./live-timer.css']");
    expect(factsOf(source).clientOnly).toBe(true);
    const code = compile(source);
    expect(code).toContain('import __oeStyle0 from "./live-timer.css";');
  });

  test('a duplicate ssr refuses instead of picking one', () => {
    const error = laneError(island("ssr: false, ssr: true, root: 'shadow'"));
    expect(error.diagnostics.map((item) => item.code)).toContain(
      GENERATED_ELEMENT_DIAGNOSTIC.SSR_INVALID,
    );
  });

  test('a dynamic ssr value refuses instead of guessing the phase', () => {
    const error = laneError(island("ssr: flag(), root: 'shadow', styles: ['./live-timer.css']"));
    expect(error.diagnostics.map((item) => item.code)).toContain(
      GENERATED_ELEMENT_DIAGNOSTIC.SSR_INVALID,
    );
  });
});

describe('client-only sheet imports (the module-graph edge the gap lacked)', () => {
  test('a client-only shadow island imports each declared sheet and carries it on the descriptor', () => {
    const code = compile(
      island(
        "ssr: false, dsd: false, hydrate: 'only', root: 'shadow', styles: ['./live-timer.css']",
      ),
    );
    // A REAL static import of the authored specifier, not a string row: this is
    // the edge the router build's style-asset intercept answers with the sheet
    // adapter (CSSStyleSheet + URL + readiness).
    expect(code).toContain('import __oeStyle0 from "./live-timer.css";');
    expect(code).toContain('styles: [__oeStyle0],');
    // The one asset, one delivery rule still applies: the shadow host wrapper
    // keeps the typed styleLinks channel (the SSR/DSD half), and the client
    // row is additive.
    expect(code).toContain('export function LiveTimer__ssrHost(');
    // P-6: the producer declares every slot in a FIXED order, so the stylesheet
    // channel's presence is asserted on the parameter list it always carries.
    expect(code).toContain('attributes, styleLinks, nestedHost) {');
  });

  test('the imports stay in authored order', () => {
    const code = compile(
      island("ssr: false, hydrate: 'only', root: 'shadow', styles: ['./a.css', './nested/b.css']"),
    );
    expect(code.indexOf('from "./a.css"')).toBeLessThan(code.indexOf('from "./nested/b.css"'));
    expect(code).toContain('styles: [__oeStyle0, __oeStyle1],');
  });

  test('a client-only LIGHT island gets the same module-graph edge', () => {
    const code = compile(
      island("ssr: false, hydrate: 'only', root: 'light', styles: ['./live-timer.css']"),
    );
    expect(code).toContain('import __oeStyle0 from "./live-timer.css";');
    expect(code).toContain('styles: [__oeStyle0],');
    // A light root has no DSD template, so no host wrapper is appended.
    expect(code).not.toContain('LiveTimer__ssrHost');
  });

  test('a client-only island without a styles declaration emits neither the import nor the row', () => {
    const code = compile(island("ssr: false, dsd: false, hydrate: 'only', root: 'shadow'"));
    expect(code).not.toContain('import __oeStyle0');
    expect(code).not.toContain('styles: [');
  });

  test('an SSR shadow island keeps the marked DSD link as its only delivery', () => {
    const styled = compile(
      island("ssr: true, dsd: true, root: 'shadow', styles: ['./live-timer.css']"),
    );
    // The DSD carrier is the sheet's delivery: the wrapper still takes the
    // typed styleLinks channel and the module gains NO import and NO descriptor
    // row (a module-graph copy would be a second delivery the link guard would
    // then have to undo).
    expect(styled).toContain(
      'LiveTimer__ssrHost(props, lightChildren, attributes, styleLinks, nestedHost)',
    );
    expect(styled).not.toContain('styles: [');
    expect(styled).not.toContain('.css";');
  });

  test('an SSR LIGHT island keeps its pre-slice bytes: the document channel owns the sheet', () => {
    const styled = compile(
      island("ssr: true, dsd: false, root: 'light', styles: ['./live-timer.css']"),
    );
    const unstyled = compile(island("ssr: true, dsd: false, root: 'light'"));
    // A light root has no DSD template and its declared sheet is the build's
    // document-level delivery (#1800). The sidecar is not emitted, so the
    // authoritative styles entry may not change one byte of the module.
    expect(styled).toBe(unstyled);
    expect(styled).not.toContain('styles: [');
  });

  // A row here asserted that a client-only island WITHOUT a host producer still
  // gets its sheet edge, forcing producerlessness with a property-channel field.
  // F16 admits that channel, and the emitter now states the producer rule
  // directly: a client-only island with NO declared sheet has no producer, one
  // WITH sheets keeps the wrapper for its `styleLinks` channel. Under that rule
  // the old state — sheets but no producer — is unreachable, so the row is gone
  // rather than re-pointed at something that cannot exist. The delivery it
  // protected is covered by the rows above (import + descriptor row + wrapper).

  test('the fail-closed half: a client-only island whose declared list reaches the emitter empty', () => {
    // The router scan refuses this authored shape with its own coded error; the
    // compiler lane must ALSO refuse, because a descriptor without sheet
    // objects renders the island unstyled with no error at all.
    const error = laneError(island("ssr: false, root: 'shadow', styles: dynamicSheets()"));
    expect(error.diagnostics.map((item) => item.code)).toContain(
      GENERATED_ELEMENT_DIAGNOSTIC.CLIENT_STYLES_UNWIRED,
    );
    expect(String(error.diagnostics[0]!.message)).toContain('client-only');
  });
});

// ---- deletion prerequisite P-1: static class candidates ----------------

test('P-1: the compiled module carries its admitted STATIC class tokens', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ root: 'shadow', styles: [] });
function Card() {
  return <article class="card inline-flex gap-2"><span class="marker">x</span></article>;
}
export default Card;
`;
  const compiled = compileGeneratedElementIfAdmitted(source, '/proj/candidates.tsx', {
    site: { tag: 'oe-candidates' },
  });
  expect(compiled).not.toBeNull();
  expect(compiled!.classCandidates).toEqual(['card', 'gap-2', 'inline-flex', 'marker']);
});

test('P-1: a dynamic class channel contributes NO candidate (an expression is not a token)', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
import { compute } from './compute.ts';
export const openElement = defineIslandConfig({ root: 'shadow' });
function Card() {
  return <article class="static-token" data-x={compute()}>x</article>;
}
export default Card;
`;
  const compiled = compileGeneratedElementIfAdmitted(source, '/proj/candidates-dynamic.tsx', {
    site: { tag: 'oe-candidates-dynamic' },
  });
  expect(compiled).not.toBeNull();
  expect(compiled!.classCandidates).toEqual(['static-token']);
});
