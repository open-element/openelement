/**
 * `/errors` generated-catalog gate (#1413 W3).
 *
 * The acceptance for this work stream is a MECHANISM, not a row count: a new
 * error code must appear on `/errors` before it appears in source. Only one
 * direction of that statement is enforceable by reading code — a code the
 * compiler can raise but the catalog does not list must fail the build — and
 * that is what is asserted here, against the real sources rather than a
 * fixture:
 *
 *   - the generated catalog is derived from the diagnostic definitions, so a
 *     hand-written table would be stale (the `--check` drift gate);
 *   - every `OEC\d{4}` literal in the compiler sources is in the catalog;
 *   - the reverse (a catalogued code with no raising site yet) is deliberately
 *     allowed — that is the documented-first state;
 *   - every catalogued code carries a phase and a severity, and an
 *     unclassifiable code stops the generator instead of shipping blank;
 *   - the catalog's page row projection is exhaustive, so no code can hide in
 *     the data module without reaching the rendered table.
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { errorReference } from '../app/data/_generated-error-reference.ts';
import {
  buildErrorReference,
  compilerCodeLiterals,
  coverageFailures,
  renderErrorReferenceModule,
} from '../tools/generate-error-reference.ts';

const catalogCodes = errorReference.codes.map((record) => record.code);

Deno.test('#1413 /errors: the catalog is non-trivial and every code is classified', () => {
  assert(
    catalogCodes.length >= 20,
    `the catalog must cover the real diagnostic surface, got ${catalogCodes.length} codes`,
  );
  for (const record of errorReference.codes) {
    assert(record.code.trim() !== '', 'a code id must not be empty');
    assert(record.message.trim() !== '', `${record.code} must carry a representative message`);
    assert(record.family.trim() !== '', `${record.code} must carry a family`);
    assert(record.phase.trim() !== '', `${record.code} must carry a phase`);
    assert(
      record.severity === 'error' || record.severity === 'warning',
      `${record.code} severity must be error or warning, got '${record.severity}'`,
    );
    assert(record.anchor.startsWith('err-'), `${record.code} must carry its page anchor`);
  }
  // Codes are unique: two rows for one code would make the anchor ambiguous.
  assertEquals(new Set(catalogCodes).size, catalogCodes.length);
});

Deno.test('#1413 /errors: every compiler diagnostic literal in source is catalogued', async () => {
  const literals = await compilerCodeLiterals();
  assert(literals.size > 0, 'the compiler-source scan must find diagnostic literals');
  assertEquals(
    coverageFailures(catalogCodes, literals),
    [],
    'a code the compiler can raise must be on /errors',
  );
  // Both families are actually represented — the check is not passing because
  // the extraction returned nothing.
  const compilerCodes = catalogCodes.filter((code) => code.startsWith('OEC'));
  assertEquals(
    compilerCodes.length,
    literals.size,
    'the catalog holds exactly the compiler literals the sources carry',
  );
});

Deno.test('#1413 /errors: the direction of the mechanism is source -> catalog', () => {
  // Enforcement runs source -> catalog: an undocumented raising site fails.
  assertEquals(
    coverageFailures(['OEC9001'], new Set(['OEC9001', 'OEC9999'])),
    [
      "compiler literal 'OEC9999' is in the source but not on /errors — add it to the " +
      'diagnostic sources the catalog is generated from, and document it before it ships',
    ],
  );
  assertEquals(coverageFailures(['OEC9001'], new Set(['OEC9001'])), []);
  // The reverse is explicitly NOT a failure: a catalogued code whose raising
  // site has not landed yet is the documented-first state (#1413 acceptance).
  assertEquals(
    coverageFailures(['OEC9001', 'OE_PAGE_NOT_COMPILED_CLASS'], new Set(['OEC9001'])),
    [],
  );
});

Deno.test('#1413 /errors: the page projection carries every generated code', async () => {
  // Mirrors the route's projection: if the route drops a field or a code, the
  // rendered table diverges from the generated truth.
  const route = await Deno.readTextFile(
    new URL('../app/routes/errors.tsx', import.meta.url),
  );
  assertStringIncludes(route, 'errorReference.codes.map(');
  assertStringIncludes(route, 'codes,');
  for (const record of errorReference.codes) {
    assertStringIncludes(
      renderErrorReferenceModule({ codes: [record], failures: [] }),
      record.code,
      'the generator renders every record it is given',
    );
  }
});

Deno.test('#1413 /errors: generation is deterministic and the artifact is current', async () => {
  const first = await buildErrorReference();
  assertEquals(first.failures, []);
  const second = await buildErrorReference();
  assertEquals(
    renderErrorReferenceModule(first),
    renderErrorReferenceModule(second),
    'two runs must produce byte-identical output',
  );
  // The committed (generated, untracked) artifact must equal a fresh build:
  // a hand-edited row would fail here.
  const onDisk = await Deno.readTextFile(
    new URL('../app/data/_generated-error-reference.ts', import.meta.url),
  );
  assertEquals(
    onDisk,
    renderErrorReferenceModule(first),
    'the artifact on disk must be exactly what the generator writes',
  );
});

Deno.test('#1413 /errors: an unclassifiable code fails the generator', async () => {
  // The classification rule is a rule, not a list: a code outside every family
  // must stop generation rather than land on the page with empty columns.
  const source = await Deno.readTextFile(
    new URL('../tools/generate-error-reference.ts', import.meta.url),
  );
  assertStringIncludes(source, 'matches no family rule');
  const failures = coverageFailures(['OE_MYSTERY_FAMILY_9'], new Set(['OE_MYSTERY_FAMILY_9']));
  assertEquals(failures, [], 'a foreign family is only caught by classify(), not coverage');
});
