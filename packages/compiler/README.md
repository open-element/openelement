# @openelement/compiler

The OpenElement TSX-to-Part-Program compiler: build-time tooling that lowers
authored `@element` components into the serializable Part Program v1 IR the
element runtime consumes, plus the Vite plugin boundary
(`compileElementModule` / `compiledElementPlugin`).

This package is build-tooling only. It is never part of a browser/runtime
graph: it imports the TypeScript compiler API and ships `typescript` as its
one heavy dependency, so pure-runtime consumers of `@openelement/element`
never install it.

## Install

```sh
npm install @openelement/compiler
```

You normally do not install this package directly: `@openelement/router`
depends on it for its build and drives it through the `openElement()` Vite
plugin.

## Subpaths

- `@openelement/compiler` — the compiler facade: `compileElementProgram`,
  `analyzeModuleSemantics`, the Part Program boundary types, diagnostics.
- `@openelement/compiler/vite` — the standalone `element()` authoring plugin
  (`compiledElementPlugin`), for builds that do not use Router.

## License

MIT
