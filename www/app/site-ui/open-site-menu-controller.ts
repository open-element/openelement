/**
 * Browser behaviour of the site header's mobile disclosure (open-site-menu).
 *
 * The layout owns the SSR markup (native <details>, so the panel still opens
 * without JavaScript); this controller owns everything the native element
 * lacks: Escape and outside-pointer dismissal, aria-expanded and trigger-label
 * state, and focus transfer into the first row and back to the trigger.
 *
 * State is per host in a WeakMap, matching the other www chrome controllers:
 * the island's connect/disconnect lifetime does not create a second owner for
 * a reconnected element.
 */
import {
  applyDocumentTheme,
  isSiteTheme,
  resolveSiteTheme,
  THEME_STORAGE_KEY,
  type SiteTheme,
} from '../../../packages/ui/src/theme-contract.ts';

export interface SiteMenuOptions {
  openLabel: string;
  closeLabel: string;
}

interface MenuParts {
  details: HTMLDetailsElement;
  summary: HTMLElement;
}

interface MenuState {
  cleanup: () => void;
}

const states = new WeakMap<HTMLElement, MenuState>();

/**
 * Wire the localized zh button, the package toggle's
 * mode bookkeeping, and the explicit "Match system" button that routes back to
 * the OS preference. The package toggle stays the en control; the system
 * button is rendered in both locales, so this function runs on every page even
 * when one of the other two is hidden.
 *
 * Storage keeps today's key: `light` / `dark` are explicit choices, `system`
 * (or a missing value, which is how the pre-paint script already behaves)
 * follows `prefers-color-scheme`. The pre-paint script mirrors that mode onto
 * `html[data-theme-mode]`, so the system button's pressed paint is correct
 * before hydration; this controller only keeps it true after a click and
 * follows OS changes while the mode is `system`.
 */
const wiredThemeDocs = new WeakSet<Document>();

type ThemeMode = 'system' | SiteTheme;

function readStoredTheme(doc: Document): string | null {
  try {
    return doc.defaultView?.localStorage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function storedMode(doc: Document): ThemeMode {
  const saved = readStoredTheme(doc);
  return isSiteTheme(saved) ? saved : 'system';
}

function systemTheme(doc: Document): SiteTheme {
  try {
    return resolveSiteTheme(
      null,
      !!doc.defaultView?.matchMedia?.('(prefers-color-scheme: light)')?.matches,
    );
  } catch {
    return resolveSiteTheme(null, false);
  }
}

function dispatchThemeChange(theme: SiteTheme): void {
  try {
    globalThis.dispatchEvent(
      new globalThis.CustomEvent('open:theme-change', { detail: { theme } }),
    );
  } catch {
    // The event is an integration point, not a requirement for painting.
  }
}

function wireThemeControls(doc: Document): void {
  if (wiredThemeDocs.has(doc)) return;
  wiredThemeDocs.add(doc);

  const zhButton = doc.querySelector<HTMLButtonElement>('.oe-theme-control');
  const systemButton = doc.querySelector<HTMLButtonElement>('.oe-theme-system');
  const menuToggle = doc.querySelector<HTMLButtonElement>('[data-menu-theme-toggle]');
  const menuSystem = doc.querySelector<HTMLButtonElement>('[data-menu-theme-system]');
  const themeGroup = doc.querySelector<HTMLElement>('[data-theme-group]');
  const packageToggle = doc.querySelector<HTMLElement>('open-theme-toggle');
  let painting = false;
  let toggleClicked = false;

  const paintMode = (mode: ThemeMode): void => {
    doc.documentElement.dataset.themeMode = mode;
    const followsSystem = mode === 'system' ? 'true' : 'false';
    systemButton?.setAttribute('aria-pressed', followsSystem);
    menuSystem?.setAttribute('aria-pressed', followsSystem);
    // The group name announces the active mode to assistive technology.
    // The server renders a localized label for each mode on the group,
    // and the controller selects the matching label.
    if (themeGroup) {
      const label =
        mode === 'light'
          ? themeGroup.dataset.themeLabelLight
          : mode === 'dark'
            ? themeGroup.dataset.themeLabelDark
            : themeGroup.dataset.themeLabelSystem;
      if (label) themeGroup.setAttribute('aria-label', label);
    }
  };

  const paintTheme = (theme: SiteTheme, mode: ThemeMode): void => {
    painting = true;
    applyDocumentTheme(doc.documentElement, theme);
    // The package host reflects its icon from `theme`; the zh button from
    // `data-theme`. Neither write is the document theme seam.
    packageToggle?.setAttribute('theme', theme);
    if (zhButton) zhButton.dataset.theme = theme;
    paintMode(mode);
    globalThis.queueMicrotask(() => {
      painting = false;
    });
  };

  const paintStoredMode = (): void => {
    const mode = storedMode(doc);
    paintMode(mode);
    if (zhButton)
      zhButton.dataset.theme = doc.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  };

  const toggleTheme = (): void => {
    const next: SiteTheme = doc.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    try {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be blocked; the in-page theme still changes.
    }
    paintTheme(next, next);
    dispatchThemeChange(next);
  };
  const followSystem = (): void => {
    try {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, 'system');
    } catch {
      // A blocked store still follows the OS for this page.
    }
    const theme = systemTheme(doc);
    paintTheme(theme, 'system');
    dispatchThemeChange(theme);
  };
  if (zhButton && !zhButton.hidden) zhButton.addEventListener('click', toggleTheme);
  systemButton?.addEventListener('click', followSystem);
  if (menuToggle && menuSystem) {
    menuToggle.addEventListener('click', toggleTheme);
    menuSystem.addEventListener('click', followSystem);
    menuToggle.closest('.oe-menu-appearance')?.removeAttribute('hidden');
  }

  // A user press on the package toggle is the only event that marks the mode
  // explicit: its own first hydration also dispatches `open:theme-change`, and
  // that one must not overwrite a `system` preference restored from storage.
  packageToggle?.addEventListener(
    'click',
    () => {
      toggleClicked = true;
      // The package applies the attribute through its change channel, which
      // can land a task later than the click; a short expiry keeps a real
      // press attributable without ever swallowing the initial hydration
      // event (that one happens before any press).
      globalThis.setTimeout(() => {
        toggleClicked = false;
      }, 500);
    },
    true,
  );

  const onThemeChange = (event: Event): void => {
    if (painting || !toggleClicked) return;
    const detail = (event as CustomEvent<{ theme?: unknown }>).detail;
    const theme = isSiteTheme(detail?.theme) ? detail.theme : 'dark';
    paintMode(theme);
    try {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Keep the in-page explicit mode even when persistence is unavailable.
    }
    if (zhButton) zhButton.dataset.theme = theme;
    toggleClicked = false;
  };

  const media = doc.defaultView?.matchMedia?.('(prefers-color-scheme: light)');
  const onSystemChange = (): void => {
    if (storedMode(doc) !== 'system') return;
    const theme = systemTheme(doc);
    paintTheme(theme, 'system');
    dispatchThemeChange(theme);
  };

  globalThis.addEventListener('open:theme-change', onThemeChange);
  media?.addEventListener?.('change', onSystemChange);
  paintStoredMode();
}

function menuParts(host: HTMLElement): MenuParts | null {
  // The island is rendered INSIDE the layout's <details>, so the enclosure is
  // the behaviour subject, not a child of the island.
  const details = host.closest<HTMLDetailsElement>('details');
  const summary = details?.querySelector('summary');
  if (!details || !summary) return null;
  return { details, summary };
}

function connect(host: HTMLElement, options: SiteMenuOptions): () => void {
  const parts = menuParts(host);
  if (!parts) return () => {};
  const { details, summary } = parts;
  const doc = host.ownerDocument;

  const setExpanded = (open: boolean): void => {
    summary.setAttribute('aria-expanded', open ? 'true' : 'false');
    summary.setAttribute('aria-label', open ? options.closeLabel : options.openLabel);
  };

  const closeAndReturn = (): void => {
    details.open = false;
    setExpanded(false);
    summary.focus();
  };

  const onToggle = (): void => {
    setExpanded(details.open);
    if (!details.open) return;
    // `toggle` fires before the open panel is laid out; one frame later the
    // first row is visible and focusable. Only take focus if the reader has
    // not already moved it into the panel (keyboard-opened disclosure lands
    // on the summary; a fast pointer/keyboard move to a row must win over
    // this hand-off — otherwise Enter activates the wrong link).
    globalThis.requestAnimationFrame(() => {
      const active = doc.activeElement;
      if (active instanceof Node && active !== summary && details.contains(active)) return;
      details.querySelector<HTMLElement>('a')?.focus();
    });
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !details.open) return;
    event.preventDefault();
    closeAndReturn();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!details.open) return;
    const target = event.target;
    if (target instanceof Node && details.contains(target)) return;
    // An outside press belongs to whatever was pressed: close without moving
    // focus away from it (Escape is the keyboard path that returns focus).
    details.open = false;
    setExpanded(false);
  };

  setExpanded(details.open);
  details.addEventListener('toggle', onToggle);
  doc.addEventListener('keydown', onKeydown);
  doc.addEventListener('pointerdown', onPointerDown, true);

  return () => {
    details.removeEventListener('toggle', onToggle);
    doc.removeEventListener('keydown', onKeydown);
    doc.removeEventListener('pointerdown', onPointerDown, true);
  };
}

/** Attach the disclosure behaviour to one SSR-rendered menu host. */
export function installSiteMenu(host: HTMLElement, options: SiteMenuOptions): void {
  wireThemeControls(host.ownerDocument);
  if (states.has(host)) return;
  states.set(host, { cleanup: connect(host, options) });
}

/** Detach every listener this host installed (idempotent). */
export function uninstallSiteMenu(host: HTMLElement): void {
  const state = states.get(host);
  if (!state) return;
  state.cleanup();
  states.delete(host);
}
