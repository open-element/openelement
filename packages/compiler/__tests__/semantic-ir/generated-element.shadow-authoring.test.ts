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
 * The M09-1a light tail, byte-for-byte. A light root must keep exactly these
 * bytes: this slice never alters the light path.
 */
const M09_1A_LIGHT_TAIL = [
  '',
  '// ---- generated native element (M09-1) ----',
  `import { createGeneratedElementClass } from ${JSON.stringify(GENERATED_ELEMENT_SHELL_SPECIFIER)};`,
  '',
  'const __oeElementDescriptor = {',
  '  tag: "profile-card",',
  '  root: "light",',
  '  properties: [],',
  '  createRecipe: createProfileRecipe,',
  '};',
  '',
  'const __oeProfileElement = createGeneratedElementClass(__oeElementDescriptor);',
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
      `import { createGeneratedElementClass, serializeGeneratedElementHtml } from ${JSON.stringify(GENERATED_ELEMENT_SHELL_SPECIFIER)};`,
    );
    expect(tail).toContain('root: "shadow-open"');
    expect(tail).toContain('export function Profile__ssrHost(props, lightChildren) {');
    expect(tail).toContain('    root: "open",');
    expect(tail).toContain('    content: Profile__ssr(props, undefined),');
    expect(tail).toContain('    ...(lightChildren === undefined ? {} : { lightChildren }),');
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

  test('the lane reads the authored sidecar and emits the wrapper only for shadow', () => {
    const shadow = compileGeneratedElementIfAdmitted(SHADOW, FILE, { site: SITE });
    expect(shadow).not.toBeNull();
    expect(shadow!.code).toContain('export function Profile__ssrHost(props, lightChildren) {');
    expect(shadow!.code).toContain('root: "shadow-open"');
    expect(shadow!.code).toContain('    root: "open",');

    const light = compileGeneratedElementIfAdmitted(LIGHT, FILE, { site: SITE });
    expect(light).not.toBeNull();
    expect(light!.code).not.toContain('__ssrHost');
    expect(light!.code).not.toContain('serializeGeneratedElementHtml');
  });
});
