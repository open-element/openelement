/**
 * T4 / 16b-LC-2 — DEPTH-1 nested-instance wiring, artifact contract (LOCAL, Node).
 *
 * The compiled module is the whole evidence surface here: no browser, no
 * runtime, no hand-written generated code. The plan v3 acceptance rows pinned
 * by this file:
 *
 * - the ROOT retaining body is the ONLY body that brackets an instance pass and
 *   emits a retain call: `beginInstancePass`/`endInstancePass` and
 *   `retainChildInstance` text appear exactly in the root mount/claim bodies and
 *   nowhere else (zero in recipe, claim-time-recipe, leaf and legacy bodies);
 * - `16b-LC-2` depth-1: a DIRECT hostless child is a leaf instance body — one
 *   module-local `<Name>__setup` factory, both its mount and its claim alias the
 *   retained record from the child host literal's `setup` property, and its body
 *   contains no ledger text at all;
 * - the site key is the authored-span literal `"<file>:<start>:<end>"`, emitted
 *   by ONE helper, byte-identical in mount and claim, unique per module;
 * - eligibility is the monotone fixpoint (B3): a target referenced from the root
 *   body AND from a leaf/recipe/legacy body is demoted and emits today's text
 *   everywhere; a target referenced only from the root body is retained;
 * - the root-target guard (B3b) is a conservative whole-module fallback: a
 *   component reference whose target is the module root (even on a dead
 *   component/recipe path) emits today's bytes with ZERO ledger text and adds no
 *   diagnostic; a reachable root reference keeps the existing mount-cycle
 *   refusal byte-identically;
 * - a module that retains nothing is byte-identical to HEAD `2545e0ac6`
 *   (SHA-256 pins, captured by running the HEAD generator on the same inputs);
 * - the host delta is the single optional `instance` field on
 *   `GeneratedElementHost` (B4), forwarded only by the root component's recipe
 *   factory, and no recipe/leaf/legacy body reads `host.instance`.
 *
 * LOCAL Node evidence for the wiring lane. Not M09 exit, not the M13 matrix, no
 * depth >= 2 retention claim (that stays OWED behind the transaction protocol).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  compileFunctionModule,
  type FunctionModelModule,
} from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import { GENERATED_ELEMENT_IMPORT_CLASSIFIER } from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { createGeneratedElementSiteResolver } from '../../../router/src/vite/generated-element-site.ts';
import { REPO_ROOT } from './testlib/element-classifier.ts';

const ISLANDS_DIR = 'app/islands';
const FILE = `${ISLANDS_DIR}/artifact.tsx`;
const SITE = createGeneratedElementSiteResolver(ISLANDS_DIR)(FILE)!;

function sidecar(properties: string): string {
  return (
    "import { defineIslandConfig } from '@openelement/router';\n" +
    'export const openElement = defineIslandConfig({\n' +
    "  root: 'light',\n" +
    `  properties: { ${properties} },\n` +
    '});\n'
  );
}

const SIDECAR = sidecar('seed: { default: 0 }');
const SIDECAR_SHOW = sidecar('seed: { default: 0 }, show: { default: false }');

/** One direct hostless child, both components own a setup snapshot. */
const RETAINED_SOURCE =
  SIDECAR +
  'function Child(props: { seed: number }) {\n' +
  '  const childSnapshot = props.seed;\n' +
  '  return <em className="child">{childSnapshot}</em>;\n' +
  '}\n' +
  'function Root(props: { seed: number }) {\n' +
  '  const rootSnapshot = props.seed;\n' +
  '  return <span className="root"><b>{rootSnapshot}</b><Child seed={props.seed} /></span>;\n' +
  '}\n' +
  'export default Root;\n';

/** Two distinct direct sites: the site key must be unique per module. */
const TWO_SITES_SOURCE =
  SIDECAR +
  'function First(props: { seed: number }) {\n' +
  '  const firstSnapshot = props.seed;\n' +
  '  return <i className="first">{firstSnapshot}</i>;\n' +
  '}\n' +
  'function Second(props: { seed: number }) {\n' +
  '  const secondSnapshot = props.seed;\n' +
  '  return <u className="second">{secondSnapshot}</u>;\n' +
  '}\n' +
  'function Root(props: { seed: number }) {\n' +
  '  return <span><First seed={props.seed} /><Second seed={props.seed} /></span>;\n' +
  '}\n' +
  'export default Root;\n';

/**
 * B3a demotion: `Twin` is referenced from the root body AND from the leaf
 * `Holder` body, so it is demoted and emits today's text everywhere; `Holder`
 * itself is referenced only from the root body and stays a retained leaf.
 */
const DEMOTED_SOURCE =
  SIDECAR +
  'function Twin(props: { seed: number }) {\n' +
  '  const twinSnapshot = props.seed;\n' +
  '  return <b className="twin">{twinSnapshot}</b>;\n' +
  '}\n' +
  'function Holder(props: { seed: number }) {\n' +
  '  const holderSnapshot = props.seed;\n' +
  '  return <em className="holder"><Twin seed={props.seed} /></em>;\n' +
  '}\n' +
  'function Root(props: { seed: number }) {\n' +
  '  return (\n' +
  '    <span>\n' +
  '      <Holder seed={props.seed} />\n' +
  '      <Twin seed={props.seed} />\n' +
  '    </span>\n' +
  '  );\n' +
  '}\n' +
  'export default Root;\n';

/**
 * A children-recipe body is a recipe body: `Leaf` is referenced from there, so
 * it is demoted despite the reference sitting in the root component's module.
 */
const CHILDREN_RECIPE_SOURCE =
  SIDECAR +
  'function Frame(props: { seed: number; children?: unknown }) {\n' +
  '  const frameSnapshot = props.seed;\n' +
  '  return <div className="frame">{frameSnapshot}{props.children as any}</div>;\n' +
  '}\n' +
  'function Leaf(props: { seed: number }) {\n' +
  '  const leafSnapshot = props.seed;\n' +
  '  return <i className="leaf">{leafSnapshot}</i>;\n' +
  '}\n' +
  'function Root(props: { seed: number }) {\n' +
  '  return <span><Frame seed={props.seed}><Leaf seed={props.seed} /></Frame></span>;\n' +
  '}\n' +
  'export default Root;\n';

/** The `when` branch boundary exercises the R1/R2 release text sites. */
const CONDITION_SOURCE =
  SIDECAR_SHOW +
  'function Leaf(props: { seed: number }) {\n' +
  '  const leafSnapshot = props.seed;\n' +
  '  return <i className="leaf">{leafSnapshot}</i>;\n' +
  '}\n' +
  'function Root(props: { seed: number; show: boolean }) {\n' +
  '  const rootSnapshot = props.seed;\n' +
  '  return (\n' +
  '    <span className="root">\n' +
  '      <b>{rootSnapshot}</b>\n' +
  '      {props.show ? <Leaf seed={props.seed} /> : null}\n' +
  '    </span>\n' +
  '  );\n' +
  '}\n' +
  'export default Root;\n';

/**
 * Claimable root with BOTH a direct retained reference and a `when` branch: the
 * claim body carries the claim mirror retain and the R4/R5 release text. The
 * retained child sits outside the branch (a reference inside a branch is
 * mount-only in this slice), so this row is the artifact contract for the claim
 * release sites, not a nested-branch retention claim.
 */
const MIXED_CLAIM_SOURCE =
  SIDECAR_SHOW +
  'function Leaf(props: { seed: number }) {\n' +
  '  const leafSnapshot = props.seed;\n' +
  '  return <i className="leaf">{leafSnapshot}</i>;\n' +
  '}\n' +
  'function Root(props: { seed: number; show: boolean }) {\n' +
  '  const rootSnapshot = props.seed;\n' +
  '  return <><Leaf seed={props.seed} /><span>{props.show ? <b>on</b> : <u>off</u>}</span></>;\n' +
  '}\n' +
  'export default Root;\n';

/** No component reference at all: nothing may change (byte-identical pin). */
const NO_REF_SOURCE =
  SIDECAR +
  'function Only(props: { seed: number }) {\n' +
  '  const snapshot = props.seed;\n' +
  '  return <span className="only">{snapshot}</span>;\n' +
  '}\n' +
  'export default Only;\n';

/**
 * B3b root-target guard: a DEAD component references the module root. The mount
 * cycle guard does not see it (the root never reaches the dead component), so
 * the conservative superset rule emits the whole module legacy.
 */
const ROOT_TARGET_SOURCE =
  SIDECAR +
  'function Orphan(props: { seed: number }) {\n' +
  '  const orphanSnapshot = props.seed;\n' +
  '  return <b className="orphan">{orphanSnapshot}</b>;\n' +
  '}\n' +
  'function Link(props: { seed: number }) {\n' +
  '  return <i><Only seed={props.seed} /></i>;\n' +
  '}\n' +
  'function Only(props: { seed: number }) {\n' +
  '  const snapshot = props.seed;\n' +
  '  return <span className="only">{snapshot}</span>;\n' +
  '}\n' +
  'export default Only;\n';

/** Reachable root reference: the existing mount-cycle refusal stays in force. */
const ROOT_CYCLE_SOURCE =
  SIDECAR +
  'function Child(props: { seed: number }) {\n' +
  '  return <i><Root seed={props.seed} /></i>;\n' +
  '}\n' +
  'function Root(props: { seed: number }) {\n' +
  '  return <span><Child seed={props.seed} /></span>;\n' +
  '}\n' +
  'export default Root;\n';

function compile(source: string): string {
  const compiled = compileGeneratedElementIfAdmitted(source, FILE, { site: SITE });
  expect(compiled, 'the fixture must be admitted').not.toBeNull();
  return compiled!.code;
}

function frontModule(source: string): FunctionModelModule {
  const front = compileFunctionModule(source, FILE, {
    importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  });
  expect(front.diagnostics, front.diagnostics.map((item) => item.message).join('\n')).toEqual([]);
  return front.module!;
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const FUNCTION_HEADER = /^\s*(?:export\s+)?function\s+([\w$]+)\s*\(/;

/** Remove quoted literals so braces inside strings cannot move a range end. */
function stripQuoted(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** Locate one emitted function by brace slicing (test-side, no generator help). */
function functionText(module: string, name: string, occurrence = 0): string {
  const lines = module.split('\n');
  let seen = 0;
  for (let index = 0; index < lines.length; index++) {
    const match = FUNCTION_HEADER.exec(lines[index]!);
    if (match === null || match[1] !== name) continue;
    if (seen !== occurrence) {
      seen += 1;
      continue;
    }
    let depth = 0;
    let opened = false;
    for (let cursor = index; cursor < lines.length; cursor++) {
      for (const character of stripQuoted(lines[cursor]!)) {
        if (character === '{') {
          depth += 1;
          opened = true;
        } else if (character === '}') {
          depth -= 1;
          if (opened && depth === 0) return lines.slice(index, cursor + 1).join('\n');
        }
      }
    }
    throw new Error(`unterminated function '${name}'`);
  }
  throw new Error(`function '${name}' not found in the emitted module`);
}

const LEDGER_CALLEES = [
  'retainChildInstance(',
  'releaseChildInstance(',
  'releaseUnderStructuralScope(',
  'beginInstancePass(',
  'endInstancePass(',
  'abortInstancePass(',
] as const;

function ledgerText(text: string): readonly string[] {
  return LEDGER_CALLEES.filter((callee) => text.includes(callee));
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Every module-scope function declaration name (mount/claim/setup/factory/SSR). */
function declaredFunctions(module: string): readonly string[] {
  return [...module.matchAll(/^(?:export )?function ([\w$]+)\(/gm)].map((match) => match[1]!);
}

describe('T4 depth-1 nested-instance wiring — artifact contract', () => {
  test('R1 the root body is the only ledger text site; the leaf body has none', () => {
    const module = compile(RETAINED_SOURCE);
    const rootMount = functionText(module, 'Root__mount');
    const rootClaim = functionText(module, 'Root__claim');
    const childSetup = functionText(module, 'Child__setup');
    const childMount = functionText(module, 'Child__mount');
    const childClaim = functionText(module, 'Child__claim');

    // The pass bracket and the retain call live in the ROOT retaining body
    // (mount + shared-cursor claim), once each.
    for (const body of [rootMount, rootClaim]) {
      expect(occurrences(body, 'beginInstancePass(__oe_host.instance);')).toBe(1);
      expect(occurrences(body, 'endInstancePass(__oe_host.instance);')).toBe(1);
      expect(occurrences(body, 'retainChildInstance(')).toBe(1);
    }
    expect(occurrences(module, 'beginInstancePass(')).toBe(2);
    expect(occurrences(module, 'endInstancePass(')).toBe(2);
    expect(occurrences(module, 'retainChildInstance(')).toBe(2);

    // Leaf body: one setup factory, retained-record aliases in both bodies, and
    // ZERO ledger text (no retain, no key, no pass bracket).
    expect(declaredFunctions(module)).toContain('Child__setup');
    expect(childSetup).toContain('return { childSnapshot };');
    for (const body of [childMount, childClaim]) {
      expect(body).toContain('const __oe_setup = __oe_host.setup ?? {};');
      expect(body).toContain('const childSnapshot = __oe_requireRootSetup("childSnapshot");');
      expect(body).not.toContain('const childSnapshot = (');
      expect(ledgerText(body)).toEqual([]);
      expect(body).not.toContain(`${ISLANDS_DIR}/artifact.tsx:`);
    }
    // No body other than the root mount/claim carries ledger text.
    const nonRootLedger = declaredFunctions(module)
      .filter((name) => name !== 'Root__mount' && name !== 'Root__claim')
      .map((name) => ({ name, ledger: ledgerText(functionText(module, name)) }))
      .filter((entry) => entry.ledger.length > 0);
    expect(nonRootLedger).toEqual([]);
  });

  test('R2 the site key is span-based, mount/claim-identical and module-unique', () => {
    const module = compile(RETAINED_SOURCE);
    const keys = [...module.matchAll(/retainChildInstance\(__oe_host\.instance, ("[^"]+")/g)].map(
      (match) => match[1]!,
    );
    expect(keys.length).toBe(2);
    // Same authored span in the mount and the claim: byte-identical literal.
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(new RegExp(`^"${ISLANDS_DIR}/artifact\\.tsx:\\d+:\\d+"$`));

    // Two distinct sites never share a key, and both bodies carry one retain per
    // site: 2 sites × (mount + claim) = 4 retains, 2 distinct keys.
    const two = compile(TWO_SITES_SOURCE);
    const twoKeys = [...two.matchAll(/retainChildInstance\(__oe_host\.instance, ("[^"]+")/g)].map(
      (match) => match[1]!,
    );
    expect(twoKeys.length).toBe(4);
    const counts = new Map<string, number>();
    for (const key of twoKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
    expect([...counts.values()]).toEqual([2, 2]);
    expect(counts.size).toBe(2);
    // The key literal is emitted by ONE helper: the mount-only leaf path (no
    // claim) still uses exactly the same form.
    expect(functionText(two, 'Root__mount')).toContain('retainChildInstance(');
    expect(functionText(two, 'Root__claim')).toContain('retainChildInstance(');
  });

  test('R3 B3a: a target referenced from a leaf/recipe body is demoted everywhere', () => {
    // Root body + leaf body reference `Twin` -> legacy everywhere; `Holder` is
    // only referenced from the root body -> retained leaf.
    const demoted = compile(DEMOTED_SOURCE);
    const demotedKeys = [
      ...demoted.matchAll(/retainChildInstance\(__oe_host\.instance, ("[^"]+")/g),
    ].map((match) => match[1]!);
    // Only the Holder site (mount + claim) retains.
    expect(demotedKeys.length).toBe(2);
    expect(new Set(demotedKeys).size).toBe(1);
    expect(declaredFunctions(demoted)).toContain('Holder__setup');
    expect(declaredFunctions(demoted)).not.toContain('Twin__setup');
    // The root's Twin reference and the Holder body's Twin reference are the
    // today's legacy text: a fresh child scope, no retain/key/bracket.
    const rootMount = functionText(demoted, 'Root__mount');
    expect(occurrences(rootMount, 'retainChildInstance(')).toBe(1);
    expect(rootMount).toContain('Twin__mount(__oe_childScope');
    const holderMount = functionText(demoted, 'Holder__mount');
    expect(holderMount).toContain('Twin__mount(__oe_childScope');
    expect(ledgerText(holderMount)).toEqual([]);

    // A children-recipe body counts as a recipe body: `Leaf` is demoted, while
    // `Frame` (referenced from the root body) is the retained leaf.
    const recipe = compile(CHILDREN_RECIPE_SOURCE);
    const recipeKeys = [
      ...recipe.matchAll(/retainChildInstance\(__oe_host\.instance, ("[^"]+")/g),
    ].map((match) => match[1]!);
    expect(recipeKeys.length).toBe(2);
    expect(declaredFunctions(recipe)).toContain('Frame__setup');
    expect(declaredFunctions(recipe)).not.toContain('Leaf__setup');
    expect(recipe).toContain('Leaf__mount(__oe_childScope');
    // The only ledger text is the Frame site in the root body (mount + claim).
    const recipeRootMount = functionText(recipe, 'Root__mount');
    expect(occurrences(recipeRootMount, 'retainChildInstance(')).toBe(1);
    expect(ledgerText(functionText(recipe, 'Frame__mount'))).toEqual([]);
    expect(ledgerText(functionText(recipe, 'Frame__claim'))).toEqual([]);
    expect(ledgerText(functionText(recipe, 'Leaf__mount'))).toEqual([]);
  });

  test('R4 R1/R2 release text is emitted only inside the root retaining body', () => {
    const module = compile(CONDITION_SOURCE);
    const rootMount = functionText(module, 'Root__mount');
    // Branch removal (R1) is cleanup-first with an accumulated failure; the new
    // branch construction catch (R2) rethrows the ORIGINAL error.
    expect(rootMount).toContain('releaseUnderStructuralScope(');
    expect(rootMount).toContain('catch { /* construction error wins */ }');
    expect(rootMount).toContain('throw __oe_releaseFailure');
    // The leaf body never emits release text.
    expect(ledgerText(functionText(module, 'Leaf__mount'))).toEqual([]);

    // The CLAIM mirror of R4/R5 is emitted only when the root body is claimable
    // and the root retaining body owns the branch: a direct retained reference
    // plus a `when` branch. Mount and claim both retain the same site; the claim
    // body carries the old-branch release (R4) and the new-branch rollback (R5).
    const mixed = compile(MIXED_CLAIM_SOURCE);
    const mixedMount = functionText(mixed, 'Root__mount');
    const mixedClaim = functionText(mixed, 'Root__claim');
    expect(occurrences(mixedMount, 'retainChildInstance(')).toBe(1);
    expect(occurrences(mixedClaim, 'retainChildInstance(')).toBe(1);
    expect(occurrences(mixedClaim, 'releaseUnderStructuralScope(')).toBe(2);
    expect(mixedClaim).toContain('throw __oe_releaseFailure');
    expect(mixedClaim).toContain('catch { /* construction error wins */ }');
    const mixedKeys = [
      ...mixed.matchAll(/retainChildInstance\(__oe_host\.instance, ("[^"]+")/g),
    ].map((match) => match[1]!);
    expect(mixedKeys.length).toBe(2);
    expect(new Set(mixedKeys).size).toBe(1);
    // No ledger text outside the root mount/claim pair, including the claim-time
    // recipe bodies emitted inside the claim chunk.
    for (const name of declaredFunctions(mixed)) {
      if (name === 'Root__mount' || name === 'Root__claim') continue;
      expect(ledgerText(functionText(mixed, name))).toEqual([]);
    }
    // No release text outside the root mount body at all (the claim does not
    // exist for this shape: a reference inside a `when` branch is mount-only).
    for (const name of declaredFunctions(module)) {
      if (name === 'Root__mount' || name === 'Leaf__mount' || name === 'Leaf__claim') continue;
      const body = functionText(module, name);
      expect(body).not.toContain('releaseUnderStructuralScope(');
    }
  });

  test('R5 B3b: a root-target reference emits the whole module legacy (byte pin)', () => {
    const module = compile(ROOT_TARGET_SOURCE);
    expect(ledgerText(module)).toEqual([]);
    expect(module).not.toContain('__oe_host.instance');
    expect(module).not.toContain('__oe_setup = __oe_host.setup');
    // Captured from HEAD `2545e0ac6` by running that tree's generator on the
    // same source/id/site (byte equality verified against the primed baseline
    // tree; the pin makes the fallback a regression contract).
    expect(sha256(module)).toBe('d0523ed596cba8a8ae478964210e6492577e486841eaa83ef3e64e5dc0faacea');
    // A reachable root reference keeps the existing mount-cycle refusal, and the
    // marker adds no diagnostic: with and without the root marker the refusal is
    // the same code with the same span.
    const cycleModule = frontModule(ROOT_CYCLE_SOURCE);
    const withoutMarker = generateLeafModule(cycleModule);
    const withMarker = generateLeafModule(cycleModule, { rootInstance: 'Root' });
    expect(withoutMarker.module).toBeNull();
    expect(withMarker.module).toBeNull();
    expect(withMarker.diagnostics).toEqual(withoutMarker.diagnostics);
    expect(withMarker.diagnostics.map((item) => item.code)).toEqual(['OEIR_LEAF_COMPONENT_CYCLE']);
  });

  test('R6 a module that retains nothing is byte-identical to HEAD 2545e0ac6', () => {
    const module = compile(NO_REF_SOURCE);
    expect(ledgerText(module)).toEqual([]);
    expect(module).not.toContain('__oe_host.instance');
    expect(module).not.toContain('__oe_host.setup');
    // No retention marker in any factory literal (the factory keeps today's
    // exact `mountHost` bytes).
    expect(module).not.toContain('instance: __oe_host.instance');
    expect(sha256(module)).toBe('1d99012b74f46779ef73cbdb190372b2bf9ac288975c02a15857d1d9119995b2');
    // Hostless leaf (direct leaf tests) stays byte-identical to the pre-change
    // hostless emission too: no marker, no factory, no alias.
    const hostless = generateLeafModule(frontModule(NO_REF_SOURCE));
    expect(hostless.rootInstanceFactory).toBeNull();
    expect(hostless.module).not.toContain('instance');
  });

  test('R7 host delta B4: one optional `instance` field, forwarded by the root factory only', () => {
    const retained = compile(RETAINED_SOURCE);
    // The root recipe factory forwards the logical instance; a non-root factory
    // keeps today's literal exactly.
    expect(functionText(retained, 'createRootRecipe')).toContain('instance: __oe_host.instance');
    expect(functionText(retained, 'createChildRecipe')).not.toContain(
      'instance: __oe_host.instance',
    );
    // No leaf/recipe/legacy body READS host.instance: the only reads are the
    // root mount/claim (bracket + retain argument) and the root factory forward.
    const instanceReads = (body: string): number => occurrences(body, '__oe_host.instance');
    expect(instanceReads(functionText(retained, 'Root__mount'))).toBe(4);
    expect(instanceReads(functionText(retained, 'Root__claim'))).toBe(4);
    expect(instanceReads(functionText(retained, 'createRootRecipe'))).toBe(1);
    for (const name of ['Child__setup', 'Child__mount', 'Child__claim', 'createChildRecipe']) {
      expect(instanceReads(functionText(retained, name))).toBe(0);
    }
    // `host.setup` is read only by the leaf instance bodies (retained record
    // alias), never by the root body or a factory.
    expect(occurrences(functionText(retained, 'Root__mount'), '__oe_host.setup')).toBe(0);
    expect(occurrences(functionText(retained, 'Root__claim'), '__oe_host.setup')).toBe(0);
    expect(occurrences(functionText(retained, 'Child__mount'), '__oe_host.setup')).toBe(1);
    expect(occurrences(functionText(retained, 'Child__claim'), '__oe_host.setup')).toBe(1);

    // The shell host type carries exactly one additive optional field.
    const shell = readFileSync(
      join(REPO_ROOT, 'packages/element/src/internal/compiled/generated-element/shell.ts'),
      'utf8',
    );
    const declaration = shell.slice(
      shell.indexOf('export interface GeneratedElementHost'),
      shell.indexOf('interface GeneratedElementInstanceHost'),
    );
    expect(declaration).toContain('readonly instance?: LifetimeScope;');
    expect(declaration).not.toContain('readonly setup');
    expect([...declaration.matchAll(/readonly \w+\??:/g)].map((match) => match[0])).toEqual([
      'readonly bindings:',
      'readonly instance?:',
      'readonly props:',
      'readonly propsChanged:',
    ]);
  });
});
