import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// This fixture has no islands, authored browser scripts, or enhanced forms.
const requiredPages = ['index.html', 'about/index.html', 'mdx-page/index.html'];
const scriptTag = /<script(?=[\t\n\f\r />])/i;
const linkTags = /<link(?=[\t\n\f\r />])(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const clientLink =
  /data-open-(?:element-runtime-preload|island-prefetch)|\bmodulepreload\b|\b(?:client|island-manifests)\/|\.[cm]?js(?=[?#\s"'>])/i;

export function assertZeroIslandOutput(dist: string): void {
  const htmlPages = new Set<string>();
  for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    const outputPath = relative(dist, path).split(sep).join('/');
    if (outputPath === 'island-manifests' || outputPath === 'client') {
      throw new Error(`Zero-island build emitted dist/${outputPath}`);
    }
    if (entry.isDirectory()) continue;
    if (/\.[cm]?js$/i.test(entry.name)) {
      throw new Error(`Zero-island build emitted JavaScript at dist/${outputPath}`);
    }
    if (!entry.name.endsWith('.html')) continue;

    htmlPages.add(outputPath);
    const html = readFileSync(path, 'utf8');
    if (scriptTag.test(html)) {
      throw new Error(`Zero-island document dist/${outputPath} contains a script tag`);
    }
    for (const [link] of html.matchAll(linkTags)) {
      if (clientLink.test(link)) {
        throw new Error(`Zero-island document dist/${outputPath} references a client asset`);
      }
    }
  }

  for (const page of requiredPages) {
    if (!htmlPages.has(page)) throw new Error(`Zero-island build is missing dist/${page}`);
  }
}

if (import.meta.main) {
  assertZeroIslandOutput(join(import.meta.dirname, 'dist'));
  console.log('zero-island output: no island manifests, client assets, or script references');
}
