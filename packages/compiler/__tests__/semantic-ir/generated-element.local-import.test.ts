/**
 * ADR-0183 D-4 follow-up — a derived value may read a shared MODULE HELPER.
 *
 * Measured defect: the generated-element lane classified only its own factory
 * specifiers, so any other module import stayed `unknown` and a TRACKED slot
 * (a `computed` body) that read one was refused with
 * `OEC9043 [OEIR_UNCLASSIFIED_BINDING]`. Every site module with shared copy or
 * a shared formatter has that shape, so the refusal was not a safety property:
 * an ordinary module value carries no reactive source and nothing can go stale
 * by reading it.
 *
 * This pins both halves: a plain module import is admitted in a derived body,
 * and the lane's own factories still classify as factories (so their result is
 * still a signal, not a plain value).
 */
import { expect, test } from 'vitest';
import { GENERATED_ELEMENT_IMPORT_CLASSIFIER } from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';

test('a plain module import is classified as an ordinary value', () => {
  expect(GENERATED_ELEMENT_IMPORT_CLASSIFIER.classifyValue('react', 'useState')).toEqual('plain');
  expect(
    GENERATED_ELEMENT_IMPORT_CLASSIFIER.classifyValue(
      './chrome-strings.ts',
      'readingChromeStrings',
    ),
  ).toEqual('plain');
});

test('the lane factory specifiers keep their factory classification', () => {
  for (const specifier of ['@openelement/element', '@openelement/element/lifecycle']) {
    expect(GENERATED_ELEMENT_IMPORT_CLASSIFIER.classifySymbol(specifier, 'signal')).toEqual(
      'factory',
    );
    expect(GENERATED_ELEMENT_IMPORT_CLASSIFIER.classifySymbol(specifier, 'computed')).toEqual(
      'factory',
    );
    // The factory's RESULT is a signal, never a plain value.
    expect(GENERATED_ELEMENT_IMPORT_CLASSIFIER.classifyValue(specifier, 'signal')).toBeUndefined();
  }
  // A namespace/type import stays unclassified: the lane reads no member of it.
  expect(
    GENERATED_ELEMENT_IMPORT_CLASSIFIER.classifyValue('./page-contract.ts', null),
  ).toBeUndefined();
});
