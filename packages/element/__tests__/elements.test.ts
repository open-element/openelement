import { expect, test } from 'vitest';
import { OpenElement } from '../src/index.ts';
import * as elementSurface from '../src/index.ts';

test('@openelement/element exports OpenElement facade', () => {
  const element = new OpenElement();

  expect(element).toBeInstanceOf(OpenElement);
});

test('@openelement/element preserves light DOM opt-in static contract', () => {
  class LightElement extends OpenElement {
    static override renderMode = 'light' as const;
  }

  expect(LightElement.renderMode).toEqual('light');
});

test('@openelement/element exports the compiled pipeline entries', () => {
  // 0.44: the functional authoring helper (defineElement) and the runtime JSX
  // factories (For/jsx/...) were removed with the legacy renderer. The public
  // pipeline entries are the compiled server render and the claim bootstrap.
  expect('defineElement' in elementSurface).toEqual(false);
  expect('defineLayout' in elementSurface).toEqual(false);
  expect('For' in elementSurface).toEqual(false);
  expect('jsx' in elementSurface).toEqual(false);
  expect(typeof elementSurface.renderDsd).toEqual('function');
  expect(typeof elementSurface.ensurePreHydrationClickCapture).toEqual('function');
});
