# CEM extraction experiment (#1156, Beta.2.2 slice)

Bounded, reproducible harness for evaluating whether the upstream
`@custom-elements-manifest/analyzer` can carry OpenElement's generic component
metadata extraction while OE's layer/interop/hydration policy stays local.

Evidence record: `docs/evidence/2026-09-10-beta2-2-cem-experiment.md`.

## Run

From the repo root (Deno 2.9+):

```sh
deno run --no-lock --node-modules-dir=none --allow-read --allow-write --allow-env \
  tools/experiments/cem/run.ts
```

Exit code is non-zero if any parity/inventory/orthogonality check fails.
Optional `--out <path>` writes the machine-readable summary JSON.

Flag rationale:

- `--no-lock` — the analyzer is pinned exactly in the `npm:` specifier
  (`npm:@custom-elements-manifest/analyzer@0.11.0`) so `deno.lock` and
  `vendor/` stay untouched;
- `--node-modules-dir=none` — the root config sets `nodeModulesDir: "manual"`,
  which rejects npm packages not preinstalled into the repo `node_modules`;
  `none` resolves the analyzer from Deno's global cache (first run needs
  network access to registry.npmjs.org) without mutating repo state;
- `--allow-write` — used only for a fresh `$TMPDIR` directory in the
  consumer-path scanner probe and the optional `--out` file.

## Files

- `run.ts` — the five checks (authored-source parity, policy locality,
  two-CEM-path inventory, compiled-form parity, foreign-corpus expectations)
  plus the pass/fail gate and machine-readable summary;
- `oe-plugin.ts` — the ~90-statement OE provenance plugin PoC: supplies
  `@element` tagNames, TSX/doc-comment slots and CSS parts, the file-header
  description convention, kebab-cased attribute names, and compiled-form
  provenance from `__elementMetadata`/`__partProgram`. It deliberately carries
  no layer/hydrate/ssr/dsd policy — that remains in `POLICY_BY_CLASS`
  (tools/generate-ui-manifest.ts).
