import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import {
  buildManifest,
  hydrateFromClass,
  layerFromClass,
  parseCssParts,
  parseEvents,
  parseSlots,
} from './generate-ui-manifest.ts';

Deno.test('UI event manifest parses nested detail objects with TypeScript AST', () => {
  const [event] = parseEvents(`
    this.dispatchEvent(new CustomEvent('change', {
      detail: { value: 1, nested: { enabled: true } },
      bubbles: true,
    }));
  `);
  assertEquals(event.name, 'change');
  assertStringIncludes(event.type ?? '', 'nested: { enabled: boolean }');
});

Deno.test('parseSlots picks up JSX <slot name=...> literals without doc comments', () => {
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
  assertEquals(
    slots.map((s) => s.name),
    ['', 'header', 'footer'],
  );
  assertEquals(slots[0].description, 'Default slot');
});

Deno.test('parseSlots keeps @slot doc descriptions and does not duplicate JSX matches', () => {
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
  assertEquals(
    slots.map((s) => s.name),
    ['tab', 'panel'],
  );
  assertEquals(slots[0].description, 'Tab label element (one per panel)');
  assertEquals(slots.some((s) => s.name === ''), false);
});

Deno.test('parseCssParts picks up JSX part=... literals without doc comments', () => {
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
  assertEquals(
    parts.map((p) => p.name),
    ['container', 'icon', 'content'],
  );
});

Deno.test('parseCssParts prefers @csspart doc descriptions over JSX literals', () => {
  const parts = parseCssParts(`
    /**
     * @csspart container - The article wrapper
     */
    render() {
      return <article part='container'><div part='body'></div></article>;
    }
  `);
  assertEquals(
    parts.map((p) => [p.name, p.description]),
    [
      ['container', 'The article wrapper'],
      ['body', "The 'body' part"],
    ],
  );
});

Deno.test('layer/hydrate policies fail loud on unknown component classes', () => {
  assertThrows(() => layerFromClass('OpenUnknown'), Error, 'No layer/hydrate policy');
  assertThrows(() => hydrateFromClass('OpenUnknown'), Error, 'No layer/hydrate policy');
  assertEquals(layerFromClass('OpenCard'), 'dsd-static');
  assertEquals(layerFromClass('OpenDialog'), 'dsd-interactive');
  assertEquals(hydrateFromClass('OpenDialog'), 'idle');
  assertEquals(hydrateFromClass('OpenTabs'), 'load');
});

Deno.test('generated UI manifest covers every shipped component', () => {
  const manifest = buildManifest();
  assertEquals(manifest.packageName, '@openelement/ui');
  assertStringIncludes(manifest.$comment, 'GENERATED FILE');
  assertEquals(manifest.declarations.map((declaration) => declaration.tagName), [
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
    assert(declaration.className, `${declaration.tagName} missing className`);
    assertEquals(declaration.openElement?.ssr, true);
    assertEquals(declaration.openElement?.dsd, true);
  }
});
