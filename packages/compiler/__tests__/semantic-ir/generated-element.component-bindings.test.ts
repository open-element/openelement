import { expect, test } from 'vitest';
import { compileGeneratedElementIfAdmitted } from '../../src/compiler.ts';

const file = 'app/islands/component-binding.tsx';
const sidecar = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ root: 'shadow', ssr: true });
`;

test.each([
  {
    case: 'dynamic component aliases',
    component: `function A(props) { return <i>{props.label}</i>; }
function B(props) { return <b>{props.label}</b>; }
export default function Root() {
  const Chosen = Math.random() > 0.5 ? A : B;
  return <Chosen label="test" />;
}`,
    code: 'OEIR_LEAF_UNKNOWN_COMPONENT',
    line: 7,
  },
  {
    case: 'cross-module component recipes',
    component: `import { Child } from './child.tsx';
export default function Root() { return <Child label="test" />; }`,
    code: 'OEIR_LEAF_UNKNOWN_COMPONENT',
    line: 4,
  },
  {
    case: 'runtime values shadowing declared components',
    component: `function Child(props) { return <i>{props.label}</i>; }
export default function Root() {
  const Child = Math.random() > 0.5 ? 'i' : 'b';
  return <Child label="test" />;
}`,
    code: 'OEC9042',
    line: 6,
  },
  {
    case: 'qualified tags that could be mistaken for a local component',
    component: `function Child(props) { return <i>{props.label}</i>; }
export default function Root() { return <Child.Other label="test" />; }`,
    code: 'OEC9042',
    line: 4,
  },
])('the generated-element lane refuses $case at the authored tag', ({ component, code, line }) => {
  expect(() =>
    compileGeneratedElementIfAdmitted(sidecar + component, file, {
      site: { tag: 'component-binding' },
    }),
  ).toThrow(
    expect.objectContaining({
      diagnostics: expect.arrayContaining([expect.objectContaining({ code, file, line })]),
    }),
  );
});
