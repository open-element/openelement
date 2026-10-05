import { compiledStyle } from '../site-ui/compiled-style.ts';
import { crumbStyles, pageStyles } from './page-styles.ts';

export const pageChangelogStyles = [
  compiledStyle(
    pageStyles +
      `
  :host { display: block; }
  ${crumbStyles}
  .page-title { margin: 0; color: var(--color-foreground); font-family: var(--font-sans); font-size: clamp(2.1rem, 4.6vw, 3.4rem); font-weight: var(--font-weight-extrabold); letter-spacing: -.035em; line-height: 1.05; overflow-wrap: break-word; text-wrap: balance; }
  .lede { max-width: 640px; margin: calc(var(--spacing) * 4) 0 0; color: var(--color-muted-foreground); font-size: clamp(var(--text-base), 1.4vw, var(--text-xl)); line-height: 1.65; }
  .version-line { margin: calc(var(--spacing) * 4) 0 0; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .version-line code { font-family: var(--font-mono); background: var(--color-muted); padding: calc(var(--spacing) * 1) calc(var(--spacing) * 2); border-radius: var(--radius-md); font-size: var(--text-xs); }
  .register { margin: calc(var(--spacing) * 8) 0 calc(var(--spacing) * 10); border-block-start: calc(var(--spacing) * 0.25) solid var(--color-border); }
  .reg-row { padding: calc(var(--spacing) * 5); border-block-end: calc(var(--spacing) * 0.25) solid var(--color-border); }
  .reg-current { background: color-mix(in srgb, var(--color-primary) 14%, transparent); box-shadow: inset calc(var(--spacing) * 1) 0 0 var(--color-primary); }
  .reg-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: calc(var(--spacing) * 3); }
  .reg-version { color: var(--color-muted-foreground); font-size: clamp(1.4rem, 2.4vw, 2rem); font-weight: 800; line-height: 1; letter-spacing: -.02em; }
  .reg-current .reg-version { color: var(--color-foreground); font-size: clamp(1.9rem, 3.4vw, 2.8rem); }
  .reg-stamp { padding: calc(var(--spacing) * 1) calc(var(--spacing) * 3); border-radius: var(--radius-md); background: var(--color-primary); color: var(--color-primary-foreground); font-size: var(--text-xs); font-weight: var(--font-weight-bold); letter-spacing: .08em; text-transform: uppercase; }
  .reg-note { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .reg-summary { margin: calc(var(--spacing) * 2) 0 0; max-width: 640px; overflow: hidden; color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: var(--leading-normal); text-overflow: ellipsis; white-space: nowrap; }
  .changelog-content { font-size: var(--text-base); line-height: var(--leading-relaxed); color: var(--color-foreground); }
  .changelog-content h2 { position:relative; font-size: var(--text-5xl); margin: calc(var(--spacing) * 10) 0 calc(var(--spacing) * 4); border-bottom: 0.5px solid var(--color-border); padding:0 0 calc(var(--spacing) * 4) calc(var(--spacing) * 6); }
  .changelog-content h2::before { content:""; position:absolute; inset:0 auto 0 0; width:2px; background:var(--color-primary); }
  .changelog-content h2:first-child::after { content:"published history"; display:block; margin-top:calc(var(--spacing) * 2); color:var(--color-primary); font-family:var(--font-mono); font-size:var(--text-xs); text-transform:uppercase; letter-spacing:.08em; }
  .changelog-content h3 { font-size: var(--text-2xl); margin: calc(var(--spacing) * 6) 0 calc(var(--spacing) * 2); }
  .changelog-content code { font-family: var(--font-mono); background: var(--color-muted); padding: calc(var(--spacing) * 1) calc(var(--spacing) * 2); border-radius: var(--radius-md); font-size: var(--text-xs); }
  .changelog-content pre { background: var(--color-muted); padding: calc(var(--spacing) * 5) calc(var(--spacing) * 6); border-radius: var(--radius-lg); overflow-x: auto; }
`,
  ),
];
