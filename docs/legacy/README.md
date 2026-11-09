# Legacy

This directory is a **read-only archive**. Nothing here governs current work.
The single source of truth for active documents and decisions is
[`docs/TRUTH.md`](../TRUTH.md).

## Why it exists

Active records stay in `docs/adr/`; records that no longer govern are moved
here so the main line carries only what is currently in force. Moving is not
deletion: the full text of every archived record is preserved, and Git history
retains the path it came from.

## Contents

`adr/` — the four closed decision records (`SUPERSEDED` / `RETIRED` /
`EXECUTED`). Their entries remain in the [`docs/adr/README.md`](../adr/README.md)
index with the closed-vocabulary annotation, and
`tools/repo/check-adr-index.ts` reads both directories so the `gate:source`
check still covers them.

| Record | Status |
| --- | --- |
| `ADR-0108-deno-native-npm-distribution.md` | SUPERSEDED by ADR-0161 |
| `ADR-0112-protocol-types-and-tiny-runtime.md` | SUPERSEDED by ADR-0152 |
| `ADR-0156-tree-sha-evidence-reuse.md` | RETIRED by the #1567 CI/Release redesign |
| `ADR-0162-element-runtime-compiler-split-deferred.md` | EXECUTED (deferred split landed) |

## Rules

1. Archived files are never edited and never cited as an active requirement.
   A citation that points here must say the record is retired.
2. Process documents that are not ADRs are **not** archived: they were removed
   from the main line on 2026-11-10 and are recoverable from Git history at the
   parent of the removal commit. See `docs/TRUTH.md` for the removal list.
3. Recover any removed document with `git show <removal>^:<path>`.
