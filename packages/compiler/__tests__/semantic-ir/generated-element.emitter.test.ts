/**
 * M09-1a — generated native element emitter evidence (LOCAL, Node).
 *
 * The producer contract, without a browser:
 *
 * - a hostless module (no host site fact) is byte-identical to
 *   `generateLeafModule`'s output — the negative proof that a plain function
 *   component never acquires the shell;
 * - a site module is append-only: the leaf prefix is unchanged, and the leaf's
 *   source map/placement ledger are reused rather than rebuilt;
 * - the appended tail has the documented shape, contains exactly one
 *   `createGeneratedElementClass` call and one default export, and never names
 *   the Custom Elements registry (registration stays the entry's decision);
 * - the full emitted text parses as JavaScript;
 * - the admission gates fail closed with internal `OEIR_GENERATED_ELEMENT_*`
 *   codes, and structural opt-outs (class/re-export/anonymous default) pass
 *   through instead of refusing;
 * - a Node child process with no `HTMLElement` and a throwing
 *   `globalThis.customElements` accessor imports the emitted module
 *   successfully and never touches the registry.
 *
 * This is one Node engine and LOCAL evidence. It is not M09 exit, not M09-1b
 * registration/packaging, not a property/attribute/event/form claim, and not a
 * packed-consumer qualification. The typecheck item of design §5.2 A.7 is
 * deliberately not claimed here: the real shell's generic descriptor
 * (`Recipe<P extends object>`) and the leaf factory's `Recipe<unknown>` do not
 * meet, and faking a pass would hide the M09-1b reconciliation.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import { build } from 'vite';
import {
  compileFunctionModule,
  type FunctionModelModule,
} from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import {
  GENERATED_LEAF_RUNTIME_SPECIFIER,
  generateLeafModule,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  GENERATED_ELEMENT_SHELL_SPECIFIER,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { generateElementModule } from '../../src/internal/compiler/semantic-ir/generated-element/emit.ts';
import { compiledElementPlugin } from '../../src/internal/compiler/plugin.ts';

const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
const FILE = '/proj/src/islands/profile.tsx';
// D-root-source (2026-11-13): the host fact carries the tag only; the root is
// read by the lane from the authored sidecar (see generated-element.root-source.test.ts).
const SITE: GeneratedElementSite = { tag: 'x-profile' };
const SIDECAR =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "export const openElement = defineIslandConfig({ root: 'light' });\n";

const PROFILE = `${SIDECAR}
function Profile() {
  return <p id="profile">hello</p>;
}
export default Profile;
`;

const HOSTLESS = `function Profile() {
  return <p id="profile">hello</p>;
}
`;

function frontModule(source: string): FunctionModelModule {
  const front = compileFunctionModule(source, FILE, {
    importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  });
  expect(front.diagnostics, front.diagnostics.map((item) => item.message).join('\n')).toEqual([]);
  return front.module!;
}

function laneError(source: string, site: GeneratedElementSite | null = SITE): CompiledElementError {
  try {
    compileGeneratedElementIfAdmitted(source, FILE, { site });
  } catch (error) {
    if (error instanceof CompiledElementError) return error;
    throw error;
  }
  throw new Error('expected the generated element lane to refuse the module');
}

function codes(error: CompiledElementError): string[] {
  return error.diagnostics.map((diagnostic) => diagnostic.code);
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

describe('M09-1a generated element emitter', () => {
  test('a hostless module is byte-identical and never acquires a CE tail', () => {
    const module = frontModule(HOSTLESS);
    const leaf = generateLeafModule(module);
    const emitted = generateElementModule(module, null);
    expect(leaf.module).not.toBeNull();
    expect(emitted.module).toBe(leaf.module);
    expect(emitted.tail).toBeNull();
    expect(emitted.module).not.toContain('createGeneratedElementClass');
    // The lane is inert without a host fact, even for an island-shaped module.
    expect(compileGeneratedElementIfAdmitted(PROFILE, FILE, { site: null })).toBeNull();
  });

  test('a site module is append-only and reuses the leaf map and placements', () => {
    const module = frontModule(PROFILE);
    const leaf = generateLeafModule(module, { authoredSource: PROFILE });
    const emitted = generateElementModule(module, SITE, {
      rootComponent: 'Profile',
      authoredSource: PROFILE,
    });
    expect(leaf.module).not.toBeNull();
    expect(emitted.diagnostics).toEqual([]);
    expect(emitted.module!.startsWith(leaf.module!)).toBe(true);
    expect(emitted.leaf).toBe(leaf.module);
    expect(emitted.tail).not.toBeNull();
    expect(emitted.module!.length).toBe(leaf.module!.length + emitted.tail!.length);
    // Reused, not rebuilt: the mapped prefix keeps the same segments.
    expect(emitted.sourceMap).toEqual(leaf.sourceMap);
    expect(emitted.placements).toEqual(leaf.placements);
  });

  test('the tail has one constructor call, one default export, the alias and no registry', () => {
    // The emitter receives the lane-read root (D-root-source); SITE no longer
    // carries it.
    const emitted = generateElementModule(frontModule(PROFILE), SITE, {
      rootComponent: 'Profile',
      root: 'light',
    });
    const tail = emitted.tail!;
    expect(tail.match(/createGeneratedElementClass\(/g)?.length).toBe(1);
    expect(tail.match(/export default /g)?.length).toBe(1);
    expect(tail).toContain(
      `import { createGeneratedElementClass } from ${JSON.stringify(GENERATED_ELEMENT_SHELL_SPECIFIER)};`,
    );
    expect(tail).toContain('tag: "x-profile"');
    expect(tail).toContain('root: "light"');
    expect(tail).toContain('properties: []');
    expect(tail).toContain('createRecipe: createProfileRecipe');
    expect(tail).toContain('export { __oeProfileElement as ProfileElement };');
    expect(tail).toContain('export const __oeElementTag = "x-profile";');
    expect(emitted.module).not.toContain('customElements');
  });

  test('an absent root omits the descriptor property so the shell owns the default', () => {
    const emitted = generateElementModule(frontModule(PROFILE), SITE, {
      rootComponent: 'Profile',
    });
    const tail = emitted.tail!;
    expect(tail).toContain('tag: "x-profile"');
    expect(tail).not.toContain('root:');
    expect(tail).toContain('properties: []');
  });

  test('the emitted module with the tail parses as JavaScript', () => {
    const emitted = generateElementModule(frontModule(PROFILE), SITE, {
      rootComponent: 'Profile',
    });
    expect(parseDiagnostics(emitted.module!)).toEqual([]);
  });

  test('the lane compiles the admitted site module to a constructor default export', () => {
    const compiled = compileGeneratedElementIfAdmitted(PROFILE, FILE, { site: SITE });
    expect(compiled).not.toBeNull();
    expect(compiled!.tag).toBe('x-profile');
    expect(compiled!.component).toBe('Profile');
    expect(compiled!.code).toContain('export default __oeProfileElement;');
    expect(compiled!.code).toContain('createGeneratedElementClass');
    expect(compiled!.code).not.toContain('customElements');
  });

  test('the plugin lane is inert without the internal site option and runs with it', () => {
    type TransformHook = (
      this: unknown,
      code: string,
      id: string,
    ) => { code: string; map: unknown } | null;
    const context = {
      error(error: unknown): never {
        throw error;
      },
    };
    const inert = (compiledElementPlugin().transform as unknown as TransformHook).bind(context);
    expect(inert(PROFILE, FILE)).toBeNull();

    const activePlugin = compiledElementPlugin({
      generatedElementSite: (moduleId) => (moduleId === FILE ? SITE : null),
    });
    const active = (activePlugin.transform as unknown as TransformHook).bind(context);
    const result = active(PROFILE, FILE);
    expect(result).not.toBeNull();
    expect(result!.code).toContain('export default __oeProfileElement;');
    expect(result!.code).toContain('createGeneratedElementClass');
    expect(result!.code).not.toContain('customElements');
  });

  test('a props parameter refuses with OEIR_GENERATED_ELEMENT_UNDECLARED_PROPS', () => {
    const source = `${SIDECAR}
function Profile(props) {
  return <p>{props.label}</p>;
}
export default Profile;
`;
    expect(codes(laneError(source))).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.UNDECLARED_PROPS]);
  });

  test('a destructured props parameter refuses even though the model spells it null', () => {
    const source = `${SIDECAR}
function Profile({ label }) {
  return <p>{label}</p>;
}
export default Profile;
`;
    const error = laneError(source);
    expect(codes(error)).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.UNDECLARED_PROPS]);
    expect(error.diagnostics[0]!.message).toContain('{ label }');
  });

  test('a host binding requirement refuses with OEIR_GENERATED_ELEMENT_UNBOUND_BINDING', () => {
    const source = `${SIDECAR}
import { signal } from '@openelement/element';
const label = signal('hi');
function Profile() {
  return <p>{label.value}</p>;
}
export default Profile;
`;
    const error = laneError(source);
    expect(codes(error)).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.UNBOUND_BINDING]);
    expect(error.diagnostics[0]!.message).toContain('"label"');
  });

  test('a local default function that is not a component refuses as NOT_A_COMPONENT', () => {
    const source = `${SIDECAR}
function Profile() {
  return <p>hello</p>;
}
function helper() {
  return 1;
}
export default helper;
`;
    expect(codes(laneError(source))).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.NOT_A_COMPONENT]);
  });

  test('a missing island sidecar refuses with OEIR_GENERATED_ELEMENT_MISSING_SITE_MARKER', () => {
    const source = `function Profile() {
  return <p>hello</p>;
}
export default Profile;
`;
    expect(codes(laneError(source))).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.MISSING_SITE_MARKER]);
  });

  test('structural opt-outs pass through: class, re-export and anonymous default', () => {
    const classDefault = `${SIDECAR}
export default class Profile extends HTMLElement {}
`;
    const reExport = `${SIDECAR}
export { default } from './other-island.tsx';
`;
    const anonymous = `${SIDECAR}
export default function () {
  return <p>hello</p>;
}
`;
    for (const source of [classDefault, reExport, anonymous]) {
      expect(compileGeneratedElementIfAdmitted(source, FILE, { site: SITE })).toBeNull();
    }
  });

  test('a default-exported expression (a page call) passes through', () => {
    const source = `${SIDECAR}
export default definePage({ render: () => <p>hello</p> });
`;
    expect(compileGeneratedElementIfAdmitted(source, FILE, { site: SITE })).toBeNull();
  });

  test('the emitted module imports on a server with no HTMLElement and no registry read', async () => {
    const compiled = compileGeneratedElementIfAdmitted(PROFILE, FILE, { site: SITE });
    expect(compiled).not.toBeNull();
    const dir = mkdtempSync(join(tmpdir(), 'oe-m09-1a-server-'));
    try {
      const runtime = join(REPO_ROOT, 'packages/element/src/internal/compiled/runtime');
      const element = join(REPO_ROOT, 'packages/element/src/internal');
      const leaf = join(dir, 'generated-element.js');
      const shim = join(dir, 'runtime-shim.ts');
      const entry = join(dir, 'entry.js');
      writeFileSync(leaf, compiled!.code);
      writeFileSync(
        shim,
        [
          `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
          `export { bindSignalWrites, runUntracked } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
          `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
          `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
          `import * as claimInvariants from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
          `export const { assertElementInHtmlNamespace, assertStaticAttributeSeed, assertWhenAnchor, assertWhenEndMarker, isWhenEndMarker, leafClaimMismatch } = claimInvariants;`,
          `export const assertTextSlotMarker = claimInvariants.assertTextSlotMarker;`,
          `import * as markers from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
          `export const { emitComment, MARKERS, markerText, rangeMarker } = markers;`,
          `export const textSlotMarker = markers.textSlotMarker;`,
          `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
          `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
          `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
          '',
        ].join('\n'),
      );
      writeFileSync(
        entry,
        [
          "export { default } from './generated-element.js';",
          "export { __oeElementTag, ProfileElement } from './generated-element.js';",
          '',
        ].join('\n'),
      );
      const result = await build({
        configFile: false,
        root: dir,
        logLevel: 'silent',
        resolve: {
          alias: {
            [GENERATED_LEAF_RUNTIME_SPECIFIER]: shim,
            [GENERATED_ELEMENT_SHELL_SPECIFIER]: join(
              element,
              'compiled/generated-element/shell.ts',
            ),
          },
        },
        ssr: { noExternal: true },
        build: {
          write: false,
          minify: false,
          ssr: entry,
          rollupOptions: { output: { format: 'es', entryFileNames: 'server-import.mjs' } },
        },
      });
      const output = Array.isArray(result)
        ? result[0]!.output
        : (result as { output: unknown[] }).output;
      const chunk = (output as Array<{ type: string; code?: string }>).find(
        (item) => item.type === 'chunk',
      );
      expect(chunk?.code).toBeDefined();
      const outputFile = join(dir, 'server-import.mjs');
      writeFileSync(outputFile, chunk!.code!);
      const probe = join(dir, 'probe.mjs');
      writeFileSync(
        probe,
        [
          'delete globalThis.HTMLElement;',
          'let registryReads = 0;',
          "Object.defineProperty(globalThis, 'customElements', {",
          '  configurable: true,',
          '  get() { registryReads += 1; throw new Error("customElements must not be read"); },',
          '});',
          'const mod = await import(process.argv[2]);',
          'console.log(JSON.stringify({',
          '  defaultType: typeof mod.default,',
          '  aliasType: typeof mod.ProfileElement,',
          '  tag: mod.__oeElementTag,',
          '  registryReads,',
          '}));',
          '',
        ].join('\n'),
      );
      const child = spawnSync(process.execPath, [probe, pathToFileURL(outputFile).href], {
        encoding: 'utf8',
      });
      expect(child.stderr, child.stderr).toBe('');
      expect(child.status, child.stderr).toBe(0);
      const facts = JSON.parse(child.stdout.trim()) as {
        defaultType: string;
        aliasType: string;
        tag: string;
        registryReads: number;
      };
      expect(facts).toEqual({
        defaultType: 'function',
        aliasType: 'function',
        tag: 'x-profile',
        registryReads: 0,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
