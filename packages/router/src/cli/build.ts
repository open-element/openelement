/**
 * @openelement/router/cli/build - CLI: Full Static Build
 *
 * ADR 0011: One-command build entry. viteBuild() triggers Phase 1,
 * and closeBundle() in open:build plugin automatically runs Phase 2/3.
 * No orchestrator needed - all three phases run in a single viteBuild() call.
 *
 * Usage:
 *   deno run -A npm:@openelement/router/cli/build
 *   deno task build
 */

import process from 'node:process';
import { formatError } from '@openelement/element';
import { buildApp } from '../vite/index.ts';

if (import.meta.main) {
  try {
    await buildApp();
    process.exit(0);
  } catch (error) {
    console.error(
      `Build failed: ${
        error instanceof Error ? error.stack ?? formatError(error) : formatError(error)
      }`,
    );
    if (error instanceof Error && error.cause) console.error('Caused by:', error.cause);
    process.exit(1);
  }
}
