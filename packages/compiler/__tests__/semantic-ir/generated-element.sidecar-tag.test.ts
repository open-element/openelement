/**
 * The island sidecar's EXPLICIT `tag` source (alpha16 tag-source slice), LOCAL
 * Node.
 *
 * A generated element's tag is the ONE host fact the compiler cannot derive:
 * the transform runs before the island transform, so `__tagName` does not exist
 * there yet. Until this slice the host could answer it from a package manifest
 * or the islands directory only, which left a page-local component
 * (`www/app/site-ui/open-artifact-panel.tsx`) with no tag source at all — the
 * lane declined the module and it never compiled.
 *
 * The owner decision is the authored sidecar key (`defineIslandConfig({ tag })`),
 * not path derivation (a second path-identity source, forbidden by the seam
 * rule) and not JSX-usage inference (which would admit a typo instead of
 * failing closed). These tests pin the READER's contract:
 *
 * - `readIslandMetadata` reads a static string `tag` into `facts.tag`;
 * - an absent `tag` stays undefined, so every existing sidecar is unaffected;
 * - a non-static value, a duplicate key, an invalid spelling and a non-string
 *   literal refuse with the internal, source-located
 *   `OEIR_GENERATED_ELEMENT_TAG_INVALID` — never a guessed identity;
 * - the fact is the resolver's input only: the descriptor still takes its tag
 *   from the host site fact, so the emitted bytes for a sidecar that ALSO
 *   declares `tag` are the same ones it emitted before.
 *
 * The router scanner stays the authority for the sidecar's accepted shape and
 * error text; the compiler↔router agreement is guarded in the router's
 * `island-metadata-drift-guard.test.ts`.
 */

import { describe, expect, test } from 'vitest';
import type ts from 'typescript';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { typescriptParser } from '../../src/internal/compiler/semantic-core/parse-module.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import { GENERATED_ELEMENT_DIAGNOSTIC } from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import {
  admitGeneratedElementSite,
  readIslandMetadata,
} from '../../src/internal/compiler/semantic-ir/generated-element/site.ts';

// A path WITHOUT the tag in it: the emitted module carries source-located
// diagnostic markers naming this file, so a path containing the tag string
// would make "the sidecar spelling appears nowhere" unassertable.
const FILE = '/proj/app/site-ui/panel-probe.tsx';
const SITE = { tag: 'open-artifact-panel' } as const;

function parse(source: string): ts.SourceFile {
  const parsed = typescriptParser.parseModule(source, FILE);
  expect(parsed.syntaxDiagnostics).toEqual([]);
  return parsed.sourceFile;
}

/** One page-local component with the given sidecar entry list, verbatim. */
function component(entries: string): string {
  return (
    "import { defineIslandConfig } from '@openelement/router';\n" +
    `export const openElement = defineIslandConfig({ ${entries} });\n` +
    'function ArtifactPanel() {\n' +
    '  return <section><slot></slot></section>;\n' +
    '}\n' +
    'export default ArtifactPanel;\n'
  );
}

function laneError(source: string): CompiledElementError {
  try {
    compileGeneratedElementIfAdmitted(source, FILE, { site: SITE });
  } catch (error) {
    if (error instanceof CompiledElementError) return error;
    throw error;
  }
  throw new Error('expected the generated element lane to refuse the module');
}

describe('sidecar declared tag', () => {
  test('a static string tag is read as the authored identity', () => {
    const read = readIslandMetadata(parse(component("tag: 'open-artifact-panel'")));
    expect(read.kind).toBe('read');
    if (read.kind !== 'read') throw new Error('unreachable');
    expect(read.facts.tag).toBe('open-artifact-panel');
  });

  test('a string-literal key is read like an identifier key', () => {
    const read = readIslandMetadata(parse(component('"tag": "open-artifact-panel"')));
    if (read.kind !== 'read') throw new Error('unreachable');
    expect(read.facts.tag).toBe('open-artifact-panel');
  });

  test('an absent tag stays undefined so every existing sidecar is unaffected', () => {
    for (const entries of ["hydrate: 'idle'", "root: 'light'", "styles: ['./panel.css']"]) {
      const read = readIslandMetadata(parse(component(entries)));
      expect(read.kind, entries).toBe('read');
      if (read.kind !== 'read') throw new Error('unreachable');
      expect(read.facts.tag, entries).toBeUndefined();
    }
  });

  test('a non-static value refuses and the diagnostic is source-located', () => {
    const read = readIslandMetadata(parse(component('tag: configuredTag')));
    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') throw new Error('unreachable');
    expect(read.diagnostic.code).toBe(GENERATED_ELEMENT_DIAGNOSTIC.TAG_INVALID);
    expect(read.diagnostic.message).toContain('must be a static literal');
    expect(read.diagnostic.span.file).toBe(FILE);
    // The span points at the offending value, not at the module start.
    expect(read.diagnostic.span.line).toBe(2);
    expect(read.diagnostic.span.start).toBeGreaterThan(0);
  });

  test('a template expression, another literal and a spread refuse', () => {
    const nonStatic = [
      'tag: `open-${name}`',
      'tag: someTags[0]',
      'tag: 42',
      'tag: null',
      'tag: true',
    ];
    for (const entry of nonStatic) {
      const read = readIslandMetadata(parse(component(entry)));
      expect(read.kind, entry).toBe('refused');
      if (read.kind !== 'refused') throw new Error('unreachable');
      expect(read.diagnostic.code, entry).toBe(GENERATED_ELEMENT_DIAGNOSTIC.TAG_INVALID);
      expect(read.diagnostic.message, entry).toContain('must be a static literal');
    }
    for (const entry of ['tag', '...base', "[key]: 'open-x'"]) {
      const read = readIslandMetadata(parse(component(entry)));
      expect(read.kind, entry).toBe('refused');
    }
  });

  test('an invalid custom-element spelling refuses instead of being admitted', () => {
    for (const spelling of ['"openartifactpanel"', '"Open-Panel"', '"open_panel"', '""']) {
      const read = readIslandMetadata(parse(component(`tag: ${spelling}`)));
      expect(read.kind, spelling).toBe('refused');
      if (read.kind !== 'refused') throw new Error('unreachable');
      expect(read.diagnostic.code, spelling).toBe(GENERATED_ELEMENT_DIAGNOSTIC.TAG_INVALID);
      expect(read.diagnostic.message, spelling).toContain('not a valid custom-element name');
    }
  });

  test('a duplicate tag declaration refuses as ambiguous', () => {
    const read = readIslandMetadata(
      parse(component("tag: 'open-artifact-panel', tag: 'open-other-panel'")),
    );
    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') throw new Error('unreachable');
    expect(read.diagnostic.code).toBe(GENERATED_ELEMENT_DIAGNOSTIC.TAG_INVALID);
    expect(read.diagnostic.message).toContain('more than once');
  });

  test('the admission carries the declared tag beside the other facts', () => {
    const admitted = admitGeneratedElementSite(
      parse(component("tag: 'open-artifact-panel'")),
      SITE,
    );
    expect(admitted.kind).toBe('admitted');
    if (admitted.kind !== 'admitted') throw new Error('unreachable');
    expect(admitted.admission.componentName).toBe('ArtifactPanel');
  });

  test('the lane refuses an invalid declared tag with the coded diagnostic', () => {
    const error = laneError(component('tag: configuredTag'));
    expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      GENERATED_ELEMENT_DIAGNOSTIC.TAG_INVALID,
    ]);
    expect(error.diagnostics[0]!.file).toBe(FILE);
  });

  test('the descriptor still takes its tag from the host site fact', () => {
    // The sidecar `tag` is the RESOLVER's input, never a second emitter source.
    // Proof: give the host a site tag that DIFFERS from the declared one. The
    // emitted descriptor must carry the host's tag — the registration identity
    // the island pipeline will use — and the sidecar spelling appears nowhere.
    const compiled = compileGeneratedElementIfAdmitted(
      component("tag: 'open-artifact-panel'"),
      FILE,
      { site: { tag: 'host-pinned-panel' } },
    );
    expect(compiled!.code).toContain('tag: "host-pinned-panel"');
    expect(compiled!.code).toContain('__oeElementTag = "host-pinned-panel"');
    expect(compiled!.code).not.toContain('open-artifact-panel');
  });

  test('a sidecar without tag keeps the pre-slice descriptor bytes exactly', () => {
    // The additive contract: reading a key an author did not write changes
    // nothing. The two modules differ only by that key, so the emitted module
    // from the descriptor onward is identical — the host fact answered the tag
    // in both.
    const withTag = compileGeneratedElementIfAdmitted(
      component("tag: 'open-artifact-panel'"),
      FILE,
      { site: SITE },
    );
    const withoutTag = compileGeneratedElementIfAdmitted(component("hydrate: 'idle'"), FILE, {
      site: SITE,
    });
    const fromDescriptor = (code: string): string =>
      code.slice(code.indexOf('tag: "open-artifact-panel"'));
    expect(fromDescriptor(withTag!.code)).toEqual(fromDescriptor(withoutTag!.code));
  });
});
