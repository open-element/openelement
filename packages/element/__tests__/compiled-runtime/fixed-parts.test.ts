import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { testProgram } from './test-program.ts';

test('fixed Parts validate every exact DOM sink', () => {
  const program = testProgram({
    tag: 'oe-fixed-parts',
    template: [
      {
        k: 'el',
        tag: 'div',
        attrs: [],
        children: [],
      },
    ],
    parts: [
      { k: 'attr', index: 0, signal: 'title', name: 'title', path: [0] },
      { k: 'prop', index: 1, signal: 'value', name: 'value', path: [0] },
      { k: 'bool', index: 2, signal: 'disabled', name: 'disabled', path: [0] },
      { k: 'class', index: 3, signal: 'classes', path: [0] },
      { k: 'style', index: 4, signal: 'styles', path: [0] },
      {
        k: 'event',
        index: 5,
        event: 'click',
        handler: 'onClick',
        action: { kind: 'method', name: 'onClick' },
        path: [0],
      },
      { k: 'ref', index: 6, ref: 'captureRef', path: [0] },
    ],
  });

  expect(program.parts.map((part) => part.k)).toEqual([
    'attr',
    'prop',
    'bool',
    'class',
    'style',
    'event',
    'ref',
  ]);
});

test('program validation rejects void elements with children', () => {
  assertThrowsIncludes(
    () =>
      testProgram({
        tag: 'oe-invalid-void',
        template: [
          {
            k: 'el',
            tag: 'input',
            attrs: [],
            children: [{ k: 'text', value: 'unsupported' }],
          },
        ],
        parts: [],
      }),
    Error,
    'void elements may not have children',
  );
});
