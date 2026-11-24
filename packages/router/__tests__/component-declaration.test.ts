/**
 * The ONE component-declaration reader (P-4 fix).
 *
 * Four build passes used to call the sidecar parser themselves and interpret the
 * result differently — eight call sites, four interpretations, one fact. That is
 * how one module came to be a class page for the classifier and a generated
 * element for the transform. These rows pin the single answer every pass now
 * shares.
 */
import { expect, test } from 'vitest';
import {
  mayDeclareComponent,
  readComponentDeclaration,
} from '../src/vite/internal/component-declaration.ts';

const SIDECAR = (body: string) => `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ ${body} });
export default function Component() {
  return <div>c</div>;
}
`;

test('a module without the sidecar is ABSENT, not an error', () => {
  const source = `export default function Plain() { return <div>c</div>; }`;
  expect(mayDeclareComponent(source)).toBe(false);
  expect(readComponentDeclaration(source).kind).toBe('absent');
});

test('a sidecar with a pinned tag declares that tag and its root', () => {
  const reading = readComponentDeclaration(SIDECAR("tag: 'x-card', root: 'shadow'"));
  expect(reading.kind).toBe('declared');
  if (reading.kind !== 'declared') return;
  expect(reading.declaration.tag).toBe('x-card');
  expect(reading.declaration.root).toBe('shadow');
});

test('a sidecar with NO pinned tag falls back to the caller convention tag', () => {
  // The island case: its tag is its path's, so the caller passes the derived one.
  const reading = readComponentDeclaration(SIDECAR("root: 'light'"), 'path-derived');
  expect(reading.kind).toBe('declared');
  if (reading.kind !== 'declared') return;
  expect(reading.declaration.tag).toBe('path-derived');
  expect(reading.declaration.root).toBe('light');
});

test('no pinned tag AND no fallback means the module has no identity to admit', () => {
  // A page-local component with neither: there is nothing to register, and the
  // answer must be the same "not a component" every pass reads.
  expect(readComponentDeclaration(SIDECAR("root: 'light'")).kind).toBe('absent');
});

test('an UNREADABLE sidecar is reported as invalid, never silently absent', () => {
  // `styles` must be a static literal array; a dynamic value is refused by the
  // parser. The scan reports it as a note; the transform reports the authored
  // diagnostic. Neither may treat it as "no component" without saying so.
  const reading = readComponentDeclaration(
    `export const openElement = defineIslandConfig({ styles: getStyles() });`,
  );
  expect(reading.kind).toBe('invalid');
});

test('the styles list is the authored order, and empty when undeclared', () => {
  // Specifiers are `./`-relative by the parser's own rule (a bare package
  // specifier or absolute path cannot resolve against an island directory). The
  // row asserts the ORDER the sidecar wrote, which is the whole contract.
  const withStyles = readComponentDeclaration(
    SIDECAR("tag: 'x-styled', root: 'shadow', styles: ['./b.css', './a.css']"),
  );
  expect(withStyles.kind).toBe('declared');
  if (withStyles.kind === 'declared') {
    expect(withStyles.declaration.styles).toEqual(['./b.css', './a.css']);
  }
  const withoutStyles = readComponentDeclaration(SIDECAR("tag: 'x-plain'"));
  if (withoutStyles.kind === 'declared') expect(withoutStyles.declaration.styles).toEqual([]);
});
