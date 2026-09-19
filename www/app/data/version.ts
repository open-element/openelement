// Current source line. The npm registry line may lag (publish is a gated
// human authorization, not an automatic step); prose that claims a published
// line must not use this constant directly.
export const OPENELEMENT_VERSION = 'v1.0.0-alpha.1';

// Per-package registry `latest` dist-tag truth. There is deliberately NO
// single "published version" constant: @openelement/router has never shipped
// the 0.43.x stable line, so no one version covers all four packages. Site and
// docs copy must present the per-package state, never a fabricated shared
// version. Keep in sync with docs/release/release-state.json
// (release:state-machine:check offline; release:registry-check verifies it
// against the live registry).
export const PUBLISHED_LATEST: Readonly<Record<string, string>> = {
  '@openelement/element': 'v0.43.3',
  '@openelement/create': 'v0.43.3',
  '@openelement/ui': 'v0.43.3',
  '@openelement/router': 'v0.41.0-alpha.6',
};

// The newest STABLE version published for every package, or null when none
// exists. It is null today: Router has no 0.43.x. release:registry-check
// computes this from the live registry and rejects any value that is absent
// from any package.
export const COMMON_PUBLISHED_VERSION: string | null = null;

// Human-readable note for the (absent) common complete version, in the page
// locale — chrome copy is finalized at SSR, never rewritten at runtime.
// The interpolation goes through an explicitly typed local and String() so
// no operand can be implicitly converted (CodeQL js/implicit-operand-
// conversion on the string|null template operands); behavior is unchanged.
export function COMMON_PUBLISHED_NOTE(locale: ReleaseLocale): string {
  const published = COMMON_PUBLISHED_VERSION;
  if (published === null) {
    return locale === 'zh'
      ? '四个包尚无统一已发布的稳定版本'
      : 'no single stable version is published for all four packages';
  }
  const version = String(published);
  return locale === 'zh'
    ? `${version} — 已发布到全部四个包`
    : `${version} — published for all four packages`;
}

// Short label for that version in UI chrome: no number until one exists for
// all four packages, so chrome never fabricates a shared line.
export const COMMON_PUBLISHED_LABEL = COMMON_PUBLISHED_VERSION === null
  ? 'none'
  : COMMON_PUBLISHED_VERSION;

// Human-readable per-package latest summary derived from PUBLISHED_LATEST.
export const REGISTRY_NOTE = Object.entries(PUBLISHED_LATEST)
  .map(([name, version]) => `${name.replace('@openelement/', '')} ${version}`)
  .join(' · ');

// The newest prerelease train. It was a PARTIAL publish: element/create/ui
// published at this version, Router never did. Registry-line copy must use
// this constant with the missing-package fact, never as a four-package line.
export const LATEST_PRERELEASE_VERSION = 'v0.44.0-beta.2.2';

// Per-package registry truth at LATEST_PRERELEASE_VERSION. `null` means the
// package was never published at that version. Keep in sync with
// docs/release/release-state.json (checked by release:state-machine:check).
export const PUBLISHED_PACKAGE_VERSIONS: Readonly<Record<string, string | null>> = {
  '@openelement/element': 'v0.44.0-beta.2.2',
  '@openelement/router': null,
  '@openelement/create': 'v0.44.0-beta.2.2',
  '@openelement/ui': 'v0.44.0-beta.2.2',
};

// ---------------------------------------------------------------------------
// Source-line wording, derived from release-state truth (generated module).
// When the release train publishes the source line to @alpha for every
// package, SOURCE_LINE_PUBLISHED flips and every consumer below rewrites
// itself on the next site:build — no manual wording sweep.
import {
  ALPHA_RESOLVES_TO,
  SOURCE_LINE_PUBLISHED,
  SOURCE_VERSION,
} from './_generated-release-line.ts';

type ReleaseLocale = 'en' | 'zh';

/** Docs-page stamp: "vX · repository baseline" until publish, then plain. */
export function sourceLineStamp(locale: ReleaseLocale): string {
  if (SOURCE_LINE_PUBLISHED) return `v${SOURCE_VERSION}`;
  return locale === 'en'
    ? `v${SOURCE_VERSION} · repository baseline`
    : `v${SOURCE_VERSION} · 仓库基线`;
}

/** "Applies to …" label injected for {{OPENELEMENT_VERSION}} in content. */
export function sourceLineAppliesLabel(locale: ReleaseLocale): string {
  if (SOURCE_LINE_PUBLISHED) return `v${SOURCE_VERSION}`;
  return locale === 'en'
    ? `the v${SOURCE_VERSION} repository baseline`
    : `v${SOURCE_VERSION} 仓库基线`;
}

/**
 * One-sentence install-command caveat for getting-started and the home
 * "Begin." note: what @alpha resolves to today, in plain text (no markdown —
 * this string is also substituted into rendered HTML).
 */
export function alphaLineNote(locale: ReleaseLocale): string {
  if (SOURCE_LINE_PUBLISHED) {
    return locale === 'en'
      ? `The @alpha dist-tag resolves to ${SOURCE_VERSION} — the current baseline.`
      : `@alpha dist-tag 解析到 ${SOURCE_VERSION}——即当前基线。`;
  }
  return locale === 'en'
    ? `The @alpha dist-tag currently resolves to ${ALPHA_RESOLVES_TO} (the previous 0.43 line); ${SOURCE_VERSION} is the repository baseline, not yet on npm.`
    : `@alpha dist-tag 当前解析到 ${ALPHA_RESOLVES_TO}（此前的 0.43 线）；${SOURCE_VERSION} 是仓库基线，尚未发布到 npm。`;
}

/** Getting-started lead-in note ({{SOURCE_LINE_NOTE}} placeholder). */
export function sourceLineNote(locale: ReleaseLocale): string {
  if (SOURCE_LINE_PUBLISHED) {
    return locale === 'en'
      ? `${SOURCE_VERSION} is the current baseline for Element and Router, published to npm under the @alpha dist-tag.`
      : `${SOURCE_VERSION} 是 Element 与 Router 的当前基线，已通过 @alpha dist-tag 发布到 npm。`;
  }
  return locale === 'en'
    ? `${SOURCE_VERSION} is the repository baseline for Element and Router and is not yet published to npm. The @alpha dist-tag currently resolves to ${ALPHA_RESOLVES_TO} — the previous 0.43 line with the retired functional authoring model.`
    : `${SOURCE_VERSION} 是 Element 与 Router 的仓库基线，尚未发布到 npm。@alpha dist-tag 当前解析到 ${ALPHA_RESOLVES_TO}——即旧的 0.43 线，采用已退役的函数式创作模型。`;
}
