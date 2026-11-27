/**
 * M09-2a — the shadow host producer in the generated element tail (LOCAL, Node).
 *
 * The author-facing fact is the island sidecar's `root: 'shadow'`; the lane
 * reads it (`readIslandRoot`, D-root-source), the emitter carries it into the
 * descriptor, and — for a shadow root only — appends the host-level export
 * `<Name>__ssrHost(props, lightChildren?)` that wraps the content-only
 * `<Name>__ssr` bytes with the canonical DSD template.
 *
 * The proof this file carries without a browser:
 *
 * - a LIGHT root (and an absent root) appends nothing: the tail is byte-for-byte
 *   the M09-1a tail, so the light path is untouched by this slice;
 * - a shadow root appends exactly one wrapper, it imports the producer from the
 *   ONE generated-element specifier, it passes the leaf's own `__ssr` export as
 *   the content, and the tail carries no DSD spelling of its own (no
 *   `shadowrootmode`, no `<template`, no `<style>`): the canonical template
 *   stays owned by `dsd.ts`;
 * - the descriptor root the author's sidecar pinned is what the wrapper wraps
 *   (`'shadow'` → `shadow-open` → wire `open`), and the unauthorable
 *   `shadow-closed` maps to `closed` instead of falling through to `open`;
 * - the emitted module still parses as JavaScript and still never names the
 *   Custom Elements registry.
 *
 * The browser half of this slice (parser adoption → claim → update → dispose) is
 * `generated-element.shadow-authoring.browser.test.ts`.
 */

import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  GENERATED_ELEMENT_SHELL_SPECIFIER,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { generateElementModule } from '../../src/internal/compiler/semantic-ir/generated-element/emit.ts';

const FILE = '/proj/src/islands/profile-card.tsx';
const SITE: GeneratedElementSite = { tag: 'profile-card' };

const SIDECAR_LIGHT =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "export const openElement = defineIslandConfig({ root: 'light' });\n";
const SIDECAR_SHADOW =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "export const openElement = defineIslandConfig({ root: 'shadow' });\n";
const BODY = `
function Profile() {
  return <p id="profile">hello</p>;
}
export default Profile;
`;
const LIGHT = `${SIDECAR_LIGHT}${BODY}`;
const SHADOW = `${SIDECAR_SHADOW}${BODY}`;

/**
 * The M09-1a light tail with the form-free factory import.
 */
const M09_1A_LIGHT_TAIL = [
  '',
  '// ---- generated native element (M09-1) ----',
  `import { createGeneratedElementClassWithFeatures as __oe_createElementClass } from ${JSON.stringify(GENERATED_ELEMENT_SHELL_SPECIFIER)};`,
  '',
  'const __oeElementDescriptor = {',
  '  tag: "profile-card",',
  '  root: "light",',
  '  properties: [],',
  '  createRecipe: createProfileRecipe,',
  // A light root's SSR entry point is the leaf's parameterless producer; the
  // shell attaches it as the class's static `__ssr` (B4). The shadow lane's
  // `<Name>__ssrHost` wrapper has no light DOM to produce, so the row is absent
  // there.
  '  ssrProducer: Profile__ssr,',
  '};',
  '',
  'const __oeProfileElement = __oe_createElementClass(__oeElementDescriptor, {});',
  '',
  'export default __oeProfileElement;',
  'export { __oeProfileElement as ProfileElement };',
  'export const __oeElementTag = "profile-card";',
  '',
].join('\n');

function frontModule(source: string) {
  const front = compileFunctionModule(source, FILE, {
    importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  });
  expect(front.diagnostics, front.diagnostics.map((item) => item.message).join('\n')).toEqual([]);
  return front.module!;
}

function emitted(source: string, root?: 'light' | 'shadow-open' | 'shadow-closed') {
  const result = generateElementModule(frontModule(source), SITE, {
    rootComponent: 'Profile',
    ...(root === undefined ? {} : { root }),
  });
  expect(result.diagnostics, result.diagnostics.map((item) => item.message).join('\n')).toEqual([]);
  expect(result.tail).not.toBeNull();
  return result;
}

function parseDiagnostics(text: string): readonly unknown[] {
  const source = ts.createSourceFile(
    'generated-element.js',
    text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  return (source as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics ?? [];
}

describe('M09-2a generated shadow host producer', () => {
  test('a light root appends exactly the M09-1a tail and no host wrapper', () => {
    const result = emitted(LIGHT, 'light');
    expect(result.tail).toBe(M09_1A_LIGHT_TAIL);
    expect(result.module).toBe(result.leaf! + M09_1A_LIGHT_TAIL);
    expect(result.tail).not.toContain('__ssrHost');
    expect(result.tail).not.toContain('serializeGeneratedElementHtml');
    // The light lane's SSR producer is the leaf's own parameterless `__ssr`;
    // no DSD wrapper and no host producer is involved.
    expect(result.tail).toContain('ssrProducer: Profile__ssr,');
  });

  test('an absent root keeps the same light tail so the shell owns the default', () => {
    const absent = emitted(LIGHT);
    expect(absent.tail).not.toContain('root:');
    expect(absent.tail).not.toContain('__ssrHost');
    expect(absent.tail!.replace('  root: "light",\n', '')).toBe(
      M09_1A_LIGHT_TAIL.replace('  root: "light",\n', ''),
    );
  });

  test('a shadow root appends one host wrapper over the content-only ssr export', () => {
    const result = emitted(SHADOW, 'shadow-open');
    const tail = result.tail!;
    expect(tail.match(/__ssrHost/g)?.length).toBe(1);
    expect(tail.match(/export function Profile__ssrHost\(/g)?.length).toBe(1);
    expect(tail).toContain(
      `import { createGeneratedElementClassWithFeatures as __oe_createElementClass, serializeGeneratedElementHtml, seedGeneratedElementHostPropertiesWithoutRows as seedGeneratedElementHostProperties } from ${JSON.stringify(GENERATED_ELEMENT_SHELL_SPECIFIER)};`,
    );
    expect(tail).toContain('root: "shadow-open"');
    expect(tail).toContain(
      'export function Profile__ssrHost(props, lightChildren, attributes, styleLinks, nestedHost) {',
    );
    // M11: the host producer seeds its content props from the canonical host
    // attribute pairs through the shell's ONE conversion surface.
    expect(tail).toContain(
      '  const __oeHostProps = seedGeneratedElementHostProperties(props, attributes);',
    );
    expect(tail).toContain('    root: "open",');
    expect(tail).toContain(
      '    content: Profile__ssr(__oeHostProps, nestedHost === undefined ? undefined : { "__oe_nestedHost": nestedHost }),',
    );
    expect(tail).toContain('    ...(lightChildren === undefined ? {} : { lightChildren }),');
    expect(tail).toContain('    ...(attributes === undefined ? {} : { attributes }),');
    expect(tail).toContain('tag: "profile-card"');
    // The leaf prefix is untouched: append-only still holds for a shadow root.
    expect(result.module!.startsWith(result.leaf!)).toBe(true);
    expect(result.module!.length).toBe(result.leaf!.length + tail.length);
    expect(result.module).not.toContain('customElements');
  });

  test('the tail carries no DSD spelling of its own and no raw markup channel', () => {
    const tail = emitted(SHADOW, 'shadow-open').tail!;
    for (const forbidden of [
      'shadowrootmode',
      '<template',
      '</template>',
      '<style',
      '<link',
      'escapeAttr',
      'rawPrefix',
    ]) {
      expect(tail, forbidden).not.toContain(forbidden);
    }
    // The content is the leaf's own export, never inlined bytes.
    expect(tail).not.toContain('<p id="profile">');
  });

  test('the closed wire root maps to a closed template instead of falling through', () => {
    const tail = emitted(SHADOW, 'shadow-closed').tail!;
    expect(tail).toContain('root: "shadow-closed"');
    expect(tail).toContain('    root: "closed",');
  });

  test('the emitted module with the host wrapper parses as JavaScript', () => {
    expect(parseDiagnostics(emitted(SHADOW, 'shadow-open').module!)).toEqual([]);
    expect(parseDiagnostics(emitted(LIGHT, 'light').module!)).toEqual([]);
  });

  test("a styles sidecar grows the fail-closed guard; the channel is every shadow host's (F16)", () => {
    // The fact is read from the SAME authored sidecar the lane already reads for
    // root/focus/props, so no host boolean and no scan-order dependence exists.
    const styledSource = SHADOW.replace(
      "export const openElement = defineIslandConfig({ root: 'shadow' });",
      "export const openElement = defineIslandConfig({ root: 'shadow', styles: ['./profile-card.css'] });",
    );
    const styled = compileGeneratedElementIfAdmitted(styledSource, FILE, { site: SITE })!;
    expect(styled.code).toContain(
      'export function Profile__ssrHost(props, lightChildren, attributes, styleLinks, nestedHost) {',
    );
    expect(styled.code).toContain('    ...(styleLinks === undefined ? {} : { styleLinks }),');
    // Mixed generated-element/entry artifacts: an old 3-arg caller (or a missing
    // carrier) must fail closed instead of rendering the styled host unstyled.
    const guard =
      'if (!Array.isArray(styleLinks) || styleLinks.length === 0) throw new Error("OEIR_LEAF_MISSING_VALUE: styleLinks';
    expect(styled.code).toContain(guard);
    const producerStart = styled.code.indexOf(
      'export function Profile__ssrHost(props, lightChildren, attributes, styleLinks, nestedHost) {',
    );
    expect(producerStart).toBeGreaterThan(-1);
    const guardStart = styled.code.indexOf('OEIR_LEAF_MISSING_VALUE: styleLinks');
    expect(guardStart).toBeGreaterThan(producerStart);
    // The guard runs before the seed/serialization call, so no partial markup.
    expect(guardStart).toBeLessThan(
      styled.code.indexOf(
        'const __oeHostProps = seedGeneratedElementHostProperties',
        producerStart,
      ),
    );
    // The claim skips exactly the canonical marked link prefix.
    expect(styled.code).toContain('data-oe-static-styles');
    expect(styled.code).toContain('nodeName === "LINK"');
    // F16: an UNSTYLED shadow host is no different in these two respects. Its
    // DSD template can begin with a nested LIGHT child's lifted marked links,
    // so the producer forwards the runtime channel and the claim skips the
    // leading run. What the declaration alone adds is the STRICT half: without
    // a declared sheet set the producer tolerates an absent URL list.
    const unstyled = compileGeneratedElementIfAdmitted(SHADOW, FILE, { site: SITE })!;
    expect(unstyled.code).toContain(
      'export function Profile__ssrHost(props, lightChildren, attributes, styleLinks, nestedHost) {',
    );
    expect(unstyled.code).toContain('...(styleLinks === undefined ? {} : { styleLinks }),');
    expect(unstyled.code).toContain('data-oe-static-styles');
    expect(unstyled.code).toContain('nodeName === "LINK"');
    expect(unstyled.code).not.toContain('OEIR_LEAF_MISSING_VALUE: styleLinks');
  });

  test('the claim prefix walk is a DSD-template fact, not a styling fact (F16)', () => {
    // A LIGHT root has no template to prefix, so its claim keeps the pre-slice
    // bytes even when the sidecar declares styles (the next row owns the
    // byte-identity half).
    const styledLight = LIGHT.replace(
      "export const openElement = defineIslandConfig({ root: 'light' });",
      "export const openElement = defineIslandConfig({ root: 'light', styles: ['./profile-card.css'] });",
    );
    const light = compileGeneratedElementIfAdmitted(styledLight, FILE, { site: SITE })!;
    expect(light.code).not.toContain('data-oe-static-styles');
    expect(light.code).not.toContain('styleLinks');
    // ... while EVERY shadow root gets the walk, candidate-free included.
    const plainShadow = compileGeneratedElementIfAdmitted(SHADOW, FILE, { site: SITE })!;
    expect(plainShadow.code).toMatch(
      /let (__oe_claimStart\d+) = __oe_parent\.firstChild;\n {2}while \(\1 !== null && \1\.nodeType === 1 && \1\.nodeName === "LINK" && \1\.hasAttribute\("data-oe-static-styles"\)\) \1 = \1\.nextSibling;/,
    );
  });

  test('a light root keeps its bytes even when the sidecar declares styles', () => {
    const styledLight = LIGHT.replace(
      "export const openElement = defineIslandConfig({ root: 'light' });",
      "export const openElement = defineIslandConfig({ root: 'light', styles: ['./profile-card.css'] });",
    );
    const light = compileGeneratedElementIfAdmitted(styledLight, FILE, { site: SITE })!;
    // Light roots have no DSD template: the declared sheet keeps the document
    // channel, so no host wrapper / styleLinks channel / claim prefix is added.
    expect(light.code).not.toContain('__ssrHost');
    expect(light.code).not.toContain('styleLinks');
    expect(light.code).not.toContain('data-oe-static-styles');
  });

  test('attribute rows project canonical host attrs from the seeded record (M11-2)', () => {
    const propsSidecar =
      "import { defineIslandConfig } from '@openelement/router';\n" +
      "export const openElement = defineIslandConfig({ root: 'shadow', " +
      "properties: { title: { attribute: 'data-title', default: '' }, count: { default: 0 } } });\n";
    const propsBody = `
function Profile(props: { title: string; count: number }) {
  return <p>{props.title}{props.count}</p>;
}
export default Profile;
`;
    const styled = compileGeneratedElementIfAdmitted(`${propsSidecar}${propsBody}`, FILE, {
      site: SITE,
    })!;
    expect(styled.code).toContain('const __oeHostAttrs = __oeHostProps.__oeHostAttributes;');
    expect(styled.code).toContain(
      'attributes: __oeHostAttrs === undefined ? attributes : __oeHostAttrs',
    );
    // A module with no attribute-backed row keeps the pre-slice wrapper bytes.
    const plain = compileGeneratedElementIfAdmitted(SHADOW, FILE, { site: SITE })!;
    expect(plain.code).not.toContain('__oeHostAttrs');
    expect(plain.code).toContain('...(attributes === undefined ? {} : { attributes }),');
  });

  test('a property-only primitive row makes the producer consume the ONE seed (A5)', () => {
    // ADR-0181 A5 amendment (2026-11-23): a supplied `attribute: false` primitive
    // has no attribute pair of its own, so the JSON seed is its ONLY host wire.
    // Without this gate the emitted wrapper called the seeder and IGNORED the
    // pair set, so the seed never reached the tag and the claim kept the default.
    const sidecar =
      "import { defineIslandConfig } from '@openelement/router';\n" +
      "export const openElement = defineIslandConfig({ root: 'shadow', " +
      "properties: { inner: { attribute: false, default: 'prop-only' } } });\n";
    const body = `
function Profile(props: { inner: string }) {
  return <p>{props.inner}</p>;
}
export default Profile;
`;
    const code = compileGeneratedElementIfAdmitted(`${sidecar}${body}`, FILE, { site: SITE })!.code;
    expect(code).toContain('const __oeHostAttrs = __oeHostProps.__oeHostAttributes;');
    expect(code).toContain('attributes: __oeHostAttrs === undefined ? attributes : __oeHostAttrs');
    // No per-row attribute is invented for the property-only row.
    expect(code).not.toContain('attribute: "inner"');
  });

  test('the lane reads the authored sidecar and emits the wrapper only for shadow', () => {
    const shadow = compileGeneratedElementIfAdmitted(SHADOW, FILE, { site: SITE });
    expect(shadow).not.toBeNull();
    expect(shadow!.code).toContain(
      'export function Profile__ssrHost(props, lightChildren, attributes, styleLinks, nestedHost) {',
    );
    expect(shadow!.code).toContain(
      'createDirectShadowElementClassWithProjection as __oe_createElementClass',
    );
    expect(shadow!.code).toContain('    root: "open",');

    const light = compileGeneratedElementIfAdmitted(LIGHT, FILE, { site: SITE });
    expect(light).not.toBeNull();
    expect(light!.code).not.toContain('__ssrHost');
    expect(light!.code).not.toContain('serializeGeneratedElementHtml');
  });
});
