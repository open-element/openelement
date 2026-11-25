---
status: active
topic: Production browser entry applicability
summary: What counts as a production browser entry, how to check the emitted graph, and where coverage requires an explicit candidate receipt.
---

# Production browser entry applicability

P1 requires that the retired generic executor be unreachable from each applicable production browser entry. The Router client build writes the entry graph under `<outDir>/client/.vite/oe-browser-entry-graph.json`. The checker evaluates the artifacts it receives. The release evidence separately names every applicable build and explains any omission. [Release qualification](./alpha16-18-execution-plan.md#release-qualification)

## Applicable builds

| Build | Coverage responsibility |
| --- | --- |
| Site and SaaS | Both are product builds. The root `test:p1` task rebuilds them and passes both graphs to the checker. |
| Packed starter and external application consumers | Check the graph of the actual independent app build. Keep the temporary artifact long enough to evaluate it. A source build in the monorepo does not establish the packed app's resolution graph. |
| Router fixture apps | Native Framework, Request Time, UI Dogfood, UnoCSS and Site Light exercise specialized browser delivery paths. Capture the graph from any fixture that produces a JS entry when claiming graph coverage for that fixture. |
| Static-only and style-only builds | First verify that no executable browser entry is delivered. A build can emit CSS only or omit client output entirely. An observer artifact that names a removed entry is insufficient to classify the result. |
| Library packages and server adapters | Library typechecking and server-only Nitro packaging do not produce a Router browser entry. When an application uses them, verify the application's entry graph. |

Distinguish reported module reachability from the separate proof that the same app works in a browser. Capture uses the emitted static and dynamic chunk edges and includes module identities so names alone cannot settle the result. `MET` covers a complete supplied graph, `VIOLATED` identifies reachable retired execution, and `UNPROVEN` means the capture is missing or incomplete. Do not equate a removed package file, absence of a string in a minified bundle, or a successful unit test with this graph proof.

## Reproduce

From the repository root:

```sh
vp run --no-cache test:p1
```

To check additional production or installed-consumer artifacts:

```sh
vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo browser-graph:check <artifact-path>
```

Record the actual build command, the clean candidate SHA, the artifact path, the checker result and the scope of the consumer. The browser graph observer is report-only in the build. The separate checker records the verdict, and the release decision requires the complete set of applicable evidence. [Historical applicability audit and measurements](https://github.com/open-element/openelement/blob/e655a0bab6f1396f4ed1a10208794e51e592b0ce/docs/architecture/p1-applicability-record.md)
