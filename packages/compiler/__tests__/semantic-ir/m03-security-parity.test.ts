/**
 * M03-I-4b — full per-position security parity matrix (owner-approved D4 item c).
 *
 * Every expression position the function frontend newly admits is exercised with
 * negative fixtures proving the canonical admission predicates refuse the same
 * sinks the Alpha15 baseline refuses. The predicates are reused, never
 * duplicated (`forbiddenSinkReason`, `isSafeAttributeName`,
 * `classifyIntrinsicAttribute`). Where the class baseline has an equivalent
 * authored construct the harness asserts class-vs-function parity on the OEC
 * code + offending authored token; where it does not, the row records the
 * canonical predicate denial and marks class parity `n/a (no equivalent
 * construct)` — it is not silently dropped.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { forbiddenSinkReason } from '@openelement/protocol/forbidden-sinks';
import {
  CompiledElementError,
  compileElementProgram,
} from '../../src/internal/compiler/semantic-core/compile.ts';
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

const CLASS_PRELUDE = `import { element, OpenElement, property } from '@openelement/element';
@element('oe-security-parity')
export class SecurityParity extends OpenElement {
  @property({ reflect: false }) label = 'ready';
  @property({ type: Number, reflect: false }) count = 0;
  @property({ type: Array, reflect: false }) items = [];
  render() { return `;

function classDiagnostics(render: string): Array<{ code: string; token: string }> {
  const source = `${CLASS_PRELUDE}${render}; }
}
`;
  try {
    compileElementProgram(source, FILE);
  } catch (error) {
    if (error instanceof CompiledElementError) {
      return error.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        token: source.slice(diagnostic.start, diagnostic.end),
      }));
    }
    throw error;
  }
  return [];
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
  /** Class-fixture render argument, when the baseline has an equivalent construct. */
  readonly classRender?: (sink: string) => string;
  readonly sink: string;
  readonly code: string;
  readonly classParity: 'asserted' | 'n/a-no-equivalent';
}

/**
 * The admitted expression positions of the function frontend:
 *  1. direct element dynamic attribute
 *  2. condition-branch JSX
 *  3. list-template JSX
 *  4. JSX inside an expression position (lowered to a recipe target)
 *  5. component-reference props (not a sink position; positive row)
 * Each is injected with the same forbidden sink (`srcdoc`) so the canonical
 * predicate is exercised on that position, then compared to the class baseline
 * where an equivalent construct exists.
 */
const SRCDOC_ROWS: readonly PositionRow[] = [
  {
    position: 'direct element attribute',
    functionRender: (sink) => `<x-widget ${sink}={props.raw}></x-widget>`,
    classRender: (sink) => `<x-widget ${sink}={this.label}></x-widget>`,
    sink: 'srcdoc',
    code: 'OEC9011',
    classParity: 'asserted',
  },
  {
    position: 'condition branch',
    functionRender: (sink) =>
      `<main>{props.ok ? <x-widget ${sink}={props.raw}></x-widget> : <i />}</main>`,
    classRender: (sink) =>
      `<main>{this.label ? <x-widget ${sink}={this.label}></x-widget> : <i />}</main>`,
    sink: 'srcdoc',
    code: 'OEC9011',
    classParity: 'asserted',
  },
  {
    position: 'list template',
    functionRender: (sink) => `<ul>{props.items.map((item) => <li ${sink}={item.text}></li>)}</ul>`,
    // The class list-item grammar restricts item expressions to this.<field>
    // reads before the sink screen, so an identical equivalent construct does
    // not exist on the class side; predicate denial is recorded instead.
    sink: 'srcdoc',
    code: 'OEC9011',
    classParity: 'n/a-no-equivalent',
  },
  {
    position: 'recipe target (JSX in expression)',
    functionRender: (sink) =>
      `<main title={props.ok ? <x-widget ${sink}={props.raw}></x-widget> : null}></main>`,
    // The class frontend does not admit JSX inside an expression position; the
    // class row is recorded as n/a rather than invented.
    sink: 'srcdoc',
    code: 'OEC9011',
    classParity: 'n/a-no-equivalent',
  },
];

describe('M03-I-4b — security parity matrix across admitted expression positions', () => {
  for (const row of SRCDOC_ROWS) {
    test(`${row.position}: canonical predicate refuses ${row.sink} (${row.code})`, () => {
      const token = offending(functionDiagnostics(row.functionRender(row.sink)), row.code);
      expect(token, `${row.position} must refuse ${row.sink}`).toBe(row.sink);
      if (row.classParity === 'asserted' && row.classRender !== undefined) {
        const classToken = offending(classDiagnostics(row.classRender(row.sink)), row.code);
        expect(classToken, 'class baseline parity').toBe(token);
      } else {
        // No equivalent class construct: the shared predicate itself is asserted.
        expect(forbiddenSinkReason('attr', row.sink)).not.toBeNull();
      }
    });
  }

  test('positive position: event handlers are admitted on both frontends (no sink added)', () => {
    const functionResult = compileFunctionModule(
      'function Fixture(props) { return <button onClick={() => props.onHit()}>go</button>; }\n',
      FILE,
    );
    expect(functionResult.diagnostics).toEqual([]);
    const classResult = classDiagnostics('<button onClick={() => this.count++}>go</button>');
    expect(classResult).toEqual([]);
  });

  test('positive position: component-reference props are not intrinsic sinks and are not screened', () => {
    const result = compileFunctionModule(
      'function Row(props) { return <li>{props.text}</li>; }\nfunction Fixture(props) { return <Row srcdoc={props.raw} />; }\n',
      FILE,
    );
    // `srcdoc` is a component prop here, not an intrinsic attribute: the
    // function model must not reinterpret it as a DOM sink (the class frontend
    // has no equivalent component-prop position).
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
  test('class baseline evidence: dynamic innerHTML requires the class trusted-HTML contract', () => {
    // The Alpha15 rule: a dynamic innerHTML sink requires an Object-typed
    // TrustedHtml property plus the literal trustedHtml capability marker.
    const diagnostics = classDiagnostics('<div innerHTML={this.label}></div>');
    const codes = diagnostics.map((diagnostic) => diagnostic.code);
    // The class baseline refuses at the capability/sink layer (OEC9011 for the
    // wrong value shape, OEC9026 for the trustedHtml capability contract).
    expect(codes.some((code) => code === 'OEC9011' || code === 'OEC9026')).toBe(true);
    const message = readFileSync(
      new URL('../../src/internal/compiler/semantic-core/lower-program.ts', import.meta.url),
      'utf8',
    );
    expect(message).toContain('innerHTML sinks require an Object-typed TrustedHtml property');
    expect(message).toContain('trustedHtml capability marker');
  });

  test('function model keeps the conservative refusal (no baseline rule expressible)', () => {
    // The class contract is class-authoring-specific (decorated properties and
    // the literal trustedHtml capability marker); the function model has no
    // equivalent capability channel. Conservative side implemented: refuse.
    // Proposed rule for owner sign-off: "Function components refuse dynamic
    // innerHTML (OEC9044) until a trusted-HTML contract with a named consumer is
    // approved and ships a negative fixture; no sink widening before that."
    const source = 'function Fixture(props) { return <div innerHTML={props.html}></div>; }\n';
    const result = compileFunctionModule(source, FILE);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('OEC9044');
    expect(result.module).toBeNull();
  });
});
