/**
 * www content collection pipeline.
 *
 * The site's article collections used to be served by the adapter's Vite
 * content plugin. That adapter dissolved into the packages (ADR-0148), and the
 * site only ever needed the build-time half of it: parse frontmatter, validate
 * it against a declarative schema, render Markdown, sanitize, and emit a typed
 * data module. That build-time half lives here.
 *
 * The schema shape is unchanged from the adapter so `content-collections.ts`
 * stays a pure declaration, and the emitted module keeps the same exported
 * surface (`pages`, `getPage`, `GeneratedCollectionEntry`) that the site's
 * routes and tests consume.
 */

import { sanitizeHtml, type SanitizeOptions } from '@openelement/element/sanitize';
import matter from 'gray-matter';
import { marked } from 'marked';

/** Primitive frontmatter field types supported by content collections. */
export type CollectionFieldType = 'string' | 'number' | 'boolean' | 'string[]';

/** Declarative definition of one frontmatter field (type, required, default). */
export interface CollectionFieldDefinition {
  type: CollectionFieldType;
  required?: boolean;
  default?: unknown;
}

/** Context handed to a collection schema's `transform` hook. */
export interface CollectionSchemaContext {
  collection: string;
  fileName: string;
  filePath: string;
  slug: string;
}

/** The slug/frontmatter result a collection schema `transform` returns. */
export interface CollectionSchemaResult {
  slug?: string;
  frontmatter: Record<string, unknown>;
}

/**
 * Declarative fields keep generated modules typed. `transform` covers values
 * derived from filenames (for example the site's locale suffix) without making
 * that convention part of the schema engine.
 */
export interface CollectionSchema {
  fields: Record<string, CollectionFieldType | CollectionFieldDefinition>;
  transform?: (
    frontmatter: Record<string, unknown>,
    context: CollectionSchemaContext,
  ) => CollectionSchemaResult;
}

/** Configuration of one content collection (directory, base path, schema). */
export interface CollectionOptions {
  contentDir: string;
  basePath?: string;
  schema?: CollectionSchema;
  /** Custom Markdown renderer; its output still crosses the shared sanitizer. */
  markdown?: (content: string) => string | Promise<string>;
}

/** One loaded collection entry: slug, validated frontmatter and rendered HTML. */
export interface CollectionEntry {
  slug: string;
  locale?: string;
  frontmatter: Record<string, unknown>;
  content: string;
  html: string;
}

/** Frontmatter of one blog dispatch, normalized by `blogCollectionSchema`. */
export interface BlogPostFrontmatter {
  title: string;
  date: string;
  draft?: boolean;
  tags?: string[];
  excerpt?: string;
  type?: string;
  lang?: string;
}

/** A fully loaded blog dispatch: slug, normalized frontmatter, body + HTML. */
export interface BlogPost {
  slug: string;
  frontmatter: BlogPostFrontmatter;
  content: string;
  html: string;
}

/** ADR-0126: the single shared allow-list for every Markdown collection. */
export const CONTENT_SANITIZE_OPTIONS: SanitizeOptions = {
  allowedTags: [
    'p',
    'a',
    'code',
    'pre',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'strong',
    'em',
    'b',
    'i',
    's',
    'del',
    'ins',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'br',
    'hr',
    'img',
    'figure',
    'figcaption',
    'details',
    'summary',
    'sup',
    'sub',
    'abbr',
    'input',
  ],
  allowedAttributes: {
    '*': ['class', 'id'],
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    code: ['language', 'data-language'],
    input: ['type', 'disabled', 'checked'],
    abbr: ['title'],
  },
  allowedSchemes: ['http', 'https', 'mailto', '#', 'relative'],
  disallowedTagsMode: 'discard',
  allowDangerousTags: ['details', 'summary', 'input'],
  linkRel: ['noopener', 'noreferrer'],
  voidElementStyle: 'xhtml',
};

export function sanitizeContentHtml(html: string): string {
  return sanitizeHtml(html, CONTENT_SANITIZE_OPTIONS);
}

function definition(
  value: CollectionFieldType | CollectionFieldDefinition,
): CollectionFieldDefinition {
  return typeof value === 'string' ? { type: value } : value;
}

function matchesType(value: unknown, type: CollectionFieldType): boolean {
  if (type === 'string[]') {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
  }
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number';
  return typeof value === 'boolean';
}

export function validateCollectionFrontmatter(
  schema: CollectionSchema | undefined,
  input: Record<string, unknown>,
  context: CollectionSchemaContext,
): CollectionSchemaResult {
  if (!schema) return { frontmatter: input };

  const frontmatter: Record<string, unknown> = {};
  for (const [name, rawDefinition] of Object.entries(schema.fields)) {
    const field = definition(rawDefinition);
    let value = input[name];
    if (value === undefined && field.default !== undefined) value = field.default;
    if (value === undefined) {
      if (field.required) {
        throw new Error(
          `[content:${context.collection}] ${context.fileName}: frontmatter.${name} is required`,
        );
      }
      continue;
    }
    // YAML parsers commonly materialize unquoted ISO dates as Date objects;
    // collection schemas expose stable JSON/string data to generated modules.
    if (field.type === 'string' && value instanceof Date) {
      value = value.toISOString().split('T')[0];
    }
    if (!matchesType(value, field.type)) {
      throw new Error(
        `[content:${context.collection}] ${context.fileName}: frontmatter.${name} must be ${field.type}`,
      );
    }
    frontmatter[name] = value;
  }
  return schema.transform?.(frontmatter, context) ?? { frontmatter };
}

export function collectionFieldTypeScript(
  value: CollectionFieldType | CollectionFieldDefinition,
): { type: string; optional: boolean } {
  const field = definition(value);
  const type = field.type === 'string[]' ? 'string[]' : field.type;
  return { type, optional: !field.required && field.default === undefined };
}

/** Load a content collection from disk: parse frontmatter, validate the schema, render Markdown. */
export async function loadCollectionData(
  name: string,
  options: CollectionOptions,
): Promise<CollectionEntry[]> {
  let fileNames: string[];
  try {
    fileNames = [];
    for await (const entry of Deno.readDir(options.contentDir)) {
      if (entry.isFile) fileNames.push(entry.name);
    }
  } catch {
    return [];
  }
  fileNames.sort();

  const entries: CollectionEntry[] = [];
  for (const fileName of fileNames) {
    if (!fileName.endsWith('.md') && !fileName.endsWith('.mdx')) continue;
    const filePath = `${options.contentDir}/${fileName}`;
    const source = await Deno.readTextFile(filePath);
    const parsed = matter(source);
    const initialSlug = fileName.replace(/\.mdx?$/, '');
    const result = validateCollectionFrontmatter(
      options.schema,
      parsed.data as Record<string, unknown>,
      { collection: name, fileName, filePath, slug: initialSlug },
    );
    const renderedMarkdown = options.markdown
      ? await options.markdown(parsed.content)
      : await marked(parsed.content, { async: true });
    entries.push({
      slug: result.slug ?? initialSlug,
      ...(typeof result.frontmatter.locale === 'string'
        ? { locale: result.frontmatter.locale }
        : {}),
      frontmatter: result.frontmatter,
      content: parsed.content,
      html: sanitizeContentHtml(renderedMarkdown),
    });
  }
  return entries;
}

/** Serialize loaded collection entries into the generated typed data module source. */
export function writeCollectionDataModule(
  name: string,
  entries: CollectionEntry[],
  options: CollectionOptions,
): string {
  const fields = options.schema
    ? Object.entries(options.schema.fields).map(([fieldName, raw]) => {
      const field = collectionFieldTypeScript(raw);
      return `    ${JSON.stringify(fieldName)}${field.optional ? '?' : ''}: ${field.type};`;
    })
    : ['    [key: string]: unknown;'];
  const localeField = options.schema?.fields.locale;
  const locale = localeField ? collectionFieldTypeScript(localeField) : null;
  const localeDeclaration = locale?.type === 'string' && !locale.optional
    ? '  locale: string;'
    : '  locale?: string;';
  return [
    `// Auto-generated by tools/generate-www-content-data.ts from collection:${name} - do not edit`,
    'export interface GeneratedCollectionEntry {',
    '  slug: string;',
    localeDeclaration,
    '  frontmatter: {',
    ...fields,
    '  };',
    '  content: string;',
    '  html: string;',
    '}',
    '',
    `export const pages: GeneratedCollectionEntry[] = ${JSON.stringify(entries, null, 2)};`,
    '',
    'export function getPage(slug: string, locale?: string): GeneratedCollectionEntry | undefined {',
    '  return pages.find((page) => page.slug === slug && (locale === undefined || page.locale === locale));',
    '}',
    '',
  ].join('\n');
}

/**
 * Serialize blog posts into the generated module behind
 * `@openelement/generated/blog-data`. Same contract as the article serializer:
 * a self-contained typed module with no import-time work.
 */
export function writeBlogDataModule(posts: BlogPost[]): string {
  return [
    `// Auto-generated by tools/generate-www-content-data.ts from collection:blog - do not edit`,
    'export interface GeneratedBlogPost {',
    '  slug: string;',
    '  frontmatter: {',
    '    title: string;',
    '    date: string;',
    '    draft?: boolean;',
    '    tags?: string[];',
    '    excerpt?: string;',
    '    type?: string;',
    '    lang?: string;',
    '  };',
    '  content: string;',
    '  html: string;',
    '}',
    '',
    `export const posts: GeneratedBlogPost[] = ${JSON.stringify(posts, null, 2)};`,
    '',
    'export function getPostBySlug(slug: string): GeneratedBlogPost | undefined {',
    '  return posts.find((post) => post.slug === slug);',
    '}',
    '',
  ].join('\n');
}
