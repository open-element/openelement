import { openElement } from '@openelement/router/vite';
import { defineConfig } from 'vite';

/**
 * M11-3 executor-free entry proof fixture: the app's whole client graph is one
 * generated-element page island (no class page/island, no form enhancement), so
 * the generated client entry must not request the legacy compiled executor
 * runtime. Built from `tests/fixtures/router-request-time` so workspace package
 * resolution comes from the parent fixture's node_modules.
 */
export default defineConfig({ base: '/', plugins: [openElement()] });
