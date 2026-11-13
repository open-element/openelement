/**
 * generated-element/dsd-ssr.ts — the host-level DSD producer for the generated
 * native element (M09-2a).
 *
 * `dsd.ts` owns the ONE canonical DSD spelling and refuses to build a host tag;
 * the generated `<Name>__ssr` is content-only by contract. This leaf is the one
 * place that closes the two facts into the host artifact the browser parser
 * adopts: host tag, then the DSD template, then the light children.
 *
 * The shape mirrors the class serializer's host wrapping
 * (`server/index.ts` `serializeCompiledProgram`): the tag and its attributes,
 * `<template shadowrootmode="…" …>` around the content, light children AFTER
 * the template so the platform's own slot distribution does the work, and
 * `<tag>content</tag>` for a light root. It is deliberately narrower than that
 * serializer:
 *
 * - the template comes from `serializeShadowTemplate` (`dsd.ts`), so there is
 *   no second DSD spelling and no raw-markup prefix channel;
 * - attributes are `[name, value]` string pairs only, screened by the one
 *   canonical safe-attribute-name predicate and escaped by the shared
 *   `escapeAttrValue`, so there is no second escape table;
 * - no `<style>`, no `<link>`, no CSS and no `class`/`style` value algebra:
 *   style delivery is a later typed link-resource slice (M09-2e) and the
 *   caller normalizes values before they cross this boundary.
 *
 * This module is a browser-safe leaf. It imports strings and validation only:
 * `dsd.ts`, the shared escapers, the safe-attribute predicate and the compiled
 * validation error. It never imports `server/index.ts`, `server/shared.ts`,
 * `serialize-program.ts`, the kernel or any execution backend.
 *
 * @module ./dsd-ssr.ts
 */

import { escapeAttrValue } from '../../core/html-escape.ts';
import { isSafeAttributeName } from '../../core/security.ts';
import { CompiledProgramValidationError } from '../runtime/values.ts';
import {
  serializeShadowTemplate,
  type CompiledDsdOptions,
  type CompiledDsdRootMode,
} from '../dsd.ts';

/**
 * The root the host producer was asked for, in the DSD wire vocabulary.
 *
 * The descriptor's `RootMode` (`light | shadow-open | shadow-closed`) is the
 * caller's vocabulary; `open`/`closed` are the wire spellings
 * `serializeShadowTemplate` validates. The translation happens at the call
 * site, so no second root spelling exists here.
 */
export type GeneratedElementSsrRoot = 'light' | CompiledDsdRootMode;

/**
 * One host artifact request. Every field is typed; there is no raw-markup
 * channel and no unvalidated attribute channel.
 */
export interface GeneratedElementSsrInput {
  /** The registration tag the host derived (never re-derived here). */
  readonly tag: string;
  /** The root the descriptor pinned, in the DSD wire vocabulary. */
  readonly root: GeneratedElementSsrRoot;
  /**
   * Host-tag attributes as `[name, value]` string pairs. The name is screened
   * by the canonical safe-attribute predicate, duplicates (case-insensitive)
   * are refused, and the value is escaped by the shared attribute escaper.
   * Ordered: the emitted attribute order is the caller's order.
   */
  readonly attributes?: readonly (readonly [string, string])[];
  /** The typed DSD platform options the template carries (`dsd.ts`). */
  readonly dsd?: CompiledDsdOptions;
  /** Trusted, already-escaped generated content (the `<Name>__ssr` bytes). */
  readonly content: string;
  /**
   * The host's light children, placed AFTER the template. A shadow root
   * distributes them through its own `<slot>` elements; a light root
   * distributes nothing, so a non-empty value there is a caller defect.
   */
  readonly lightChildren?: string;
}

function hostAttributes(raw: GeneratedElementSsrInput['attributes']): string {
  if (raw === undefined) return '';
  const seen = new Set<string>();
  let markup = '';
  for (const [index, pair] of raw.entries()) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new CompiledProgramValidationError(
        `attributes[${index}]`,
        'host attributes must be [name, value] pairs',
      );
    }
    const name: unknown = pair[0];
    if (typeof name !== 'string' || !isSafeAttributeName(name)) {
      throw new CompiledProgramValidationError(
        'attributes',
        `unsafe attribute name ${String(name)}`,
      );
    }
    const value: unknown = pair[1];
    if (typeof value !== 'string') {
      // The one serializer's `class`/`style` value normalization is a server
      // module this leaf must not reach, and guessing a second normalization
      // here would be a second value dialect. Values are normalized by the
      // caller before they cross.
      throw new CompiledProgramValidationError(
        `attributes[${index}]`,
        `host attribute value for ${JSON.stringify(name)} must be a string`,
      );
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new CompiledProgramValidationError(
        'attributes',
        `duplicate attribute ${JSON.stringify(name)}`,
      );
    }
    seen.add(key);
    markup += ` ${name}="${escapeAttrValue(value)}"`;
  }
  return markup;
}

/**
 * Build the host artifact for one generated element from its content-only
 * `<Name>__ssr` bytes:
 *
 * ```html
 * <tag [attrs]><template shadowrootmode="open|closed" [shadowroot*]>…</template>[lightChildren]</tag>
 * <tag [attrs]>…</tag>                                    (light root)
 * ```
 *
 * The browser parser adopts the template as a real declarative shadow root, so
 * the generated class claims that root instead of calling `attachShadow`.
 */
export function serializeGeneratedElementHtml(input: GeneratedElementSsrInput): string {
  const { tag, root, content } = input;
  if (typeof tag !== 'string' || tag.length === 0) {
    throw new CompiledProgramValidationError('tag', 'the host tag must be a non-empty string');
  }
  if (root !== 'light' && root !== 'open' && root !== 'closed') {
    throw new CompiledProgramValidationError(
      'root',
      `the host root must be "light", "open" or "closed", got ${JSON.stringify(root)}`,
    );
  }
  if (typeof content !== 'string') {
    throw new CompiledProgramValidationError('content', 'generated content must be a string');
  }
  const lightChildren = input.lightChildren ?? '';
  if (typeof lightChildren !== 'string') {
    throw new CompiledProgramValidationError('lightChildren', 'light children must be a string');
  }
  const attributes = hostAttributes(input.attributes);
  if (root === 'light') {
    if (lightChildren !== '') {
      throw new CompiledProgramValidationError(
        'lightChildren',
        'lightChildren is for shadow-root hosts: a light root consumes its children ' +
          'through projectedChildren',
      );
    }
    return `<${tag}${attributes}>${content}</${tag}>`;
  }
  const template = serializeShadowTemplate(root, content, input.dsd ?? {});
  return `<${tag}${attributes}>${template}${lightChildren}</${tag}>`;
}
