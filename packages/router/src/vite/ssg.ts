/** Public SSG post-processing helpers intentionally supported by the Router build tooling. */
export {
  buildIslandChunkMap,
  buildSpeculationRulesJson,
  extractCustomElementTags,
  generateIslandManifests,
  injectClientScript,
  injectCspMeta,
  injectSpeculationRules,
  injectViewTransitionMeta,
  writeIslandManifests,
} from './internal/ssg/index.ts';
export type { SpeculationRulesOptions, SsgBehaviorOptions } from './internal/protocol/ssg.ts';
