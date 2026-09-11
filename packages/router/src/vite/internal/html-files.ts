import { join } from 'node:path';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

interface HtmlFileEntry {
  absolutePath: string;
  relativePath: string;
}

/**
 * Single deterministic directory walker shared by SSG post-processing,
 * sitemap generation, island manifests, and build artifact collection (#710).
 * Dotfiles are skipped and entries are sorted for stable output.
 */
export function walkFileEntries(
  root: string,
  extension?: string,
  relativeDir = '',
): HtmlFileEntry[] {
  const files: HtmlFileEntry[] = [];
  try {
    const entries = readdirSync(join(root, relativeDir), { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;
      if (entry.isDirectory()) files.push(...walkFileEntries(root, extension, relativePath));
      else if (!extension || entry.name.endsWith(extension)) {
        files.push({ absolutePath: join(root, relativePath), relativePath });
      }
    }
  } catch {
    // Output directory may not exist yet.
  }
  return files;
}

/** Walk all .html files under root. */
export function walkHtmlFileEntries(root: string, relativeDir = ''): HtmlFileEntry[] {
  return walkFileEntries(root, '.html', relativeDir);
}

/**
 * Visit each HTML file under dir. The visitor receives the file content and
 * absolute path; returning a string overwrites the file, null leaves it as-is.
 */
export function visitHtmlFiles(
  dir: string,
  visitor: (content: string, fullPath: string) => string | null,
): void {
  for (const entry of walkHtmlFileEntries(dir)) {
    const content = readFileSync(entry.absolutePath, 'utf-8');
    const result = visitor(content, entry.absolutePath);
    if (result !== null) writeFileSync(entry.absolutePath, result, 'utf-8');
  }
}
