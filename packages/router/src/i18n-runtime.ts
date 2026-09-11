/** Runtime-safe i18n options and locale utilities. */
export interface OpenElementI18nOptions {
  locales: string[];
  defaultLocale: string;
}

export function loadI18nData(options: OpenElementI18nOptions): OpenElementI18nOptions {
  return { ...options, locales: [...options.locales] };
}

export type { LocalePath } from './internal/router/i18n.ts';
export { normalizeLocalePath } from './internal/router/i18n.ts';
