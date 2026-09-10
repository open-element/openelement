# Beta.2.2 — Oxc TSX→PartProgram frontend experiment (#1156)

- Date: 2026-09-10
- Experimenter: an automated CLI subagent session (bounded experiment, Beta.2.2 slice)
- Scope: feasibility/capability comparison of an `oxc-parser` (ESTree) frontend against the
  existing TypeScript-AST frontend consumed by the compiler semantic core
  (`packages/adapter-vite/src/internal/compiler/semantic-core/`). This is an experiment, NOT a
  production migration. No `packages/*/src` file was changed.
- Decision supported: whether an Oxc-based frontend is worth pursuing at the Alpha stage
  (an Alpha INPUT — not Alpha admission, not a production migration, and no production
  build-time claim follows from it).

```text
STATUS: PASS — 7/7 samples full parity (verdict, OEC9xxx code, diagnostic coordinates,
provenance facts, accepted-program skeleton identity); source-map consumer verified;
oracle matrix stable; negative control fails closed.

TESTED_IMPLEMENTATION_SHA:
f83398daeac7c3d25b88e6df2abbece493607db4
("fix: close Beta.2.2 review findings (ADR-0153)") — the implementation commit whose
clean tree this harness ran against (git status at run time: clean apart from the
untracked docs/evidence/ files being drafted). This evidence file is added by a LATER
evidence-only commit that changes no code, harness, lockfile or generated file; the PR
final SHA is bound by the remote CI run on that final SHA, not by this file.

HARNESS:
tools/experiments/oxc/ — run.ts (driver, fail-closed), oxc-analyze.ts (minimal ESTree
analysis), samples/ (7 pinned inputs + .gitattributes `* -text` byte pinning).
Pinned dependency: npm:oxc-parser@0.149.0 (exact; integrity-locked via the committed
deno.lock entries: oxc-parser + @oxc-parser/binding-* + @oxc-project/types).
```

## Tool versions and environment

| Component                    | Version                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| OS / CPU                     | macOS 26.5.1 (build 25F80), Apple Silicon (arm64)                                                                         |
| Deno                         | 2.9.0 (stable, aarch64-apple-darwin), V8 14.9.207.2-rusty                                                                 |
| Node (secondary checks only) | 24.18.0                                                                                                                   |
| TypeScript API (repo pin)    | npm:typescript@^5.9.0 → resolved 5.9.3 (printed live by the harness)                                                      |
| oxc-parser                   | 0.149.0 exactly; native binding @oxc-parser/binding-darwin-arm64 0.149.0 (prebuilt `.node`, no postinstall script needed) |

## How to reproduce (fresh checkout)

```sh
deno install                                     # repo uses nodeModulesDir: "manual"
deno task experiment:oxc                         # exit 0 = parity; exit 1 = any mismatch
deno run -A tools/experiments/oxc/run.ts --out /tmp/oxc-results.json   # optional JSON dump
```

The harness imports the REAL compiler (`compileElementProgram`, `analyzeModuleSemantics`,
`SourceMapSegmentBuilder`) from `packages/adapter-vite/src/internal/compiler/semantic-core/`
at whatever SHA the checkout is — results are always against the current tree, never
transcribed. `deno install` materializes `node_modules/oxc-parser` from the committed
deno.lock entries.

## Inputs (fixed sample set, pinned bytes)

All under `tools/experiments/oxc/samples/`; `.gitattributes` in that directory sets
`* -text` so git never normalizes bytes (the root `.gitattributes` enforces `eol=lf`, which
would destroy the CRLF sample on checkout).

| File                           | Bytes | Provenance                                                                                                                                                                                                                                                                               |
| ------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a-counter.tsx`                | 1253  | verbatim copy of `packages/adapter-vite/__fixtures__/compiled-element-v1/counter.tsx` @ tested SHA (cmp-verified)                                                                                                                                                                        |
| `b1-spread.tsx`                | 488   | verbatim copy of `__fixtures__/compiled-element-v1/unsupported-spread.tsx` (cmp-verified)                                                                                                                                                                                                |
| `b2-type-only.tsx`             | 261   | inline type-only `element` import case from `__tests__/compiler-intrinsic-provenance.test.ts` (`import { type element, ... }` variant, line ~303); one leading `// deno-fmt-ignore-file` comment line added                                                                              |
| `b3-foreign-property.tsx`      | 304   | third-party `@property` decorator case from the same test file (line ~284); same leading comment                                                                                                                                                                                         |
| `c1-counter-spread-crlf.tsx`   | 1336  | a-counter + injected spread attribute on `<h1>` (→ OEC9011 site), all CRLF, leading fmt-ignore comment                                                                                                                                                                                   |
| `c2-counter-spread-bom.txt`    | 1295  | same component, LF + UTF-8 BOM at byte 0. Stored as `.txt` because `deno fmt` strips BOMs from `.tsx` sources unconditionally (empirically verified; `deno-fmt-ignore-file` does not suppress the BOM check). The harness compiles it under the virtual name `c2-counter-spread-bom.tsx` |
| `c3-counter-spread-astral.tsx` | 1297  | same component + non-BMP char (U+1F680, 2 UTF-16 units) in the leading doc comment before the diagnostic site                                                                                                                                                                            |

## Pass/fail criteria (enforced by run.ts, exit 1 on any failure)

1. Oracle matrix gate: the repo compiler must reproduce the pinned expectation per sample
   (verdict + OEC code + 1-based line/character). Guards against silent compiler drift.
2. Verdict parity (accept/reject) between the TS frontend and the Oxc analysis.
3. On reject: diagnostic code AND full coordinates (line, character, start, end offsets)
   identical. Message wording is reported but not gated (see limitations).
4. On accept: deep structural identity of the program skeleton — tag, root, template,
   parts (incl. `when` on/off branches and `each` item trees), regions, dependencies,
   locations, every sourceMap record (offset/line/column, start and end), property
   metadata, observedAttributes.
5. Module-analysis parity: `compiledElementDecorator`, full `unsupportedElementDecorator`
   provenance sentence, `definedCustomElementTags`.
6. Source-map consumer check: program source records from both frontends are fed through
   the repo's real `SourceMapSegmentBuilder`; the builder's coordinate validation must
   accept Oxc-derived spans and emit byte-identical VLQ `mappings`.
7. Hygiene: `deno fmt --check tools/experiments/oxc/` and `deno lint tools/experiments/oxc/`
   pass; sample bytes are drift-guarded by the oracle matrix.

## Results (2026-09-10, TESTED_IMPLEMENTATION_SHA above)

Parity table (positions are `line:character [startOffset,endOffset]`; TS == Oxc on every row):

| Sample                       | Verdict | Code    | Position (both frontends) | Skeleton/facts                                                                              |
| ---------------------------- | ------- | ------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| a-counter.tsx                | accept  | —       | —                         | skeleton identical, incl. all 16 source records and the 5 parts (text/prop/event/when/each) |
| b1-spread.tsx                | reject  | OEC9007 | 12:3 [396,485]            | facts identical                                                                             |
| b2-type-only.tsx             | reject  | OEC9027 | 3:1 [100,132]             | provenance sentence identical                                                               |
| b3-foreign-property.tsx      | reject  | OEC9004 | 6:3 [222,251]             | facts identical                                                                             |
| c1-counter-spread-crlf.tsx   | reject  | OEC9011 | 34:13 [989,1005]          | facts identical                                                                             |
| c2-counter-spread-bom.tsx    | reject  | OEC9011 | 34:13 [957,973]           | facts identical                                                                             |
| c3-counter-spread-astral.tsx | reject  | OEC9011 | 34:13 [959,975]           | facts identical                                                                             |

Coordinate deltas across variants behave exactly as the UTF-16 code-unit contract predicts
(c1 vs LF base: +32 units before the site from 32 CRLF line breaks; c2: +1 BOM unit; c3:
+3 units for `🚀`), identically in both frontends.

Source-map consumer: `builder accepted oxc-derived spans: true; mappings identical: true`.
Conclusion for the source-map question: oxc-parser spans (UTF-16 offsets) feed the
hand-rolled Source Map v3 emitter (`semantic-core/source-map.ts`) without loss, provided the
frontend computes line/character with TS's line-break table (`\n`, `\r\n`, `\r`, U+2028,
U+2029`) — which the harness does and the parity rows prove.

Negative control (harness teeth): inserting one blank line at the top of b2 shifted the
diagnostic to 4:1; the harness exited 1 with
`[b2-type-only.tsx] oracle drifted from expected matrix`. (A trailing-space append correctly
does NOT fail — it is unobservable trivia for both frontends.)

### Timing (bounded microbenchmark: median of 50 runs, 5 warmup, per-call ms; fixed sample

### files of 0.2–1.3 KB on this one machine)

| Path                                                 | a-counter (1253B) | b1 (488B) | c1 (1336B) | c3 (1297B) |
| ---------------------------------------------------- | ----------------- | --------- | ---------- | ---------- |
| ts createSourceFile + transpileModule (current gate) | 1.66              | 0.59      | 1.06       | 0.96       |
| ts createSourceFile only                             | 0.102             | 0.026     | 0.068      | 0.069      |
| oxc parseSync                                        | 0.017             | 0.006     | 0.018      | 0.019      |
| FULL compileElementProgram (real compiler)           | 1.61              | —         | —          | —          |
| FULL oxcAnalyze (minimal analysis)                   | 0.104             | —         | —          | —          |

Within THIS fixed sample, on THIS host, inside THIS bounded harness: oxc parse is ~6× faster
than `createSourceFile` alone and ~95× faster than the full TS syntax gate at these sizes; the
minimal Oxc analysis of the whole grammar is ~15× faster than the full real compile (which also
emits code and maps). These are parser/frontend microbenchmark figures over tiny
single-component files — they say nothing about end-to-end OpenElement production build times,
and no production-migration conclusion is drawn from them.

### Memory (Deno.memoryUsage deltas over 200 iterations of a-counter parse)

| Path                                  | rss Δ    | heapUsed Δ             | external Δ |
| ------------------------------------- | -------- | ---------------------- | ---------- |
| oxc parseSync                         | +0.80 MB | +0.21 MB               | 0          |
| ts createSourceFile only              | +0.13 MB | −3.8 MB (GC noise)     | 0          |
| ts createSourceFile + transpileModule | +23.9 MB | +87.6 MB (unforced GC) | −0.05 MB   |

Reliability caveat: Deno exposes only process-level `Deno.memoryUsage()` (rss/heapTotal/
heapUsed/external); there is no per-parse allocation counter, GC was not forced (no
`--v8-flags=--expose-gc` in the harness contract), and oxc-parser's native (Rust) heap is
visible only inside rss. The +23.9 MB rss / +87.6 MB heapUsed deltas for the TS gate over
200 iterations reflect transpileModule's allocation churn measured without GC; treat as
"TS gate allocates orders of magnitude more per parse" rather than a precise figure.

## Capability inventory delta (what an Oxc frontend must provide)

Verified by reading `semantic-core/` at the tested SHA and by the harness above:
`ts.createSourceFile(TSX)` + `ts.transpileModule` syntax gate (→ OEC9000), ~40 `ts.isXxx`
guards, `ts.getDecorators`/`ts.getModifiers`/`canHaveModifiers`, `SyntaxKind` token checks,
`forEachChild`, `getStart`/`getEnd`/`getText`, `getLineAndCharacterOfPosition` (UTF-16
code-unit columns), decoded literal `.text`. No `.parent`, no comment/trivia APIs.
oxc-parser 0.149.0 provides all of it: decorators on classes/members, modifier equivalents
as node flags (`static`, `accessibility`, `declare`, `optional`, `definite`, `abstract`,
`async`), import/type-only provenance (per-specifier `importKind`), ESTree JSX nodes, UTF-16
offsets (empirically: not UTF-8 bytes), top-level comments array, `Visitor`/`visitorKeys`,
JSON-serializable acyclic AST. It does NOT provide: `loc` line/column (must be derived —
done in `oxc-analyze.ts`), a printer/codegen (verbatim copies use `source.slice(start,end)`,
equivalent to the current `getText` use), or TS's first-diagnostic-only gate shape (Oxc
yields multiple labeled errors; mapping the first label to OEC9000 is straightforward).

## Known limitations / explicitly NOT tested

- OEC9000 syntax-error parity: all 7 samples parse cleanly in both parsers, so the
  gate's span mapping is implemented but unexercised; message WORDING differs by
  construction (Oxc: e.g. "Expected corresponding JSX closing tag for 'span'." + codeframe;
  TS: its own wording). Category (OEC9000) and label span are the portable contract.
- Grammar-message texts on the Oxc side are mirrored from the TS messages by construction;
  the measured contract is code + location, not prose.
- computed()/trustedHtml initializers, island-config statements, custom-element hosts,
  innerHTML sinks, `static styles` emission: not exercised by the fixed sample set (the
  binding machinery they rely on IS exercised via b2/b3).
- Escape-decoding edge cases in literal extraction (`.text` vs `Literal.value` cooked),
  wasm binding, worker parallelism, and parse-time scaling on large files: not tested.
- Node-side and workerd/Bun runs of the harness: NOT RUN here; the in-repo harness is
  Deno-only. The earlier scratch session verified oxc-parser under Node 24.18.0 with
  identical findings.

## Decision: PROCEED (with conditions), as an Alpha-stage evaluation input

The bounded sample set shows byte-level parity of verdicts, diagnostic codes/coordinates,
provenance facts, program skeletons, and source-map consumer output between the TS frontend
and a minimal Oxc ESTree analysis, robust to CRLF/BOM/astral perturbation — at a fraction of
the parse cost in this fixed-sample microbenchmark, and with Deno compatibility. This
supports continuing the direction at Alpha; it is NOT Alpha admission and NOT a completed
production migration. Conditions carried to the Alpha decision:

1. Pin oxc-parser exactly (0.x line, per-platform native bindings; the deno.lock entries and
   the `deno install` bootstrap step this repo's `nodeModulesDir: "manual"` requires are
   now committed).
2. Port the line table + OEC9000 mapping first, and diff-test the syntax-error gate
   specifically (the one path this experiment could not exercise).
3. Known ESTree structural translations: export wrappers vs ExportKeyword modifiers,
   AssignmentExpression vs BinaryExpression `=`, UpdateExpression vs pre/postfix unary,
   `Literal` vs keyword tokens, TemplateLiteral vs NoSubstitutionTemplateLiteral,
   flag-based modifiers vs modifier nodes.

## Commands executed (representative)

```sh
# oracle sanity (repo suites green at the tested SHA):
deno test --no-check --config deno.json --allow-read --allow-write --allow-env --allow-net \
  --allow-run --allow-ffi --allow-sys \
  packages/adapter-vite/__tests__/compiled-element-v1.test.ts \
  packages/adapter-vite/__tests__/compiler-fail-closed-matrix.test.ts \
  packages/adapter-vite/__tests__/compiler-intrinsic-provenance.test.ts \
  packages/adapter-vite/__tests__/compiler-source-map-v3.test.ts \
  packages/adapter-vite/__tests__/module-analysis.test.ts

deno task experiment:oxc                          # exit 0 (PASS line above)
deno fmt --check tools/experiments/oxc/           # exit 0 (8 files)
deno lint tools/experiments/oxc/                  # exit 0 (8 files)
deno fmt --check  (repo-wide)                     # exit 0 (1724 files)
deno lint (repo-wide)                             # exit 0
```

Full structured output: `deno run -A tools/experiments/oxc/run.ts --out <path>.json`.
