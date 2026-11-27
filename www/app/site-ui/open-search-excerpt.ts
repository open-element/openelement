/**
 * Construct search-result excerpts.
 *
 * Pagefind's own `excerpt` is a dense 30-word window: it can start mid-sentence,
 * it carries the page's build stamp and CLI snippets, and (because the indexer
 * concatenates adjacent DOM text nodes) it glues block text together —
 * "Hydrationwhen", "IslandTransformOptionsinterface". The pagefind build now
 * inserts a separator between adjacent text nodes (www/build-pagefind.ts), and
 * this module turns the result into a reader sentence:
 *
 *   - pick a sentence that sits on a real sentence boundary;
 *   - drop build stamps ("Applies to v… · repository baseline · Updated …"),
 *     bare dates and command lines;
 *   - keep enough surrounding sentence context for a hit that lands in a short
 *     heading line;
 *   - split the sentence around the matched term so the view can render a
 *     real `<mark>` instead of stripping Pagefind's tags.
 *
 * The module is deliberately dependency-free and DOM-free: the island's lazy
 * chunk imports it and the unit suite exercises it in plain Node.
 */

export interface SearchExcerpt {
  /** Whole excerpt text (before + match + after); useful for tests and titles. */
  text: string;
  before: string;
  match: string;
  after: string;
}

/** Lines that are site chrome or build provenance, never prose. */
const MACHINE_SENTENCE =
  /^(?:Applies to|适用于|Updated|更新于|repository baseline|仓库基线|@openelement\/|\$?\s*(?:cat|cd|ls|grep|pnpm|npm|npx|node|deno|git|curl|oe|export|import)\s|(?:interface|type|class|const|function|enum|let|var)\s*·\s*(?:public|internal|private))/u;

const MACHINE_FRAGMENTS: readonly RegExp[] = [
  // Full build stamp, both locales (the version may carry ZWS in the source).
  /(?:Applies to|适用于)\s+v?[\w.-]+\s*·\s*(?:repository baseline|仓库基线)\s*·\s*(?:Updated|更新于)\s*(?:\d{4}-\d{2}-\d{2}|\d{4}年\d{1,2}月\d{1,2}日)[.!?。]?/giu,
  // Stamp pieces that survive a malformed/partial stamp.
  /\bUpdated\s+\d{4}-\d{2}-\d{2}\b[.!?]?/giu,
  /\b更新于\s*\d{4}年\d{1,2}月\d{1,2}日[。]?/gu,
  /\bv?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\s*·\s*(?:repository baseline|仓库基线)\b/giu,
  /\b(?:repository baseline|仓库基线)\b/giu,
  // Release badge on the homepage.
  /\bnpm\s+prerelease\s*v?[\w.-]+\s*→?/giu,
  // Pagefind CLI examples and their output paths.
  /\b(?:cat|cd|ls|grep|pnpm|npm|npx|node|deno|git|curl|oe)\s+[^.!?。！？\n]*(?:www\/dist|\/pagefind\/)[^.!?。！？\n]*[.!?。]?/giu,
];

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
  '#39': "'",
};

/** Decode the HTML entities Pagefind writes into `raw_content`/`excerpt`. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
    const key = name.toLowerCase();
    if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16) || 0);
    if (key.startsWith('#')) return String.fromCodePoint(Number.parseInt(key.slice(1), 10) || 0);
    return NAMED_ENTITIES[key] ?? whole;
  });
}

/**
 * Pagefind's inter-node delimiter. The indexer uses U+200B between text nodes
 * when it wants an unspaced join (Chinese), so dropping it is right for zh and
 * turning it into a space is right for Latin text.
 */
export function normalizeExcerptText(value: string, locale: string): string {
  let text = decodeEntities(value)
    .replace(/\u200B/g, locale === 'zh' ? '' : ' ')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (locale === 'zh') {
    // Pagefind tokenizes zh with spaces around punctuation; the excerpt keeps
    // the prose convention (no space before/after full-width punctuation).
    text = text.replace(/([。！？；：，、])\s+/gu, '$1').replace(/\s+([。！？；：，、])/gu, '$1');
  }
  return text;
}

function stripMachineFragments(text: string): string {
  let cleaned = text;
  for (const pattern of MACHINE_FRAGMENTS) {
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, ' ');
  }
  return cleaned.replace(/\s+/gu, ' ').trim();
}

function isMachineSentence(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (!trimmed) return true;
  if (MACHINE_SENTENCE.test(trimmed)) return true;
  if (/·\s*(?:public|internal|private)\b/u.test(trimmed) && trimmed.length < 160) return true;
  if (/(?:www\/dist|\/pagefind\/)/u.test(trimmed) && trimmed.length < 200) return true;
  return false;
}

/** Code samples are not prose context: do not pull them into a sentence window. */
function isCodeLikeSentence(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (!trimmed) return true;
  if (/<[^>]+>/u.test(trimmed)) return true;
  if (
    /^(?:const|let|var|function|return|import|export|interface|type|class|enum)\b/u.test(trimmed)
  ) {
    return true;
  }
  if (/(?:=>|\{\s*[\w"'[]+\s*:|<\/|\/>)/u.test(trimmed)) return true;
  return (trimmed.match(/[{};]/gu)?.length ?? 0) > 4;
}

/** Terminal punctuation plus the quote/bracket run that may trail it. */
const TERMINAL = /[.!?。！？]+["'”’)\]】]*/gu;

/**
 * Is the punctuation match at `punctuation` really a prose sentence end?
 * A period inside `1.0`, an abbreviation (`e.g.`) or a lowercase continuation
 * is not. Chinese punctuation ends a sentence without a space.
 */
function endsSentence(text: string, punctuation: number, end: number): boolean {
  const after = text.slice(end);
  const gap = /^\s*/u.exec(after)?.[0].length ?? 0;
  const next = after.slice(gap, gap + 1);
  if (!next) return true;
  if (/[\u4e00-\u9fff]/u.test(next)) return true;
  if (gap === 0) return false;
  if (/[a-z]/u.test(next)) return false;
  const before = text.slice(Math.max(0, punctuation - 10), punctuation);
  return !/(?:^|[\s(])(?:e\.g|i\.e|vs|approx)$/iu.test(before);
}

/** Index just past the next real sentence boundary at or after `from`. */
function nextBoundaryEnd(text: string, from: number): number {
  TERMINAL.lastIndex = from;
  for (const match of text.matchAll(TERMINAL)) {
    if ((match.index ?? 0) < from) continue;
    const end = (match.index ?? 0) + match[0].length;
    if (endsSentence(text, match.index ?? 0, end)) return end;
  }
  return -1;
}

interface TextRange {
  start: number;
  end: number;
}

/** The sentence containing `index`, starting after a real boundary when one exists. */
function sentenceAt(text: string, index: number): TextRange {
  let start = 0;
  let cursor = 0;
  for (let guard = 0; guard < 10_000; guard++) {
    const end = nextBoundaryEnd(text, cursor);
    if (end === -1 || end > index) break;
    start = end;
    cursor = end;
  }
  const boundary = nextBoundaryEnd(text, index);
  let end = boundary === -1 ? text.length : boundary;
  // A code block can run for screens without terminal punctuation: cap the
  // sentence so a hit never pulls half the page into the popup.
  if (end - start > 360) end = Math.min(text.length, index + 220);
  return { start, end };
}

function nextSentence(text: string, from: number): TextRange | null {
  let start = from;
  while (start < text.length && /\s/u.test(text[start]!)) start++;
  if (start >= text.length) return null;
  const boundary = nextBoundaryEnd(text, start);
  return { start, end: boundary === -1 ? text.length : boundary };
}

function previousSentence(text: string, from: number): TextRange | null {
  if (from <= 0) return null;
  const previous = sentenceAt(text, Math.max(0, from - 2));
  return previous.start < previous.end ? previous : null;
}

/** Query words worth highlighting: 2+ chars, plus the whole CJK query. */
function queryTerms(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const terms = trimmed
    .split(/\s+/u)
    .map((term) => term.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ''))
    .filter((term) => term.length >= 2);
  if (terms.length === 0 && trimmed.length >= 2) terms.push(trimmed);
  // Longest first: a phrase hit is more informative than one of its words.
  return [...new Set(terms)].sort((left, right) => right.length - left.length);
}

interface LocatedTerm {
  index: number;
  length: number;
  sentence: TextRange;
}

/**
 * Find the first clean sentence containing a query term. Machine-looking
 * sentences are skipped (the next occurrence is tried) so a reference-page hit
 * does not read "interface · public".
 */
function locate(text: string, terms: readonly string[]): LocatedTerm | null {
  const lower = text.toLowerCase();
  let best: LocatedTerm | null = null;
  for (const term of terms) {
    const needle = term.toLowerCase();
    let from = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      const index = lower.indexOf(needle, from);
      if (index === -1) break;
      const sentence = sentenceAt(text, index);
      if (!isMachineSentence(text.slice(sentence.start, sentence.end))) {
        if (!best || index < best.index) {
          best = { index, length: term.length, sentence };
        }
        break;
      }
      from = index + needle.length;
    }
  }
  return best;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/u).length;
}

/**
 * Extend a short hit sentence with neighbours so the popup line reads like
 * prose. The excerpt still begins (and ends) on a sentence boundary.
 */
function withContext(text: string, located: LocatedTerm): TextRange {
  let { start, end } = located.sentence;
  let guard = 0;
  while (countWords(text.slice(start, end)) < 20 && guard < 3) {
    const next = nextSentence(text, end);
    if (!next) break;
    // Never step over a machine sentence: including it would reintroduce the
    // build stamp the excerpt filter just removed.
    const candidate = text.slice(next.start, next.end);
    if (isMachineSentence(candidate) || isCodeLikeSentence(candidate)) break;
    end = next.end;
    guard++;
  }
  if (countWords(text.slice(start, end)) < 12) {
    const previous = previousSentence(text, start);
    const candidate = previous ? text.slice(previous.start, previous.end) : '';
    if (previous && !isMachineSentence(candidate) && !isCodeLikeSentence(candidate)) {
      start = previous.start;
    }
  }
  return { start, end };
}

function trimTo(
  text: string,
  range: TextRange,
  marker: number,
  budget = 280,
): { range: TextRange; truncated: boolean } {
  if (range.end - range.start <= budget) return { range, truncated: false };
  const sentenceStart = range.start;
  const markerOffset = marker - sentenceStart;
  if (markerOffset <= budget - 60) {
    let end = sentenceStart + budget;
    while (end > sentenceStart && !/\s/u.test(text[end - 1]!)) end--;
    return { range: { start: sentenceStart, end }, truncated: true };
  }
  let start = Math.max(sentenceStart, marker - Math.floor(budget / 2));
  while (start < marker && !/\s/u.test(text[start]!)) start++;
  let end = Math.min(text.length, start + budget);
  while (end > marker && !/\s/u.test(text[end - 1]!)) end--;
  return { range: { start, end }, truncated: true };
}

function splitAtTerm(
  text: string,
  term: string,
  locale: string,
): { before: string; match: string; after: string } {
  if (!term) return { before: text, match: '', after: '' };
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index === -1) return { before: text, match: '', after: '' };
  let start = index;
  let end = index + term.length;
  if (locale !== 'zh') {
    // Expand to the word edges so a stem hit ("route") does not mark a prefix.
    while (start > 0 && /[\p{L}\p{N}'’-]/u.test(text[start - 1]!)) start--;
    while (end < text.length && /[\p{L}\p{N}'’-]/u.test(text[end]!)) end++;
  }
  return { before: text.slice(0, start), match: text.slice(start, end), after: text.slice(end) };
}

/** First marked phrase in a Pagefind excerpt, used when raw_content is absent. */
function markedExcerptPhrase(excerpt: string, locale: string): string {
  const match = /<mark>([\s\S]*?)<\/mark>/iu.exec(excerpt);
  if (!match) return '';
  return normalizeExcerptText(match[1]!, locale)
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
    .trim();
}

/**
 * Build the popup excerpt from Pagefind's raw page text.
 *
 * `fallbackExcerpt` (Pagefind's HTML snippet) supplies the matched phrase when
 * the fragment has no `raw_content`; both paths go through the same sentence
 * and machine-text filters.
 */
export function buildSearchExcerpt(
  raw: string,
  query: string,
  locale: string,
  fallbackExcerpt = '',
): SearchExcerpt {
  const fallbackPhrase = markedExcerptPhrase(fallbackExcerpt, locale);
  const source = raw.trim()
    ? normalizeExcerptText(raw, locale)
    : normalizeExcerptText(fallbackExcerpt.replace(/<[^>]+>/g, ' '), locale);
  const text = stripMachineFragments(source);
  if (!text) return { text: '', before: '', match: '', after: '' };

  const terms = queryTerms(query);
  if (fallbackPhrase && !terms.includes(fallbackPhrase)) terms.push(fallbackPhrase);
  let located = locate(text, terms);
  if (!located) {
    // No literal term (Pagefind may have matched a stem). Fall back to the
    // first sentence, still starting on a boundary.
    const first = sentenceAt(text, 0);
    located = { index: first.start, length: 0, sentence: first };
  }
  let range = withContext(text, located);
  const trimmed = trimTo(text, range, located.index);
  range = trimmed.range;
  let excerpt = text.slice(range.start, range.end).trim();
  if (trimmed.truncated) excerpt = `${excerpt.replace(/[.!?。！？]+["'”’)\]】]*$/u, '')}…`;
  // The mark is only meaningful if it survived the context window/trim.
  const locatedTerm = located.length
    ? text.slice(located.index, located.index + located.length)
    : '';
  // A selected sentence can begin with a code block that has no terminal
  // punctuation (the DSD example is one long `<template>` run). If the prose
  // hit sits after such a run, start at the last tag and keep the sentence.
  if (locatedTerm) {
    const markerIndex = excerpt.toLowerCase().indexOf(locatedTerm.toLowerCase());
    if (markerIndex > 80) {
      const prefix = excerpt.slice(0, markerIndex);
      if ((prefix.match(/[<>]/gu)?.length ?? 0) >= 2) {
        const cut = prefix.lastIndexOf('>');
        const candidate = cut >= 0 ? excerpt.slice(cut + 1).trimStart() : '';
        if (/^(?:[A-Z“"'(]|[\u4e00-\u9fff])/u.test(candidate)) excerpt = candidate;
      }
    }
  }
  const markTerm =
    locatedTerm && excerpt.toLowerCase().includes(locatedTerm.toLowerCase()) ? locatedTerm : '';
  const parts = splitAtTerm(excerpt, markTerm, locale);
  return { text: parts.before + parts.match + parts.after, ...parts };
}
