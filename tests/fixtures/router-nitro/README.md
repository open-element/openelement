# router-nitro

**Nitro host qualification** proof. Builds this fixture with real Nitro presets
(`node-server` and `cloudflare_module`) and smokes the generated output: route
behavior, island/client-only asset delivery, public assets, and the host-level
Nitro cache route rule. The fixture consumes workspace SOURCE artifacts
(packages/router tooling invoked from this repository checkout), never a
published release.

The `/stream` probe checks Web `ReadableStream` passthrough, headers/cookie,
shell/frame order, and no-JS tail. Framework-generated handler semantics are
tested separately in Router tests. The Workers proof imports the built
`cloudflare_module` output and calls `fetch` under Deno with a simulated
`env`/`context`; it is **not** a Cloudflare simulator or a real deployment.

```bash
deno task --cwd tests/fixtures/router-nitro proof:node
deno task --cwd tests/fixtures/router-nitro proof:workers
```

`deno.lock` is generated from the real build (not a source entrypoint) — see
`tests/fixtures/README.md`.
