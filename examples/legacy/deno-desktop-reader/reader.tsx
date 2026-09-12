/** @jsxImportSource @openelement/element */
import { defineApp } from '@openelement/app/spa';
import { OpenElement } from '@openelement/element';
import { setRouter } from './router.ts';
import { createTopNav, installTopNavLayout, updateActiveNav } from '../lib/topnav.ts';
import { pdfMaxWidth } from './app/pdf-measure.ts';

// Register all @openelement/ui custom elements + design tokens
import '@openelement/ui';
import { openPropsRootSheet } from '@openelement/ui';

// ─── Inject design system ───────────────────────────────────

const tokenStyle = document.createElement('style');
tokenStyle.textContent = [...openPropsRootSheet.cssRules].map((r) => r.cssText)
  .join('\n');
document.head.appendChild(tokenStyle);

// Apply persisted theme before app mount to avoid flash
try {
  const stored = localStorage.getItem('reader:settings');
  if (stored) {
    const parsed = JSON.parse(stored);
    if (parsed.theme === 'dark' || parsed.theme === 'sepia') {
      document.documentElement.setAttribute('data-theme', parsed.theme);
    }
    if (parsed.fontSize) {
      document.documentElement.style.setProperty('--reader-font-size', `${parsed.fontSize}px`);
    }
    if (parsed.lineHeight) {
      document.documentElement.style.setProperty('--reader-line-height', String(parsed.lineHeight));
    }
    if (parsed.measure) {
      document.documentElement.style.setProperty('--reader-measure', `${parsed.measure}ch`);
      document.documentElement.style.setProperty(
        '--reader-pdf-max-width',
        `${pdfMaxWidth(Number(parsed.measure))}px`,
      );
    }
  }
} catch {
  // ignore
}

import './app/styles.css';

declare global {
  interface Window {
    __OPEN_READER_DESKTOP_HOST__?: boolean;
  }
  var __OPEN_READER_DESKTOP_HOST__: boolean | undefined;
}

function notifyDesktopClose(): void {
  if (!globalThis.__OPEN_READER_DESKTOP_HOST__) return;
  const payload = new Blob(['{}'], { type: 'application/json' });
  if (typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon('/api/app/close', payload);
    return;
  }
  void fetch('/api/app/close', {
    method: 'POST',
    body: payload,
    headers: { 'content-type': 'application/json' },
    keepalive: true,
  }).catch(() => {});
}

globalThis.addEventListener('pagehide', notifyDesktopClose, { once: true });

// ─── Inject styles into Shadow DOM ──────────────────────────
// Shadow DOM isolates CSS: document-level rules (styles.css) cannot
// select elements inside <reader-*> shadow roots. We register the
// design system as a global stylesheet via OpenElement.registerGlobalStyles()
// (v0.41.0 framework API). The framework automatically merges it into
// every OpenElement shadow root's adoptedStyleSheets, and broadcasts
// documentElement data-theme changes to all hosts so :host([data-theme])
// selectors stay in sync. No hand-rolled MutationObserver needed.

const SHADOW_STYLE_CSS = `
  /* Theme tokens live in app/styles.css (document-level :root/[data-theme]) and
  inherit into shadow trees; keep only non-token host layout here. */
  :host {
    display: block;
    font-family: var(--font-sans);
    color: var(--text-primary);
    font-size: var(--reader-font-size);
    line-height: var(--reader-line-height);
  }
  /* === Page shell === */
  .reader-main {
    box-sizing: border-box;
    margin: 0 auto;
    max-width: var(--reader-measure);
    padding: 40px 32px 80px;
    width: 100%;
  }

  .page-header {
    align-items: flex-end;
    display: flex;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 28px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--border);
  }
  .page-header-text h1 {
    color: var(--text-primary);
    font-family: var(--font-serif);
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.5px;
    line-height: 1.2;
    margin: 0;
  }
  .page-header-text p {
    color: var(--text-muted);
    font-size: 13px;
    margin: 8px 0 0;
  }
  .page-header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-shrink: 0;
  }

  /* === Section title === */
  .section-title {
    color: var(--text-primary);
    font-family: var(--font-serif);
    font-size: 19px;
    font-weight: 600;
    margin: 32px 0 18px;
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .section-title:first-child { margin-top: 0; }
  .section-title .count {
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 400;
  }
  .section-title .section-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }

  /* === Card === */
  .card, .reader-card, .open-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    padding: 20px 22px;
    margin-bottom: 14px;
  }
  .card-hover:hover {
    border-color: var(--border-hover);
    box-shadow: var(--shadow-md);
  }
  .card-title {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .card-title .count {
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 400;
  }

  /* === Bookshelf === */
  .source-section {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 20px 24px;
    margin: 40px 0 0;
  }
  .source-section-hint { color: var(--text-muted); font-size: 13px; margin: 8px 0 0; }
  .source-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .source-card {
    align-items: center;
    background: var(--bg-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    display: flex;
    gap: 10px;
    padding: 8px 10px 8px 14px;
    font-size: 13px;
    transition: border-color 0.12s ease;
  }
  .source-card:hover { border-color: var(--border-hover); }
  .source-card-info { display: flex; flex-direction: column; gap: 1px; }
  .source-card-info span { font-weight: 600; color: var(--text-primary); line-height: 1.3; }
  .source-card-info small { color: var(--text-muted); font-size: 12px; }
  .source-manage-button::part(control),
  .source-pick-button::part(control) {
    background: transparent;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    cursor: pointer;
    font: 600 13px/1 var(--font-sans);
    min-height: 34px;
    padding: 8px 13px;
  }
  .source-manage-button:hover::part(control),
  .source-pick-button:hover::part(control) {
    background: var(--bg-hover);
    border-color: var(--border-hover);
    color: var(--text-primary);
  }

  .book-grid {
    display: grid;
    gap: 32px 24px;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  }
  .book-card {
    background: transparent;
    border: 0;
    border-radius: var(--radius-md);
    cursor: pointer;
    min-width: 0;
    padding: 0;
    text-align: left;
    transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    display: flex;
    flex-direction: column;
    font-family: inherit;
    color: inherit;
  }
  .book-card:hover { transform: translateY(-4px); }
  .book-card:hover .book-cover-wrap { box-shadow: var(--shadow-lg); }

  .book-cover-wrap {
    border-radius: 2px 6px 6px 2px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    margin: 0 0 12px;
    overflow: hidden;
    padding-top: 140%;
    position: relative;
    transition: box-shadow 0.18s ease;
    width: 100%;
  }
  .book-cover-svg {
    position: absolute;
    top: 0; left: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .book-cover-wrap::before {
    content: '';
    position: absolute;
    top: 0; left: 0;
    width: 4px;
    height: 100%;
    background: linear-gradient(to right, rgba(0,0,0,0.18), rgba(0,0,0,0));
    z-index: 2;
    pointer-events: none;
  }

  .book-meta { padding: 0 2px; }
  .book-title {
    color: var(--text-primary);
    font-family: var(--font-serif);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
    margin: 0 0 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .book-author {
    color: var(--text-muted);
    font-size: 12px;
    margin: 0 0 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .book-summary {
    color: var(--text-muted);
    display: -webkit-box;
    font-size: 12px;
    line-height: 1.5;
    margin: 0 0 8px;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
  .book-foot {
    align-items: center;
    color: var(--text-faint);
    display: flex;
    font-size: 11px;
    gap: 8px;
    margin-top: 4px;
  }
  .book-foot .progress-pct {
    color: var(--brand);
    font-weight: 600;
  }
  .progress-block { margin: 8px 0 0; }
  .progress-bar {
    background: var(--bg-muted);
    border-radius: 999px;
    height: 3px;
    overflow: hidden;
    margin-bottom: 6px;
  }
  .progress-bar span {
    background: var(--brand);
    border-radius: 999px;
    display: block;
    height: 100%;
  }

  /* === Reading page === */
  .pdf-surface {
    background: var(--bg-reading);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }

  /* === Note panel === */
  .note-panel {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    margin-bottom: 14px;
    overflow: hidden;
  }
  .note-panel-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    background: var(--bg-muted);
  }
  .note-panel-tab {
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    padding: 12px 18px;
    transition: color 0.12s ease, border-color 0.12s ease, background 0.12s ease;
  }
  .note-panel-tab:hover { color: var(--text-primary); }
  .note-panel-tab.active {
    color: var(--brand);
    border-bottom-color: var(--brand);
    background: var(--bg-card);
  }
  .note-panel-body { padding: 18px 20px; }
  .saved-note-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 58vh;
    overflow: auto;
    padding-right: 2px;
  }
  .note-panel form label {
    color: var(--text-secondary);
    display: block;
    font-size: 11px;
    font-weight: 600;
    margin: 12px 0 5px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .note-panel form label:first-child { margin-top: 0; }
  .note-panel h2 {
    color: var(--text-primary);
    font-family: var(--font-serif);
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
  }
  .note-panel textarea {
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-sizing: border-box;
    color: var(--text-primary);
    font: 14px/1.6 var(--font-sans);
    padding: 10px 12px;
    resize: vertical;
    width: 100%;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  .note-panel textarea:focus {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--brand-ring);
    outline: none;
  }

  .note-card {
    border-top: 1px solid var(--border);
    padding: 14px 0;
  }
  .note-card:first-of-type {
    border-top: 0;
    padding-top: 0;
  }
  .note-card blockquote {
    border-left: 3px solid var(--brand);
    color: var(--text-secondary);
    font-family: var(--font-serif);
    font-size: 13px;
    font-style: italic;
    line-height: 1.6;
    margin: 0 0 8px;
    padding-left: 12px;
  }
  .note-card p {
    color: var(--text-primary);
    font-size: 14px;
    line-height: 1.6;
    margin: 0 0 6px;
  }
  .note-card small {
    color: var(--text-muted);
    font-size: 12px;
  }
  .note-card.compact {
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 12px;
  }
  .note-card-footer {
    align-items: center;
    display: flex;
    gap: 10px;
    justify-content: space-between;
    margin-top: 8px;
  }

  /* === Notes page === */
  .notes-book-section { margin-bottom: 28px; }
  .notes-book-title {
    align-items: baseline;
    color: var(--text-primary);
    display: flex;
    font-family: var(--font-serif);
    font-size: 18px;
    font-weight: 600;
    gap: 10px;
    margin: 0 0 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
  }
  .notes-book-title .count {
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 400;
  }
  .notes-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .notes-list .note-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    border-top: 1px solid var(--border);
    padding: 16px 18px;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  .notes-list .note-card:hover {
    border-color: var(--border-hover);
    box-shadow: var(--shadow-sm);
  }
  .note-meta {
    color: var(--text-muted);
    font-size: 12px;
    margin: 6px 0 10px;
  }
  .note-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .inline-form { display: inline; }
  .notes-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 24px;
  }

  /* === Search === */
  .search-box-wrapper { margin-bottom: 20px; }
  search-box-island { display: block; }
  search-box-island form { display: flex; gap: 8px; margin: 0; }
  search-box-island input {
    flex: 1;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font: 15px/1.4 var(--font-sans);
    padding: 14px 18px;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  search-box-island input:focus {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--brand-ring);
    outline: none;
  }
  search-box-island input::placeholder { color: var(--text-faint); }
  search-box-island button {
    background: var(--brand);
    border: 1px solid var(--brand);
    border-radius: 999px;
    color: var(--text-on-brand);
    cursor: pointer;
    font: 600 14px/1 var(--font-sans);
    padding: 12px 24px;
    transition: background 0.12s ease;
    white-space: nowrap;
  }
  search-box-island button:hover {
    background: var(--brand-hover);
    border-color: var(--brand-hover);
  }

  .search-results {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 16px;
  }
  .search-result {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    padding: 18px 20px;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  .search-result:hover {
    border-color: var(--brand);
    box-shadow: var(--shadow-md);
  }
  .search-result-meta {
    color: var(--text-muted);
    font-size: 12px;
    margin: 0 0 6px;
  }
  .search-result-title {
    color: var(--text-primary);
    font-family: var(--font-serif);
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 4px;
  }
  .search-result-author {
    color: var(--text-muted);
    font-family: var(--font-serif);
    font-size: 13px;
    font-style: italic;
    margin: 0 0 8px;
  }
  .search-result-snippet {
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.6;
    margin: 0;
  }
  .search-term {
    color: var(--text-muted);
    font-size: 13px;
    margin: 16px 0;
  }

  /* === Settings === */
  .settings-grid {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    margin-bottom: 14px;
  }
  .settings-section {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    padding: 22px;
  }
  .settings-section h3 {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .settings-row {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .settings-slider {
    width: 100%;
    max-width: 240px;
    accent-color: var(--brand);
  }
  .settings-value {
    color: var(--brand);
    font-weight: 600;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }
  .theme-options {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .theme-option {
    align-items: center;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 16px;
    transition: border-color 0.12s ease, background 0.12s ease;
    font-family: inherit;
    font-size: 13px;
    color: var(--text-secondary);
    min-width: 80px;
  }
  .theme-option:hover { border-color: var(--border-hover); }
  .theme-option.active {
    border-color: var(--brand);
    background: var(--brand-soft);
    color: var(--brand);
    font-weight: 600;
  }
  .theme-option-swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
  }
  .theme-option-swatch.light { background: linear-gradient(135deg, #ffffff 50%, #f6f6f4 50%); }
  .theme-option-swatch.dark { background: linear-gradient(135deg, #242424 50%, #1a1a1a 50%); }
  .theme-option-swatch.sepia { background: linear-gradient(135deg, #faf3e0 50%, #f4ecd8 50%); }

  .settings-select {
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font: 14px/1.4 var(--font-sans);
    padding: 9px 12px;
    cursor: pointer;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  .settings-select:focus {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--brand-ring);
    outline: none;
  }

  .source-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 14px;
  }
  .source-row {
    align-items: center;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    display: flex;
    font-size: 14px;
    gap: 12px;
    justify-content: space-between;
    padding: 12px 14px;
    transition: border-color 0.12s ease;
  }
  .source-row:hover { border-color: var(--border-hover); }
  .source-row strong { color: var(--text-primary); font-weight: 600; }
  .source-row small { color: var(--text-muted); display: block; font-size: 12px; margin-top: 2px; }

  .source-form {
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-md);
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    padding: 16px;
    background: var(--bg-inset);
    margin-top: 12px;
  }
  .source-form-tools {
    align-self: end;
    display: grid;
    gap: 6px;
  }
  .source-form label {
    color: var(--text-secondary);
    display: grid;
    font-size: 11px;
    font-weight: 600;
    gap: 5px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .source-form input, .source-form select {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font: 14px/1.4 var(--font-sans);
    padding: 9px 12px;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
    text-transform: none;
    letter-spacing: 0;
  }
  .source-form input:focus, .source-form select:focus {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--brand-ring);
    outline: none;
  }
  .source-submit::part(control) {
    align-self: end;
    background: var(--brand);
    border: 1px solid var(--brand);
    border-radius: var(--radius-md);
    color: var(--text-on-brand);
    cursor: pointer;
    font: 600 14px/1 var(--font-sans);
    min-height: 38px;
    padding: 10px 16px;
  }
  .source-submit:hover::part(control) {
    background: var(--brand-hover);
    border-color: var(--brand-hover);
  }
  .field-hint {
    color: var(--text-muted);
    display: block;
    font-size: 12px;
    line-height: 1.5;
    margin-top: 4px;
    text-transform: none;
    letter-spacing: 0;
  }

  /* === Inline feedback === */
  .toast-inline {
    background: var(--success-bg);
    border-radius: var(--radius-md);
    border-left: 3px solid var(--success-fg);
    color: var(--success-fg);
    font-size: 13px;
    font-weight: 500;
    margin: 0 0 16px;
    padding: 11px 16px;
    animation: toastSlide 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes toastSlide {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .form-error {
    background: var(--error-bg);
    border-radius: var(--radius-md);
    border-left: 3px solid var(--error-fg);
    color: var(--error-fg);
    font-size: 13px;
    font-weight: 500;
    margin: 0 0 16px;
    padding: 11px 16px;
  }

  /* === Empty state === */
  .empty-state {
    align-items: center;
    color: var(--text-muted);
    display: flex;
    flex-direction: column;
    font-size: 14px;
    gap: 16px;
    padding: 80px 24px;
    text-align: center;
  }
  .empty-state.compact {
    gap: 6px;
    padding: 28px 12px;
  }
  .empty-state svg { opacity: 0.35; }
  .empty-state-title {
    color: var(--text-secondary);
    font-family: var(--font-serif);
    font-size: 16px;
    font-weight: 600;
    margin: 0;
  }
  .empty-state-hint {
    color: var(--text-muted);
    font-size: 13px;
    margin: 0;
    max-width: 320px;
  }

  /* === WC interop === */
  .wc-interop-grid {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    margin-top: 8px;
  }
  .wc-interop-cell {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 18px;
    box-shadow: var(--shadow-sm);
  }
  .wc-interop-cell h3 {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    margin: 0 0 14px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }
  .wc-interop-demo {
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.6;
    margin: 8px 0 0;
    min-height: 20px;
  }
  .wc-interop-cell > open-button,
  .wc-interop-cell > open-card,
  .wc-interop-cell > open-input {
    display: block;
    margin-bottom: 8px;
  }

  /* === open-button brand alignment === */
  open-button[variant='primary'] {
    background: var(--brand) !important;
    border-color: var(--brand) !important;
    color: var(--text-on-brand) !important;
    border-radius: var(--radius-md) !important;
    font-weight: 500 !important;
    transition: background 0.12s ease !important;
  }
  open-button[variant='primary']:hover {
    background: var(--brand-hover) !important;
    border-color: var(--brand-hover) !important;
  }
  open-button[variant='ghost'] {
    background: transparent !important;
    border: 1px solid var(--border-strong) !important;
    color: var(--text-secondary) !important;
    border-radius: var(--radius-md) !important;
    transition: all 0.12s ease !important;
  }
  open-button[variant='ghost']:hover {
    background: var(--bg-hover) !important;
    border-color: var(--border-hover) !important;
    color: var(--text-primary) !important;
  }
  open-input { display: block; }
  open-input input, open-input::part(input) {
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font: 14px/1.4 var(--font-sans);
    padding: 9px 12px;
  }

  /* === Responsive (shadow) === */
  @media (max-width: 720px) {
    .reader-main { padding: 24px 16px 64px; }
    .book-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 20px 12px;
    }
    .page-header { flex-direction: column; align-items: flex-start; }
    .settings-grid { grid-template-columns: 1fr; }
  }
`;

// Register the shadow-DOM design system as a framework global stylesheet.
// v0.41.0: OpenElement handles injection into every shadow root + theme
// broadcasting. The ~50 lines of MutationObserver code this replaces are gone.
try {
  const shadowSheet = new CSSStyleSheet();
  shadowSheet.replaceSync(SHADOW_STYLE_CSS);
  OpenElement.registerGlobalStyles(shadowSheet);
} catch {
  // CSSStyleSheet constructor may not be available in older browsers
}

// Import route modules to bind their loader/action/tagName exports for the
// route table below. The @element page classes are compiled by the adapter's
// open:compiled-element transform; v0.44 compiled modules never self-register
// — in adapter-generated SSR/client entries the entry owns every
// customElements.define (packages/adapter-vite entry-orchestrator). This
// custom SPA bootstrap therefore must not rely on module side effects for
// page-element registration.
import BookshelfPage, {
  action as bookshelfAction,
  loader as bookshelfLoader,
  tagName as bookshelfTag,
} from './routes/index.tsx';
import ReadingPage, {
  loader as readingLoader,
  tagName as readingTag,
} from './routes/books/[id].tsx';
import NotesPage, {
  action as notesAction,
  loader as notesLoader,
  tagName as notesTag,
} from './routes/notes.tsx';
import SearchPage, { loader as searchLoader, tagName as searchTag } from './routes/search.tsx';
import SettingsPage, {
  action as settingsAction,
  loader as settingsLoader,
  tagName as settingsTag,
} from './routes/settings.tsx';
import WcInteropPage, { tagName as wcInteropTag } from './routes/wc-interop.tsx';

// Import islands for side effect: definePreactIsland() registers each
// island's custom element at module evaluation. This app ships its own
// index.html client entry, so no adapter-generated entry imports the islands
// — the bootstrap import is what runs that registration.
import './islands/pdf-reader-island.tsx';
import './islands/search-box-island.tsx';
import './islands/sync-status-island.tsx';

void BookshelfPage;
void ReadingPage;
void NotesPage;
void SearchPage;
void SettingsPage;
void WcInteropPage;

// ─── Route config ──────────────────────────────────────────

const routes = [
  {
    path: '/',
    loader: bookshelfLoader,
    action: bookshelfAction,
    tagName: bookshelfTag,
  },
  {
    path: '/books/:id',
    loader: readingLoader,
    tagName: readingTag,
  },
  {
    path: '/notes',
    loader: notesLoader,
    action: notesAction,
    tagName: notesTag,
  },
  {
    path: '/search',
    loader: searchLoader,
    tagName: searchTag,
  },
  {
    path: '/settings',
    loader: settingsLoader,
    action: settingsAction,
    tagName: settingsTag,
  },
  { path: '/wc-interop', tagName: wcInteropTag },
];

// ─── Top Navigation (replaces left sidebar) + boot ──────────

const app = defineApp({ mode: 'spa', routes });

installTopNavLayout(
  'reader',
  createTopNav({
    prefix: 'reader',
    brand: {
      label: 'OpenReader',
      svg:
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
      ariaLabel: 'OpenReader home',
    },
    items: [
      { path: '/', label: '书架' },
      { path: '/notes', label: '笔记' },
      { path: '/search', label: '搜索' },
      { path: '/settings', label: '设置' },
    ],
    onNavigate: (path) => app.router?.navigate(path),
  }),
);

app.mount('#root');
setRouter(app.router);

// v0.41.0: No need to manually observe #root for new reader-* elements or
// inject styles into their shadow roots. OpenElement.registerGlobalStyles()
// handles both — the framework merges global sheets in createRenderRoot() /
// connectedCallback(), and the theme observer is installed on first connect.

function updateActiveNavFromUrl() {
  updateActiveNav('reader', globalThis.location.pathname);
}
globalThis.addEventListener('popstate', updateActiveNavFromUrl);
updateActiveNavFromUrl();

globalThis.addEventListener('reader-navigate', (event: Event) => {
  const detail = (event as CustomEvent<{ path?: string }>).detail;
  if (!detail?.path) return;
  void app.router?.navigate(detail.path);
  updateActiveNav('reader', detail.path);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e: KeyboardEvent) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
    e.preventDefault();
    notifyDesktopClose();
    globalThis.close();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    app.router?.navigate('/search');
  }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') {
    e.preventDefault();
    app.router?.navigate('/settings');
  }
});
