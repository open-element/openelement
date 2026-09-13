/**
 * @openelement/router - Shared development-mode detection (#743).
 *
 * Recognizes both build signals so browser bundles (Vite) and server
 * runtimes (Deno) agree on what "development" means:
 * - Vite browser bundles: `import.meta.env.DEV === true`
 * - Deno runtime: `DENO_ENV !== 'production'`
 *
 * Previously spa.ts probed only the Vite signal and data-context-store.ts
 * only the Deno signal, so the two halves of the runtime could disagree.
 */

interface ImportMetaWithEnvironment extends ImportMeta {
  env?: { DEV?: boolean };
}

export function isDevMode(): boolean {
  if ((import.meta as ImportMetaWithEnvironment).env?.DEV === true) return true;
  try {
    const deno = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno;
    if (deno && typeof deno.env?.get === 'function') {
      return deno.env.get('DENO_ENV') !== 'production';
    }
  } catch (e) {
    /* anomaly only: Workers hit the `undefined Deno` branch above and never reach here */
    console.warn('[dev-mode] Unexpected error reading DENO_ENV, defaulting to non-dev mode', e);
  }
  return false;
}
