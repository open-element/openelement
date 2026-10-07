/**
 * Sheet-import admission (#1558) — the one style authoring form.
 *
 * Behavior-first coverage for the compiler half of the style seam:
 *   - a compiled module's sheets come from relative `.css` default imports,
 *     arrayed in `static styles` in authored order; the imports and the
 *     initializer are copied verbatim and the compile result carries the
 *     edges for the intercepting host build
 *   - every inline sheet shape (string, factory call, foreign binding)
 *     fails closed with OEC9029 and a migration hint — never a silent
 *     inline path
 *   - the `.css` import shape itself is policed: side-effect and named
 *     forms have no binding for the class to adopt; bare package specifiers
 *     do not resolve inside the authoring tree
 *   - the style-edge registry hands each edge to the intercepting host
 *     build under the module id its resolver lands on (the consumer form
 *     the router's style-asset plugin reads — seams.md "CSS import
 *     compatibility" row)
 */

import { beforeEach, describe, expect, test } from 'vitest';
import {
  CompiledElementError,
  compileElementProgram,
} from '../../../packages/compiler/src/internal/compiler/semantic-core/compile.ts';
import type { StaticSidecarDescriptor } from '../../../packages/compiler/src/internal/compiler/semantic-core/module-analysis.ts';
import { compiledElementPlugin } from '../../../packages/compiler/src/internal/compiler/plugin.ts';
import {
  clearStyleRequests,
  getStyleRequest,
  hasStyleImporter,
  styleRequestFile,
  styleRequestModuleId,
} from '../../../packages/compiler/src/internal/compiler/style-requests.ts';

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

const OPTIONS = { staticSidecars: [ISLAND_SIDECAR] } as const;

/** An authored module importing the given `.css` specifiers as `sheet<i>`. */
function authoredSource(
  specifiers: string[],
  stylesExpression: string,
  { island = true }: { island?: boolean } = {},
): string {
  return [
    "import { element, OpenElement, property, type StyleSheetLike } from '@openelement/element';",
    ...(island ? ["import { defineIslandConfig } from '@openelement/router';"] : []),
    ...specifiers.map((specifier, index) => `import sheet${index} from '${specifier}';`),
    ...(island ? ['export const openElement = defineIslandConfig({ hydrate: "load" });'] : []),
    "@element('oe-sheet-import', { root: 'shadow-open' })",
    'export class SheetImportElement extends OpenElement {',
    `  static override styles: StyleSheetLike[] = ${stylesExpression};`,
    "  @property({ reflect: false }) label = '';",
    '  render() {',
    '    return <main>{this.label}</main>;',
    '  }',
    '}',
  ].join('\n');
}

/** A plain class without sheet imports (the no-styles control). */
const NO_STYLES_SOURCE = [
  "import { element, OpenElement, property } from '@openelement/element';",
  "@element('oe-no-styles')",
  'export class NoStyles extends OpenElement {',
  "  @property({ reflect: false }) label = '';",
  '  render() {',
  '    return <main>{this.label}</main>;',
  '  }',
  '}',
].join('\n');

const compile = (source: string): ReturnType<typeof compileElementProgram> =>
  compileElementProgram(source, '/proj/app/islands/x.tsx', OPTIONS);

const failWith = (source: string): string => {
  try {
    compile(source);
  } catch (error) {
    if (error instanceof CompiledElementError) {
      const diagnostic = error.diagnostics[0]!;
      expect(diagnostic.code).toEqual('OEC9029');
      return diagnostic.message;
    }
    throw error;
  }
  throw new Error('expected the compile to fail closed with OEC9029');
};

const transformOf = (): ((code: string, id: string) => unknown) => {
  const plugin = compiledElementPlugin(OPTIONS);
  const transform = plugin.transform as (this: unknown, code: string, id: string) => unknown;
  return (code: string, id: string): unknown => transform.call({}, code, id);
};

beforeEach(() => {
  clearStyleRequests();
});

describe('the admitted form', () => {
  test('a .css default import arrays verbatim and carries the edge', () => {
    const result = compile(authoredSource(['./sheet-import.css'], '[sheet0]'));
    // The generated module keeps the authored import and initializer
    // verbatim — no synthesized request sibling, no sheet bytes.
    expect(result.code).toContain("import sheet0 from './sheet-import.css';");
    expect(result.code).toContain('static override styles: StyleSheetLike[] = [sheet0];');
    expect(result.code).not.toContain('oe-style');
    expect(result.styleRequests).toEqual(['./sheet-import.css']);
  });

  test('several sheets keep the authored array order', () => {
    const result = compile(authoredSource(['./b.css', './a.css'], '[sheet0, sheet1]'));
    expect(result.styleRequests).toEqual(['./b.css', './a.css']);
    expect(result.code).toContain('static override styles: StyleSheetLike[] = [sheet0, sheet1];');
  });

  test('island-ness is irrelevant: page modules track their edges identically', () => {
    const result = compileElementProgram(
      authoredSource(['./page.css'], '[sheet0]', { island: false }),
      '/proj/app/components/page.tsx',
      OPTIONS,
    );
    expect(result.styleRequests).toEqual(['./page.css']);
  });

  test('an empty styles array carries no edges', () => {
    const result = compile(authoredSource([], '[]'));
    expect(result.styleRequests).toBeUndefined();
  });
});

describe('inline sheet shapes fail closed (OEC9029)', () => {
  test('a real inline template is refused with the migration hint', () => {
    const message = failWith(
      [
        "import { element, OpenElement, property, type StyleSheetLike } from '@openelement/element';",
        "@element('oe-sheet-import')",
        'export class X extends OpenElement {',
        '  static override styles: StyleSheetLike[] = [`:host { display: block; }`];',
        "  @property({ reflect: false }) label = '';",
        '  render() {',
        '    return <main>{this.label}</main>;',
        '  }',
        '}',
      ].join('\n'),
    );
    expect(message).toContain('.css file imports');
  });

  test('a factory call initializer (the retired compiledStyle convention)', () => {
    failWith(
      [
        "import { element, OpenElement, property, type StyleSheetLike } from '@openelement/element';",
        "import { compiledStyle } from './compiled-style.ts';",
        "@element('oe-sheet-import')",
        'export class X extends OpenElement {',
        '  static override styles: StyleSheetLike[] = [compiledStyle(`:host{}`)];',
        "  @property({ reflect: false }) label = '';",
        '  render() {',
        '    return <main>{this.label}</main>;',
        '  }',
        '}',
      ].join('\n'),
    );
  });

  test('a bare identifier that is not a .css import', () => {
    failWith(
      [
        "import { element, OpenElement, property, type StyleSheetLike } from '@openelement/element';",
        "import { styles } from './styles.ts';",
        "@element('oe-sheet-import')",
        'export class X extends OpenElement {',
        '  static override styles: StyleSheetLike[] = styles;',
        "  @property({ reflect: false }) label = '';",
        '  render() {',
        '    return <main>{this.label}</main>;',
        '  }',
        '}',
      ].join('\n'),
    );
  });

  test('a spread in the styles array', () => {
    failWith(authoredSource(['./a.css'], '[...sheets]'));
  });

  test('an imported sheet never referenced by static styles', () => {
    failWith(
      [
        "import { element, OpenElement, property, type StyleSheetLike } from '@openelement/element';",
        "import sheet0 from './a.css';",
        "@element('oe-sheet-import')",
        'export class X extends OpenElement {',
        '  static override styles: StyleSheetLike[] = [];',
        "  @property({ reflect: false }) label = '';",
        '  render() {',
        '    return <main>{this.label}</main>;',
        '  }',
        '}',
      ].join('\n'),
    );
  });
});

describe('the .css import shape itself', () => {
  test('a side-effect .css import has no binding to adopt', () => {
    const message = failWith(
      [
        "import { element, OpenElement, property, type StyleSheetLike } from '@openelement/element';",
        "import './side-effect.css';",
        "@element('oe-sheet-import')",
        'export class X extends OpenElement {',
        '  static override styles: StyleSheetLike[] = [];',
        "  @property({ reflect: false }) label = '';",
        '  render() {',
        '    return <main>{this.label}</main>;',
        '  }',
        '}',
      ].join('\n'),
    );
    expect(message).toContain('must bind its sheet');
  });

  test('a bare package .css specifier is refused', () => {
    failWith(authoredSource(['@openelement/ui/sheet.css'], '[sheet0]'));
  });
});

describe('the style-edge registry (the intercept channel)', () => {
  test('the plugin registers the edge under the resolver-landed module id', () => {
    const transform = transformOf();
    const importer = '/proj/app/islands/sheet-import.tsx';
    transform(authoredSource(['./sheet-import.css'], '[sheet0]'), importer);
    const key = styleRequestModuleId(importer, './sheet-import.css');
    const request = getStyleRequest(key);
    expect(request).toBeDefined();
    expect(request?.specifier).toEqual('./sheet-import.css');
    expect(request?.importer).toEqual(importer);
    expect(request?.file).toEqual(styleRequestFile(importer, './sheet-import.css'));
    expect(request?.file.endsWith('/app/islands/sheet-import.css')).toEqual(true);
    expect(hasStyleImporter(importer)).toEqual(true);
  });

  test('a query-carrying importer id re-registers under one key', () => {
    const transform = transformOf();
    const source = authoredSource(['./sheet-import.css'], '[sheet0]');
    const importer = '/proj/app/islands/sheet-import.tsx';
    const key = styleRequestModuleId(importer, './sheet-import.css');
    transform(source, importer);
    transform(source, `${importer}?t=123`);
    expect(getStyleRequest(key)?.importer).toEqual(`${importer}?t=123`);
  });

  test('a non-style module registers nothing', () => {
    const transform = transformOf();
    transform(NO_STYLES_SOURCE, '/proj/app/islands/no-styles.tsx');
    expect(hasStyleImporter('/proj/app/islands/no-styles.tsx')).toEqual(false);
    expect(
      getStyleRequest(styleRequestModuleId('/proj/app/islands/no-styles.tsx', './x.css')),
    ).toBeUndefined();
  });

  test('clearing empties the registry', () => {
    const transform = transformOf();
    const importer = '/proj/app/islands/x.tsx';
    transform(authoredSource(['./x.css'], '[sheet0]'), importer);
    expect(getStyleRequest(styleRequestModuleId(importer, './x.css'))).toBeDefined();
    clearStyleRequests();
    expect(getStyleRequest(styleRequestModuleId(importer, './x.css'))).toBeUndefined();
    expect(hasStyleImporter(importer)).toEqual(false);
  });
});
