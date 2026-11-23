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
 *   emitted descriptor carries no per-row attribute channel);
 * - the emitted host producer keeps the current host-producer ABI, seeds the
 *   in-process props fold, and resolves the property-only rows through the
 *   shell's props resolver. Array/object rows still travel on the runtime's one
 *   shared `data-oe-prop-seed` JSON document (ADR-0181 A5 amendment / D-18c);
 *   that is the seeder's transport, not a per-row attribute channel, and a
 *   `trustedHtml` brand is still unseeded;
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

test('the non-primitive probe compiles property-only rows with no per-row attribute channel', async () => {
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
  // The host producer keeps the current ABI: the in-process props fold, then
  // the shell resolver for the property-only rows (fresh defaults + the
  // trustedHtml brand). The attribute-pair channel is the primitive/literal one
  // and cannot carry these rows because their descriptor attribute is null.
  expect(code).toContain(
    'function InteropPropsCard__ssrHost(props, lightChildren, attributes, styleLinks, nestedHost)',
  );
  expect(code).toContain('seedGeneratedElementHostProperties');
  expect(code).toContain(
    'content: InteropPropsCard__ssr(resolveGeneratedElementProps(__oeElementDescriptor, __oeHostProps)',
  );
  // No PER-ROW JSON transport or attribute name is invented for the property-only
  // rows (array/object still ride the runtime's one shared data-oe-prop-seed JSON
  // document; that is the seeder's channel, not an emitted per-row one).
  expect(code).not.toContain('JSON.stringify(props');
  expect(code).not.toContain('data-events');
  expect(code).not.toContain('data-model');
  expect(code).not.toContain('data-article-html');
});
