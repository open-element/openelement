# generated-only fixture (M11-3)

A single generated-element page island and nothing else: no class page, no class
island, no form enhancement. It exists to prove that the generated client entry
for a fully generated lane does not require the legacy compiled executor runtime
(`@openelement/element` element-services chunk).

Build and verify from this directory (not part of any gate):

```sh
node ../../../../packages/router/src/cli/build.ts
node ../../../../tools/repo/check-browser-entry-graph.ts dist/client/.vite/oe-browser-entry-graph.json --json
```

Expected: build exit 0; checker `MET` with `violated: 0`. `parsedOnlyExecutorResidues`
is report-only evidence of module-graph residue that did not render.
