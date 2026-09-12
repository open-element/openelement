// Type declarations for @openelement/generated/blog-data.
// The runtime module is generated during build/dev by the adapter-vite
// internal content/blog plugin. This stub provides types when the generated
// .ts file is not yet present.

export interface GeneratedBlogPost {
  slug: string;
  frontmatter: {
    title: string;
    date: string;
    draft?: boolean;
    tags?: string[];
    excerpt?: string;
    type?: string;
    lang?: string;
  };
  content: string;
  html: string;
}

export declare const posts: GeneratedBlogPost[];
export declare function getPostBySlug(slug: string): GeneratedBlogPost | undefined;
