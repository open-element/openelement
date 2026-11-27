/** Locate a visible export without walking the full list on every scroll. */
function rowAt(rows: HTMLCollection, y: number): number {
  let start = 0;
  let end = rows.length - 1;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (rows[middle]!.getBoundingClientRect().bottom <= y) start = middle + 1;
    else end = middle;
  }
  return start;
}

/** Page-local navigation over the published registry's existing row anchors. */
export function connectRegistryLookup(host: HTMLElement, signal: AbortSignal): void {
  const page = host.closest<HTMLElement>('[data-registry]');
  const form = host.querySelector('form');
  const input = form?.querySelector('input');
  const status = form?.querySelector('[role=status]');
  const results = form?.querySelector('ul');
  const paging = form?.querySelector<HTMLElement>('[data-lookup-pages]');
  const prev = paging?.querySelector<HTMLButtonElement>('[data-lookup-prev]');
  const next = paging?.querySelector<HTMLButtonElement>('[data-lookup-next]');
  if (!page || !form || !input || !status || !results || !paging || !prev || !next) return;

  const document = host.ownerDocument;
  const locale = document.documentElement.lang === 'zh' ? 'zh' : 'en';
  const exact = page.dataset.registry === 'errors';
  const scope = exact ? null : document.createElement('select');
  const groups = page.querySelectorAll<HTMLElement>('[data-ref-package]');
  if (scope) {
    const field = document.createElement('div');
    field.className = 'mt-3 flex flex-wrap items-center gap-x-3 gap-y-1';
    const label = document.createElement('label');
    label.className = 'text-sm font-semibold text-foreground';
    label.htmlFor = scope.id = 'registry-package';
    label.textContent = locale === 'zh' ? '包' : 'Package';
    scope.className =
      'min-h-11 max-w-full rounded-md border border-border bg-background px-3 text-base text-foreground';
    const packageNames = ['', ...Array.from(groups, (group) => group.dataset.refPackage ?? '')];
    for (const name of packageNames) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name || (locale === 'zh' ? '所有包' : 'All packages');
      scope.add(option);
    }
    field.append(label, scope);
    form.querySelector('#registry-query-hint')?.before(field);
    signal.addEventListener(
      'abort',
      () => {
        field.remove();
        input.required = true;
      },
      { once: true },
    );
  }
  const rows = [...page.querySelectorAll<HTMLElement>('[data-lookup-label]')].map((element) => ({
    element,
    label: element.dataset.lookupLabel ?? '',
    context: element.querySelector('.ref-container')?.textContent?.trim() ?? '',
    package: element.closest<HTMLElement>('[data-ref-package]')?.dataset.refPackage,
  }));
  const codes = exact ? new Map(rows.map((row) => [row.label.toLowerCase(), row])) : null;
  const pageSize = 8;
  prev.textContent = locale === 'zh' ? '上一页' : 'Previous results';
  next.textContent = locale === 'zh' ? '下一页' : 'Next results';
  let matches: typeof rows = [];
  let offset = 0;

  const renderMatches = () => {
    results.replaceChildren();
    const shown = matches.slice(offset, offset + pageSize);
    paging.hidden = matches.length <= pageSize;
    prev.disabled = offset === 0;
    next.disabled = offset + pageSize >= matches.length;
    if (!shown.length) return;

    status.textContent = !paging.hidden
      ? locale === 'zh'
        ? `共 ${matches.length} 项，当前显示第 ${offset + 1}–${offset + shown.length} 项。`
        : `Showing ${offset + 1}–${offset + shown.length} of ${matches.length} matches.`
      : codes && matches.length > 1
        ? locale === 'zh'
          ? `找到 ${matches.length} 个错误码，请选择要查看的错误码。`
          : `Found ${matches.length} codes. Choose one to open its record.`
        : locale === 'zh'
          ? `${matches.length} 项匹配。`
          : `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}.`;
    for (const row of shown) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'block py-2 wrap-anywhere text-sm text-primary underline underline-offset-4';
      link.href = `#${encodeURIComponent(row.element.id)}`;
      link.textContent = row.context ? `${row.label} · ${row.context}` : row.label;
      item.append(link);
      results.append(item);
    }
  };

  const update = () => {
    const inputText = input.value.trim();
    const query = inputText.toLowerCase();
    const packageName = scope?.value;
    matches = [];
    offset = 0;
    status.textContent = '';

    if (query && codes) {
      // Bare registry names such as UNKNOWN can also occur in ordinary prose.
      // Accept them as exact queries or bracketed codes. In log text, scan
      // only the diagnostic and runtime code namespaces.
      const tokens = new Set([query]);
      for (const match of inputText.matchAll(
        /\[\s*([a-z0-9_$]+)\s*\]|(?<![a-z0-9_$])(oec\d{4}|(?:oe|open_element)_[a-z0-9_]+|(SSR_RENDER_ERROR|BOUNDARY_CAUGHT))(?![a-z0-9_$])/gi,
      )) {
        const token = match[1] ?? match[2];
        const legacy = match[3];
        if (token && (!legacy || legacy === legacy.toUpperCase())) tokens.add(token.toLowerCase());
      }
      for (const token of tokens) {
        const row = codes.get(token);
        if (row) matches.push(row);
      }
    } else if (query || packageName) {
      const terms = query.split(/\s+/);
      matches = rows
        .filter((row) => !packageName || row.package === packageName)
        .map((row) => {
          const name = row.label.toLowerCase();
          const context = row.context.toLowerCase();
          let rank = 0;
          if (name === query) rank = 3;
          else if (name.startsWith(query)) rank = 2;
          else if (terms.every((term) => name.includes(term) || context.includes(term))) rank = 1;
          return { row, rank };
        })
        .filter(({ rank }) => rank > 0)
        .sort((a, b) => b.rank - a.rank)
        .map(({ row }) => row);
    }
    renderMatches();
    if ((query || packageName) && matches.length === 0) {
      status.textContent = exact
        ? locale === 'zh'
          ? '未找到该错误码。请粘贴包含完整错误码的原始消息，或查看下方的诊断指南。'
          : 'No code found. Paste the original message with its full code, or use the diagnostics guide below.'
        : locale === 'zh'
          ? '未找到导出项。请尝试更短的名称，或选择“所有包”扩大范围。'
          : 'No exports match. Try a shorter name or choose All packages.';
    }
  };

  const showRow = (row: HTMLElement) => {
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'start', inline: 'nearest' });
  };

  input.addEventListener('input', update, { signal });
  scope?.addEventListener(
    'change',
    () => {
      input.required = !scope.value;
      update();
    },
    { signal },
  );
  const showResults = () => {
    form.scrollIntoView({ block: 'start' });
    results.querySelector('a')?.focus({ preventScroll: true });
  };
  for (const [button, direction] of [
    [prev, -1],
    [next, 1],
  ] as const) {
    button.addEventListener(
      'click',
      () => {
        offset += direction * pageSize;
        renderMatches();
        showResults();
      },
      { signal },
    );
  }
  if (codes) {
    input.addEventListener(
      'paste',
      (event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (!text || !/[\r\n]/.test(text)) return;
        // A single-line search input removes line breaks, joining adjacent codes.
        event.preventDefault();
        input.setRangeText(
          text.replace(/[\r\n]+/g, ' '),
          input.selectionStart ?? input.value.length,
          input.selectionEnd ?? input.value.length,
          'end',
        );
        update();
      },
      { signal },
    );
  }
  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      update();
      const first = results.querySelector('a');
      if (!first) return;
      if (matches.length === 1) {
        first.click();
      } else {
        showResults();
      }
    },
    { signal },
  );
  results.addEventListener(
    'click',
    (event) => {
      const link = (event.target as Element | null)?.closest('a');
      if (
        !link ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const row = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      if (!row) return;
      event.preventDefault();
      if (document.defaultView?.location.hash !== link.hash) {
        document.defaultView?.history.pushState(null, '', link.hash);
      }
      showRow(row);
    },
    { signal },
  );

  if (!exact) {
    const paneSizes = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        const pane = (target as HTMLElement).closest<HTMLElement>('.ref-group-scroll');
        if (pane) syncContinuation(pane);
      }
    });
    const syncContinuation = (pane: HTMLElement) => {
      const controls = pane.nextElementSibling;
      const browse = pane.previousElementSibling;
      const button = controls?.querySelector<HTMLButtonElement>('[data-ref-continue]');
      const position = controls?.querySelector('[data-ref-position]');
      const exports = pane.firstElementChild?.children;
      if (
        !(controls instanceof HTMLElement) ||
        !(browse instanceof HTMLButtonElement) ||
        !button ||
        !position ||
        !exports?.length
      )
        return;
      const range = pane.scrollHeight - pane.clientHeight;
      controls.hidden = browse.getAttribute('aria-pressed') === 'true';
      browse.hidden = range <= 1 && !controls.hidden;
      if (controls.hidden) return;
      button.hidden = range <= 1;
      button.textContent =
        pane.scrollTop >= range - 1
          ? (button.dataset.refTop ?? '')
          : (button.dataset.refMore ?? '');
      const bounds = pane.getBoundingClientRect();
      const start = rowAt(exports, bounds.top) + 1;
      const end = rowAt(exports, bounds.bottom - 1) + 1;
      const visible = start === end ? start : `${start}–${end}`;
      position.textContent =
        locale === 'zh'
          ? `第 ${visible} 项，共 ${exports.length} 项`
          : `${visible} of ${exports.length} exports`;
    };
    for (const pane of page.querySelectorAll<HTMLElement>('.ref-group-scroll')) {
      const controls = pane.nextElementSibling;
      const browse = pane.previousElementSibling;
      const button = controls?.querySelector<HTMLButtonElement>('[data-ref-continue]');
      if (!(browse instanceof HTMLButtonElement) || !button) continue;
      paneSizes.observe(pane);
      if (pane.firstElementChild) paneSizes.observe(pane.firstElementChild);
      pane.addEventListener('scroll', () => syncContinuation(pane), { passive: true, signal });
      syncContinuation(pane);
      let compactScroll = 0;
      browse.addEventListener(
        'click',
        () => {
          const expanded = browse.getAttribute('aria-pressed') === 'true';
          if (!expanded) compactScroll = pane.scrollTop;
          browse.setAttribute('aria-pressed', String(!expanded));
          if (expanded) {
            pane.scrollTop = compactScroll;
            browse.scrollIntoView({ block: 'nearest' });
          }
          syncContinuation(pane);
        },
        { signal },
      );
      button.addEventListener(
        'click',
        () => {
          const range = pane.scrollHeight - pane.clientHeight;
          const next = pane.scrollTop >= range - 1 ? 0 : pane.scrollTop + pane.clientHeight * 0.8;
          pane.scrollTo({ top: next });
          syncContinuation(pane);
        },
        { signal },
      );
    }
    signal.addEventListener('abort', () => paneSizes.disconnect(), { once: true });

    // On a hydrated page Arrow Up/Down selects the row. Keep each row's
    // optional notes out of the general Tab sequence until that row is selected.
    const noteToggles = page.querySelectorAll<HTMLElement>('.ref-detail-toggle');
    for (const toggle of noteToggles) toggle.tabIndex = -1;
    signal.addEventListener(
      'abort',
      () => {
        for (const toggle of noteToggles) toggle.removeAttribute('tabindex');
      },
      { once: true },
    );
    let noteToggle: HTMLElement | null = null;
    let signature: HTMLElement | null = null;
    let lastRow: HTMLElement | null = null;
    const enableRowControls = (row: HTMLElement | null) => {
      const next = row?.querySelector<HTMLElement>('.ref-sig') ?? null;
      if (next === signature) return;
      if (noteToggle) noteToggle.tabIndex = -1;
      noteToggle = row?.querySelector<HTMLElement>('.ref-detail-toggle') ?? null;
      if (noteToggle) noteToggle.removeAttribute('tabindex');
      if (signature) {
        signature.tabIndex = -1;
        signature.removeAttribute('data-sig-active');
        signature.removeAttribute('role');
        signature.removeAttribute('aria-label');
      }
      signature = next;
      if (!next) return;
      next.setAttribute('data-sig-active', '');
      if (next.scrollWidth <= next.clientWidth) return;
      next.tabIndex = 0;
      next.setAttribute('role', 'region');
      next.setAttribute('aria-label', next.dataset.sigLabel ?? '');
    };
    page.addEventListener(
      'focusin',
      (event) => {
        const target = event.target as HTMLElement;
        const row = target.closest<HTMLElement>('.ref-row');
        if (row) lastRow = row;
        enableRowControls(row);
      },
      { signal },
    );
    const initialRow = document.activeElement?.closest<HTMLElement>('.ref-row');
    if (initialRow && page.contains(initialRow)) {
      lastRow = initialRow;
      enableRowControls(initialRow);
    }
    page.addEventListener(
      'keydown',
      (event) => {
        const target = event.target as HTMLElement;
        const { key } = event;
        if (
          signature &&
          target === signature &&
          (key === 'ArrowLeft' || key === 'ArrowRight') &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          // WebKit does not scroll a focused code block with the arrow keys.
          event.preventDefault();
          signature.scrollBy({ left: key === 'ArrowRight' ? 40 : -40, behavior: 'instant' });
          return;
        }
        const group = target.closest<HTMLElement>('.ref-group-scroll');
        const row = target.closest<HTMLElement>('.ref-row');
        if (!group) return;
        const browse = group.previousElementSibling;
        const expanded = browse?.getAttribute('aria-pressed') === 'true';
        if (target === group && !expanded && (key === 'PageDown' || key === 'PageUp')) {
          event.preventDefault();
          const direction = key === 'PageDown' ? 1 : -1;
          lastRow = null;
          group.scrollBy({ top: group.clientHeight * 0.9 * direction, behavior: 'instant' });
          return;
        }
        if (key === 'Escape' && row) {
          event.preventDefault();
          group.focus({ preventScroll: true });
        }
        if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
        if (target !== group && target !== row) return;
        const exports = group.firstElementChild?.children;
        if (!exports?.length) return;
        const down = key === 'ArrowDown';
        const bounds = group.getBoundingClientRect();
        const siteHeaderBottom =
          document.querySelector('.oe-site-header')?.getBoundingClientRect().bottom ?? 0;
        const headerBottom = expanded
          ? Math.max(siteHeaderBottom, browse.getBoundingClientRect().bottom)
          : siteHeaderBottom;
        const top = Math.max(bounds.top, headerBottom);
        const bottom = Math.min(bounds.bottom, document.documentElement.clientHeight);
        const isVisible = (candidate: Element) => {
          const rect = candidate.getBoundingClientRect();
          return rect.bottom > top && rect.top < bottom;
        };
        const selected = lastRow && group.contains(lastRow) && isVisible(lastRow) ? lastRow : null;
        let nextRow = row
          ? down
            ? row.nextElementSibling
            : row.previousElementSibling
          : (selected ?? exports[rowAt(exports, down ? top : bottom - 1)]);
        if (!row && !selected && nextRow) {
          const name = nextRow.querySelector('.ref-name')?.getBoundingClientRect();
          const later = nextRow.nextElementSibling;
          const laterName = later?.querySelector('.ref-name')?.getBoundingClientRect();
          // The pane can start behind the sticky header. Skip a clipped title
          // only when the next title fits the visible band.
          if (
            name &&
            name.top < top &&
            laterName &&
            laterName.top >= top &&
            laterName.bottom <= bottom
          ) {
            nextRow = later;
          }
        }
        if (nextRow instanceof HTMLElement) {
          event.preventDefault();
          nextRow.focus({ preventScroll: true });
          const name = nextRow.querySelector('.ref-name');
          if (!name) return;
          const pane = group.getBoundingClientRect();
          const nameBounds = name.getBoundingClientRect();
          const abovePane = nameBounds.top - pane.top;
          const paneShift =
            abovePane < 0 ? abovePane : Math.max(0, nameBounds.bottom - pane.bottom);
          if (paneShift) group.scrollBy({ top: paneShift, behavior: 'instant' });
          // Reveal the focused name past the sticky header or viewport edge
          // without shifting a title that is already inside the pane.
          const visibleName = name.getBoundingClientRect();
          const aboveViewport = visibleName.top - headerBottom;
          const belowViewport = visibleName.bottom - document.documentElement.clientHeight;
          const pageShift =
            aboveViewport < 0 ? aboveViewport - 4 : belowViewport > 0 ? belowViewport + 4 : 0;
          if (pageShift) {
            document.defaultView?.scrollBy({ top: pageShift, behavior: 'instant' });
          }
        }
      },
      { signal },
    );
  }
  update();
  form.hidden = false;
  // Restore static claim seeds before a disconnected island can reconnect.
  signal.addEventListener(
    'abort',
    () => {
      form.hidden = true;
      paging.hidden = true;
      status.replaceChildren();
      results.replaceChildren();
      for (const button of [prev, next]) {
        button.disabled = false;
        button.replaceChildren();
      }
    },
    { once: true },
  );
}
