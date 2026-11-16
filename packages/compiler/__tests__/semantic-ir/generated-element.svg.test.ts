/**
 * SVG subtrees in the generated-element lane.
 *
 * An `<svg>` subtree lives in the SVG namespace. The mount must create it with
 * `createElementNS` (an HTML-namespaced lookalike renders nothing), and the
 * claim must assert the element's OWN namespace instead of the HTML ancestor
 * walk (the ancestors are legitimately SVG). `foreignObject` switches its
 * children back to HTML in both paths.
 *
 * Artifact-level rows only (no browser).
 */

import { describe, expect, test } from 'vitest';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

const SIDECAR =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  'export const openElement = defineIslandConfig({ root: "shadow" });\n';

function compile(body: string): string {
  const source = SIDECAR + 'function Icon() {\n' + body + '}\n' + 'export default Icon;\n';
  return compileGeneratedElementIfAdmitted(source, 'app/islands/icon.tsx', {
    site: { tag: 'open-icon' },
  }).code;
}

function section(module: string, header: string): string {
  const start = module.indexOf(header);
  if (start < 0) return '';
  const end = module.indexOf('\nfunction ', start + header.length);
  return module.slice(start, end < 0 ? undefined : end);
}

describe('generated-element SVG subtrees', () => {
  test('mount creates the svg subtree in the SVG namespace', () => {
    const module = compile(
      '  return <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3"></circle></svg>;\n',
    );
    const mount = section(module, 'function Icon__mount(');
    expect(mount).toContain(`document.createElementNS("${SVG_NS}", "svg")`);
    expect(mount).toContain(`document.createElementNS("${SVG_NS}", "circle")`);
  });

  test('claim checks the own namespace inside the subtree', () => {
    const module = compile(
      '  return <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3"></circle></svg>;\n',
    );
    const claim = section(module, 'function Icon__claim(');
    // The svg element and its child each assert the SVG namespace.
    expect(
      claim.match(new RegExp(`assertElementInNamespace\\([^,]+, "${SVG_NS}"`, 'g'))?.length,
    ).toBe(2);
  });

  test('camelCase SVG tags stay outside the admitted tag grammar', () => {
    // `TAG_PATTERN` is lowercase-only, so `foreignObject`/`linearGradient` are
    // refused instead of being created in the wrong namespace; the subtree's
    // namespace stays SVG for every admitted (lowercase) descendant.
    expect(() =>
      compile('  return <svg viewBox="0 0 16 16"><foreignObject></foreignObject></svg>;\n'),
    ).toThrow(/OEIR_LEAF_UNSUPPORTED_TAG/);
  });
});
