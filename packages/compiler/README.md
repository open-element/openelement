# @openelement/compiler

Build-time compiler for OpenElement function components authored in JSX or TSX.
It emits HTML renderers for server function components and native Custom
Elements for components admitted by the host. Generated elements include the
code to mount fresh DOM, claim server-rendered DOM, and update reactive bindings.

## Subpaths

| Subpath | Import it for |
| --- | --- |
| `@openelement/compiler` | Compiler integration for build hosts. Use `analyzeModuleSemantics` for discovery, `compileServerComponentIfAdmitted` for server components, and `compileGeneratedElementIfAdmitted` for generated elements. This entry also exposes structured diagnostics, style-edge helpers, and `stableModuleId`. |
| `@openelement/compiler/vite` | The standalone `element()` Vite plugin, which runs before Vite lowers JSX. Hosts enable the generated-element transform by supplying a tag through `generatedElementSite`. |

## Boundary

Applications that use Router get the compiler through
`openElement()` from `@openelement/router/vite`. Router reads the sidecar
declared with `defineIslandConfig` and supplies the tag plus an optional root
hint for style scoping. The sidecar determines the emitted element's root.
Unsupported syntax in an admitted component produces a source-located
compiler diagnostic.

Compiler entry points use the TypeScript compiler API and belong in build
tooling. The browser loads the generated element module and its Element runtime.

See the [authoring guide](https://openelement.org/guide/compiled-grammar/) for
supported component syntax.
