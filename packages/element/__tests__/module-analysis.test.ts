import { expect, test } from 'vitest';
import {
  analyzeModuleSemantics,
  type ModuleSemanticFacts,
  type ModuleVocabularyDescriptor,
} from '../src/internal/compiler/semantic-core/module-analysis.ts';

type SemanticCase = {
  name: string;
  source: string;
  fileName?: string;
  /** Host vocabulary injected for this case; omitted runs the default scan. */
  vocabulary?: readonly ModuleVocabularyDescriptor[];
  expected: Partial<ModuleSemanticFacts>;
};

/**
 * The router vocabulary a host injects, mirrored here because element tests
 * cannot import the router package. Matches
 * router/src/vite/internal/protocol/module-vocabulary.ts.
 */
const ROUTER_VOCABULARY: readonly ModuleVocabularyDescriptor[] = [
  {
    moduleSpecifier: '@openelement/router',
    exportName: 'definePage',
    kind: 'page-definition',
  },
  {
    moduleSpecifier: '@openelement/router/lit',
    exportName: 'defineLitPage',
    kind: 'page-definition',
  },
  {
    moduleSpecifier: '@openelement/router',
    exportName: 'defineElement',
    kind: 'element-registration',
  },
];

function emptyFacts(): ModuleSemanticFacts {
  return {
    relativeImports: [],
    compiledElementDecorator: false,
    definePage: false,
    usesExportedTagName: false,
    enhancedForm: false,
    definedCustomElementTags: [],
    referencedCustomElementTags: [],
    compilerInteractionEvents: [],
  };
}

const semanticCases: SemanticCase[] = [
  {
    name: 'collects relative imports and re-exports but excludes packages',
    source: `
      import { local } from './local.ts';
      const lazy = import('./lazy.ts');
      import packageValue from '@scope/package';
      export { Button } from '../components/button.tsx';
      export * from 'npm:shared-package';
      void packageValue; void lazy;
    `,
    expected: {
      relativeImports: ['./local.ts', '../components/button.tsx', './lazy.ts'],
    },
  },
  {
    name: 'reads an exported tagName string',
    source: `export const tagName = 'oe-string-page';`,
    expected: { exportedTagName: 'oe-string-page' },
  },
  {
    name: 'reads an exported no-substitution tagName template',
    source: 'export const tagName = `oe-template-page`;',
    expected: { exportedTagName: 'oe-template-page' },
  },
  {
    name: 'recognizes directly imported definePage',
    vocabulary: ROUTER_VOCABULARY,
    source: `
      import { definePage } from '@openelement/router';
      export default definePage({ render() { return <main />; } });
    `,
    expected: { definePage: true },
  },
  {
    name: 'recognizes aliased definePage from the app package',
    vocabulary: ROUTER_VOCABULARY,
    source: `
      import { definePage as makePage } from '@openelement/router';
      export default makePage({ render() { return <main />; } });
    `,
    expected: { definePage: true },
  },
  {
    name: 'default scan does not know the router page factory (fail closed)',
    source: `
      import { definePage } from '@openelement/router';
      export default definePage({ render() { return <main />; } });
    `,
    expected: {},
  },
  {
    name: 'does not treat strings or comments mentioning definePage as a page export',
    source: `
      const prose = 'definePage';
      // export default definePage({});
      /* definePage({ render() { return <main />; } }); */
      export default function Page() {
        return <p>{prose}</p>;
      }
    `,
    expected: {},
  },
  {
    name: 'recognizes a valid compiled @element application',
    source: `
      import { OpenElement, element } from '@openelement/element';
      @element('oe-valid-element')
      export class ValidElement extends OpenElement {}
    `,
    expected: {
      compiledElementDecorator: true,
      definedCustomElementTags: ['oe-valid-element'],
    },
  },
  {
    name: 'recognizes an invalid-tag @element application for compiler gating',
    source: `
      import { OpenElement, element } from '@openelement/element';
      @element('invalid')
      export class InvalidElement extends OpenElement {}
    `,
    expected: { compiledElementDecorator: true },
  },
  {
    name: 'records the identity of a default compiled component',
    source: `
      import { OpenElement, element } from '@openelement/element';
      @element('oe-default-component')
      export default class DefaultComponent extends OpenElement {}
    `,
    expected: {
      compiledElementDecorator: true,
      defaultCompiledTag: 'oe-default-component',
      definedCustomElementTags: ['oe-default-component'],
    },
  },
  {
    name: 'recognizes injected router defineElement; element package exposes no factory',
    vocabulary: ROUTER_VOCABULARY,
    source: `
      import { defineElement as appElement } from '@openelement/router';
      import { defineElement as elementElement } from '@openelement/element';
      appElement('oe-app-element', {});
      elementElement('oe-element-element', {});
    `,
    expected: {
      // The element package has no defineElement factory: compiled
      // registration is the @element decorator, so its namesake import only
      // resolves through host-injected vocabulary and fails closed here.
      definedCustomElementTags: ['oe-app-element'],
    },
  },
  {
    name: 'default scan knows no registration factories — retired names fail closed',
    source: `
      import {
        defineElement as elementElement,
        defineIsland as elementIsland,
      } from '@openelement/element';
      import {
        defineElement as appElement,
        defineIsland as appIsland,
      } from '@openelement/router';
      elementElement('oe-element-element', {});
      elementIsland('oe-element-island', {});
      appElement('oe-app-element', {});
      appIsland('oe-app-island', {});
    `,
    expected: {
      // The default scan fails closed on every retired or foreign factory:
      // neither package's defineElement nor defineIsland is core vocabulary,
      // and the router's live factories ride host-injected vocabulary only.
      definedCustomElementTags: [],
    },
  },
  {
    name: 'injected router vocabulary no longer admits defineIsland (retired v0.44)',
    vocabulary: ROUTER_VOCABULARY,
    source: `
      import { defineIsland as legacyIsland } from '@openelement/router';
      legacyIsland('oe-legacy-island', {});
    `,
    expected: {},
  },
  {
    name: 'recognizes customElements.define',
    source: `
      class PlatformElement extends HTMLElement {}
      customElements.define('oe-platform-element', PlatformElement);
    `,
    expected: { definedCustomElementTags: ['oe-platform-element'] },
  },
  {
    name: 'recognizes exported tagName use by identifier',
    vocabulary: ROUTER_VOCABULARY,
    source: `
      import { defineElement } from '@openelement/router';
      export const tagName = 'oe-identifier-use';
      defineElement(tagName, {});
    `,
    expected: {
      exportedTagName: 'oe-identifier-use',
      usesExportedTagName: true,
    },
  },
  {
    name: 'recognizes exported tagName use by matching literal definition',
    vocabulary: ROUTER_VOCABULARY,
    source: `
      import { defineElement } from '@openelement/router';
      export const tagName = 'oe-literal-use';
      defineElement('oe-literal-use', {});
    `,
    expected: {
      exportedTagName: 'oe-literal-use',
      usesExportedTagName: true,
      definedCustomElementTags: ['oe-literal-use'],
    },
  },
  {
    name: 'recognizes exported tagName use by matching JSX',
    source: `
      export const tagName = 'oe-jsx-use';
      export default function Page() {
        return <oe-jsx-use />;
      }
    `,
    expected: {
      exportedTagName: 'oe-jsx-use',
      usesExportedTagName: true,
      referencedCustomElementTags: ['oe-jsx-use'],
    },
  },
  {
    name: 'detects data-open-enhance only as a JSX attribute',
    source: `
      export default function Form() {
        return <form method="post" data-open-enhance />;
      }
    `,
    expected: { enhancedForm: true },
  },
  {
    name: 'detects data-open-enhance inside a lit html template literal (#1339)',
    source: `
      import { html } from 'lit';
      export class FormPage {
        render() {
          return html\`<form method="post" data-open-enhance><button>go</button></form>\`;
        }
      }
    `,
    expected: { enhancedForm: true },
  },
  {
    name: 'detects data-open-enhance in template expression parts (#1339)',
    source: `
      import { html } from 'lit';
      const method = 'post';
      export const view = html\`<form method=\${method} data-open-enhance>\${'go'}</form>\`;
    `,
    expected: { enhancedForm: true },
  },
  {
    name: 'ignores data-open-enhance template prose without attribute shape',
    source: `
      import { html } from 'lit';
      export const view = html\`<p>Use data-open-enhance<em>sparingly</em></p>\`;
    `,
    expected: {},
  },
  {
    name: 'ignores data-open-enhance in prose, strings, and comments',
    source: `
      const prose = 'data-open-enhance';
      // data-open-enhance
      /* data-open-enhance */
      export default function Page() {
        return <p>data-open-enhance {prose}</p>;
      }
    `,
    expected: {},
  },
  {
    name: 'collects custom tags while excluding intrinsic HTML tags',
    vocabulary: ROUTER_VOCABULARY,
    source: `
      import { defineElement } from '@openelement/router';
      defineElement('oe-defined', {});
      defineElement('div', {});
      customElements.define('oe-platform', HTMLElement);
      customElements.define('button', HTMLElement);
      export default function Page() {
        return (
          <>
            <oe-defined />
            <oe-referenced />
            <div />
            <button />
          </>
        );
      }
    `,
    expected: {
      definedCustomElementTags: ['oe-defined', 'oe-platform'],
      referencedCustomElementTags: ['oe-defined', 'oe-referenced'],
    },
  },
  {
    name: 'sorts and deduplicates compiler interaction event names',
    source: `
      const handler = () => {};
      export default function Page() {
        return (
          <>
            <button onKeyDown={handler} onClick={handler} />
            <input onMouseEnter={handler} onInput={handler} />
            <a onClick={handler} />
          </>
        );
      }
    `,
    expected: {
      compilerInteractionEvents: ['click', 'input', 'keydown', 'mouseenter'],
    },
  },
  {
    name: 'recognizes canonical JSX runtime factories without scanning prose',
    source: `
      import { jsx as makeNode } from '@openelement/element/jsx-runtime';
      const view = makeNode('oe-factory-tag', {});
      const prose = '<oe-prose-tag />';
      // <oe-comment-tag />
      void view; void prose;
    `,
    expected: { referencedCustomElementTags: ['oe-factory-tag'] },
  },
];

for (const testCase of semanticCases) {
  test(`analyzeModuleSemantics: ${testCase.name}`, () => {
    const actual = analyzeModuleSemantics(
      testCase.source,
      testCase.fileName ?? `/matrix/${testCase.name}.tsx`,
      { vocabulary: testCase.vocabulary },
    );
    expect(actual, testCase.name).toEqual({ ...emptyFacts(), ...testCase.expected });
  });
}

test('analyzeModuleSemantics is deterministic across repeated analysis', () => {
  const source = `
    import { defineElement } from '@openelement/router';
    export const tagName = 'oe-repeatable';
    defineElement('oe-repeatable', {});
    export default function Page() {
      return (
        <oe-repeatable onKeyDown={() => {}} onClick={() => {}} />
      );
    }
  `;
  const outputs = Array.from({ length: 5 }, () =>
    analyzeModuleSemantics(source, '/matrix/repeatable.tsx', {
      vocabulary: ROUTER_VOCABULARY,
    }),
  );

  for (const output of outputs.slice(1)) {
    expect(output).toEqual(outputs[0]);
    expect(JSON.stringify(output)).toEqual(JSON.stringify(outputs[0]));
  }
});
