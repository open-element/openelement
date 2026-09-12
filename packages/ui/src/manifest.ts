/**
 * @openelement/ui - Generated Package Manifest
 *
 * Imports the build-time generated manifest JSON. The generator lives in
 * tools/generate-ui-manifest.ts and is run via `deno task generate:ui-manifest`.
 */

import type { OpenElementPackageManifest } from '@openelement/element';
import manifestData from './generated-manifest.json' with { type: 'json' };

/** The build-time generated package manifest (declarations for every UI component). */
export const manifest: OpenElementPackageManifest = manifestData as OpenElementPackageManifest;
