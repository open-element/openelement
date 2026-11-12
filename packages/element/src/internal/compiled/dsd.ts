/**
 * Canonical Declarative Shadow DOM (DSD) spelling for the compiled runtime.
 *
 * This module is a browser-safe leaf: it reads and writes strings only. Its
 * imports are the shared validation error (`runtime/values.ts`) and the
 * protocol marker constant; it never imports `server/index.ts`, the kernel,
 * the generated-element shell or any execution backend.
 *
 * The old server serializer and the generated-element SSR producer must share
 * this ONE spelling. `serializeShadowTemplate` is the M09-shadow producer
 * primitive: the generated `<Name>__ssr` remains content-only, and the future
 * M09-1 producer wraps that content in this template before building the host
 * tag and light children. The template takes only typed DSD options and
 * validated, already-produced content: there is no raw-markup prefix channel.
 * Style delivery is a later typed link-resource slice; this leaf emits no CSS,
 * `<style>` or `<link>`.
 *
 * @module ./dsd.ts
 */

import { CompiledProgramValidationError } from './runtime/values.ts';

/** Native DSD template flags. This is a serialized attribute set, not author syntax. */
export interface CompiledDsdOptions {
  delegatesFocus?: boolean;
  clonable?: boolean;
  serializable?: boolean;
  slotAssignment?: 'named' | 'manual';
  customElementRegistry?: boolean;
}

/** A DSD root mode is the wire spelling of a shadow root, never `light`. */
export type CompiledDsdRootMode = 'open' | 'closed';

/**
 * The canonical `shadowroot*` boolean/option attributes. One implementation
 * serves both the old server serializer and the M09-shadow producer, so a
 * spelling change cannot drift between the two.
 */
export function serializeDsdAttributes(options: CompiledDsdOptions | undefined): string {
  if (!options) return '';
  const booleans = ['delegatesFocus', 'clonable', 'serializable', 'customElementRegistry'] as const;
  for (const key of booleans) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') {
      throw new CompiledProgramValidationError(`dsd.${key}`, 'DSD option must be boolean');
    }
  }
  if (
    options.slotAssignment !== undefined &&
    options.slotAssignment !== 'named' &&
    options.slotAssignment !== 'manual'
  ) {
    throw new CompiledProgramValidationError(
      'dsd.slotAssignment',
      'DSD slotAssignment must be "named" or "manual"',
    );
  }
  const parts: string[] = [];
  if (options.delegatesFocus) parts.push(' shadowrootdelegatesfocus');
  if (options.clonable) parts.push(' shadowrootclonable');
  if (options.serializable) parts.push(' shadowrootserializable');
  if (options.slotAssignment === 'manual') parts.push(' shadowrootslotassignment="manual"');
  if (options.customElementRegistry) parts.push(' shadowrootcustomelementregistry');
  return parts.join('');
}

/**
 * The typed platform options the M09-shadow producer may supply. This is the
 * same option set the old server serializer carries; it is not a raw-markup
 * channel.
 */
export type ShadowTemplateOptions = CompiledDsdOptions;

/**
 * Wrap content-only generated SSR output in the canonical DSD template:
 *
 * ```html
 * <template shadowrootmode="open|closed" [shadowroot*]>…</template>
 * ```
 *
 * `content` is trusted, already-escaped program markup. This function does not
 * escape it, does not build a host tag or light children (the producer owns
 * those), and never creates an inline `<style>`, `<link>` or other raw prefix.
 */
export function serializeShadowTemplate(
  mode: CompiledDsdRootMode,
  content: string,
  options: ShadowTemplateOptions = {},
): string {
  if (mode !== 'open' && mode !== 'closed') {
    throw new CompiledProgramValidationError(
      'shadowRootMode',
      `DSD root mode must be "open" or "closed", got ${JSON.stringify(mode)}`,
    );
  }
  if (typeof content !== 'string') {
    throw new CompiledProgramValidationError('content', 'DSD template content must be a string');
  }
  const dsdAttrs = serializeDsdAttributes(options);
  return `<template shadowrootmode="${mode}"${dsdAttrs}>${content}</template>`;
}
