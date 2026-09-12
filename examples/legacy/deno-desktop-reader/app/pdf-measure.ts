/**
 * Derives the PDF text-page max width (px) from the measure (characters)
 * reader setting. Shared by the client bootstrap, the settings page, and the
 * PDF island so the formula cannot drift.
 */
export function pdfMaxWidth(measure: number): number {
  return Math.max(720, measure * 14);
}
