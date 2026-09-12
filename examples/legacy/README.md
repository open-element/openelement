# Legacy examples (frozen at 0.44)

这两个应用依赖 `@openelement/app/preact`、`@openelement/app/spa` 与裸 `preact`，
这些 API 已在 `ec80f9c5` 从框架中移除（改用 DSD / pure-island 模型）。
**它们当前不可构建，且被排除在 lint / fmt / test / CI 门禁之外。**

保留原因：作为 1.0 稳定后建立 L3 独立仓的重写起点，同时保留 Git 历史可达性。

- `deno-desktop-reader/` — 早期 desktop reader 参考应用
- `deno-desktop-mastodon/` — 早期 Mastodon 桌面客户端参考应用
- `lib/` — 上面两个应用的共享库（`client-router.ts` / `server-utils.ts` / `topnav.ts`），
  在 0.44 线仅被这两个应用引用，故随之下沉，保持冻结集自包含

重写时不得沿用相对路径直连框架源码，必须消费已发布产物（`npm:` / `jsr:`）。
