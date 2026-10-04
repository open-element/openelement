/**
 * Shared light-root counter harness for the compiled claim/activation suites:
 * one LIGHT_PROGRAM shape and one defineLightCounter factory, parameterized by
 * the suite's tag prefix so suites cannot collide on registered tags. The
 * suite supplies its already-resolved OpenElement class, testProgram builder,
 * and DOM registry — this module imports nothing at module-eval time, so the
 * facade-dom globals are guaranteed to be installed before the class is
 * defined (the caller resolves OpenElement after installFacadeDom()).
 */
import type { OpenElement as OpenElementClass } from '@openelement/element';
import type { testProgram } from './test-program.ts';

export const LIGHT_PROGRAM = {
  template: [
    {
      k: 'el' as const,
      tag: 'button',
      attrs: [['type', 'button']] as Array<[string, string]>,
      children: [
        { k: 'text' as const, value: 'count: ' },
        { k: 'part' as const, index: 0 },
      ],
    },
  ],
  parts: [
    { k: 'text' as const, index: 0, signal: 'count' },
    {
      k: 'event' as const,
      index: 1,
      event: 'click',
      handler: 'increment',
      action: { kind: 'method' as const, name: 'increment' },
      path: [0],
    },
  ],
  properties: [
    {
      name: 'count',
      attribute: 'count',
      type: 'number' as const,
      converter: 'number' as const,
      reflect: true,
      default: 0,
    },
  ],
};

/** Per-suite unique-tag generator: `oe-<prefix>-<label>-<n>` with its own counter. */
export function makeUniqueTag(prefix: string): (label: string) => string {
  let tagCounter = 0;
  return (label: string): string => `oe-${prefix}-${label}-${++tagCounter}`;
}

/** The resolved collaborators a suite hands to defineLightCounter. */
export interface LightCounterDeps {
  OpenElement: typeof OpenElementClass;
  testProgram: typeof testProgram;
  registry: CustomElementRegistry;
}

/** Define one light-root counter element under `tag` and return its constructor. */
export function defineLightCounter(deps: LightCounterDeps, tag: string): CustomElementConstructor {
  const program = deps.testProgram({ tag, rootMode: 'light', ...LIGHT_PROGRAM });
  const ctor = class extends deps.OpenElement {
    // oxlint-disable-next-line no-explicit-any
    increment(this: any): void {
      this.count++;
    }
  } as unknown as CustomElementConstructor & Record<string, unknown>;
  ctor.__partProgram = program;
  ctor.__compiledProperties = program.metadata.properties;
  ctor.__elementMetadata = program.metadata;
  ctor.observedAttributes = program.metadata.observedAttributes;
  deps.registry.define(tag, ctor);
  return ctor;
}
