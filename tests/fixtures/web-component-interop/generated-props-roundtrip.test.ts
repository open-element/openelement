/**
 * 16b-MN residual (a) — in-tree fixture evidence for the generated-element
 * non-primitive property channel (Node, no browser, no build).
 *
 * The probe source lives in `probes/`, OUTSIDE `app/`, so the router build and
 * the interop qualification harness never see it; this test reads it and runs
 * the REAL compiler lane over it. It pins the artifact facts the client
 * round-trip evidence (Chromium, compiler lane) depends on:
 *
 * - array/object/trustedHtml rows are property-only (`attribute: false` -> the
 *   emitted descriptor has no attribute channel for them);
 * - the emitted host producer keeps the M11 host-producer ABI and folds only
 *   the in-process props record (no JSON/attribute seed for these rows);
 * - the client shell receives the property rows (the only channel a client
 *   mount/update/claim can use).
 *
 * The behaviour itself (mount -> update -> claim) is exercised in
 * `packages/compiler/__tests__/semantic-ir/generated-element.nonprimitive-properties.browser.test.ts`;
 * this file is the fixture/product-fact layer, not a second renderer.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { compileGeneratedElementIfAdmitted } from '@openelement/compiler';

const fixtureRoot = new URL('./', import.meta.url);
const probeFile = 'probes/generated-props-card.tsx';
const tag = 'generated-props-card';

test('the non-primitive probe compiles property-only rows with no attribute seed channel', async () => {
  const source = await readFile(fileURLToPath(new URL(probeFile, fixtureRoot)), 'utf8');
  const compiled = compileGeneratedElementIfAdmitted(source, probeFile, { site: { tag } });
  expect(compiled).not.toBeNull();
  expect(compiled!.tag).toBe(tag);
  expect(compiled!.component).toBe('InteropPropsCard');
  expect(compiled!.ssrHostExport).toBe('InteropPropsCard__ssrHost');

  const code = compiled!.code;
  // Property-only descriptor rows: no attribute name is derivable for any row.
  for (const name of ['events', 'model', 'articleHtml']) {
    expect(code).toContain(`name: "${name}"`);
    expect(code).toMatch(new RegExp(`name: "${name}",\\s*attribute: null,\\s*type: "`));
  }
  // The host-producer ABI is unchanged (in-process props fold only; the
  // attribute pairs channel is the primitive/literal one and cannot carry these
  // rows because their descriptor attribute is null).
  expect(code).toContain('function InteropPropsCard__ssrHost(props, lightChildren, attributes)');
  expect(code).toContain('seedGeneratedElementHostProperties');
  // No JSON transport/attribute name is invented for the property-only rows.
  expect(code).not.toContain('JSON.stringify(props');
  expect(code).not.toContain('data-events');
  expect(code).not.toContain('data-model');
  expect(code).not.toContain('data-article-html');
});
