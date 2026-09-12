import { compiledStyle } from './compiled-style.ts';

export const openSearchStyles = [compiledStyle(`
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
    width: var(--size-9);
    height: var(--size-9);
    padding: 0;
    border: 0;
    border-radius: var(--radius-round);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-7);
    letter-spacing: 0;
    box-shadow: none;
    cursor: pointer;
    transition: all var(--ease-2) var(--duration-2);
  }
  .search-trigger:hover {
    color: var(--brand);
    border-color: transparent;
    background: color-mix(in srgb, var(--brand-pale) 34%, transparent);
  }
  .search-trigger kbd {
    font-family: inherit;
    padding: var(--size-1) var(--size-1);
    border: var(--border-size-1) solid var(--border);
    border-radius: var(--radius-1);
    font-size: var(--font-size-00);
    margin-left: var(--size-1);
  }
  .search-trigger span, .search-trigger kbd { display: none; }
  .search-icon { display: inline-block; width: var(--size-5); height: var(--size-5); }
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
    background: color-mix(in srgb, var(--gray-12) 44%, transparent);
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
    margin: 0 var(--size-4);
    background: var(--gray-0);
    border: var(--border-size-1) solid var(--border);
    border-radius: var(--radius-4);
    box-shadow: 0 var(--size-4) var(--size-16) color-mix(in srgb, var(--brand) 18%, transparent);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .search-input {
    width: 100%;
    padding: var(--size-3) var(--size-3);
    border: none;
    border-bottom: 0.5px solid var(--gray-3);
    background: transparent;
    color: var(--gray-10);
    font-size: var(--font-size-1);
    outline: none;
    box-sizing: border-box;
    font-family: inherit;
  }
  .results { flex: 1; overflow-y: auto; padding: var(--size-3) 0; }
  .item {
    display: block;
    padding: var(--size-3) var(--size-3);
    text-decoration: none;
    color: inherit;
    transition: background var(--ease-2) var(--duration-2);
    cursor: pointer;
  }
  .item:hover { background: var(--gray-2); }
  .item-section {
    font-size: var(--font-size-00);
    text-transform: uppercase;
    letter-spacing: var(--font-letterspacing-5);
    color: var(--gray-6);
    margin-bottom: var(--size-1);
  }
  .item-title {
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-5);
    color: var(--gray-10);
    margin-bottom: var(--size-1);
  }
  .item-text {
    font-size: var(--font-size-0);
    color: var(--gray-7);
    line-height: var(--font-lineheight-3);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .empty {
    padding: var(--size-9) var(--size-3);
    text-align: center;
    color: var(--gray-5);
    font-size: var(--font-size-0);
  }
`)];
