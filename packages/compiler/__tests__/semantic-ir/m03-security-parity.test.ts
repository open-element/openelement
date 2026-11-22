/**
 * M03-I-4b — the function frontend's per-position security matrix.
 *
 * Every expression position the function frontend admits is exercised with
 * negative fixtures proving the canonical admission predicates refuse the
 * sinks the Alpha15 baseline refused. The predicates are reused, never
 * duplicated (`forbiddenSinkReason`, `isSafeAttributeName`,
 * `classifyIntrinsicAttribute`).
 *
 * WHY there is no class column any more: this suite was the class-vs-function
 * parity harness, and Alpha16 retired the class frontend outright. The half
 * that still has a subject — "the surviving frontend refuses the sink at each
 * position it admits, through the shared predicate" — is kept; the class half
 * is deleted rather than stubbed, because a comparison against a frontend that
 * no longer exists would either be tautological or assert nothing.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { forbiddenSinkReason } from '@openelement/protocol/forbidden-sinks';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';

const FILE = '/proj/src/security-parity.tsx';

function functionDiagnostics(render: string): Array<{ code: string; token: string }> {
  const source = `function Fixture(props) { return ${render}; }\n`;
  const result = compileFunctionModule(source, FILE);
  return result.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    token: source.slice(diagnostic.start, diagnostic.end),
  }));
}

/** Normalize a diagnostic span to the offending attribute/tag token. */
function offending(
  diagnostics: Array<{ code: string; token: string }>,
  code: string,
): string | undefined {
  const hit = diagnostics.find((diagnostic) => diagnostic.code === code);
  if (hit === undefined) return undefined;
  return hit.token.includes('=') ? hit.token.slice(0, hit.token.indexOf('=')) : hit.token;
}

interface PositionRow {
  readonly position: string;
  /** Function-fixture render argument. */
  readonly functionRender: (sink: string) => string;
  readonly sink: string;
  readonly code: string;
}

/**
 * The admitted expression positions of the function frontend:
 *  1. direct element dynamic attribute
 *  2. condition-branch JSX
 *  3. list-template JSX
 *  4. JSX inside an expression position (lowered to a recipe target)
 *  5. component-reference props (not a sink position; positive row)
 * Each is injected with the same forbidden sink (`srcdoc`) so the canonical
 * predicate is exercised on that position.
 */
const SRCDOC_ROWS: readonly PositionRow[] = [
  {
    position: 'direct element attribute',
    functionRender: (sink) => `<x-widget ${sink}={props.raw}></x-widget>`,
    sink: 'srcdoc',
    code: 'OEC9011',
  },
  {
    position: 'condition branch',
    functionRender: (sink) =>
      `<main>{props.ok ? <x-widget ${sink}={props.raw}></x-widget> : <i />}</main>`,
    sink: 'srcdoc',
    code: 'OEC9011',
  },
  {
    position: 'list template',
    functionRender: (sink) => `<ul>{props.items.map((item) => <li ${sink}={item.text}></li>)}</ul>`,
    sink: 'srcdoc',
    code: 'OEC9011',
  },
  {
    position: 'recipe target (JSX in expression)',
    functionRender: (sink) =>
      `<main title={props.ok ? <x-widget ${sink}={props.raw}></x-widget> : null}></main>`,
    sink: 'srcdoc',
    code: 'OEC9011',
  },
];

describe('M03-I-4b — security matrix across admitted expression positions', () => {
  for (const row of SRCDOC_ROWS) {
    test(`${row.position}: canonical predicate refuses ${row.sink} (${row.code})`, () => {
      const token = offending(functionDiagnostics(row.functionRender(row.sink)), row.code);
      expect(token, `${row.position} must refuse ${row.sink}`).toBe(row.sink);
      // The denial comes from the SHARED predicate, not a per-frontend table:
      // the row would otherwise pass on a frontend that invented its own sink
      // list naming the same attribute.
      expect(forbiddenSinkReason('attr', row.sink)).not.toBeNull();
    });
  }

  test('positive position: event handlers are admitted on the frontend (no sink added)', () => {
    const functionResult = compileFunctionModule(
      'function Fixture(props) { return <button onClick={() => props.onHit()}>go</button>; }\n',
      FILE,
    );
    expect(functionResult.diagnostics).toEqual([]);
  });

  test('positive position: component-reference props are not intrinsic sinks and are not screened', () => {
    const result = compileFunctionModule(
      'function Row(props) { return <li>{props.text}</li>; }\nfunction Fixture(props) { return <Row srcdoc={props.raw} />; }\n',
      FILE,
    );
    // `srcdoc` is a component prop here, not an intrinsic attribute: the
    // function model must not reinterpret it as a DOM sink.
    expect(result.diagnostics).toEqual([]);
  });

  test('the frontend holds no second sink table (shared predicate only)', () => {
    const source = readFileSync(
      new URL('../../src/internal/compiler/semantic-core/function-frontend.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/['"](?:srcdoc|__proto__|constructor|prototype)['"]/);
    expect(source).toContain('forbiddenSinkReason');
    expect(source).toContain('isSafeAttributeName');
    expect(source).toContain('classifyIntrinsicAttribute');
  });
});

// ─── Dynamic innerHTML decision (A4a deferred it; A4b resolves it) ────────

describe('deferred decision — dynamic innerHTML in function components', () => {
  test('function model keeps the conservative refusal (no baseline rule expressible)', () => {
    // The retired class contract was class-authoring-specific (decorated
    // properties and the literal trustedHtml capability marker); the function
    // model has no equivalent capability channel. Conservative side
    // implemented: refuse.
    // Proposed rule for owner sign-off: "Function components refuse dynamic
    // innerHTML (OEC9044) until a trusted-HTML contract with a named consumer is
    // approved and ships a negative fixture; no sink widening before that."
    //
    // The evidence fixture that used to sit above this test compiled a class
    // with the retired class frontend, so it went with that frontend; this row
    // is the surviving decision and stands on its own.
    const source = 'function Fixture(props) { return <div innerHTML={props.html}></div>; }\n';
    const result = compileFunctionModule(source, FILE);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('OEC9044');
    expect(result.module).toBeNull();
  });
});
