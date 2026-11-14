import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import {
  buildManifest,
  hydrateFromClass,
  layerFromClass,
  parseCssParts,
  parseEvents,
  parseSlots,
} from './generate-ui-manifest.ts';

test('UI event manifest parses nested detail objects with TypeScript AST', () => {
  const [event] = parseEvents(`
    this.dispatchEvent(new CustomEvent('change', {
      detail: { value: 1, nested: { enabled: true } },
      bubbles: true,
    }));
  `);
  expect(event.name).toEqual('change');
  expect(event.type ?? '').toContain('nested: { enabled: boolean }');
});

test('parseSlots picks up JSX <slot name=...> literals without doc comments', () => {
  const slots = parseSlots(`
    export class OpenCard extends OpenElement {
      render() {
        return (
          <article part='container'>
            <slot name='header'></slot>
            <div part='body'><slot></slot></div>
            <slot name='footer'></slot>
          </article>
        );
      }
    }
  `);
  expect(slots.map((s) => s.name)).toEqual(['', 'header', 'footer']);
  expect(slots[0].description).toEqual('Default slot');
});

test('parseSlots keeps @slot doc descriptions and does not duplicate JSX matches', () => {
  const slots = parseSlots(`
    /**
     * @slot tab - Tab label element (one per panel)
     * @slot panel - Panel shown while its tab is active
     */
    render() {
      return (
        <div>
          <slot name='tab'></slot>
          <slot name='panel'></slot>
        </div>
      );
    }
  `);
  expect(slots.map((s) => s.name)).toEqual(['tab', 'panel']);
  expect(slots[0].description).toEqual('Tab label element (one per panel)');
  expect(slots.some((s) => s.name === '')).toEqual(false);
});

test('parseCssParts picks up JSX part=... literals without doc comments', () => {
  const parts = parseCssParts(`
    render() {
      return (
        <div part='container'>
          <span part='icon'></span>
          <div part='content'><slot></slot></div>
        </div>
      );
    }
  `);
  expect(parts.map((p) => p.name)).toEqual(['container', 'icon', 'content']);
});

test('parseCssParts prefers @csspart doc descriptions over JSX literals', () => {
  const parts = parseCssParts(`
    /**
     * @csspart container - The article wrapper
     */
    render() {
      return <article part='container'><div part='body'></div></article>;
    }
  `);
  expect(parts.map((p) => [p.name, p.description])).toEqual([
    ['container', 'The article wrapper'],
    ['body', "The 'body' part"],
  ]);
});

test('layer/hydrate policies fail loud on unknown component classes', () => {
  assertThrowsIncludes(
    () => layerFromClass('OpenUnknown'),
    Error,
    'No layer/hydrate/status policy',
  );
  assertThrowsIncludes(
    () => hydrateFromClass('OpenUnknown'),
    Error,
    'No layer/hydrate/status policy',
  );
  expect(layerFromClass('OpenButton')).toEqual('dsd-interactive');
  expect(layerFromClass('OpenDialog')).toEqual('dsd-interactive');
  expect(hydrateFromClass('OpenDialog')).toEqual('idle');
  expect(hydrateFromClass('OpenInput')).toEqual('load');
});

/**
 * The published tag set: the public API surface of @openelement/ui. Renaming
 * or removing a component is a breaking change, so it must edit this constant
 * deliberately. Regenerating the manifest cannot absorb such a change
 * silently, because the assertion below pins exactly these tags.
 */
const PUBLISHED_TAGS = [
  'open-button',
  'open-input',
  'open-theme-toggle',
  'open-code-block',
  'open-dialog',
  'open-dropdown',
] as const;

/**
 * Tag names as declared in the component sources, read as TEXT rather than
 * through the generator's AST reader. The generator walks the source tree
 * recursively, so this reader must too; a nested component counts. Two
 * independent readers over one fact guard the manifest: it can only stay
 * correct while both agree, so a new component cannot land in the tree and be
 * absent from the manifest, and a renamed tag cannot pass with a stale one.
 */
function tagsDeclaredInSource(): string[] {
  const sourceRoot = join(import.meta.dirname!, '..', 'src');
  return readdirSync(sourceRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /^open-.*\.tsx$/.test(entry.name))
    .map((entry) => {
      const declaration = /@element\(\s*'([^']+)'/.exec(
        readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8'),
      );
      if (declaration === null) throw new Error(`${entry.name}: no @element('<tag>') declaration`);
      return declaration[1]!;
    })
    .sort();
}

test('generated UI manifest covers every shipped component', () => {
  const manifest = buildManifest();
  expect(manifest.packageName).toEqual('@openelement/ui');
  expect(manifest.$comment).toContain('GENERATED FILE');
  // (1) Pin the published set: an addition, deletion or rename must fail here.
  expect(tagsDeclaredInSource()).toEqual([...PUBLISHED_TAGS].sort());
  // (2) Every component declared in source must reach the manifest.
  expect(manifest.declarations.map((declaration) => declaration.tagName).sort()).toEqual(
    tagsDeclaredInSource(),
  );
  for (const declaration of manifest.declarations) {
    expect(declaration.className, `${declaration.tagName} missing className`).toBeTruthy();
    expect(declaration.openElement?.ssr).toEqual(true);
    expect(declaration.openElement?.dsd).toEqual(true);
  }
});
