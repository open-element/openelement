import { compiledStyle } from '../site-ui/compiled-style.ts';
import { pageStyles } from './page-styles.ts';

export const pageChangelogStyles = [compiledStyle(
  pageStyles + `
  :host { display: block; }
  .crumb { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--size-2); margin: 0 0 var(--size-4); color: var(--text-muted); font-family: var(--font-mono); font-size: var(--font-size-00); font-weight: var(--font-weight-8); letter-spacing: 0.1em; text-transform: uppercase; }
  .crumb .crumb-sep { color: color-mix(in srgb, var(--text-muted) 55%, transparent); }
  .crumb .crumb-current { color: var(--violet-8); }
  .page-title { margin: 0; color: var(--text-primary); font-family: var(--font-sans); font-size: clamp(2.1rem, 4.6vw, 3.4rem); font-weight: var(--font-weight-8); letter-spacing: -.035em; line-height: 1.05; overflow-wrap: break-word; text-wrap: balance; }
  .lede { max-width: 640px; margin: var(--size-4) 0 0; color: var(--text-secondary); font-size: clamp(var(--font-size-1), 1.4vw, var(--font-size-2)); line-height: 1.65; }
  .version-line { margin: var(--size-4) 0 0; color: var(--text-muted); font-size: var(--font-size-0); }
  .version-line code { font-family: var(--font-mono); background: var(--bg-surface); padding: var(--size-1) var(--size-2); border-radius: var(--radius-1); font-size: var(--font-size-00); }
  .register { margin: var(--size-8) 0 var(--size-10); border-block-start: var(--border-size-1) solid var(--border); }
  .reg-row { padding: var(--size-5); border-block-end: var(--border-size-1) solid var(--border); }
  .reg-current { background: var(--brand-subtle); box-shadow: inset var(--size-1) 0 0 var(--brand); }
  .reg-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--size-3); }
  .reg-version { color: var(--text-secondary); font-size: clamp(1.4rem, 2.4vw, 2rem); font-weight: 800; line-height: 1; letter-spacing: -.02em; }
  .reg-current .reg-version { color: var(--text-primary); font-size: clamp(1.9rem, 3.4vw, 2.8rem); }
  .reg-ghost .reg-version { color: transparent; -webkit-text-stroke: 1.5px color-mix(in srgb, var(--violet-5) 55%, transparent); }
  .reg-stamp { padding: var(--size-1) var(--size-3); border-radius: var(--radius-1); background: var(--brand); color: var(--on-brand); font-size: var(--font-size-00); font-weight: var(--font-weight-7); letter-spacing: .08em; text-transform: uppercase; }
  .reg-note { color: var(--text-muted); font-size: var(--font-size-00); }
  .reg-summary { margin: var(--size-2) 0 0; max-width: 640px; overflow: hidden; color: var(--text-secondary); font-size: var(--font-size-00); line-height: var(--font-lineheight-3); text-overflow: ellipsis; white-space: nowrap; }
  .reg-ghost .reg-summary { color: var(--text-muted); }
  .changelog-content { font-size: var(--font-size-1); line-height: var(--font-lineheight-4); color: var(--text-primary); }
  .changelog-content h2 { position:relative; font-size: var(--font-size-5); margin: var(--size-10) 0 var(--size-4); border-bottom: 0.5px solid var(--border); padding:0 0 var(--size-4) var(--size-6); }
  .changelog-content h2::before { content:""; position:absolute; inset:0 auto 0 0; width:2px; background:var(--brand); }
  .changelog-content h2:first-child::after { content:"published history"; display:block; margin-top:var(--size-2); color:var(--brand); font-family:var(--font-mono); font-size:var(--font-size-00); text-transform:uppercase; letter-spacing:.08em; }
  .changelog-content h3 { font-size: var(--font-size-3); margin: var(--size-6) 0 var(--size-2); }
  .changelog-content code { font-family: var(--font-mono); background: var(--bg-surface); padding: var(--size-1) var(--size-2); border-radius: var(--radius-1); font-size: var(--font-size-00); }
  .changelog-content pre { background: var(--bg-surface); padding: var(--size-5) var(--size-6); border-radius: var(--radius-2); overflow-x: auto; }
`,
)];
