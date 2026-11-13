/**
 * M09-2a — the island sidecar `delegatesFocus` source (D-delegatesFocus,
 * 2026-11-14), LOCAL Node.
 *
 * The owner decision: expose the existing `@element(tag, { delegatesFocus })`
 * vocabulary on the island sidecar, read by the compiler lane from the same
 * authored statement as `root` (D-root-source), and reject `true` without a
 * shadow root. These tests pin the reader's contract and the lane's use of it:
 *
 * - `readIslandMetadata` reads `delegatesFocus: true` / `false` / absent and
 *   keeps `root` in the same fact record;
 * - a dynamic value, another literal, a duplicate key, a shorthand and a
 *   spread refuse with the internal, source-located
 *   `OEIR_GENERATED_ELEMENT_DELEGATES_FOCUS_INVALID` — never a guessed fact;
 * - `delegatesFocus: true` with `root: 'light'` (or no root, which the shell
 *   defaults to light) refuses with
 *   `OEIR_GENERATED_ELEMENT_DELEGATES_FOCUS_WITHOUT_SHADOW`;
 * - `false` is the documented default and carries no shadow requirement;
 * - the admission carries the fact next to root/componentName/propsParameter;
 * - the descriptor emits `delegatesFocus: true` only for a true fact, and the
 *   emitted `<Name>__ssrHost` threads the typed DSD option so the
 *   parser-adopted root reports the same fact as the descriptor;
 * - the emitter refuses the pair directly (defense in depth) and keeps a
 *   delegatesFocus-free tail byte-identical to M09-1a's.
 *
 * The router scanner stays the authority for the sidecar's accepted shape and
 * error text; the router↔compiler agreement is guarded separately, in the
 * router's `island-metadata-drift-guard.test.ts` (P8 consumer form).
 */

import { describe, expect, test } from 'vitest';
import type ts from 'typescript';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import {
  compileFunctionModule,
  type FunctionModelModule,
} from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { typescriptParser } from '../../src/internal/compiler/semantic-core/parse-module.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { generateElementModule } from '../../src/internal/compiler/semantic-ir/generated-element/emit.ts';
import {
  admitGeneratedElementSite,
  readIslandMetadata,
  readIslandRoot,
} from '../../src/internal/compiler/semantic-ir/generated-element/site.ts';

const FILE = '/proj/src/islands/profile.tsx';
const SITE: GeneratedElementSite = { tag: 'x-profile' };

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

function frontModule(source: string): FunctionModelModule {
  const front = compileFunctionModule(source, FILE, {
    importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  });
  expect(front.diagnostics, front.diagnostics.map((item) => item.message).join('\n')).toEqual([]);
  return front.module!;
}

describe('M09-2a sidecar delegatesFocus source (D-delegatesFocus)', () => {
  test('a shadow sidecar reads delegatesFocus true', () => {
    expect(readIslandMetadata(parse(island("root: 'shadow', delegatesFocus: true")))).toEqual({
      kind: 'read',
      facts: {
        root: 'shadow-open',
        delegatesFocus: true,
        formAssociated: false,
        properties: undefined,
      },
    });
  });

  test('false is read as the default fact and needs no shadow root', () => {
    expect(readIslandMetadata(parse(island('delegatesFocus: false')))).toEqual({
      kind: 'read',
      facts: {
        root: undefined,
        delegatesFocus: false,
        formAssociated: false,
        properties: undefined,
      },
    });
    expect(readIslandMetadata(parse(island("root: 'light', delegatesFocus: false")))).toEqual({
      kind: 'read',
      facts: { root: 'light', delegatesFocus: false, formAssociated: false, properties: undefined },
    });
  });

  test('an absent delegatesFocus reads false beside the root fact', () => {
    expect(readIslandMetadata(parse(island("root: 'shadow'")))).toEqual({
      kind: 'read',
      facts: {
        root: 'shadow-open',
        delegatesFocus: false,
        formAssociated: false,
        properties: undefined,
      },
    });
    expect(readIslandMetadata(parse(island("hydrate: 'idle'")))).toEqual({
      kind: 'read',
      facts: {
        root: undefined,
        delegatesFocus: false,
        formAssociated: false,
        properties: undefined,
      },
    });
  });

  test('a string-literal key is read like an identifier key', () => {
    expect(readIslandMetadata(parse(island('root: \'shadow\', "delegatesFocus": true')))).toEqual({
      kind: 'read',
      facts: {
        root: 'shadow-open',
        delegatesFocus: true,
        formAssociated: false,
        properties: undefined,
      },
    });
  });

  test('an absent sidecar reads absent rather than a defaulted fact', () => {
    const noSidecar = 'function Profile() {\n  return <p>hello</p>;\n}\nexport default Profile;\n';
    expect(readIslandMetadata(parse(noSidecar))).toEqual({ kind: 'absent' });
  });

  test('a dynamic value refuses and the diagnostic is source-located', () => {
    const read = readIslandMetadata(
      parse(island("root: 'shadow', delegatesFocus: configuredFocus")),
    );
    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') throw new Error('unreachable');
    expect(read.diagnostic.code).toBe(GENERATED_ELEMENT_DIAGNOSTIC.DELEGATES_FOCUS_INVALID);
    expect(read.diagnostic.message).toContain('must be a static literal');
    expect(read.diagnostic.span.file).toBe(FILE);
    // The span points at the offending value, not at the module start.
    expect(read.diagnostic.span.line).toBe(2);
    expect(read.diagnostic.span.start).toBeGreaterThan(0);
  });

  test('another literal refuses instead of coercing it', () => {
    for (const literal of ['1', "'true'", 'null', '[true]']) {
      const read = readIslandMetadata(parse(island(`root: 'shadow', delegatesFocus: ${literal}`)));
      expect(read.kind, literal).toBe('refused');
      if (read.kind !== 'refused') throw new Error('unreachable');
      expect(read.diagnostic.code, literal).toBe(
        GENERATED_ELEMENT_DIAGNOSTIC.DELEGATES_FOCUS_INVALID,
      );
      expect(read.diagnostic.message, literal).toContain('must be a static literal');
    }
  });

  test('an ambiguous or unprovable key set refuses', () => {
    const cases = [
      ["root: 'shadow', delegatesFocus: true, delegatesFocus: false", 'more than once'],
      ['root', 'cannot be read statically'],
      ['...base', 'cannot be read statically'],
      ["[key]: 'light'", 'not a static property name'],
    ] as const;
    for (const [entries, message] of cases) {
      const read = readIslandMetadata(parse(island(entries)));
      expect(read.kind, entries).toBe('refused');
      if (read.kind !== 'refused') throw new Error('unreachable');
      expect(read.diagnostic.message, entries).toContain(message);
    }
  });

  test('true without a shadow root refuses with the dedicated code', () => {
    for (const entries of ['delegatesFocus: true', "root: 'light', delegatesFocus: true"]) {
      const read = readIslandMetadata(parse(island(entries)));
      expect(read.kind, entries).toBe('refused');
      if (read.kind !== 'refused') throw new Error('unreachable');
      expect(read.diagnostic.code, entries).toBe(
        GENERATED_ELEMENT_DIAGNOSTIC.DELEGATES_FOCUS_WITHOUT_SHADOW,
      );
      expect(read.diagnostic.message, entries).toContain('requires root: "shadow"');
      expect(read.diagnostic.span.file, entries).toBe(FILE);
      expect(read.diagnostic.span.line, entries).toBe(2);
    }
  });

  test('the one-fact root view projects the same read without a second parser', () => {
    expect(readIslandRoot(parse(island("root: 'shadow', delegatesFocus: true")))).toEqual({
      kind: 'root',
      root: 'shadow-open',
    });
    expect(readIslandRoot(parse(island('delegatesFocus: false')))).toEqual({ kind: 'absent' });
    const refused = readIslandRoot(parse(island('delegatesFocus: true')));
    expect(refused.kind).toBe('refused');
    if (refused.kind !== 'refused') throw new Error('unreachable');
    expect(refused.diagnostic.code).toBe(
      GENERATED_ELEMENT_DIAGNOSTIC.DELEGATES_FOCUS_WITHOUT_SHADOW,
    );
  });

  test('the admission carries the fact beside the other facts', () => {
    const admitted = admitGeneratedElementSite(
      parse(island("root: 'shadow', delegatesFocus: true")),
      SITE,
    );
    expect(admitted.kind).toBe('admitted');
    if (admitted.kind !== 'admitted') throw new Error('unreachable');
    expect(admitted.admission.delegatesFocus).toBe(true);
    expect(admitted.admission.root).toBe('shadow-open');
    expect(admitted.admission.propsParameter).toBeNull();

    const defaulted = admitGeneratedElementSite(parse(island("root: 'shadow'")), SITE);
    if (defaulted.kind !== 'admitted') throw new Error('unreachable');
    expect(defaulted.admission.delegatesFocus).toBe(false);
  });

  test('the lane refuses true without a shadow root before emitting', () => {
    for (const entries of ['delegatesFocus: true', "root: 'light', delegatesFocus: true"]) {
      const error = laneError(island(entries));
      expect(
        error.diagnostics.map((diagnostic) => diagnostic.code),
        entries,
      ).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.DELEGATES_FOCUS_WITHOUT_SHADOW]);
      expect(error.diagnostics[0]!.file, entries).toBe(FILE);
    }
  });

  test('the descriptor carries delegatesFocus only when the sidecar declares it', () => {
    const declared = compileGeneratedElementIfAdmitted(
      island("root: 'shadow', delegatesFocus: true"),
      FILE,
      { site: SITE },
    );
    expect(declared!.code).toContain('root: "shadow-open"');
    expect(declared!.code).toContain('delegatesFocus: true');
    expect(declared!.code).toContain('properties: []');

    const absent = compileGeneratedElementIfAdmitted(island("root: 'shadow'"), FILE, {
      site: SITE,
    });
    expect(absent!.code).not.toContain('delegatesFocus');

    const explicitFalse = compileGeneratedElementIfAdmitted(
      island("root: 'shadow', delegatesFocus: false"),
      FILE,
      { site: SITE },
    );
    expect(explicitFalse!.code).not.toContain('delegatesFocus');
  });

  test('the emitted host wrapper threads the typed DSD option', () => {
    const compiled = compileGeneratedElementIfAdmitted(
      island("root: 'shadow', delegatesFocus: true"),
      FILE,
      { site: SITE },
    );
    const tail = compiled!.code.slice(compiled!.code.indexOf('// ---- generated native element'));
    expect(tail).toContain('export function Profile__ssrHost(props, lightChildren) {');
    expect(tail).toContain('dsd: { delegatesFocus: true },');
    // The content stays the leaf's content-only <Name>__ssr bytes.
    expect(tail).toContain('content: Profile__ssr(props, undefined),');
  });

  test('the emitter refuses the pair directly (defense in depth)', () => {
    const module = frontModule(island("root: 'light', delegatesFocus: true"));
    for (const root of [undefined, 'light'] as const) {
      const emitted = generateElementModule(module, SITE, {
        rootComponent: 'Profile',
        ...(root === undefined ? {} : { root }),
        delegatesFocus: true,
      });
      expect(emitted.module).toBeNull();
      expect(emitted.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        GENERATED_ELEMENT_DIAGNOSTIC.DELEGATES_FOCUS_WITHOUT_SHADOW,
      ]);
    }
  });

  test('a delegatesFocus-free tail keeps the M09-1a bytes', () => {
    const emitted = generateElementModule(frontModule(island("root: 'shadow'")), SITE, {
      rootComponent: 'Profile',
      root: 'shadow-open',
    });
    expect(emitted.module).not.toBeNull();
    expect(emitted.tail).not.toContain('delegatesFocus');
    expect(emitted.tail).toContain('root: "shadow-open"');
  });
});
