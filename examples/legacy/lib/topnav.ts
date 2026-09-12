/**
 * Shared top navigation and SPA boot layout helpers for the desktop examples
 * (deno-desktop-mastodon and deno-desktop-reader). Extracted so the two entry
 * files stop drifting; both mastodon.tsx and reader.tsx import from here
 * instead of keeping line-for-line copies. CSS classes are derived from the
 * `prefix` option ('mastodon' / 'reader').
 */

export interface NavItem {
  path: string;
  label: string;
}

export interface TopNavOptions {
  /** CSS class prefix, e.g. 'mastodon' or 'reader'. */
  prefix: string;
  brand: {
    label: string;
    /** Inline SVG markup for the brand icon. */
    svg: string;
    ariaLabel?: string;
  };
  items: NavItem[];
  onNavigate: (path: string) => void;
}

export function createTopNav(options: TopNavOptions): HTMLElement {
  const { prefix, brand, items, onNavigate } = options;
  const nav = document.createElement('nav');
  nav.className = `${prefix}-topnav`;
  const ariaAttr = brand.ariaLabel ? ` aria-label="${brand.ariaLabel}"` : '';
  nav.innerHTML = `
    <a class="${prefix}-brand" href="/" data-nav="/" data-open-brand${ariaAttr}>
      ${brand.svg}
      ${brand.label}
    </a>
    <div class="${prefix}-nav-menu">
      ${
    items.map((item) => `
        <button class="${prefix}-nav-item" data-nav="${item.path}">${item.label}</button>
      `).join('')
  }
    </div>
    <div class="${prefix}-nav-right">
      <open-theme-toggle></open-theme-toggle>
    </div>
  `;

  nav.querySelectorAll(`.${prefix}-nav-item[data-nav], .${prefix}-brand[data-nav]`).forEach(
    (link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const path = (link as HTMLElement).dataset.nav;
        if (path) {
          onNavigate(path);
          // SPA navigation uses pushState, which does not fire popstate —
          // refresh the active highlight here (popstate covers back/forward).
          updateActiveNav(prefix, path);
        }
      });
    },
  );

  return nav;
}

export function updateActiveNav(prefix: string, path: string): void {
  document.querySelectorAll(`.${prefix}-nav-item`).forEach((link) => {
    const navPath = (link as HTMLElement).dataset.nav;
    if (!navPath) return;
    if (navPath === '/' ? path === '/' : path.startsWith(navPath)) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

/**
 * Wrap #root in the standard `<prefix>-layout` / `<prefix>-content` shell with
 * the top navigation above it. Must be called before app.mount('#root').
 */
export function installTopNavLayout(prefix: string, nav: HTMLElement): void {
  const root = document.querySelector('#root');
  if (!root) return;
  const layout = document.createElement('div');
  layout.className = `${prefix}-layout`;
  root.parentNode?.insertBefore(layout, root);
  layout.appendChild(nav);
  const content = document.createElement('div');
  content.className = `${prefix}-content`;
  content.appendChild(root);
  layout.appendChild(content);
}
