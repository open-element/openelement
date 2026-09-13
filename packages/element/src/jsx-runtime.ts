/**
 * Supported JSX transform entrypoint for Element authors.
 *
 * 0.44: this module exists only so TSX sources typecheck
 * (`jsxImportSource: @openelement/element`) while authoring components that
 * the OpenElement compiler (the @openelement/element/compiler
 * `open:compiled-element` transform) lowers to Part Programs. Compiled output
 * never calls these factories, so `jsx`/`jsxs`/`Fragment` fail closed with a
 * diagnostic: JSX executing at runtime means the module never passed through
 * the compiler.
 *
 * The JSX namespace is declared inline here (and in jsx-dev-runtime.ts)
 * because TypeScript's automatic JSX transform resolves it from the
 * jsx-runtime module's emitted declarations — a `/// <reference>` indirection
 * does not survive `deno pack` declaration emit (consumer:packaged gate).
 */
import { OpenElementError } from './internal/core/errors.ts';

function jsxOutsideCompiler(): never {
  throw new OpenElementError(
    '[openElement] JSX executed outside the 0.44 compiler pipeline. ' +
      'The runtime JSX factory was removed; run the OpenElement Vite adapter ' +
      'so the component is compiled to a Part Program.',
    { code: 'OE_JSX_OUTSIDE_COMPILER', phase: 'build' },
  );
}

/** Typechecking-only factory; fails closed when executed at runtime. */
export function jsx(_type: unknown, _props: unknown): JSX.Element {
  return jsxOutsideCompiler();
}

/** Typechecking-only factory; fails closed when executed at runtime. */
export function jsxs(_type: unknown, _props: unknown): JSX.Element {
  return jsxOutsideCompiler();
}

/** Typechecking-only fragment marker; fails closed when executed at runtime. */
export function Fragment(_props?: unknown): JSX.Element {
  return jsxOutsideCompiler();
}

/** JSX type interface consumed by TypeScript's automatic JSX transform. */
export declare namespace JSX {
  /**
   * JSX expression result — a nominal opaque type. The compiler lowers JSX
   * expressions into Part Program tree nodes at build time; at runtime no
   * JSX value exists, so this type is intentionally uninhabited.
   */
  interface Element {
    readonly __compiledJsxElement: unique symbol;
  }

  interface ElementClass {
    render(): unknown;
  }

  interface IntrinsicElements {
    [elemName: string]: Record<string, unknown>;
  }

  interface IntrinsicAttributes {
    key?: string | number;
    ref?: (el: globalThis.Element) => void;
  }

  interface ElementAttributesProperty {
    props: Record<string, unknown>;
  }

  interface ElementChildrenAttribute {
    children: unknown;
  }
}
