import { compiledStyle } from './compiled-style.ts';

export const openSearchStyles = [
  compiledStyle(`
  :host {
    display: inline-flex;
    align-items: center;
    contain: none;
  }
  .search-root { display: contents; }
  .search-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: calc(var(--spacing) * 9);
    height: calc(var(--spacing) * 9);
    padding: 0;
    border: 0;
    border-radius: calc(infinity * 1px);
    background: transparent;
    color: var(--color-foreground);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0;
    box-shadow: none;
    cursor: pointer;
    transition: all cubic-bezier(0.45, 0, 0.25, 1) 200ms;
  }
  .search-trigger:hover {
    color: var(--color-primary);
    border-color: transparent;
    background: color-mix(in srgb, color-mix(in srgb, var(--color-primary) 18%, transparent) 34%, transparent);
  }
  .search-trigger kbd {
    font-family: inherit;
    padding: calc(var(--spacing) * 1) calc(var(--spacing) * 1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    margin-left: calc(var(--spacing) * 1);
  }
  .search-trigger span, .search-trigger kbd { display: none; }
  .search-icon { display: inline-block; width: calc(var(--spacing) * 5); height: calc(var(--spacing) * 5); }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 99999;
    width: 100vw;
    height: 100vh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 15vh 0 0;
    border: 0;
    color: inherit;
    background: color-mix(in srgb, white 44%, transparent);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    box-sizing: border-box;
  }
  .overlay[hidden] { display: none; }
  .panel {
    width: 100%;
    max-width: 560px;
    max-height: 70vh;
    margin: 0 calc(var(--spacing) * 4);
    background: var(--color-background);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-2xl);
    box-shadow: 0 calc(var(--spacing) * 4) calc(var(--spacing) * 16) color-mix(in srgb, var(--color-primary) 18%, transparent);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .search-input {
    width: 100%;
    padding: calc(var(--spacing) * 3) calc(var(--spacing) * 3);
    border: none;
    border-bottom: 0.5px solid var(--color-border);
    background: transparent;
    color: var(--color-foreground);
    font-size: var(--text-base);
    box-sizing: border-box;
    font-family: inherit;
  }
  .results { flex: 1; overflow-y: auto; padding: calc(var(--spacing) * 3) 0; }
  .item {
    display: block;
    padding: calc(var(--spacing) * 3) calc(var(--spacing) * 3);
    text-decoration: none;
    color: inherit;
    transition: background cubic-bezier(0.45, 0, 0.25, 1) 200ms;
    cursor: pointer;
  }
  .item:hover { background: var(--color-accent); }
  .item-section {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-muted-foreground);
    margin-bottom: calc(var(--spacing) * 1);
  }
  .item-title {
    font-size: var(--text-sm);
    font-weight: var(--font-weight-medium);
    color: var(--color-foreground);
    margin-bottom: calc(var(--spacing) * 1);
  }
  .item-text {
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .empty {
    padding: calc(var(--spacing) * 9) calc(var(--spacing) * 3);
    text-align: center;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
  }
  /* A blank message must never leave a padded empty box behind. */
  .empty:empty {
    display: none;
  }
  /* Loading skeleton: static bars (no shimmer — motion-safe by
     construction), shaped like result rows. */
  .skeleton {
    display: grid;
    gap: calc(var(--spacing) * 3);
    padding: calc(var(--spacing) * 3);
  }
  .skeleton[hidden] {
    display: none;
  }
  .skeleton span {
    display: block;
    height: calc(var(--spacing) * 8);
    border-radius: var(--radius-md);
    background: var(--color-muted);
  }
`),
];
