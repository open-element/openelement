/**
 * packages/compiler/__tests__/tailwind-candidates.test.ts — the statically
 * admitted class-candidate channel (alpha15 S lane).
 *
 * The compiler is the ONE place a component's class values are provably
 * finite: the lowering admits static literals, primitive-literal attributes,
 * both branches of an admitted conditional class, and `each` item-template
 * literals. Those tokens travel to the build layer as OPAQUE STRINGS — the
 * compiler attaches no Tailwind semantics to them (no class grammar, no
 * utility knowledge, no runtime interpolation). This suite pins:
 *
 *   - what the lowering admits (every compile-time class value contributes);
 *   - what it does NOT admit (a `class={this.<field>}` binding is a runtime
 *     value — no guessing, no partial credit);
 *   - the registry's contract (per-module lookup, the owner's union set,
 *     query-suffix-insensitive keys, and the defect-C lifecycle: an emptied
 *     module drops its stale facts, a removal removes them, and two owners in
 *     one process never share facts);
 *   - the compiled-element transform as the registry's one writer.
 */

import { describe, expect, test } from 'vitest';
import { compileElementProgram } from '../src/internal/compiler/semantic-core/compile.ts';
import { compiledArtifactClassCandidates } from '../src/internal/compiler/compiled-artifact-class-candidates.ts';
import { compiledElementPlugin } from '../src/internal/compiler/plugin.ts';
import { createClassCandidateRegistry } from '../src/internal/compiler/tailwind-candidates.ts';

const MODULE_ID = '/proj/app/components/oe-card.tsx';

/** One compiled component whose render body is the given JSX expression. */
function authoredSource(renderBody: string): string {
  return [
    "import { element, OpenElement, property } from '@openelement/element';",
    "@element('oe-card', { root: 'shadow-open' })",
    'export class OeCard extends OpenElement {',
    "  @property({ reflect: false }) kind = 'a';",
    '  render() {',
    `    return (${renderBody});`,
    '  }',
    '}',
  ].join('\n');
}

const candidatesOf = (renderBody: string): readonly string[] =>
  compileElementProgram(authoredSource(renderBody), MODULE_ID).classCandidates ?? [];

/** The transform of one plugin instance writing into `registry`. */
const transformOf = (
  registry = createClassCandidateRegistry(),
): ((code: string, id: string) => unknown) => {
  const plugin = compiledElementPlugin({ candidates: registry });
  const transform = plugin.transform as (this: unknown, code: string, id: string) => unknown;
  return (code: string, id: string): unknown => transform.call({}, code, id);
};

describe('the lowering admits compile-time class values', () => {
  test('a static class literal contributes every whitespace-separated token', () => {
    expect(
      candidatesOf(
        `<article class="rounded-xl border bg-white p-6 shadow-lg"><h2 class="text-xl font-semibold">hi</h2></article>`,
      ),
    ).toEqual(['rounded-xl', 'border', 'bg-white', 'p-6', 'shadow-lg', 'text-xl', 'font-semibold']);
  });

  test('`className` is the same attribute and contributes identically', () => {
    expect(candidatesOf(`<div className="grid gap-4">x</div>`)).toEqual(['grid', 'gap-4']);
  });

  test('a class on a custom-element host contributes (the host lives in this shadow tree)', () => {
    expect(candidatesOf(`<div><oe-badge class="px-2 text-sm">x</oe-badge></div>`)).toEqual([
      'px-2',
      'text-sm',
    ]);
  });

  test('both branches of an admitted conditional class contribute', () => {
    expect(
      candidatesOf(
        `<div class={this.kind === 'a' ? 'bg-primary text-white' : 'bg-muted text-black'}>x</div>`,
      ),
    ).toEqual(['bg-primary', 'text-white', 'bg-muted', 'text-black']);
  });

  test('each item-template class literals contribute (a compile-time branch)', () => {
    const source = [
      "import { element, OpenElement, property } from '@openelement/element';",
      "@element('oe-list', { root: 'shadow-open' })",
      'export class OeList extends OpenElement {',
      '  @property({ reflect: false }) items: Array<{ id: string }> = [];',
      '  render() {',
      '    return (',
      '      <ul>',
      '        {this.items.map((item) => (',
      '          <li key={item.id} class="py-1 font-mono">{item.id}</li>',
      '        ))}',
      '      </ul>',
      '    );',
      '  }',
      '}',
    ].join('\n');
    expect(compileElementProgram(source, MODULE_ID).classCandidates).toEqual(['py-1', 'font-mono']);
  });

  test('a module with no class attribute contributes no candidates', () => {
    expect(
      compileElementProgram(authoredSource(`<main><h1>plain</h1></main>`), MODULE_ID)
        .classCandidates,
    ).toBeUndefined();
  });
});

describe('runtime class values are never guessed', () => {
  test('a class bound to a property contributes nothing', () => {
    // The binding's runtime value is unknowable at compile time; completeness
    // for such bindings rides the author's explicit declaration through
    // Tailwind's own `@source` mechanisms.
    expect(candidatesOf(`<div class={this.kind}>x</div>`)).toEqual([]);
  });

  test('candidates from other elements in the same module are still admitted', () => {
    expect(candidatesOf(`<div class={this.kind}><span class="truncate">x</span></div>`)).toEqual([
      'truncate',
    ]);
  });
});

describe('candidate facts survive into the artifact (S5-B)', () => {
  test('the emitted class carries the candidates and the recovery round-trips them', () => {
    const compiled = compileElementProgram(
      authoredSource(
        `<article class="rounded-xl p-8 bg-primary"><h2 class="text-2xl">x</h2></article>`,
      ),
      MODULE_ID,
    );
    expect(compiled.code, 'the artifact carries the candidate static').toContain(
      '__oeClassCandidates',
    );
    expect(compiledArtifactClassCandidates(compiled.code, MODULE_ID)).toEqual([
      'rounded-xl',
      'p-8',
      'bg-primary',
      'text-2xl',
    ]);
  });

  test('a light-root component emits no candidate static (nothing to recover)', () => {
    const source = [
      "import { element, OpenElement } from '@openelement/element';",
      "@element('oe-light', { root: 'light' })",
      'export class OeLight extends OpenElement {',
      '  render() {',
      '    return <div class="p-2">x</div>;',
      '  }',
      '}',
    ].join('\n');
    const compiled = compileElementProgram(source, MODULE_ID);
    expect(compiled.classCandidates).toEqual(['p-2']);
    expect(compiled.code, 'light roots carry no shadow stylesheet fact').not.toContain(
      '__oeClassCandidates',
    );
    expect(compiledArtifactClassCandidates(compiled.code, MODULE_ID)).toBeUndefined();
  });

  test('a foreign module is never guessed at', () => {
    expect(compiledArtifactClassCandidates('export const x = 1;', '/proj/a.js')).toBeUndefined();
    expect(
      compiledArtifactClassCandidates(
        'class X { static __oeClassCandidates = [someValue]; }',
        '/proj/a.js',
      ),
      'a non-literal element list is not adopted',
    ).toBeUndefined();
  });
});

describe('the candidate registry', () => {
  test('the compiled-element transform registers per module, query-insensitively', () => {
    const registry = createClassCandidateRegistry();
    const transform = transformOf(registry);
    transform(authoredSource(`<div class="p-4">x</div>`), MODULE_ID);
    expect(registry.forModule(MODULE_ID)).toEqual(['p-4']);
    // A dev-time cache-busted id answers identically (query stripped).
    expect(registry.forModule(`${MODULE_ID}?t=1700000000000`)).toEqual(['p-4']);
    expect(registry.has()).toEqual(true);
    expect(registry.all()).toEqual(['p-4']);
  });

  test('the union set is first-seen ordered and deduplicated across modules', () => {
    const registry = createClassCandidateRegistry();
    const transform = transformOf(registry);
    transform(authoredSource(`<div class="p-4 flex">x</div>`), '/proj/a.tsx');
    transform(authoredSource(`<div class="flex gap-2">x</div>`), '/proj/b.tsx');
    expect(registry.all()).toEqual(['p-4', 'flex', 'gap-2']);
  });

  test('re-transforming a module to carry no class drops its stale facts', () => {
    // The defect this pins: the first transform registered p-7; the same module
    // edited to carry no class token must stop contributing it, or the next
    // compiled stylesheet keeps shipping a rule nothing uses.
    const registry = createClassCandidateRegistry();
    const transform = transformOf(registry);
    transform(authoredSource(`<div class="p-7">x</div>`), MODULE_ID);
    expect(registry.all()).toEqual(['p-7']);

    transform(authoredSource(`<div>no classes here</div>`), MODULE_ID);
    expect(registry.forModule(MODULE_ID)).toEqual([]);
    expect(registry.all()).toEqual([]);
    expect(registry.has()).toEqual(false);
  });

  test('re-transforming a module replaces its candidates (never a union of both edits)', () => {
    const registry = createClassCandidateRegistry();
    const transform = transformOf(registry);
    transform(authoredSource(`<div class="p-7">x</div>`), MODULE_ID);
    transform(authoredSource(`<div class="p-9">x</div>`), MODULE_ID);
    expect(registry.all()).toEqual(['p-9']);
  });

  test('a removed module contributes nothing (deleted file)', () => {
    const registry = createClassCandidateRegistry();
    const transform = transformOf(registry);
    transform(authoredSource(`<div class="p-7">x</div>`), MODULE_ID);
    registry.remove(MODULE_ID);
    expect(registry.forModule(MODULE_ID)).toEqual([]);
    expect(registry.all()).toEqual([]);
  });

  test('two owners in one process never share facts', () => {
    // The second half of the defect: a second build/plugin instance inheriting
    // the first project's candidates. Each registry is its owner's own state.
    const firstProject = createClassCandidateRegistry();
    const secondProject = createClassCandidateRegistry();
    transformOf(firstProject)(authoredSource(`<div class="p-7">x</div>`), '/one/a.tsx');
    transformOf(secondProject)(authoredSource(`<div class="m-3">y</div>`), '/two/b.tsx');

    expect(firstProject.all()).toEqual(['p-7']);
    expect(secondProject.all()).toEqual(['m-3']);
    // An empty registration in one owner cannot erase the other's facts.
    firstProject.register('/one/a.tsx', [], { shadow: true });
    expect(secondProject.all()).toEqual(['m-3']);
  });

  test('a light-root candidate joins the component sheet but not the document-sheet input', () => {
    // The component sheet carries EVERY admitted candidate: a light root can
    // render inside a shadow tree (the layout convention puts every page
    // there), where nothing else reaches it. The document-sheet input stays
    // light-only — a shadow component's classes are delivered by the component
    // sheet and must not inflate the document one.
    const registry = createClassCandidateRegistry();
    registry.register('/proj/light.tsx', ['p-2'], { shadow: false });
    registry.register('/proj/shadow.tsx', ['m-3'], { shadow: true });
    expect(registry.all()).toEqual(['p-2', 'm-3']);
    expect(registry.allLight()).toEqual(['p-2']);
    // The shadow-only view stays available (and ordered) for a consumer that
    // wants exactly the shadow-root facts; the component sheet no longer reads
    // it, so this assertion is not what the sheet compiles from.
    expect(registry.allShadow()).toEqual(['m-3']);
  });
});
