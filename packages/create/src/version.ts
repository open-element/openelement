/** The published CLI version, embedded so packed npm installs are self-contained. */
export const CREATE_VERSION = '1.0.0-alpha.9';

/**
 * The Vite release pinned into the generated starter's package.json (the
 * `${v.vite}` scaffold token in the npm/pnpm starter). Embedded for the same
 * reason as CREATE_VERSION (packed npm installs are self-contained); the
 * repository's Vite-pin check (deps:vite-check in the repo tooling package) anchors this copy
 * to the canonical dev pin.
 */
export const VITE_STARTER_PIN = '8.0.16';

/**
 * The Tailwind line pinned into the generated starter's devDependencies (the
 * Tailwind-ON scaffold, #1524): both `tailwindcss` and `@tailwindcss/vite`,
 * exactly, aligned with the router's own dev pins. The 4.3.x line is the
 * preset's supported line (the v3-lts line is forbidden — packages/router
 * src/vite/preset-tailwind.ts). Embedded like the other pins so packed npm
 * installs stay self-contained; the create tests anchor this copy to the
 * router manifest the way deps:vite-check anchors VITE_STARTER_PIN.
 */
export const TAILWIND_STARTER_PIN = '4.3.3';
