/**
 * Fixture wiring shared by the semantic-IR test suites.
 *
 * Every test that compiles an `@openelement/element` authoring module needs the
 * same two facts: where the repository root is, and which specifiers the
 * function frontend may classify as `factory` / `value` / call targets. Those
 * were written out by hand in 27 test files (a byte-identical 14-line object)
 * and as a `REPO_ROOT` constant in 24 more — fixture wiring, not test intent,
 * copied once per file.
 *
 * One copy here, imported. A change to the classifier is one edit rather than
 * 27, and a new test cannot pick a slightly different classifier by accident.
 * This module holds no fixtures of its own: each suite still authors its own
 * source and asserts its own behavior.
 */

/**
 * Repository root, with a trailing slash so both `${REPO_ROOT}packages/...`
 * and `join(REPO_ROOT, 'packages/...')` resolve the same path.
 */
export const REPO_ROOT = new URL('../../../../../', import.meta.url).pathname;

/** The classifier the function frontend is driven with in these suites. */
export const ELEMENT_CLASSIFIER = {
  classifySymbol: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal' || importedName === 'computed') return 'factory' as const;
    return 'value' as const;
  },
  classifyValue: () => undefined,
  classifyCall: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal') return { call: 'signal' as const };
    if (importedName === 'computed') return { call: 'computed' as const };
    return undefined;
  },
};
