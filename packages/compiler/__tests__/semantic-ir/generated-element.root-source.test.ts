/**
 * M09-2a — the sidecar root source (D-root-source, 2026-11-13), LOCAL Node.
 *
 * The owner ruling: the compiler lane RE-READS the authored sidecar instead of
 * receiving the root on the host site fact. These tests pin the reader's
 * contract and the lane's use of it:
 *
 * - `readIslandRoot` reads `'light'` and `'shadow'` from the same statement the
 *   marker check matches, and maps the author-facing `'shadow'` to the
 *   descriptor's `shadow-open` (the DSD default; closed roots have no author
 *   spelling, `D-closed`);
 * - an absent property (and an absent sidecar) reads `absent`, and the lane
 *   then omits the descriptor's `root` so the shell's own `light` default is
 *   the only default owner;
 * - a dynamic value, another literal, a duplicate key, a shorthand and a
 *   spread all refuse with the internal, source-located
 *   `OEIR_GENERATED_ELEMENT_ROOT_INVALID` — never a guessed root;
 * - the admission result carries the root next to componentName/propsParameter;
 * - a hostless module is untouched even when its sidecar root is unreadable:
 *   the lane never reads a sidecar for a module no host admitted.
 *
 * The router scanner stays the authority for the sidecar's accepted shape and
 * error text; the compiler↔router agreement is guarded separately, in the
 * router's `island-metadata-drift-guard.test.ts` (P8 consumer form).
 */

import { describe, expect, test } from 'vitest';
import type ts from 'typescript';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { typescriptParser } from '../../src/internal/compiler/semantic-core/parse-module.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import { GENERATED_ELEMENT_DIAGNOSTIC } from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import {
  admitGeneratedElementSite,
  hasIslandPolicyStatement,
  readIslandRoot,
} from '../../src/internal/compiler/semantic-ir/generated-element/site.ts';

const FILE = '/proj/src/islands/profile.tsx';
const SITE = { tag: 'x-profile' } as const;

function parse(source: string): ts.SourceFile {
  const parsed = typescriptParser.parseModule(source, FILE);
  expect(parsed.syntaxDiagnostics).toEqual([]);
  return parsed.sourceFile;
}

/** One island module with the given sidecar entry list, verbatim. */
function island(entries: string): string {
  return (
    "import { defineIslandConfig } from '@openelement/router';\n" +
    `export const openElement = defineIslandConfig({ ${entries} });\n` +
    'function Profile() {\n' +
    '  return <p id="profile">hello</p>;\n' +
    '}\n' +
    'export default Profile;\n'
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

describe('M09-2a sidecar root source (D-root-source)', () => {
  test('light is read as the light root mode', () => {
    expect(readIslandRoot(parse(island("root: 'light'")))).toEqual({
      kind: 'root',
      root: 'light',
    });
  });

  test('shadow is the DSD default and reads as shadow-open', () => {
    expect(readIslandRoot(parse(island("root: 'shadow'")))).toEqual({
      kind: 'root',
      root: 'shadow-open',
    });
  });

  test('a string-literal key is read like an identifier key', () => {
    expect(readIslandRoot(parse(island('"root": "shadow"')))).toEqual({
      kind: 'root',
      root: 'shadow-open',
    });
  });

  test('root next to the delivery policy is read', () => {
    expect(readIslandRoot(parse(island("ssr: false, hydrate: 'idle', root: 'light'")))).toEqual({
      kind: 'root',
      root: 'light',
    });
  });

  test('an absent sidecar and a sidecar without root both read absent', () => {
    const noSidecar = 'function Profile() {\n  return <p>hello</p>;\n}\nexport default Profile;\n';
    expect(readIslandRoot(parse(noSidecar))).toEqual({ kind: 'absent' });
    expect(readIslandRoot(parse(island("hydrate: 'idle'")))).toEqual({ kind: 'absent' });
  });

  test('a dynamic root value refuses and the diagnostic is source-located', () => {
    const read = readIslandRoot(parse(island('root: configuredRoot')));
    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') throw new Error('unreachable');
    expect(read.diagnostic.code).toBe(GENERATED_ELEMENT_DIAGNOSTIC.ROOT_INVALID);
    expect(read.diagnostic.message).toContain('must be a static literal');
    expect(read.diagnostic.span.file).toBe(FILE);
    // The span points at the offending value, not at the module start.
    expect(read.diagnostic.span.line).toBe(2);
    expect(read.diagnostic.span.start).toBeGreaterThan(0);
  });

  test('an unknown literal refuses instead of guessing a root family', () => {
    for (const literal of ["'shadow-closed'", "'auto'", "'Light'"]) {
      const read = readIslandRoot(parse(island(`root: ${literal}`)));
      expect(read.kind).toBe('refused');
      if (read.kind !== 'refused') throw new Error('unreachable');
      expect(read.diagnostic.code).toBe(GENERATED_ELEMENT_DIAGNOSTIC.ROOT_INVALID);
      expect(read.diagnostic.message).toContain('unsupported value');
    }
  });

  test('an ambiguous or unprovable sidecar key set refuses', () => {
    const cases = [
      ["root: 'light', root: 'shadow'", 'declares root more than once'],
      ['root', 'cannot be read statically'],
      ['...base', 'cannot be read statically'],
      ["[key]: 'light'", 'not a static property name'],
    ] as const;
    for (const [entries, message] of cases) {
      const read = readIslandRoot(parse(island(entries)));
      expect(read.kind, entries).toBe('refused');
      if (read.kind !== 'refused') throw new Error('unreachable');
      expect(read.diagnostic.code, entries).toBe(GENERATED_ELEMENT_DIAGNOSTIC.ROOT_INVALID);
      expect(read.diagnostic.message, entries).toContain(message);
    }
  });

  test('the admission carries the read root beside the other facts', () => {
    const source = parse(island("root: 'shadow'"));
    const admitted = admitGeneratedElementSite(source, SITE);
    expect(admitted.kind).toBe('admitted');
    if (admitted.kind !== 'admitted') throw new Error('unreachable');
    expect(admitted.admission.componentName).toBe('Profile');
    expect(admitted.admission.propsParameter).toBeNull();
    expect(admitted.admission.root).toBe('shadow-open');

    const absent = admitGeneratedElementSite(parse(island("hydrate: 'idle'")), SITE);
    if (absent.kind !== 'admitted') throw new Error('unreachable');
    expect(absent.admission.root).toBeUndefined();
  });

  test('the marker check keeps its behavior and still admits an unreadable root property', () => {
    // hasIslandPolicyStatement names the STATEMENT, not the root fact: the
    // refusal below is readIslandRoot's, so the marker verdict stays true.
    const badRoot = parse(island('root: configuredRoot'));
    expect(hasIslandPolicyStatement(badRoot)).toBe(true);
    expect(hasIslandPolicyStatement(parse('export default function Profile() {}'))).toBe(false);
  });

  test('the lane refuses a dynamic root with the coded diagnostic before emitting', () => {
    const error = laneError(island('root: configuredRoot'));
    expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      GENERATED_ELEMENT_DIAGNOSTIC.ROOT_INVALID,
    ]);
    expect(error.diagnostics[0]!.file).toBe(FILE);
  });

  test('the lane refuses an unknown root literal', () => {
    const error = laneError(island("root: 'shadow-closed'"));
    expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      GENERATED_ELEMENT_DIAGNOSTIC.ROOT_INVALID,
    ]);
  });

  test('the descriptor carries the root the lane read from the sidecar', () => {
    const light = compileGeneratedElementIfAdmitted(island("root: 'light'"), FILE, { site: SITE });
    expect(light!.code).toContain('root: "light"');

    const shadow = compileGeneratedElementIfAdmitted(island("root: 'shadow'"), FILE, {
      site: SITE,
    });
    expect(shadow!.code).toContain('root: "shadow-open"');
  });

  test('an absent root omits the descriptor property so the shell defaults it', () => {
    const compiled = compileGeneratedElementIfAdmitted(island("hydrate: 'idle'"), FILE, {
      site: SITE,
    });
    expect(compiled!.code).toContain('tag: "x-profile"');
    expect(compiled!.code).not.toContain('root:');
    expect(compiled!.code).toContain('properties: []');
  });

  test('a hostless module is never read, even with an unreadable sidecar root', () => {
    expect(
      compileGeneratedElementIfAdmitted(island('root: configuredRoot'), FILE, { site: null }),
    ).toBeNull();
  });
});
