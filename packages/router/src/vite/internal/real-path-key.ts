/**
 * Set-key discipline for filesystem identities (the third case of the same
 * disease: dev-style-session's configuration inputs, and now the dev watch
 * guards). Identity is a fact about the FILE, not about the spelling it was
 * reached through: `os.tmpdir()` spellings (`/var/folders/…`) and the paths
 * the kernel reports (`/private/var/folders/…` on macOS, symlinked tmp roots
 * on CI runners) must key to the same entry or a guard silently rejects its
 * own directory's events. Keys are realpaths; a path not yet on disk falls
 * back to its parent directory's real path plus the entry name, which stays
 * stable across both spellings.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';

export const realPathKey = (file: string): string => {
  try {
    return realpathSync.native(file);
  } catch {
    try {
      return realpathSync.native(dirname(file)) + '/' + basename(file);
    } catch {
      return file;
    }
  }
};
