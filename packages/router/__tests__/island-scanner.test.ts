/**
 * island-scanner.ts — readIslandConfig static metadata extraction.
 *
 * #771: known keys (ssr/dsd/hydrate) with non-literal values must throw
 * (fail closed) instead of being silently skipped and treated as defaults.
 */
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { readIslandConfig } from '../src/vite/internal/ssg/route-scanner.ts';

test('readIslandConfig: returns null without openElement export', () => {
  expect(readIslandConfig(`export default class Foo extends HTMLElement {}`)).toEqual(null);
});

test('readIslandConfig: parses static literal metadata', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ ssr: false, dsd: false, hydrate: 'only' });
`;
  expect(readIslandConfig(source)).toEqual({ ssr: false, dsd: false, hydrate: 'only' });
});

test('readIslandConfig: throws on dynamic ssr value (#771)', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
const isProd = true;
export const openElement = defineIslandConfig({ ssr: isProd });
`;
  assertThrowsIncludes(
    () => readIslandConfig(source),
    Error,
    'openElement.ssr must be a static literal',
  );
});

test('readIslandConfig: throws on dynamic hydrate value (#771)', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
const strategy = 'idle';
export const openElement = defineIslandConfig({ hydrate: strategy });
`;
  assertThrowsIncludes(
    () => readIslandConfig(source),
    Error,
    'openElement.hydrate must be a static literal',
  );
});

test('readIslandConfig: throws on computed dsd value (#771)', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ dsd: !import.meta.env?.DEV });
`;
  assertThrowsIncludes(
    () => readIslandConfig(source),
    Error,
    'openElement.dsd must be a static literal',
  );
});

test('readIslandConfig: throws on unsupported hydrate literal', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ hydrate: 'hover' });
`;
  assertThrowsIncludes(() => readIslandConfig(source), Error, 'unsupported value');
});

test('readIslandConfig: tolerates comments inside the config object', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({
  // don't server-render during campaigns
  ssr: false,
  /* } */
  hydrate: 'idle',
});
`;
  expect(readIslandConfig(source)).toEqual({ ssr: false, hydrate: 'idle' });
});

/**
 * `root` is a published `IslandConfig` field the runtime already validates;
 * the static scan used to reject it (the documented-contract/build
 * disagreement), and now accepts the same two values with the same
 * fail-closed literal rule as the other keys.
 */
test('readIslandConfig: accepts the documented root key', () => {
  expect(
    readIslandConfig(
      `export const openElement = defineIslandConfig({ hydrate: 'idle', root: 'shadow' });\n`,
    ),
  ).toEqual({ hydrate: 'idle', root: 'shadow' });
  expect(
    readIslandConfig(`export const openElement = defineIslandConfig({ root: 'light' });\n`),
  ).toEqual({ root: 'light' });
});

test('readIslandConfig: throws on dynamic root value', () => {
  const source = `const configuredRoot = 'light';
export const openElement = defineIslandConfig({ root: configuredRoot });
`;
  assertThrowsIncludes(
    () => readIslandConfig(source),
    Error,
    'openElement.root must be a static literal',
  );
});

test('readIslandConfig: throws on unsupported root literal', () => {
  const source = `export const openElement = defineIslandConfig({ root: 'shadow-closed' });
`;
  assertThrowsIncludes(() => readIslandConfig(source), Error, 'unsupported value');
});

test('readIslandConfig: the accepted-shape message advertises root', () => {
  const error = assertThrowsIncludes(
    () => readIslandConfig(`export const openElement = defineIslandConfig({ root: 1 });\n`),
    Error,
    'root?: "light" | "shadow"',
  );
  expect(error.message).toContain('Accepted shape:');
});

/**
 * `delegatesFocus` (D-delegatesFocus, 2026-11-14) is the existing
 * `@element(tag, { delegatesFocus })` vocabulary on the island sidecar: one
 * boolean, meaningful only with `root: 'shadow'`. The static scan is the
 * build-time authority for the same two rules the runtime authoring surface
 * and the compiler lane apply.
 */
test('readIslandConfig: accepts delegatesFocus beside a shadow root', () => {
  expect(
    readIslandConfig(
      `export const openElement = defineIslandConfig({ root: 'shadow', delegatesFocus: true });\n`,
    ),
  ).toEqual({ root: 'shadow', delegatesFocus: true });
  // `false` is the documented default and carries no shadow requirement.
  expect(
    readIslandConfig(`export const openElement = defineIslandConfig({ delegatesFocus: false });\n`),
  ).toEqual({ delegatesFocus: false });
});

test('readIslandConfig: throws on a dynamic delegatesFocus value', () => {
  const source = `const configuredFocus = true;
export const openElement = defineIslandConfig({ root: 'shadow', delegatesFocus: configuredFocus });
`;
  assertThrowsIncludes(
    () => readIslandConfig(source),
    Error,
    'openElement.delegatesFocus must be a static literal',
  );
});

test('readIslandConfig: throws on a non-boolean delegatesFocus literal', () => {
  const source = `export const openElement = defineIslandConfig({ root: 'shadow', delegatesFocus: 1 });
`;
  assertThrowsIncludes(
    () => readIslandConfig(source),
    Error,
    'openElement.delegatesFocus must be a static literal',
  );
});

test('readIslandConfig: delegatesFocus true requires root "shadow"', () => {
  for (const entries of ['delegatesFocus: true', "root: 'light', delegatesFocus: true"]) {
    const source = `export const openElement = defineIslandConfig({ ${entries} });
`;
    assertThrowsIncludes(
      () => readIslandConfig(source),
      Error,
      'openElement.delegatesFocus requires root: "shadow"',
    );
  }
});

test('readIslandConfig: the accepted-shape message advertises delegatesFocus', () => {
  const error = assertThrowsIncludes(
    () =>
      readIslandConfig(`export const openElement = defineIslandConfig({ delegatesFocus: 1 });
`),
    Error,
    'delegatesFocus?: boolean',
  );
  expect(error.message).toContain('Accepted shape:');
});

/**
 * `properties` (D-props, 2026-11-14) is the island element's primitive
 * property table: an object map keyed by the typed props member name, carrying
 * only the platform facts a type cannot express (`reflect`, `attribute`,
 * `default`). The scan is the build-time authority for the table's shape; the
 * compiler lane re-reads it and cross-checks it against the props type.
 */
test('readIslandConfig: accepts a property table and resolves attributes', () => {
  expect(
    readIslandConfig(
      `export const openElement = defineIslandConfig({ properties: { ` +
        `count: { reflect: true, default: 0 }, label: { default: 'untitled' }, ` +
        `padding: { attribute: false }, slug: { attribute: 'data-Slug' } } });\n`,
    ),
  ).toEqual({
    properties: {
      count: { attribute: 'count', attributeExplicit: false, reflect: true, default: 0 },
      label: { attribute: 'label', attributeExplicit: false, reflect: false, default: 'untitled' },
      padding: { attribute: null, attributeExplicit: true, reflect: false },
      slug: { attribute: 'data-slug', attributeExplicit: true, reflect: false },
    },
  });
});

test('readIslandConfig: property rows are own keys on a null-prototype record', () => {
  const config = readIslandConfig(
    `export const openElement = defineIslandConfig({ properties: { ` +
      `count: { default: 0 }, label: { attribute: false, default: 'x' } } });\n`,
  );
  expect(config?.properties).toBeDefined();
  expect(Object.getPrototypeOf(config!.properties)).toBeNull();
  expect(Object.keys(config!.properties!)).toEqual(['count', 'label']);
});

test('readIslandConfig: dangerous property names are refused', () => {
  for (const name of ['__proto__', 'constructor', 'prototype']) {
    assertThrowsIncludes(
      () =>
        readIslandConfig(
          `export const openElement = defineIslandConfig({ properties: { ${name}: { attribute: false, default: {} } } });\n`,
        ),
      Error,
      'not an admissible property name',
    );
  }
});

test('readIslandConfig: trustedHtml provenance matches the compiler on type-only imports', () => {
  for (const importLine of [
    `import type { trustedHtml } from '@openelement/element';`,
    `import { type trustedHtml } from '@openelement/element';`,
  ]) {
    assertThrowsIncludes(
      () =>
        readIslandConfig(
          `${importLine}\n` +
            `export const openElement = defineIslandConfig({ properties: { html: { attribute: false, default: trustedHtml('<b>x</b>') } } });\n`,
        ),
      Error,
      'canonical trustedHtml import',
    );
  }
  // A runtime aliased import follows the canonical binding and is admitted.
  expect(
    readIslandConfig(
      `import { trustedHtml as th } from '@openelement/element';\n` +
        `export const openElement = defineIslandConfig({ properties: { html: { attribute: false, default: th('<b>x</b>') } } });\n`,
    ),
  ).toEqual({
    properties: {
      html: {
        attribute: null,
        attributeExplicit: true,
        reflect: false,
        default: { trustedHtml: '<b>x</b>' },
      },
    },
  });
  // A local same-name callee is never given canonical provenance.
  assertThrowsIncludes(
    () =>
      readIslandConfig(
        `import { trustedHtml as canonicalHtml } from '@openelement/element';\n` +
          `const trustedHtml = () => ({ html: 'local' });\n` +
          `export const openElement = defineIslandConfig({ properties: { html: { attribute: false, default: trustedHtml('<b>x</b>') } } });\n`,
      ),
    Error,
    'canonical trustedHtml import',
  );
});

test('readIslandConfig: accepts an empty property table', () => {
  expect(
    readIslandConfig(`export const openElement = defineIslandConfig({ properties: {} });\n`),
  ).toEqual({ properties: {} });
});

test('readIslandConfig: throws on malformed property tables', () => {
  const cases: Array<[string, string]> = [
    ['properties: 1', 'must be an object of static property entries'],
    ['properties: { count: 1 }', 'must be an object'],
    ['properties: { "not-an-identifier": {} }', 'must be an identifier'],
    ['properties: { count: { type: "number" } }', 'does not accept "type"'],
    ['properties: { count: { reflect: 1 } }', 'must be a boolean literal'],
    ['properties: { count: { attribute: 1 } }', 'must be a string literal or false'],
    ['properties: { count: { attribute: "onclick" } }', 'not a safe HTML attribute name'],
    ['properties: { count: { attribute: false, reflect: true } }', 'cannot reflect'],
    ['properties: { count: { attribute: "n" }, label: { attribute: "n" } }', 'more than once'],
    ['properties: { __proto__: {} }', 'not an admissible property name'],
    ['properties: { constructor: {} }', 'not an admissible property name'],
    ['properties: { prototype: {} }', 'not an admissible property name'],
  ];
  for (const [entries, message] of cases) {
    assertThrowsIncludes(
      () => readIslandConfig(`export const openElement = defineIslandConfig({ ${entries} });\n`),
      Error,
      message,
    );
  }
});

test('readIslandConfig: reads literal array/object defaults and refuses dynamic ones', () => {
  // The static scanner records the literal graph; the compiler lane pairs it
  // with the typed non-primitive member and rejects misuse.
  expect(
    readIslandConfig(
      `export const openElement = defineIslandConfig({ properties: { ` +
        `events: { attribute: false, default: [{ id: 'a' }] }, ` +
        `model: { attribute: false, default: { nested: { x: 1 } } } } });\n`,
    ),
  ).toEqual({
    properties: {
      events: {
        attribute: null,
        attributeExplicit: true,
        reflect: false,
        default: [{ id: 'a' }],
      },
      model: {
        attribute: null,
        attributeExplicit: true,
        reflect: false,
        default: { nested: { x: 1 } },
      },
    },
  });
  const dynamic = `const defaultValue = 1;
export const openElement = defineIslandConfig({ properties: { count: { default: defaultValue } } });
`;
  assertThrowsIncludes(() => readIslandConfig(dynamic), Error, 'must be a static string, number');
  const spread = `const rows = [1];
export const openElement = defineIslandConfig({ properties: { count: { default: [...rows] } } });
`;
  assertThrowsIncludes(() => readIslandConfig(spread), Error, 'must not contain spreads');
});

test('readIslandConfig: the accepted-shape message advertises properties', () => {
  const error = assertThrowsIncludes(
    () => readIslandConfig(`export const openElement = defineIslandConfig({ properties: 1 });\n`),
    Error,
    'properties?: Record<string, { reflect?: boolean, attribute?: string | false, default?: string | number | boolean }>',
  );
  expect(error.message).toContain('Accepted shape:');
});

test('readIslandConfig: throws on duplicate property names independent of the attribute channel', () => {
  const cases = [
    'properties: { label: { attribute: false }, label: { attribute: false } }',
    "properties: { label: { attribute: 'a' }, label: { attribute: 'b' } }",
  ];
  for (const entries of cases) {
    assertThrowsIncludes(
      () => readIslandConfig(`export const openElement = defineIslandConfig({ ${entries} });\n`),
      Error,
      'declares property "label" more than once',
    );
  }
});
