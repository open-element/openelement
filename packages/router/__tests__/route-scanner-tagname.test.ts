/**
 * route-scanner: missing-tagName note suppression and dedupe.
 *
 * - definePage-style routes never export tagName; the scanner must stay
 *   silent for them (pristine starter builds must be warning-free).
 * - Plain page routes without tagName get one debug note per file per
 *   process, even when scanRoutes() runs again with a different routesDir
 *   spelling (relative vs absolute).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { expect, test } from 'vitest';
import { join, relative } from '@std/path';
import { scanRoutes } from '../src/vite/internal/ssg/index.ts';

/** Run fn with console.debug captured; returns the captured messages. */
async function captureDebug(fn: () => Promise<void>): Promise<string[]> {
  const messages: string[] = [];
  const original = console.debug;
  console.debug = (msg?: unknown, ...args: unknown[]) => {
    messages.push([msg, ...args].map(String).join(' '));
  };
  try {
    await fn();
  } finally {
    console.debug = original;
  }
  return messages;
}

/** Run fn with console.info captured; returns the captured messages. */
async function captureInfo(fn: () => Promise<void>): Promise<string[]> {
  const messages: string[] = [];
  const original = console.info;
  console.info = (msg?: unknown, ...args: unknown[]) => {
    messages.push([msg, ...args].map(String).join(' '));
  };
  try {
    await fn();
  } finally {
    console.info = original;
  }
  return messages;
}

test('scanRoutes fails the build when a content element tag collides with the fallback tag (#971)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-scan-tagname-'));
  try {
    const routesDir = join(dir, 'routes');
    await mkdir(routesDir, { recursive: true });
    // The #960 residual corner: contact.tsx → fallback 'contact-page'; a
    // same-tag self-registered content element would shadow the page class.
    await writeFile(
      join(routesDir, 'contact.tsx'),
      `import { defineElement, definePage } from '@openelement/router';
export const tagName = 'contact-page';
defineElement(tagName, { render() { return <main>view</main>; } });
export default definePage({
  render() { return <contact-page />; },
});
`,
    );

    const err = await scanRoutes(routesDir).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err?.message.includes('contact-page')).toEqual(true);
    expect(err?.message ?? '').toContain('shadow the page class');
    expect(err?.message ?? '').toContain('Rename the content element');
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('scanRoutes stays silent for definePage routes without tagName', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-scan-tagname-'));
  try {
    const routesDir = join(dir, 'routes');
    await mkdir(routesDir, { recursive: true });
    // Mirrors the create-template contact.tsx: definePage, no tagName export.
    await writeFile(
      join(routesDir, 'contact.tsx'),
      `import { definePage } from '@openelement/router';
export default definePage({
  render() {
    return <main>contact</main>;
  },
});
`,
    );

    const messages = await captureDebug(async () => {
      const entries = await scanRoutes(routesDir);
      expect(entries.length).toEqual(1);
      expect(entries[0].tagName).toEqual(undefined);
    });
    const notes = messages.filter((m) => m.includes('No tagName export'));
    expect(notes, 'definePage routes must not trigger the note').toEqual([]);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('scanRoutes stays silent for .mdx routes without tagName', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-scan-tagname-'));
  try {
    const routesDir = join(dir, 'routes');
    await mkdir(routesDir, { recursive: true });
    // #954: .mdx pages are routes; the entry wraps their function component
    // itself, so a missing tagName is by design — no note.
    await writeFile(join(routesDir, 'post.mdx'), '# Hello\n');

    const messages = await captureDebug(async () => {
      const entries = await scanRoutes(routesDir);
      expect(entries.length).toEqual(1);
      expect(entries[0].tagName).toEqual(undefined);
    });
    const notes = messages.filter((m) => m.includes('No tagName export'));
    expect(notes, '.mdx routes must not trigger the note').toEqual([]);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('scanRoutes notes a plain route without tagName once across path spellings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-scan-tagname-'));
  try {
    const routesDir = join(dir, 'routes');
    await mkdir(routesDir, { recursive: true });
    // A plain function route: no definePage, no tagName.
    await writeFile(
      join(routesDir, 'plain.tsx'),
      `export default function Plain() {
  return <main>plain</main>;
}
`,
    );

    const relRoutesDir = relative(process.cwd(), routesDir);
    const messages = await captureDebug(async () => {
      await scanRoutes(routesDir); // absolute spelling
      await scanRoutes(relRoutesDir); // relative spelling — same files
    });
    const notes = messages.filter((m) => m.includes('No tagName export'));
    expect(notes.length, 'same file must be noted exactly once').toEqual(1);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

// ─── #960: registration decoupling (definePage flag + ignored-tagName note) ──

test('scanRoutes flags shape-1 definePage routes and stays silent (sanctioned)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-scan-decouple-'));
  try {
    const routesDir = join(dir, 'routes');
    await mkdir(routesDir, { recursive: true });
    // Mirrors the create-template index.tsx: the tagName export names the
    // content element, which the module self-registers AND renders.
    await writeFile(
      join(routesDir, 'index.tsx'),
      `import { defineElement, definePage } from '@openelement/router';

export const tagName = 'home-page';

defineElement(tagName, {
  render() {
    return <p>content</p>;
  },
});

export default definePage({
  render() {
    return <home-page />;
  },
});
`,
    );

    const messages = await captureInfo(async () => {
      const entries = await scanRoutes(routesDir);
      expect(entries.length).toEqual(1);
      expect(entries[0].definePage, 'definePage route must carry the flag').toEqual(true);
      expect(entries[0].tagName, 'the export stays readable for content naming').toEqual(
        'home-page',
      );
    });
    const notes = messages.filter((m) => m.includes('ignored for registration'));
    expect(notes, 'sanctioned shape-1 modules must not trigger the migration note').toEqual([]);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('scanRoutes treats customElements.define(tagName) as usage (no orphan note)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-scan-tagname-'));
  try {
    const routesDir = join(dir, 'routes');
    await mkdir(routesDir, { recursive: true });
    // The www site and some starters register via the platform primitive
    // instead of defineElement — that is still a use of the export.
    await writeFile(
      join(routesDir, 'home.tsx'),
      `import { definePage } from '@openelement/router';
export const tagName = 'page-home';
class HomePage extends HTMLElement {}
customElements.define(tagName, HomePage);
export default definePage({ render() { return <page-home />; } });
`,
    );

    const messages = await captureInfo(async () => {
      await scanRoutes(routesDir);
    });
    const notes = messages.filter((m) => m.includes('ignored for registration'));
    expect(notes, 'customElements.define(tagName) must count as usage').toEqual([]);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('scanRoutes notes an orphaned tagName export on a definePage route once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-scan-decouple-'));
  try {
    const routesDir = join(dir, 'routes');
    await mkdir(routesDir, { recursive: true });
    // The export is never used: no defineElement call, no JSX usage.
    await writeFile(
      join(routesDir, 'orphan.tsx'),
      `import { definePage } from '@openelement/router';

export const tagName = 'orphan-page';

export default definePage({
  render() {
    return <main>orphan</main>;
  },
});
`,
    );

    const relRoutesDir = relative(process.cwd(), routesDir);
    const messages = await captureInfo(async () => {
      const entries = await scanRoutes(routesDir);
      expect(entries[0].definePage).toEqual(true);
      await scanRoutes(relRoutesDir); // relative spelling — same files
    });
    const notes = messages.filter((m) => m.includes('ignored for registration'));
    expect(notes.length, 'orphaned tagName export must be noted exactly once').toEqual(1);
    expect(notes[0].includes("'orphan-page'"), 'note names the orphaned tag').toEqual(true);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('scanRoutes does not flag plain element routes embedding definePage samples', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-scan-decouple-'));
  try {
    const routesDir = join(dir, 'routes');
    await mkdir(routesDir, { recursive: true });
    // Mirrors site/app/routes/guide/*.tsx: a plain element route (tagName +
    // defineCustomElement) whose prose embeds a definePage( code sample in a
    // template literal. The sample must NOT flag the route as definePage.
    await writeFile(
      join(routesDir, 'guide.tsx'),
      "import { defineCustomElement } from '@openelement/element';\n" +
        '\n' +
        'class GuidePage extends HTMLElement {}\n' +
        '\n' +
        "const sample = `import { definePage } from '@openelement/router';\n" +
        'export default definePage({\n' +
        '  render() { return <main>sample</main>; },\n' +
        '});`;\n' +
        "const prose = 'definePage({ error }) is the page-level error renderer';\n" +
        'void sample;\n' +
        'void prose;\n' +
        '\n' +
        "export const tagName = 'guide-sample-page';\n" +
        'defineCustomElement(tagName, GuidePage);\n' +
        'export default GuidePage;\n',
    );

    const messages = await captureInfo(async () => {
      const entries = await scanRoutes(routesDir);
      expect(entries.length).toEqual(1);
      expect(
        entries[0].definePage,
        'definePage( inside strings must not flag a plain element route',
      ).toEqual(undefined);
      expect(entries[0].tagName).toEqual('guide-sample-page');
    });
    const notes = messages.filter((m) => m.includes('ignored for registration'));
    expect(notes, 'plain element routes never get the migration note').toEqual([]);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('scanRoutes leaves plain element routes with tagName unflagged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-scan-decouple-'));
  try {
    const routesDir = join(dir, 'routes');
    await mkdir(routesDir, { recursive: true });
    await writeFile(
      join(routesDir, 'plain.tsx'),
      `export const tagName = 'plain-page';

export default class PlainPage {
  render() {
    return null;
  }
}
`,
    );

    const entries = await scanRoutes(routesDir);
    expect(entries[0].definePage).toEqual(undefined);
    expect(entries[0].tagName).toEqual('plain-page');
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('scanRoutes does not flag a route when definePage( appears only in comments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-scan-decouple-'));
  try {
    const routesDir = join(dir, 'routes');
    await mkdir(routesDir, { recursive: true });
    // A plain element route whose comments merely MENTION definePage( —
    // a migration note like this must not flip the route to the path-derived
    // fallback registration tag (ADR-0128).
    await writeFile(
      join(routesDir, 'commented.tsx'),
      "import { defineCustomElement } from '@openelement/element';\n" +
        '\n' +
        '// TODO: migrate to definePage({ render() { … } }) eventually.\n' +
        '/* Historical note: this used to be written with definePage(\n' +
        '   before the plain-element shape was adopted. */\n' +
        'class CommentedPage extends HTMLElement {}\n' +
        '\n' +
        "export const tagName = 'commented-sample-page';\n" +
        'defineCustomElement(tagName, CommentedPage);\n' +
        'export default CommentedPage;\n',
    );

    const entries = await scanRoutes(routesDir);
    expect(entries.length).toEqual(1);
    expect(
      entries[0].definePage,
      'definePage( inside comments must not flag a plain element route',
    ).toEqual(undefined);
    expect(entries[0].tagName).toEqual('commented-sample-page');
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('scanRoutes masks comments inside template-literal ${…} expressions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-scan-decouple-'));
  try {
    const routesDir = join(dir, 'routes');
    await mkdir(routesDir, { recursive: true });
    // ${…} expressions are scanned as code — and comments inside them are
    // comments: definePage( mentioned there must still be masked.
    await writeFile(
      join(routesDir, 'interp.tsx'),
      "import { defineCustomElement } from '@openelement/element';\n" +
        '\n' +
        'class InterpPage extends HTMLElement {}\n' +
        '\n' +
        'const label = `docs: ${/* see definePage( for pages */ chapter}`;\n' +
        'void label;\n' +
        '\n' +
        "export const tagName = 'interp-sample-page';\n" +
        'defineCustomElement(tagName, InterpPage);\n' +
        'export default InterpPage;\n',
    );

    const entries = await scanRoutes(routesDir);
    expect(entries.length).toEqual(1);
    expect(
      entries[0].definePage,
      'definePage( inside a comment in a ${…} expression must be masked',
    ).toEqual(undefined);
    expect(entries[0].tagName).toEqual('interp-sample-page');
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});
