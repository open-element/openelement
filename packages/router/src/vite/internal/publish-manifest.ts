import { createHash } from 'node:crypto';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'pathe';
import { hasControlCharacter } from '../../internal/control-characters.ts';
import { publicOutputDir } from './paths.ts';
import { cacheControlFor } from './static-cache.ts';

const MANIFEST_FILE = 'publish-manifest.json';

interface PublishFile {
  path: string;
  size: number;
  sha256: string;
  cacheControl: string;
}

export type PublicFiles = ReadonlyMap<string, PublishFile>;

export function publicFileDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isReservedPublicPath(path: string): boolean {
  const lower = path.toLowerCase();
  return ['server', '.openelement', 'client/.vite', MANIFEST_FILE].some(
    (reserved) => lower === reserved || lower.startsWith(reserved + '/'),
  );
}

/** Resolve authored Vite public files while preserving the reserved output namespaces. */
export function authoredPublicPaths(dir: string): string[] {
  return publicTreePaths(dir).filter((path) => !isReservedPublicPath(path));
}

/** Read the declared file tree of a public producer (Vite publicDir or Pagefind). */
export function publicTreePaths(root: string): string[] {
  if (!lstatSync(root).isDirectory()) throw new Error(`Expected a directory at ${root}`);
  const files: string[] = [];
  function visit(relativeDir: string): void {
    for (const entry of readdirSync(join(root, relativeDir), { withFileTypes: true })) {
      const path = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.name.includes('\\') || hasControlCharacter(entry.name)) {
        throw new Error(`Invalid public file name ${JSON.stringify(path)}`);
      }
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      } else {
        throw new Error(`Public output requires regular files and directories at ${path}`);
      }
    }
  }
  visit('');
  return files.sort();
}

function readPublishFile(root: string, path: string): PublishFile {
  const file = resolve(root, path);
  if (
    normalize(path) !== path ||
    relative(root, file) !== path ||
    path === '..' ||
    path.startsWith('../') ||
    path.includes('\\') ||
    hasControlCharacter(path) ||
    isReservedPublicPath(path)
  ) {
    throw new Error(`Invalid public output path ${JSON.stringify(path)}`);
  }
  if (!lstatSync(file).isFile() || normalize(realpathSync(file)) !== file) {
    throw new Error(`Public output requires a canonical regular file at ${path}`);
  }
  const bytes = readFileSync(file);
  return {
    path,
    size: bytes.length,
    sha256: publicFileDigest(bytes),
    cacheControl: cacheControlFor(path),
  };
}

function inventory(root: string): PublishFile[] {
  const paths = publicTreePaths(root);
  const canonicalRoot = normalize(realpathSync(root));
  return paths.map((path) => readPublishFile(canonicalRoot, path));
}

function serialize(files: readonly PublishFile[]): string {
  return `${JSON.stringify({ version: 1, files }, null, 2)}\n`;
}

/** The build's sole writer of the isolated public directory and manifest. */
export function writePublishOutput(outDir: string, publicPaths: Iterable<string>): void {
  const publicDir = publicOutputDir(outDir);
  const manifest = join(outDir, MANIFEST_FILE);
  // The manifest is the last write. During replacement there is no admission
  // record for a partially copied public directory.
  rmSync(manifest, { force: true });
  const stage = mkdtempSync(`${publicDir}-stage-`);
  try {
    if (!lstatSync(outDir).isDirectory()) throw new Error(`Expected a directory at ${outDir}`);
    const source = normalize(realpathSync(outDir));
    const files = [...new Set(publicPaths)].sort().map((path) => readPublishFile(source, path));
    for (const file of files) {
      const target = join(stage, file.path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(source, file.path), target);
    }
    const expected = serialize(files);
    if (serialize(inventory(stage)) !== expected) {
      throw new Error('The public files changed while staging the build output');
    }
    rmSync(publicDir, { recursive: true, force: true });
    renameSync(stage, publicDir);
    writeFileSync(manifest, expected, { flag: 'wx' });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** Recompute the exact public set and compare it with the build's record. */
export function checkPublishOutput(outDir: string): { root: string; files: PublicFiles } {
  const root = publicOutputDir(outDir);
  const manifest = join(outDir, MANIFEST_FILE);
  try {
    if (!lstatSync(manifest).isFile()) throw new Error('Expected a regular manifest file');
    const recorded = readFileSync(manifest, 'utf8');
    const files = inventory(root);
    if (serialize(files) !== recorded) throw new Error('Manifest differs from public output');
    return { root, files: new Map(files.map((file) => [file.path, file])) };
  } catch (cause) {
    throw new Error(`Cannot verify ${manifest} against ${root}. Run \x60oe build\x60 first.`, {
      cause,
    });
  }
}

/** Compare the bytes a host packaged with the build's verified public file set. */
export function checkPackagedPublicFiles(
  root: string,
  publicFiles: PublicFiles,
  emptyHostControlFile?: string,
): void {
  const actual = inventory(root).filter(
    (file) => file.path !== emptyHostControlFile || file.size !== 0 || publicFiles.has(file.path),
  );
  if (serialize(actual) !== serialize([...publicFiles.values()])) {
    throw new Error(`Packaged public files in ${root} differ from the verified build manifest`);
  }
}
