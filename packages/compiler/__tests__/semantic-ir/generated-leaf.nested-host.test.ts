/**
 * alpha16 nested-expansion — a generated element's SSR producer asks the render
 * to expand each nested custom-element host.
 *
 * The defect this fixes is not subtle: a generated LIGHT-root host's `__ssr` is a
 * string builder, so a dash-tag element inside its markup stayed an inert tag —
 * no DSD, no server render, a descheduled host. The class lane never had the
 * problem because its serializer walks `renderNestedElement` for every `*-*` tag.
 * The generated lane now routes each dash tag through ONE helper that asks the
 * render's host for the expansion and otherwise returns the caller's own literal
 * bytes.
 *
 * The second property, and the reason the slice is safe to land: an intrinsic tag
 * and a module with no dash tags keep byte-identical output.
 */
import { expect, test } from 'vitest';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { GENERATED_ELEMENT_IMPORT_CLASSIFIER as CLASSIFIER } from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';

const FILE = '/proj/src/leaf.tsx';

function module(source: string): string {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  return generateLeafModule(front.module!).module!;
}

test('a nested custom-element host routes through nestedHost with a literal fallback', () => {
  const code = module(`function Wrapper(props) {
  return <div><x-child class='a' n={props.n}></x-child></div>;
}
`);
  expect(code).toContain('nestedHost(__oe_host, {');
  // The fallback is the caller's OWN bytes: tag + attributes + children + close.
  expect(code).toMatch(/fallback: \w+ \+ \w+ \+ "<\/x-child>"/);
  // The attribute pairs are the SAME evaluations the serialized bytes carry.
  expect(code).toContain('__oe_nestedAttrs');
});

test('a STATIC nested host still expands (the static producer declines dash tags)', () => {
  // A fully static producer is a compile-time string with no expansion call, so a
  // static host would silently stay inert. The static path therefore declines any
  // dash tag, which routes the component to the dynamic producer.
  const code = module(`function Wrapper(props) {
  return <div><x-child class='a'></x-child></div>;
}
`);
  expect(code).toContain('nestedHost(__oe_host, {');
  expect(code).not.toMatch(/function Wrapper__ssr\(\) \{/);
});

test('an intrinsic-only module keeps byte-identical output (no helper, no import)', () => {
  const code = module(`function Plain(props) {
  return <div class='a'>{props.text}</div>;
}
`);
  expect(code).not.toContain('nestedHost');
});

test('the helper is imported only when the module uses it', () => {
  const nested = module(`function Wrapper(props) { return <x-child></x-child>; }
`);
  expect(nested).toMatch(
    /import \{[^}]*nestedHost[^}]*\} from "@openelement\/element\/internal\/compiled\/leaf-runtime"/,
  );
  const plain = module(`function Plain(props) { return <p>{props.text}</p>; }
`);
  expect(plain).not.toMatch(/import \{[^}]*nestedHost/);
});

/* ------------------------------------------------------------------------- *
 * P-6 (2026-11-21): the SHADOW host producer must carry the expander.
 *
 * The light-root producer received the nested-host expander from the start; the
 * shadow host producer (`<Name>__ssrHost`) did not, so a shadow page's inner
 * components stayed unexpanded tags while the class lane and the light lane both
 * expanded theirs. That is a parity gap, not a design boundary — the class lane's
 * own shadow pages had always expanded, which is the proof it is required.
 * ------------------------------------------------------------------------- */

const SHADOW_PAGE = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ tag: 'p6-page', root: 'shadow' });
export default function P6Page() {
  return <main><x-inner label='a'><b>hi</b></x-inner></main>;
}
`;

test('P-6: the shadow host producer RECEIVES the nested-host expander', () => {
  const compiled = compileGeneratedElementIfAdmitted(SHADOW_PAGE, '/proj/src/p6.tsx', {
    site: { tag: 'p6-page' },
  });
  expect(compiled).not.toBeNull();
  const code = compiled!.code;
  // The wrapper's LAST parameter is the expander, in the same position the light
  // root's producer already uses.
  expect(code).toMatch(/export function P6Page__ssrHost\([^)]*nestedHost\)/);
  // ...and it reaches the leaf producer as the compiler-private host record field
  // the runtime's ONE `nestedHost` helper reads.
  expect(code).toContain(
    'nestedHost === undefined ? undefined : { "__oe_nestedHost": nestedHost }',
  );
});

test('P-6: a shadow module without nested dash tags still gains no call site', () => {
  const compiled = compileGeneratedElementIfAdmitted(
    `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ tag: 'p6-plain', root: 'shadow' });
export default function P6Plain() {
  return <main><p>no dash tags</p></main>;
}
`,
    '/proj/src/p6-plain.tsx',
    { site: { tag: 'p6-plain' } },
  );
  expect(compiled).not.toBeNull();
  // The producer still accepts the expander (one uniform ABI), but the leaf emits
  // no expansion call, so there is nothing to route.
  expect(compiled!.code).not.toContain('nestedHost(__oe_host');
});
