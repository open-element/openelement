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
  expect(layerFromClass('OpenCard')).toEqual('dsd-static');
  expect(layerFromClass('OpenDialog')).toEqual('dsd-interactive');
  expect(hydrateFromClass('OpenDialog')).toEqual('idle');
  expect(hydrateFromClass('OpenTabs')).toEqual('load');
});

test('generated UI manifest covers every shipped component', () => {
  const manifest = buildManifest();
  expect(manifest.packageName).toEqual('@openelement/ui');
  expect(manifest.$comment).toContain('GENERATED FILE');
  expect(manifest.declarations.map((declaration) => declaration.tagName)).toEqual([
    'open-card',
    'open-callout',
    'open-button',
    'open-input',
    'open-theme-toggle',
    'open-code-block',
    'open-badge',
    'open-dialog',
    'open-dropdown',
    'open-tabs',
  ]);
  for (const declaration of manifest.declarations) {
    expect(declaration.className, `${declaration.tagName} missing className`).toBeTruthy();
    expect(declaration.openElement?.ssr).toEqual(true);
    expect(declaration.openElement?.dsd).toEqual(true);
  }
});
