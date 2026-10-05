/**
 * @openelement/ui - Generated Package Manifest
 *
 * Imports the tracked, generated manifest JSON (a reviewed package contract,
 * not a build cache). Generator: the ui manifest task; regenerate
 * with `pnpm --dir packages/ui run generate:ui-manifest`, drift gate with
 * `pnpm --dir packages/ui run ui-manifest:check` (wired into the
 * gate:release chain).
 */

import type { OpenElementPackageManifest } from '@openelement/element';
import manifestData from './generated-manifest.json' with { type: 'json' };

/** The build-time generated package manifest (declarations for every UI component). */
export const manifest: OpenElementPackageManifest = manifestData as OpenElementPackageManifest;
