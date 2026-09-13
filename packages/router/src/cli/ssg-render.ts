/**
 * SSG render evidence wiring for the Router build CLI.
 *
 * build-ssg.ts delegates page rendering to the adapter-agnostic
 * internal/ssg pipeline and supplies the tooling-specific evidence
 * (build-manifest printing) through this hook.
 */

import type { SsgRenderEvidence } from '../vite/internal/protocol/ssg.ts';
import { printBuildManifest } from '../vite/build-manifest.ts';
import type { OpenElementBuildContext } from '../vite/build-context.ts';

export function createSsgRenderEvidence(
  ctx?: OpenElementBuildContext,
): SsgRenderEvidence {
  if (!ctx) return {};

  return {
    i18nOptions: ctx.plugins.i18nOptions,
    admissionDecisions: ctx.phase1.ssrAdmissionPlan?.decisions || [],
    onPrintBuildManifest: (input) => {
      printBuildManifest(input);
    },
  };
}
