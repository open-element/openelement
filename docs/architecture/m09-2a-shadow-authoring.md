---
status: active
topic: M09-2a shadow island authoring
summary: The authored `root: 'shadow'` island end to end — the one host-level DSD producer, the generated `__ssrHost` wire, and the R7 shadow-including ancestor walk; a bounded slice record, not the M09 exit.
---

# M09-2a: authoring a shadow island end to end

Date: 2026-11-13. Status: **bounded implemented — not the M09 exit.**

This is the second half of the M09-2a record. Its sibling
[`m09-2a-root-source.md`](./m09-2a-root-source.md) carries the sidecar `root`
source decision (`D-root-source`); this document carries what the root fact is
for: a shadow island that works from the author's sidecar to a claimed,
updatable, disposable declarative shadow root — plus the one claim-invariant
defect that composition makes reachable (R7).

## The capability

An island author writes one sidecar fact and nothing else:

```tsx
export const openElement = defineIslandConfig({ hydrate: 'idle', root: 'shadow' });
export default function ProfileCard() {
  return <section><slot name="title"></slot><p id="panel">hello</p></section>;
}
```

The lane reads that fact from the authored AST
([`site.ts`](../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/site.ts)
`readIslandRoot`), maps `'shadow'` to the descriptor root `shadow-open`, emits
the generated class **and** one host-level export
`ProfileCard__ssrHost(props, lightChildren?)`. Node calls the export to produce
host HTML; the browser parser adopts the template as a real declarative shadow
root; the generated class claims that root instead of calling `attachShadow`.
Claim, refresh and both dispose modes then behave as they do for a
server-produced class island.

The whole chain is proven once, in real Chromium, by
[`generated-element.shadow-authoring.browser.test.ts`](../../packages/compiler/__tests__/semantic-ir/generated-element.shadow-authoring.browser.test.ts):
sidecar → lane → host bytes → DSD adoption → mutation-free claim → signal
refresh → `dispose(false)` / `dispose(true)`.

## The host-template wire

Two producers must agree byte-for-byte on host shape, and the generated one is
new. The reference shape is the class serializer
(`server/index.ts` `serializeCompiledProgram`): host tag and attributes, then
the DSD template, then the host's light children **after** it.

| Piece | Path | Role |
| --- | --- | --- |
| The producer leaf | `packages/element/src/internal/compiled/generated-element/dsd-ssr.ts` | The ONE host-template writer: `serializeGeneratedElementHtml({tag, root, attributes?, dsd?, content, lightChildren?})` |
| The canonical spelling | `packages/element/src/internal/compiled/dsd.ts` | `serializeShadowTemplate` / `serializeDsdAttributes`; the leaf composes them rather than re-spelling DSD |
| The internal entry | `packages/element/src/internal/compiled/generated-element/shell.ts` | Re-exports the producer, so the emitted module keeps ONE specifier (`D-packaging`) |
| The emitter | `packages/compiler/.../generated-element/emit.ts` | Appends `<Name>__ssrHost` for a shadow descriptor whose leaf emitted `<Name>__ssr` |

Rules the wire holds, each one asserted:

- **The template is the canonical serializer's bytes.** No second DSD spelling,
  no raw-markup prefix and no `<style>` / `<link>`: `dsd.ts` owns the spelling,
  and style delivery is the later typed link-resource slice (M09-2e). The Node
  test asserts the leaf's bytes are literally `serializeShadowTemplate(...)`.
- **Attributes are `[name, value]` pairs only** — screened by the canonical
  safe-attribute predicate, duplicates refused case-insensitively, values
  escaped by the shared `escapeAttrValue`, so there is no second escape table.
- **Light children ride after the template** and are refused for a light root,
  exactly like the class serializer (a light root consumes children through
  `projectedChildren`, it does not append them).
- **The light path is byte-identical.** A light root (or an absent root, which
  the shell defaults to light) appends no wrapper and imports nothing new: the
  emitter test pins the M09-1a tail byte-for-byte.
- **The wrapper is appended only when the leaf emitted `<Name>__ssr`.** The
  check reads the artifact the emitter itself produced, so a module outside the
  leaf producer slice cannot acquire a call to an absent symbol.
- **`delegatesFocus` is not threaded.** The producer leaf accepts the typed DSD
  option set (`dsd?: CompiledDsdOptions`) because that is the one spelling, but
  nothing authors it: the descriptor does not carry it in this slice
  (`D-delegatesFocus` is a later commit), so the appended wrapper passes none
  and the template carries `shadowrootmode` alone.

**One cost, stated rather than hidden.** Re-exporting the producer from the
element's one internal entry puts `internal/compiled/dsd.ts` and the producer
leaf in the PARSE graph of every module that imports that specifier, including
a light generated module that never calls them. That is the price of the one
subpath (`m09-2-design.md` §7.6, `D-packaging`); the shipped artifact is the
RENDERED graph, and there the producer is tree-shaken out. Two existing
module-graph guards were **converted, not weakened**:
`generated-element.class.browser.test.ts` and `generated-element.shadow.test.ts`
each keep the rendered-graph refusal of the DSD leaf and now assert the
parse-graph fact explicitly instead of leaving it implicit.

## R7 — the shadow-including ancestor walk

**Defect.** `assertElementInHtmlNamespace`
(`packages/element/src/internal/compiled/runtime/claim-invariants.ts`) walked
`parentNode`. `ShadowRoot.parentNode` is `null` by platform definition, so a
claim parent or target nested inside ANOTHER shadow tree stopped the walk at
that boundary and the outer host's element ancestors were never checked. A
shadow island nested inside another shadow island is exactly the composition
this slice makes author-reachable, so the residual recorded in
[`m09-shadow-dsd.md`](./m09-shadow-dsd.md) stops being theoretical.

**Fix.** One `composedParent(node)` step, used by both walks: a node with a
`parentNode` answers it; a node without one continues at `node.host` if and only
if the node is a real `ShadowRoot` by the existing native cross-realm brand
check. The `nodeType !== 1` skip stays, and a `Document` or a bare
`DocumentFragment` still terminates the walk — a bare `DocumentFragment` is not
a `ShadowRoot`, so the existing rejection is intact.

**Behaviour change: strictly stricter.** It can only add a refusal, for a claim
whose ancestor chain crosses a shadow boundary into a non-HTML element. The
function is shared with the class path, which is why the guard is an
element-project test rather than a compiler one; both package suites and both
generated-element browser suites ran green.

Red→green was measured on this exact tree: with only the R7 hunk reverted to
`HEAD`, the red half fails 3 of 5 cases (nested claim parent, light-path claim
target, cross-realm root) with `expected null to be 'OEIR_LEAF_CLAIM_MISMATCH'`,
while the green control and the unchanged-refusal cases still pass; with the
hunk restored the file is 5/5. The revert and the restore were byte-verified by
SHA-256.

## What this slice does NOT do

- **No `delegatesFocus`.** No author spelling, no sidecar field, no scanner key,
  no descriptor field (`D-delegatesFocus` is a separate commit). The producer
  accepts the existing typed DSD option set; nothing authors it here.
- **No `properties` and no `formValue`.** Property/attribute conversion and the
  form-value convention are separate slices (`D-props`, `D-forms`); the
  descriptor still always emits `properties: []`.
- **Closed roots stay unopened.** No `shadow-closed` author spelling and no
  closed authoring path (`D-closed` = defer). The emitter's root mapping is
  total, so a future closed spelling cannot fall through to an open template,
  but nothing can author one yet.
- **No styles, no CEM, no events, no forms.** No `<style>`, no `<link>`, no
  adopted-sheet work, no CEM/manifest producer, no new event surface, no
  internals/`setFormValue`.
- **Not an M09 exit, and not M11 wiring.** No router DSD/SSR integration, no
  request-time production of host HTML, no manifest change, no registration
  change, no packaging/export-subpath change. `__ssrHost` is a call target with
  no production consumer, exactly as `K9` records for `__ssr`.
- **No product public-surface move.** No Element/Router root export, no option,
  no type and no documented API changes; `GeneratedElementSite` is unpublished
  ABI. The one recorded surface that does move is the additive symbol set of the
  already-declared internal subpath `./internal/compiled/generated-element/shell`
  — see the snapshot note under Evidence. The owner accepted that additive change
  and the baseline was regenerated accordingly; it was never hand-edited.
- **No `generate.ts` change.** The M08-frozen leaf generator is untouched;
  `D-claim-prefix` belongs to M09-2e.

## Evidence (LOCAL)

Focused (all green):

- `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-element.shadow-authoring.test.ts`
  — 1 file, 7 tests.
- `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-element.shadow-authoring.browser.test.ts`
  — 1 file, 2 tests, real Chromium (the vertical).
- `./node_modules/.bin/vitest run --project element packages/element/__tests__/generated-element-dsd-ssr.test.ts`
  — 1 file, 11 tests.
- `./node_modules/.bin/vitest run --project element packages/element/__tests__/compiled-runtime/claim-invariants-nested-shadow.test.ts`
  — 1 file, 5 tests (R7; red half measured, see above).
- `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-element.shadow.test.ts`
  — 1 file, 20 tests (the converted module-graph guard).
- `./node_modules/.bin/vitest run --project router packages/router/__tests__/island-scanner.test.ts packages/router/__tests__/root-declaration-boundary.test.ts packages/router/__tests__/island-root-drift-guard.test.ts`
  — 3 files, 15 tests.

Full projects (all green):

- `./node_modules/.bin/vitest run --project compiler` — 67 files, 1034 tests.
- `./node_modules/.bin/vitest run --project element` — 120 files, 899 tests.
- `./node_modules/.bin/vitest run --project router` — 145 files, 1643 tests.

Static gates:

- `./node_modules/.bin/tsc --noEmit -p packages/compiler/tsconfig.json` and
  `-p packages/element/tsconfig.json` — no diagnostics.
- `./node_modules/.bin/oxfmt --check` and `./node_modules/.bin/oxlint` on every
  changed file — formatted, 0 warnings / 0 errors.
- `pnpm run check` — `gate ok: 5 step(s)` (fmt:check, lint over 1342 files, the
  6-package typecheck, markdownlint over 186 files, public docs).
- `seams:check` — 57 rows / 57 explicit, both rows below included;
  `docs-index:check` — 29 active documents, `README.md` regenerated by
  `docs-index:write`, never hand-edited.

**The one recorded-surface change, and why it is forced.** The
`interface:snapshot` tripwire fired on this slice and the owner accepted the
change, so the baseline was **regenerated** (never hand-edited):

- The **only** delta is the element package's already-declared internal subpath
  `./internal/compiled/generated-element/shell`: it gains exactly three symbols
  — `serializeGeneratedElementHtml`, `GeneratedElementSsrInput`,
  `GeneratedElementSsrRoot` — and its `publicShapeSha256` moves with them. Eight
  previously listed symbols stay byte-identical and **nothing** is removed,
  renamed or re-typed. No root, `./authoring`, `./server` or router surface
  moves; all six packages remain.
- It is **forced**, not chosen. The emitted module may only import a declared
  subpath; the DSD producer must be a separate browser-safe leaf; and adding a
  fourth subpath would change `package.json` exports *and* move the snapshot
  further. Re-exporting the producer from the internal shell subpath is the
  minimum of those options, and it is the route `m09-2-design.md` §7.6
  (`D-packaging`) already mandates — the emitter points the shell *and* the
  producer at the one subpath.
- **The design's acceptance list is incomplete here.** §2.8 names
  `docs-index:write` as 2a's only extra generator step and omits
  `interface:snapshot:write`, so the mandated barrel route and the snapshot
  tripwire were never reconciled on paper. That is a design gap, not a slice
  defect; this record closes it, and the precedent is the same file M09-1b
  regenerated for these same internal subpaths ("generated from the `exports`
  maps … recorded, never hand-edited",
  [`m09-1-emitter.md`](./m09-1-emitter.md) §packaging).
- **The author-facing API reference does not move**: after regeneration
  `pnpm run generate:all` still writes 9 generator tasks and
  `6 packages (1147 documented exports) and 6 custom elements`, byte-identical,
  because the API-reference generator skips `internal/` subpaths. Only
  `docs/release/public-interface-snapshot.json` changed in the tree.

Evidence is one Chromium engine plus the focused Node suites; this is a bounded
slice record, not M09 qualification and not the M13 browser matrix.
