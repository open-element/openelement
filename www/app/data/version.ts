// Current source line. Derived from the generated release-line module below —
// the committed projection of docs/release/release-state.json (regenerate with
// `pnpm --dir www run generate:content`) — so the site can never show two
// different "current version" claims on one screen. The derivation is
// cross-asserted by release:state-machine:check and the version-bump anchor
// audit. Prose that claims a published line must not use this constant
// directly: publish is a gated human authorization, not an automatic step.
import type { SiteLocale } from '../../site-config.ts';
import {
  PACKAGE_COUNT,
  SOURCE_LINE_PUBLISHED,
  SOURCE_VERSION,
} from './_generated-release-line.ts';

type ReleaseLocale = SiteLocale;

export const OPENELEMENT_VERSION = `v${SOURCE_VERSION}`;

/**
 * Size of the published consumer surface — the release-state `packages` array
 * length, projected through the generated release-line module. Every package
 * count in site copy derives from this value (packageCountWord /
 * packageCountPhrase / packageCountModifier): a hand-written number is a claim
 * that goes stale the moment the surface changes (the alpha.11 split added
 * protocol and compiler, and every pre-split count sentence became false).
 */
export const PUBLISHED_PACKAGE_COUNT = PACKAGE_COUNT;

/**
 * Copy spelling for a small count. Site chrome uses words, never digits or
 * hand-written numerals, so the only literal is this table.
 */
const COUNT_WORDS: Readonly<Record<ReleaseLocale, readonly string[]>> = {
  en: [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
  ],
  zh: ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'],
};

/** The count as a copy word ("six" / "六"); digits only past the table. */
export function packageCountWord(locale: ReleaseLocale, count = PUBLISHED_PACKAGE_COUNT): string {
  return COUNT_WORDS[locale][count] ?? String(count);
}

/** "six packages" / "六个包". */
export function packageCountPhrase(locale: ReleaseLocale): string {
  const word = packageCountWord(locale);
  return locale === 'zh' ? `${word}个包` : `${word} packages`;
}

/** Attributive form for noun phrases: "six-package surface" / "六包表面". */
export function packageCountModifier(locale: ReleaseLocale): string {
  const word = packageCountWord(locale);
  return locale === 'zh' ? `${word}包` : `${word}-package`;
}

// Per-package registry `latest` dist-tag truth. There is deliberately NO
// single "published version" constant: a version common to every package is
// what would justify one, and no STABLE version is (see
// COMMON_PUBLISHED_VERSION below) — the 1.0 prerelease line sits on `latest`
// for every package. Site and docs copy must present the per-package state,
// never a fabricated shared version. Keep in sync with
// docs/release/release-state.json (release:state-machine:check offline;
// release:registry-check verifies it against the live registry).
export const PUBLISHED_LATEST: Readonly<Record<string, string>> = {
  '@openelement/protocol': 'v1.0.0-alpha.12',
  '@openelement/element': 'v1.0.0-alpha.12',
  '@openelement/compiler': 'v1.0.0-alpha.12',
  '@openelement/router': 'v1.0.0-alpha.12',
  '@openelement/create': 'v1.0.0-alpha.12',
  '@openelement/ui': 'v1.0.0-alpha.12',
};

// The one `latest` dist-tag value every published package shares, or null when
// they differ. Copy that wants to name the shared line must read this instead
// of picking one package: element's `latest` stopped being the stable line when
// the 1.0 prerelease line began publishing onto `latest` (alpha.11 ruling), and
// prose that kept treating it as the stable line stated a stable 1.0 line that
// did not exist.
export const PUBLISHED_LATEST_SHARED: string | null = (() => {
  const values = new Set(Object.values(PUBLISHED_LATEST));
  return values.size === 1 ? [...values][0]! : null;
})();

// Schema v4 (#1557): packages that have never published carry no registry
// truth yet. They are named here — never given a placeholder latest — until
// the release commit that first publishes them flips their release-state
// status to "published" and moves them into PUBLISHED_LATEST. The constant
// stays as the explicit anchor release:state-machine:check requires, and the
// publish train's registry sync rewrites the list from the tracked
// release-state on every release (tools/release/registry-sync.ts).
export const UNRELEASED_PACKAGES: readonly string[] = [];

// The newest STABLE version published for every package, or null when none
// exists. It is null today: Router has no 0.43.x. release:registry-check
// computes this from the live registry and rejects any value that is absent
// from any package.
export const COMMON_PUBLISHED_VERSION: string | null = null;

// Human-readable note for the (absent) common complete version, in the page
// locale — chrome copy is finalized at SSR, never rewritten at runtime.
// The note names the shared fact (one version across the packages) instead of
// the old "no single stable version is published across the published
// packages" spelling, which read as "the packages disagree with each other"
// while every published package actually rides one prerelease version.
// The interpolation goes through an explicitly typed local and String() so
// no operand can be implicitly converted (CodeQL js/implicit-operand-
// conversion on the string|null template operands); behavior is unchanged.
export function COMMON_PUBLISHED_NOTE(locale: ReleaseLocale): string {
  const published = COMMON_PUBLISHED_VERSION;
  if (published === null) {
    return locale === 'zh'
      ? '预发布线——尚无 stable 版本；所有包共用同一版本'
      : 'prerelease line — no stable release yet; all packages share one version';
  }
  const version = String(published);
  return locale === 'zh'
    ? `${version} — 已发布到全部发布包`
    : `${version} — published for every published package`;
}

// Short label for that version in UI chrome: no number until one exists for
// every published package, so chrome never fabricates a shared line.
export const COMMON_PUBLISHED_LABEL = COMMON_PUBLISHED_VERSION === null
  ? 'none'
  : COMMON_PUBLISHED_VERSION;

// Human-readable per-package latest summary derived from PUBLISHED_LATEST.
export const REGISTRY_NOTE = Object.entries(PUBLISHED_LATEST)
  .map(([name, version]) => `${name.replace('@openelement/', '')} ${version}`)
  .join(' · ');

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
 * "Begin." note, in plain text (no markdown — this string is also substituted
 * into rendered HTML).
 *
 * Deliberately branch-free: the sentence states the versionless-install rule
 * (npm's `latest` dist-tag) and hands verification to the registry, so it
 * stays true whether or not the current source line has published yet. No
 * "current version" claim lives here to go stale, and no release-line history
 * ("the previous 0.43 line") is hardcoded beside it.
 */
export function alphaLineNote(locale: ReleaseLocale): string {
  const verify = 'npm view @openelement/create dist-tags';
  return locale === 'en'
    ? `The versionless install resolves the current 1.0 prerelease from the npm latest dist-tag — verify the exact version with ${verify}.`
    : `不带版本号的安装从 npm latest dist-tag 解析出当前 1.0 预发布——具体版本用 ${verify} 核实。`;
}

/**
 * Roadmap alpha-train publish-state (routes/roadmap.tsx timeline), derived
 * from the same release-state truth.
 *
 * Both branches carry the registry verify pointer, and the unpublished branch
 * states the tracked baseline without asserting a registry absence: the
 * tracked registry block is a snapshot (release:registry-check refreshes it),
 * so a stale block must never make the page claim "not yet on npm" — the
 * reader is sent to `npm view` instead. The route must never hand-write this
 * status beside docs/release/release-state.json (one source of truth, guarded
 * by the www check:content-data drift check).
 */
export function prereleasePublishStatus(locale: ReleaseLocale): string {
  const verify = 'npm view @openelement/create dist-tags';
  if (SOURCE_LINE_PUBLISHED) {
    return locale === 'zh'
      ? `已通过 @alpha dist-tag 发布到 npm——实况请用 ${verify} 核实`
      : `published to npm under the @alpha dist-tag — verify the live dist-tags with ${verify}`;
  }
  return locale === 'zh'
    ? `仓库基线——实况 dist-tags 请用 ${verify} 核实`
    : `repository baseline — verify the live dist-tags with ${verify}`;
}

/** Getting-started lead-in note ({{SOURCE_LINE_NOTE}} placeholder). */
export function sourceLineNote(locale: ReleaseLocale): string {
  if (SOURCE_LINE_PUBLISHED) {
    return locale === 'en'
      ? `${SOURCE_VERSION} is the current baseline for Element and Router, published to npm under the @alpha dist-tag.`
      : `${SOURCE_VERSION} 是 Element 与 Router 的当前基线，已通过 @alpha dist-tag 发布到 npm。`;
  }
  return locale === 'en'
    ? `${SOURCE_VERSION} is the repository baseline for Element and Router. The @alpha dist-tag serves the current 1.0 prerelease — verify the exact version with npm view @openelement/create dist-tags.`
    : `${SOURCE_VERSION} 是 Element 与 Router 的仓库基线。@alpha dist-tag 服务于当前 1.0 预发布——具体版本用 npm view @openelement/create dist-tags 核实。`;
}
