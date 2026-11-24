/**
 * Generated-element SSR form controls → real Chromium HTML parsing.
 * The generated producer must express control properties in markup semantics
 * the parser consumes before a client claim can begin.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { chromium, type Browser } from 'playwright';
import ts from 'typescript';
import * as leafRuntime from '../../../element/src/internal/compiled/leaf-runtime.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import type { GeneratedElementSite } from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';

const FILE = '/proj/app/islands/form-controls.tsx';
const SITE: GeneratedElementSite = { tag: 'oe-form-controls' };
const SOURCE = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({
  hydrate: 'idle',
  root: 'shadow',
  properties: {
    textareaValue: { default: '' },
    selectedValue: { default: '' },
    dynamicValue: { default: '' },
    optionTitle: { default: '' },
    multipleEnabled: { default: false },
    multipleValues: { attribute: false, default: [] },
    implicitValue: { default: '' },
  },
});
function FormControls(props: {
  textareaValue: string;
  selectedValue: string;
  dynamicValue: string;
  optionTitle: string;
  multipleEnabled: boolean;
  multipleValues: string[];
  implicitValue: string;
}) {
  return <main>
    <textarea id="message" value={props.textareaValue} />
    <select id="single" value={props.selectedValue}>
      <option value="first" title="use selected value here" data-value="stable" value-extra="preserved">First &amp; safe</option>
      <option value={props.dynamicValue} title={props.optionTitle} data-value="dynamic" value-extra="kept">Dynamic & escaped</option>
    </select>
    <select id="multiple" value={props.multipleValues} multiple={props.multipleEnabled}>
      <option value="alpha">Alpha</option>
      <option value="beta">Beta</option>
      <option value="gamma">Gamma</option>
    </select>
    <select id="implicit" value={props.implicitValue}>
      <option title="use selected value here">  Tea & milk  </option>
      <option value="other">Other</option>
    </select>
    <div id="unrelated" data-value="keep this value here" value-extra="keep this too">literal selected value here</div>
  </main>;
}
export default FormControls;
`;

function generatedSsr(): (props: Record<string, unknown>, host?: unknown) => string {
  const compiled = compileGeneratedElementIfAdmitted(SOURCE, FILE, { site: SITE });
  if (compiled === null) throw new Error('the generated-element lane declined the form fixture');
  const runtimeImport = compiled.code.match(
    /^import \{([^}]+)\} from ['"]@openelement\/element\/internal\/compiled\/leaf-runtime['"];?$/m,
  );
  if (runtimeImport === null) throw new Error('generated form module has no leaf-runtime import');
  const runtimeNames = runtimeImport[1]!
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  const sourceFile = ts.createSourceFile(
    'form-controls.ts',
    compiled.code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const exported = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'FormControls__ssr',
  );
  if (exported === undefined || exported.name === undefined) {
    throw new Error('generated form module has no FormControls__ssr producer');
  }
  const functionSource = exported.getText(sourceFile).replace(/^export\s+/, '');
  const factory = new Function(
    ...runtimeNames,
    `${functionSource}\nreturn ${exported.name.text};`,
  ) as (...values: unknown[]) => (props: Record<string, unknown>, host?: unknown) => string;
  const bindings = runtimeNames.map((name) => {
    const value = (leafRuntime as unknown as Record<string, unknown>)[name];
    if (value === undefined) throw new Error(`leaf runtime does not export ${name}`);
    return value;
  });
  return factory(...bindings);
}

let browser: Browser | undefined;

beforeAll(async () => {
  browser = await chromium.launch();
  console.log(`[generated-form-controls] engine=chromium version=${browser.version()} LOCAL`);
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

test('textarea text and single/multiple option selectedness survive Chromium parsing', async () => {
  const textareaValue = '\n<&"first\r\nsecond';
  const dynamicValue = 'quoted "<& value';
  const html = generatedSsr()(
    {
      textareaValue,
      selectedValue: dynamicValue,
      dynamicValue,
      optionTitle: 'selected value here with "quotes" & <tags>',
      multipleEnabled: true,
      multipleValues: ['beta', 'gamma'],
      implicitValue: 'Tea & milk',
    },
    { bindings: {} },
  );

  const page = await browser!.newPage();
  try {
    await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
    const parsed = await page.evaluate(() => {
      const textarea = document.querySelector('#message') as HTMLTextAreaElement;
      const single = document.querySelector('#single') as HTMLSelectElement;
      const dynamic = single.options[1]!;
      const multiple = document.querySelector('#multiple') as HTMLSelectElement;
      const implicit = document.querySelector('#implicit') as HTMLSelectElement;
      const unrelated = document.querySelector('#unrelated') as HTMLElement;
      return {
        textareaValue: textarea.value,
        textareaDefaultValue: textarea.defaultValue,
        textareaValueAttribute: textarea.getAttribute('value'),
        selectedValue: single.value,
        selectedFlags: [...single.options].map((option) => option.selected),
        dynamicValue: dynamic.value,
        dynamicTitle: dynamic.title,
        dynamicDataValue: dynamic.getAttribute('data-value'),
        dynamicValueExtra: dynamic.getAttribute('value-extra'),
        dynamicText: dynamic.textContent,
        multipleValues: [...multiple.selectedOptions].map((option) => option.value),
        implicitSelected: implicit.options[0]!.selected,
        implicitOptionValue: implicit.options[0]!.value,
        unrelatedDataValue: unrelated.getAttribute('data-value'),
        unrelatedValueExtra: unrelated.getAttribute('value-extra'),
        unrelatedText: unrelated.textContent,
      };
    });

    expect(parsed).toEqual({
      textareaValue: '\n<&"first\nsecond',
      textareaDefaultValue: '\n<&"first\nsecond',
      textareaValueAttribute: null,
      selectedValue: dynamicValue,
      selectedFlags: [false, true],
      dynamicValue,
      dynamicTitle: 'selected value here with "quotes" & <tags>',
      dynamicDataValue: 'dynamic',
      dynamicValueExtra: 'kept',
      dynamicText: 'Dynamic & escaped',
      multipleValues: ['beta', 'gamma'],
      implicitSelected: true,
      implicitOptionValue: 'Tea & milk',
      unrelatedDataValue: 'keep this value here',
      unrelatedValueExtra: 'keep this too',
      unrelatedText: 'literal selected value here',
    });
  } finally {
    await page.close();
  }
});
