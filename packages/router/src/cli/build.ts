/**
 * @openelement/router/cli/build - CLI: Full Static Build
 *
 * ADR 0011: One-command build entry. viteBuild() triggers Phase 1,
 * and closeBundle() in open:build plugin automatically runs Phase 2/3.
 * No orchestrator needed - all three phases run in a single viteBuild() call.
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys --allow-ffi --no-prompt npm:@openelement/router/cli/build
 *   deno task build
 */

import { formatError } from '@openelement/element';
import { buildApp } from '../vite/index.ts';

if (import.meta.main) {
  try {
    await buildApp();
    Deno.exit(0);
  } catch (error) {
    console.error(
      `Build failed: ${
        error instanceof Error ? error.stack ?? formatError(error) : formatError(error)
      }`,
    );
    if (error instanceof Error && error.cause) console.error('Caused by:', error.cause);
    Deno.exit(1);
  }
}
