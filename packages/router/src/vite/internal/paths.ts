/**
 * Shared output-path constants for the adapter build pipeline.
 *
 * Every default directory name ('dist', '.openElement') routes through these
 * constants — the pipeline carries no magic-string copies.
 */

/** Default build output directory name (relative to the app root). */
export const DEFAULT_OUT_DIR = 'dist';

/** Content-addressed stylesheet owned by the SSG view-transition postprocessor. */
export const SSG_VIEW_TRANSITION_STYLE_PREFIX = 'assets/open-view-transition-';
const SSG_VIEW_TRANSITION_STYLE_PATH = new RegExp(
  `^${SSG_VIEW_TRANSITION_STYLE_PREFIX}([a-f0-9]{12})\\.css$`,
);

export function ssgViewTransitionStyleHash(path: string): string | undefined {
  return SSG_VIEW_TRANSITION_STYLE_PATH.exec(path)?.[1];
}

/** The public deployment snapshot is a sibling of the build workspace. */
export function publicOutputDir(outDir: string): string {
  return `${outDir.replace(/[\\/]+$/, '')}-public`;
}

/** openElement metadata directory name (build artifacts). */
export const OPEN_ELEMENT_DIR = '.openElement';

/**
 * Chunk size warning limit (kB) for the generated bundles. The generated
 * virtual entries intentionally contain the whole route graph, so the
 * budget is explicit and shared by Phase 1 config, Phase 2 client build,
 * and the Phase 3 SSR bundle (#847).
 */
export const CHUNK_SIZE_WARNING_LIMIT_KB = 1500;

/** Default app directory names, filled in when options omit them (#847). */
export const DEFAULT_ROUTES_DIR = 'app/routes';
export const DEFAULT_ISLANDS_DIR = 'app/islands';
export const DEFAULT_COMPONENTS_DIR = 'app/components';
/** Default generated-content data directory (nav/blog/i18n plugins). */
export const DEFAULT_DATA_DIR = 'app/data';
