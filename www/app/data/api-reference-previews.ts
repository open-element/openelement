import type { SiteLocale } from '../../site-config.ts';
import { englishExportOverrides } from './api-reference-en.ts';
import { chineseExportSummaries } from './api-reference-zh.ts';

type ExportSource = {
  name: string;
  source: { path: string };
};

/** Same-named declarations in separate modules can have different contracts. */
export function apiReferenceSourceKey(exported: ExportSource): string {
  return `${exported.source.path}#${exported.name}`;
}

const englishSentences = new Intl.Segmenter('en', { granularity: 'sentence' });
const summaryLimit = 160;

/** Full source notes are rendered independently of this quick description. */
export function apiReferencePreview(exported: ExportSource & { summary: string }, locale: SiteLocale): string {
  const key = apiReferenceSourceKey(exported);
  if (locale === 'zh') return chineseExportSummaries.get(key) ?? '';
  const authored = englishExportOverrides.get(key);
  if (authored) return authored;
  const { summary } = exported;
  if (summary.length <= summaryLimit) return summary;
  const firstSentence = englishSentences.segment(summary)[Symbol.iterator]().next().value;
  const preview = firstSentence?.segment.trim() ?? '';
  return preview.length <= summaryLimit ? preview : '';
}
