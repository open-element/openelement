import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
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
const READ_FILE_FLAGS =
  constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

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

function readCanonicalRegularFile(
  file: string,
  diagnostic: string,
): { bytes: Buffer; mode: number } {
  let fd: number | undefined;
  try {
    fd = openSync(file, READ_FILE_FLAGS);
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile()) throw new Error('Expected a regular file descriptor');
    // O_NOFOLLOW covers the leaf when available. Check canonical ancestry
    // and match the path to the descriptor before reading any bytes. The build
    // and host must keep the parent directories under their own control.
    const canonical = normalize(realpathSync(file));
    const current = lstatSync(file, { bigint: true });
    if (
      canonical !== file ||
      !current.isFile() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino
    ) {
      throw new Error('The path does not identify the opened file');
    }
    return { bytes: readFileSync(fd), mode: Number(opened.mode & 0o777n) };
  } catch (cause) {
    throw new Error(diagnostic, { cause });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readPublishFile(
  root: string,
  path: string,
): { entry: PublishFile; bytes: Buffer; mode: number } {
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
  const { bytes, mode } = readCanonicalRegularFile(
    file,
    `Public output requires a canonical regular file at ${path}`,
  );
  return {
    entry: {
      path,
      size: bytes.length,
      sha256: publicFileDigest(bytes),
      cacheControl: cacheControlFor(path),
    },
    bytes,
    mode,
  };
}

function inventory(root: string): PublishFile[] {
  const paths = publicTreePaths(root);
  const canonicalRoot = normalize(realpathSync(root));
  return paths.map((path) => readPublishFile(canonicalRoot, path).entry);
}

function serialize(files: readonly PublishFile[]): string {
  return `${JSON.stringify({ version: 1, files }, null, 2)}\n`;
}

/** The build's sole writer of the isolated public directory and manifest. */
export function writePublishOutput(outDir: string, publicPaths: Iterable<string>): void {
  const sourcePath = resolve(outDir);
  if (!lstatSync(sourcePath).isDirectory()) throw new Error(`Expected a directory at ${outDir}`);
  const source = normalize(realpathSync(sourcePath));
  const publicDir = publicOutputDir(outDir);
  const manifest = join(source, MANIFEST_FILE);
  // The manifest is the last write. During replacement there is no admission
  // record for a partially copied public directory.
  rmSync(manifest, { force: true });
  const stage = mkdtempSync(`${publicDir}-stage-`);
  try {
    const files = [...new Set(publicPaths)].sort().map((path) => {
      const { entry, bytes, mode } = readPublishFile(source, path);
      const target = join(stage, entry.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: 'wx', mode });
      return entry;
    });
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
    const canonicalManifest = join(normalize(realpathSync(outDir)), MANIFEST_FILE);
    const { bytes } = readCanonicalRegularFile(
      canonicalManifest,
      'Expected a regular manifest file',
    );
    const files = inventory(root);
    if (serialize(files) !== bytes.toString('utf8')) {
      throw new Error('Manifest differs from public output');
    }
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
