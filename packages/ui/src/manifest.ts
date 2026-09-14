/**
 * @openelement/ui - Generated Package Manifest
 *
 * Imports the tracked, generated manifest JSON (a reviewed package contract,
 * not a build cache). Generator: tools/repo/generate-ui-manifest.ts; regenerate
 * with `deno task --cwd tools/repo generate:ui-manifest`, drift gate with
 * `deno task --cwd tools/repo ui-manifest:check` (wired into gate:source).
 */

import type { OpenElementPackageManifest } from '@openelement/element';
import manifestData from './generated-manifest.json' with { type: 'json' };

/** The build-time generated package manifest (declarations for every UI component). */
export const manifest: OpenElementPackageManifest = manifestData as OpenElementPackageManifest;
