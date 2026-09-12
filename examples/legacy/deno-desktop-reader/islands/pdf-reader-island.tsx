import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { definePreactIsland } from '@openelement/app/preact';
import { pdfMaxWidth } from '../app/pdf-measure.ts';
import { loadSettings } from '../app/storage.ts';

interface PdfReaderProps {
  'book-id'?: string;
  src?: string;
  page?: string;
  zoom?: string;
  pages?: string;
}

interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: string): PdfLoadingTask;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
}

interface PdfDocument {
  destroy(): void;
  getPage(page: number): Promise<PdfPage>;
}

interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  getViewport(options: { scale: number }): PdfViewport;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }): PdfRenderTask;
}

interface PdfTextItem {
  str?: string;
}

interface PdfViewport {
  width: number;
  height: number;
}

interface PdfRenderTask {
  cancel(): void;
  promise: Promise<void>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cleanPdfText(value: string): string {
  return value
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ReaderPreferenceSettings {
  fontSize: number;
  lineHeight: number;
  measure: number;
  pdfMaxWidth: number;
}

function loadReaderSettings(): ReaderPreferenceSettings {
  // Defaults live in app/storage.ts (the single source of truth);
  // pdfMaxWidth is always derived from measure via app/pdf-measure.ts.
  const settings = loadSettings();
  return {
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    measure: settings.measure,
    pdfMaxWidth: pdfMaxWidth(settings.measure),
  };
}

// Lazy-load pdf.js to avoid doing reader work until the PDF route is visited.
// The worker is bundled by Vite so the desktop app works offline.

let pdfjsPromise: Promise<PdfJsModule> | null = null;
function loadPdfjs(): Promise<PdfJsModule> {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    const [mod, worker] = await Promise.all([
      import('pdfjs-dist/build/pdf.mjs'),
      import('pdfjs-dist/build/pdf.worker.mjs?url'),
    ]);
    const pdfjs = mod as PdfJsModule;
    pdfjs.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
    return pdfjs;
  })();
  return pdfjsPromise;
}

function PdfReaderIsland(props: PdfReaderProps) {
  const bookId = props['book-id'] ?? '';
  const totalPages = Math.max(1, Number(props.pages ?? 1));
  const [page, setPage] = useState(
    clamp(Number(props.page ?? 1), 1, totalPages),
  );
  const [zoom, setZoom] = useState(Number(props.zoom ?? 1) || 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [pageText, setPageText] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [settings] = useState(loadReaderSettings);
  const islandRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<PdfRenderTask | null>(null);
  const pdfDocRef = useRef<PdfDocument | null>(null);

  const src = props.src || '';

  useEffect(() => {
    setPage(clamp(Number(props.page ?? 1), 1, totalPages));
  }, [props.page, totalPages]);

  useEffect(() => {
    const nextZoom = Number(props.zoom ?? 1) || 1;
    setZoom(clamp(nextZoom, 0.5, 2.5));
  }, [props.zoom]);

  // Save progress when page/zoom changes
  useEffect(() => {
    if (!bookId) return;
    const event = new CustomEvent('reader-progress-change', {
      bubbles: true,
      composed: true,
      detail: { bookId, page, zoom },
    });
    globalThis.dispatchEvent(event);
    void fetch(`/api/books/${encodeURIComponent(bookId)}/progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page, zoom }),
    }).catch(() => {});
  }, [bookId, page, zoom]);

  // Keyboard nav
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.key === 'ArrowLeft') {
        setPage((current) => clamp(current - 1, 1, totalPages));
      }
      if (event.key === 'ArrowRight') {
        setPage((current) => clamp(current + 1, 1, totalPages));
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [totalPages]);

  useEffect(() => {
    document.documentElement.classList.toggle('reader-immersive', immersive);
    return () => document.documentElement.classList.remove('reader-immersive');
  }, [immersive]);

  function requestNote(quote = ''): void {
    globalThis.dispatchEvent(
      new CustomEvent('reader-note-request', {
        detail: { bookId, page, quote },
      }),
    );
  }

  function readSelection(): void {
    const selection = cleanPdfText(getSelection()?.toString() ?? '');
    setSelectedText(selection);
  }

  // Load PDF document once
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadPdfjs()
      .then(async (pdfjsLib) => {
        if (cancelled) return;
        try {
          const loadingTask = pdfjsLib.getDocument(src);
          const pdfDoc = await loadingTask.promise;
          if (cancelled) {
            pdfDoc.destroy();
            return;
          }
          pdfDocRef.current = pdfDoc;
          setLoading(false);
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
            setLoading(false);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(`Failed to load pdf.js: ${err instanceof Error ? err.message : String(err)}`);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch { /* ignore */ }
      }
      if (pdfDocRef.current) {
        try {
          pdfDocRef.current.destroy();
        } catch { /* ignore */ }
        pdfDocRef.current = null;
      }
    };
  }, [src]);

  // Render current page to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const pdfDoc = pdfDocRef.current;
    if (!canvas || !pdfDoc || loading) return;

    let cancelled = false;
    (async () => {
      try {
        const pdfPage = await pdfDoc.getPage(page);
        if (cancelled) return;
        // Cancel any in-flight render
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch { /* ignore */ }
        }
        const dpr = globalThis.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: zoom * dpr });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = renderTask;
        const text = await pdfPage.getTextContent().catch(() => null);
        if (!cancelled && text?.items) {
          const parts = text.items
            .map((item) => item.str ?? '')
            .filter((part: string) => part.trim().length > 0);
          setPageText(cleanPdfText(parts.join(' ')));
        }
        await renderTask.promise;
      } catch (err: unknown) {
        // RenderingCancelledException is expected when navigating quickly
        const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
        if (name !== 'RenderingCancelledException' && !cancelled) {
          console.error('[pdf-reader] render failed:', err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, zoom, loading]);

  return h('section', {
    class: `pdf-island ${immersive ? 'immersive' : ''}`,
    ref: islandRef,
    style: {
      '--reader-font-size': `${settings.fontSize}px`,
      '--reader-line-height': String(settings.lineHeight),
      '--reader-measure': `${settings.measure}ch`,
      '--reader-pdf-max-width': `${settings.pdfMaxWidth}px`,
    },
  }, [
    h(
      'style',
      null,
      `
        :host{display:block}
        :host{--pdf-toolbar-h:56px}
        .pdf-island{background:transparent;min-height:100%;display:flex;flex-direction:column}
        .pdf-island.immersive{position:fixed;inset:0;z-index:1000;background:var(--bg-reading,#faf7f0)}
        .pdf-island.immersive .pdf-canvas-area{height:calc(100vh - var(--pdf-toolbar-h));min-height:0}
        .pdf-toolbar{align-items:center;background:transparent;display:flex;gap:10px;justify-content:center;min-height:42px;padding:0 0 12px;flex-wrap:wrap}
        .pdf-toolbar button{background:var(--bg-card,#fff);border:1px solid var(--border,#ddd);border-radius:999px;color:var(--text-secondary,#444);cursor:pointer;font:500 13px/1 var(--font-sans,system-ui);min-height:34px;padding:8px 14px;transition:all 0.12s ease}
        .pdf-toolbar button:hover:not(:disabled){border-color:var(--brand,#07c160);color:var(--brand,#07c160)}
        .pdf-toolbar button:disabled{opacity:0.4;cursor:not-allowed}
        .pdf-toolbar .page-info{color:var(--text-muted,#888);font-size:13px;font-variant-numeric:tabular-nums;min-width:90px;text-align:center}
        .pdf-toolbar .zoom-info{color:var(--text-muted,#888);font-size:13px;font-variant-numeric:tabular-nums;min-width:50px;text-align:center}
        .pdf-canvas-area{background:transparent;min-height:calc(100vh - 210px);display:flex;justify-content:center;align-items:flex-start;padding:32px 24px 120px;overflow:visible;flex:1;position:relative;cursor:text}
        .pdf-canvas-area canvas{display:none}
        .reader-text-page{color:var(--text-primary,#1a1a1a);font-family:var(--font-serif,Georgia,serif);font-size:var(--reader-font-size,22px);line-height:var(--reader-line-height,1.9);max-width:min(var(--reader-pdf-max-width,720px),100%);min-height:520px;text-align:left}
        .reader-text-kicker{font-size:15px;letter-spacing:.09em;text-align:center;text-transform:uppercase;margin:0 0 18px}
        .reader-text-title{font-size:34px;font-weight:500;line-height:1.2;text-align:center;margin:0 0 42px}
        .reader-text-body{white-space:normal}
        .reader-text-body::selection{background:rgba(47,111,69,.18)}
        .selection-toolbar{align-items:center;background:var(--bg-card,#fff);border:1px solid var(--border,#ddd);border-radius:10px;box-shadow:0 12px 36px rgba(0,0,0,.13);display:flex;gap:8px;left:50%;padding:10px 14px;position:sticky;top:46%;transform:translateX(-50%);width:max-content;z-index:3}
        .selection-toolbar button{align-items:center;background:transparent;border:0;border-radius:8px;color:var(--text-secondary,#444);cursor:pointer;display:inline-flex;font:600 14px/1 var(--font-sans,system-ui);height:34px;justify-content:center;min-width:34px;padding:0 9px}
        .selection-toolbar button:hover{background:var(--bg-hover,#f0f0ed);color:var(--text-primary,#111)}
        .pdf-loading{display:flex;align-items:center;justify-content:center;min-height:60vh;color:var(--text-muted,#888);font-size:14px}
        .pdf-error{display:flex;align-items:center;justify-content:center;min-height:60vh;color:var(--error-fg,#c8392a);font-size:14px;text-align:center;padding:20px}
      `,
    ),
    h('div', { class: 'pdf-toolbar' }, [
      h('button', {
        type: 'button',
        disabled: page <= 1,
        onClick: () => setPage((p) => clamp(p - 1, 1, totalPages)),
        title: '上一页 (←)',
      }, '← 上一页'),
      h('span', { class: 'page-info' }, `第 ${page} 页 / 共 ${totalPages} 页`),
      h('button', {
        type: 'button',
        disabled: page >= totalPages,
        onClick: () => setPage((p) => clamp(p + 1, 1, totalPages)),
        title: '下一页 (→)',
      }, '下一页 →'),
      h('span', { style: 'flex:1' }),
      h('button', {
        type: 'button',
        onClick: () => setZoom((v) => Math.max(0.5, v - 0.2)),
        title: '缩小',
      }, '−'),
      h('span', { class: 'zoom-info' }, `${Math.round(zoom * 100)}%`),
      h('button', {
        type: 'button',
        onClick: () => setZoom((v) => Math.min(2.5, v + 0.2)),
        title: '放大',
      }, '+'),
      h('button', {
        type: 'button',
        onClick: () => requestNote(selectedText),
        title: '在当前页做笔记',
      }, '做笔记'),
      h('button', {
        type: 'button',
        onClick: () => setImmersive((value) => !value),
        title: immersive ? '退出全屏' : '全屏阅读',
      }, immersive ? '退出全屏' : '全屏'),
    ]),
    loading
      ? h('div', { class: 'pdf-loading' }, '加载 PDF 中…')
      : error
      ? h('div', { class: 'pdf-error' }, `加载失败：${error}`)
      : h('div', {
        class: 'pdf-canvas-area',
        onMouseUp: readSelection,
        onKeyUp: readSelection,
      }, [
        h('canvas', { ref: canvasRef }),
        h('article', { class: 'reader-text-page' }, [
          h('p', { class: 'reader-text-kicker' }, `Page ${page}`),
          h(
            'h2',
            { class: 'reader-text-title' },
            pageText.split(/[.!?]/).find((part) => part.trim().length > 12)?.trim() || 'Reading',
          ),
          h('p', { class: 'reader-text-body' }, pageText || '正在提取这一页的文字内容。'),
        ]),
        selectedText &&
        h('div', { class: 'selection-toolbar' }, [
          h('button', {
            type: 'button',
            title: '批注',
            onClick: () => requestNote(selectedText),
          }, '✎'),
          h('button', {
            type: 'button',
            title: '复制',
            onClick: () => navigator.clipboard?.writeText(selectedText),
          }, '⧉'),
        ]),
      ]),
  ]);
}

definePreactIsland('pdf-reader-island', PdfReaderIsland, { ssr: false });
