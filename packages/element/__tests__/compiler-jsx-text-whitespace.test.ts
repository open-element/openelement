/**
 * @openelement/element — JSX text whitespace semantics (owner ruling
 * 2026-10-02): the compiler lowers JSXText under the React contract
 * (facebook/jsx whitespace rules as implemented by the React toolchain —
 * Babel's cleanJSXElementLiteralChild and TypeScript's JSX transform):
 *
 *   R1 (text node boundaries) — a leading/trailing whitespace run containing
 *      a newline is stripped; a whitespace-only node containing a newline is
 *      removed entirely;
 *   R2 (text node interior) — a whitespace run containing a newline folds to
 *      a single space; a pure-space run not touching a newline is preserved
 *      verbatim;
 *   R3 (between elements) — a sibling-delimiting whitespace run with a
 *      newline is removed; without a newline it survives as-is (the single
 *      space form renders as one space).
 *
 * Motivation: oxfmt (Prettier rules) puts a multiline element's text child on
 * its own line. Under React semantics that re-layout is inert; the old OE
 * lowering (`\s+` → ' ' on the raw run) serialized the stripped whitespace as
 * visible spaces — the alpha7 A2 reformat turned the www 404 page's
 * `40`+`<span>4</span>` into a rendered `40 4`. The fix lives in the
 * compiler so ANY React-family formatter is safe on OE JSX.
 *
 * Every emitted-text row is cross-checked against a React oracle: the same
 * JSX fragment transpiled by `typescript`'s ReactJSX transform (the
 * React-ecosystem contract implementation in this repo's dependency tree),
 * asserting OE's emitted static text sequence equals React's compiled
 * children string sequence.
 *
 * The expression form ({'text'}) is out of scope by construction: it carries
 * no JSX whitespace, and its literal text is emitted verbatim (pinned below).
 */

import { expect, test } from 'vitest';
import ts from 'typescript';
import {
  CompiledElementError,
  compileElementProgram,
} from '../../../packages/compiler/src/internal/compiler/semantic-core/compile.ts';
import type { ProgramTreeNode } from '@openelement/protocol/part-program';
import { serializeToHtml } from '../src/internal/compiled/runtime.ts';

const PRELUDE = `
  import { element, OpenElement, property } from '@openelement/element';
`;

function component(renderBody: string, fields = ''): string {
  return `${PRELUDE}
    @element('oe-jsx-text-matrix')
    export class JsxTextMatrix extends OpenElement {
      ${fields}
      render() { return ${renderBody}; }
    }
  `;
}

function compileRender(renderBody: string, fields = '') {
  return compileElementProgram(
    component(renderBody, fields),
    '/project/app/components/jsx-text-matrix.tsx',
  ).program;
}

/** Static text values of the compiled template, in emission order. */
function staticTexts(nodes: readonly ProgramTreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.k === 'text') out.push(node.value);
    else if (node.k === 'el') staticTexts(node.children, out);
  }
  return out;
}

/**
 * React oracle: transpile the same fragment through the TypeScript ReactJSX
 * transform and return the static string children it produces, in order.
 */
function reactTextChildren(fragment: string): string[] {
  const { outputText } = ts.transpileModule(`const x = ${fragment};`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    fileName: 'react-oracle.tsx',
  });
  const sf = ts.createSourceFile('react-oracle.js', outputText, ts.ScriptTarget.ES2022, true);
  const isJsxCall = (node: ts.Expression): node is ts.CallExpression =>
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    /^_?jsxs?$/.test(node.expression.text) &&
    node.arguments.length === 2 &&
    ts.isObjectLiteralExpression(node.arguments[1]);
  const childrenOf = (call: ts.CallExpression): ts.Expression | undefined => {
    for (const prop of (call.arguments[1] as ts.ObjectLiteralExpression).properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === 'children'
      ) {
        return prop.initializer;
      }
    }
    return undefined;
  };
  const texts: string[] = [];
  const collect = (expr: ts.Expression): void => {
    if (ts.isArrayLiteralExpression(expr)) {
      for (const element of expr.elements) collect(element);
    } else if (ts.isStringLiteral(expr)) {
      texts.push(expr.text);
    } else if (isJsxCall(expr)) {
      const children = childrenOf(expr);
      if (children) collect(children);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isJsxCall(node)) {
      const children = childrenOf(node);
      if (children) collect(children);
      return;
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return texts;
}

function assertMatchesReact(fragment: string, fields = ''): void {
  const emitted = staticTexts(compileRender(fragment, fields).template);
  const react = reactTextChildren(fragment);
  expect(
    JSON.stringify(emitted) === JSON.stringify(react),
    `OE emitted ${JSON.stringify(emitted)} but the React transform compiled ${JSON.stringify(react)}`,
  ).toBeTruthy();
}

test('jsx text matrix: 404 regression shape — newline-wrapped span serializes without injected spaces', () => {
  // The alpha7 A2 oxfmt re-layout of www's el-404 heading. React renders
  // `404`; the pre-fix lowering rendered `40 4`.
  const fragment = [
    "<h1 class='code'>",
    '            40',
    "            <span class='solid'>",
    "              {'0'}",
    '            </span>',
    '            <span>4</span>',
    '          </h1>',
  ].join('\n');
  const texts = staticTexts(compileRender(fragment).template);
  expect(texts).toEqual(['40', '0', '4']);
  assertMatchesReact(fragment);
});

test('jsx text matrix: R1 — newline-touching boundary runs are stripped', () => {
  expect(staticTexts(compileRender('<p>\n  hello</p>').template)).toEqual(['hello']);
  // Trailing run with a newline: pre-fix this serialized as 'hello '.
  expect(staticTexts(compileRender('<p>hello\n  </p>').template)).toEqual(['hello']);
  // Whitespace-only node with a newline is removed entirely.
  expect(staticTexts(compileRender('<p>\n</p>').template)).toEqual([]);
  assertMatchesReact('<p>\n  hello</p>');
  assertMatchesReact('<p>hello\n  </p>');
});

test('jsx text matrix: R2 — newline-containing interior runs fold to one space', () => {
  expect(staticTexts(compileRender('<p>x\n  y</p>').template)).toEqual(['x y']);
  // Blank lines collapse into the same single joining space.
  expect(staticTexts(compileRender('<p>a\n\n  b</p>').template)).toEqual(['a b']);
  // Tabs touching a newline fold the same way.
  expect(staticTexts(compileRender('<p>x\n\ty</p>').template)).toEqual(['x y']);
  assertMatchesReact('<p>x\n  y</p>');
  assertMatchesReact('<p>a\n\n  b</p>');
});

test('jsx text matrix: R2 — pure-space runs without newlines are preserved verbatim', () => {
  expect(staticTexts(compileRender('<p>a  b</p>').template)).toEqual(['a  b']);
  // Trailing spaces on the last line never touch a newline: preserved.
  // (Pre-fix the raw run was collapsed to one space.)
  expect(staticTexts(compileRender('<p>pad  </p>').template)).toEqual(['pad  ']);
  expect(staticTexts(compileRender('<p>pad </p>').template)).toEqual(['pad ']);
  // Leading spaces survive too — the lowering reads JsxText.text, which keeps
  // the full run (getText() would have dropped it).
  expect(staticTexts(compileRender('<p>  pad</p>').template)).toEqual(['  pad']);
  expect(staticTexts(compileRender('<p>  pad  </p>').template)).toEqual(['  pad  ']);
  assertMatchesReact('<p>a  b</p>');
  assertMatchesReact('<p>pad  </p>');
  assertMatchesReact('<p>  pad</p>');
  assertMatchesReact('<p>  pad  </p>');
});

test('jsx text matrix: R3 — newline between elements removes the run, bare space survives', () => {
  expect(staticTexts(compileRender('<p><span>a</span>\n  <span>b</span></p>').template)).toEqual([
    'a',
    'b',
  ]);
  // No newline: the run survives (R3 second branch) and renders as one space.
  // The lowering must read the parser's canonical JsxText.text — getText()
  // drops a run abutting a tag and would lose the space.
  expect(staticTexts(compileRender('<p><span>a</span> <span>b</span></p>').template)).toEqual([
    'a',
    ' ',
    'b',
  ]);
  expect(staticTexts(compileRender('<p><span>a</span> b</p>').template)).toEqual(['a', ' b']);
  expect(staticTexts(compileRender('<p> </p>').template)).toEqual([' ']);
  assertMatchesReact('<p><span>a</span>\n  <span>b</span></p>');
  assertMatchesReact('<p><span>a</span> <span>b</span></p>');
  assertMatchesReact('<p><span>a</span> b</p>');
  assertMatchesReact('<p> </p>');
});

test('jsx text matrix: CRLF is a newline sequence for all three rules', () => {
  expect(staticTexts(compileRender('<p>40\r\n<span>4</span></p>').template)).toEqual(['40', '4']);
  expect(staticTexts(compileRender('<p>\r\n  hi\r\n</p>').template)).toEqual(['hi']);
  expect(staticTexts(compileRender('<p>a\r\nb</p>').template)).toEqual(['a b']);
  assertMatchesReact('<p>40\r\n<span>4</span></p>');
  assertMatchesReact('<p>a\r\nb</p>');
});

test('jsx text matrix: expression children are verbatim — no JSX whitespace applies', () => {
  expect(staticTexts(compileRender("<p>{'  40  '}</p>").template)).toEqual(['  40  ']);
  // Mixed: expression form keeps its literal while JSX text around it is
  // cleaned under the contract.
  expect(staticTexts(compileRender("<p>{'x'}\n  y\n  {'z'}</p>").template)).toEqual([
    'x',
    'y',
    'z',
  ]);
});

test('jsx text matrix: serialized 404-shape program renders 404, not 40 4', () => {
  const program = compileRender("<h1 class='code'>\n  40\n  <span class='solid'>4</span>\n</h1>");
  const host = { signals: {}, handlers: {} } as unknown as Parameters<typeof serializeToHtml>[1];
  expect(serializeToHtml(program, host)).toEqual(
    `<h1 class="code">40<span class="solid">4</span></h1>`,
  );
});

test('jsx text matrix: each-item templates lower their text under the same contract', () => {
  const itemFields = '@property({ reflect: false })\n  items = [{ id: "a", text: "alpha" }];';
  const program = compileRender(
    '<ul>{this.items.map((item) => <li key={item.id}>\n  {item.text}\n</li>)}</ul>',
    itemFields,
  );
  // The newline-only runs around the item slot are removed; the slot itself
  // (ival) is not a static text node.
  expect(staticTexts(program.template)).toEqual([]);
  const list = program.template[0];
  expect(list.k === 'el').toBeTruthy();
  const part = list.children[0];
  expect(part.k === 'part').toBeTruthy();
  const item = program.parts[part.index];
  expect(item.k === 'each').toBeTruthy();
  const itemRoot = item.item[0];
  expect(itemRoot.k === 'el').toBeTruthy();
  expect(itemRoot.children).toEqual([{ k: 'ival', field: 'text' }]);

  // Static multiline text inside the item template cleans the same way while
  // the slot keeps the template admissible. The template tree only holds the
  // part reference — the cleaned item text lives on the part's item tree.
  const staticProgram = compileRender(
    '<ul>{this.items.map((item) => <li key={item.id}>\n  x\n  {item.text}\n</li>)}</ul>',
    itemFields,
  );
  expect(staticTexts(staticProgram.template)).toEqual([]);
  const staticItem = staticProgram.parts[0];
  expect(staticItem.k === 'each').toBeTruthy();
  const staticItemRoot = staticItem.item[0];
  expect(staticItemRoot.k === 'el').toBeTruthy();
  expect(staticItemRoot.children[0]).toEqual({ k: 'text', value: 'x' });
  expect(staticItemRoot.children[1]).toEqual({ k: 'ival', field: 'text' });
});

test('jsx text matrix: html-sink childlessness stays coherent with emission', () => {
  const sinkPrelude =
    "import { element, OpenElement, property, trustedHtml, type TrustedHtml } from '@openelement/element';\n";
  const sinkFields =
    '@property({ type: Object, reflect: false, attribute: false })\n  bodyHtml: TrustedHtml = trustedHtml("");';
  const compile = (render: string) =>
    compileElementProgram(
      `${sinkPrelude}\n@element('oe-jsx-text-matrix')\nexport class JsxTextMatrix extends OpenElement {\n  ${sinkFields}\n  render() { return ${render}; }\n}\n`,
      '/project/app/components/jsx-text-matrix.tsx',
    );
  // A surviving space child means the sink is NOT childless: fail closed.
  // The no-newline single space reaches the lowering via JsxText.text (R3
  // keeps it), so the meaning predicate must see it too.
  for (const render of [
    '<div innerHTML={this.bodyHtml} trustedHtml> </div>',
    '<div innerHTML={this.bodyHtml} trustedHtml><span>x</span></div>',
  ]) {
    const error = (() => {
      try {
        compile(render);
      } catch (thrown) {
        expect(thrown instanceof CompiledElementError).toBeTruthy();
        return thrown;
      }
      throw new Error(`expected this render to keep the sink check closed: ${render}`);
    })();
    expect(String(error)).toContain('OEC9026');
  }
  // Newline-only whitespace cleans to nothing (R1): still childless, still
  // allowed. The meaning predicate and the emission see identical text.
  compile('<div innerHTML={this.bodyHtml} trustedHtml>\n</div>');
});
