// Current source line. Derived from the generated release-line module below —
// the checked-in release state projection of docs/release/release-state.json (regenerate with
// `pnpm --dir www run generate:content`) — so the site can never show two
// different "current version" claims on one screen. The derivation is
// cross-asserted by release:state-machine:check and the version-bump anchor
// audit. Prose that claims a published line must not use this constant
// directly: publish is a gated human authorization, not an automatic step.
import type { SiteLocale } from '../../site-config.ts';
import {
  LATEST_PRERELEASE_VERSION,
  PACKAGE_COUNT,
  SOURCE_LINE_PUBLISHED,
  SOURCE_VERSION,
} from './_generated-release-line.ts';

type ReleaseLocale = SiteLocale;

export const OPENELEMENT_VERSION = `v${SOURCE_VERSION}`;

/**
 * Size of the published consumer surface projected from the release-state packages array.
 */
export const PUBLISHED_PACKAGE_COUNT = PACKAGE_COUNT;

/**
 * The prerelease version every published package serves on npm `latest`
 * (release-state `latestPrerelease`, cross-checked against the per-package
 * `latest` blocks by the generator). It is registry truth, not a publish
 * promise: a stale record fails the generation step rather than printing a
 * version npm does not serve.
 */
export const CURRENT_ALPHA_VERSION = LATEST_PRERELEASE_VERSION;

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

export {
  COMMON_PUBLISHED_VERSION,
  PUBLISHED_LATEST,
  UNRELEASED_PACKAGES,
} from './_generated-release-line.ts';

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
