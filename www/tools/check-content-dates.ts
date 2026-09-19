/**
 * Verify (or refresh) the committed content-dates manifest against Git.
 *
 * This is CI/release tooling, not build tooling: the production build reads
 * `www/lib/content-dates.json` and never touches Git. Running here keeps the
 * manifest honest — every date must match the last commit that touched the
 * corresponding source file (`--follow` keeps stamps across pure moves), and
 * a source Git does not track yet is recorded as the explicit 'uncommitted'
 * sentinel, which the render layer hides instead of showing a machine-local
 * date.
 *
 * Shallow clones collapse history and would flatten every stamp onto one
 * date: fail closed with the reason instead of writing misleading data.
 * Refresh deliberately with `--write` when content moves.
 */
import { fromFileUrl, join } from '@std/path';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const contentRoot = join(repoRoot, 'www/content/docs');
const manifestFile = join(repoRoot, 'www/lib/content-dates.json');
const COLLECTIONS = ['guide', 'architecture'] as const;
const UNCOMMITTED = 'uncommitted';

async function git(args: string[]): Promise<string> {
  const command = new Deno.Command('git', {
    args,
    cwd: repoRoot,
    stdout: 'piped',
    stderr: 'null',
  });
  const { code, stdout } = await command.output();
  if (code !== 0) return '';
  return new TextDecoder().decode(stdout).trim();
}

const shallow = await git(['rev-parse', '--is-shallow-repository']);
if (shallow === 'true') {
  console.error(
    'content-dates: shallow clone collapses history — every stamp would flatten onto one date. ' +
      'Use a full clone (the production build itself never needs Git).',
  );
  Deno.exit(1);
}

const meta: Record<string, { en: string; zh: string }> = {};
for (const collection of COLLECTIONS) {
  const slugs = new Set<string>();
  for await (const entry of Deno.readDir(join(contentRoot, collection))) {
    if (!entry.isFile || !entry.name.endsWith('.md')) continue;
    slugs.add(entry.name.replace(/\.zh\.md$/, '').replace(/\.md$/, ''));
  }
  for (const slug of [...slugs].sort()) {
    const rel = `www/content/docs/${collection}`;
    const en = await git(['log', '--follow', '-1', '--format=%cs', '--', `${rel}/${slug}.md`]);
    const zh = await git(['log', '--follow', '-1', '--format=%cs', '--', `${rel}/${slug}.zh.md`]);
    meta[`${collection}/${slug}`] = { en: en || UNCOMMITTED, zh: zh || en || UNCOMMITTED };
  }
}

const generated = JSON.stringify(
  {
    generatedFrom: 'git log --follow --format=%cs per source file',
    articles: Object.fromEntries(Object.keys(meta).sort().map((slug) => [slug, meta[slug]])),
  },
  null,
  2,
) + '\n';

if (Deno.args.includes('--write')) {
  await Deno.writeTextFile(manifestFile, generated);
  console.log(`content dates manifest written: ${Object.keys(meta).length} articles.`);
} else {
  let current = '';
  try {
    current = await Deno.readTextFile(manifestFile);
  } catch {
    // Missing file is drift; fall through to the mismatch path.
  }
  if (current !== generated) {
    console.error(
      'content-dates drift: the committed manifest no longer matches Git history; ' +
        'regenerate with deno task --cwd www write:content-dates',
    );
    Deno.exit(1);
  }
  console.log(`content dates check passed (${Object.keys(meta).length} articles).`);
}
