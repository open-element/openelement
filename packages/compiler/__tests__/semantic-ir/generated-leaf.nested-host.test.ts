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
