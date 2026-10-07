# @openelement/protocol

Cross-system contracts and tiny pure predicates for the
[OpenElement](https://openelement.org) framework.

This package is deliberately **zero-dependency and logic-free**. Every module
is either a cross-system data contract (types plus serialized-shape constants)
or a tiny pure predicate that every consumer of the contract must evaluate
identically. It exists so the framework's three owner lines — the compiler
(that emits the Part Program IR), the element runtime (that consumes it), and
the router build (that reads admission descriptors and plans delivery) — can
share one definition without depending on each other.

Anything beyond contracts is refused here by charter; logic belongs to the
package that owns the behavior.

## Install

```sh
npm install @openelement/protocol
```

You normally do not install this package directly: `@openelement/element`,
`@openelement/compiler`, and `@openelement/router` depend on it and re-export
the contracts their consumers need.

## Subpaths

- `@openelement/protocol` — root entry re-exporting every contract module.
- `@openelement/protocol/app-model` — application/route model contracts.
- `@openelement/protocol/client-assets` — the client asset manifest protocol.
- `@openelement/protocol/data` — action/data channel contracts.
- `@openelement/protocol/errors` — the framework error dialect (codes, `FrameworkError`).
- `@openelement/protocol/forbidden-sinks` — sink admission predicates.
- `@openelement/protocol/framework` — framework options and delivery contracts.
- `@openelement/protocol/island` — island declaration contracts.
- `@openelement/protocol/island-admission` — the island admission descriptor.
- `@openelement/protocol/manifest` — package manifest protocol.
- `@openelement/protocol/module-descriptors` — compiler admission descriptor contracts.
- `@openelement/protocol/module-vocabulary` — module-scan vocabulary contracts.
- `@openelement/protocol/part-program` — the serializable Part Program v1 IR.
- `@openelement/protocol/policy` — policy contracts.
- `@openelement/protocol/registry-markers` — registry marker vocabulary.
- `@openelement/protocol/render` — render/SSR admission contracts.
- `@openelement/protocol/runtime` — runtime seam contracts.
- `@openelement/protocol/signal` — signal contract types.
- `@openelement/protocol/ssg` — SSG engine contracts.
- `@openelement/protocol/stream-frame-policy` — stream frame policy contracts.
- `@openelement/protocol/style-sheet` — stylesheet contract types.
- `@openelement/protocol/void-tags` — the void element tag set.

## License

MIT
