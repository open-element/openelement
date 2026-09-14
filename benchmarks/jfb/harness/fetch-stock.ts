/**
 * Fetches the stock js-framework-benchmark sources used as comparators
 * (issue #1219). Sources are pinned to an exact upstream commit and verified
 * against recorded SHA-256 digests; a mismatch fails closed. Nothing is
 * vendored into the repository: fetched files land in the out-of-tree build
 * directory so repository format/lint gates never see third-party sources.
 *
 * `--jfb-path <dir>` uses a local js-framework-benchmark checkout instead of
 * the network (must sit at the pinned commit).
 */
import { join } from '@std/path';

export const JFB_REPO = 'krausest/js-framework-benchmark';
export const JFB_COMMIT = '21d7204da754846fe1402f4437b5b53066f3c34e';
export const JFB_COMMIT_DATE = '2026-09-01T20:26:22+02:00';
export const JFB_COMMIT_SUBJECT = 'chrome152';

export interface PinnedStockFile {
  /** Path inside the JFB repository. */
  path: string;
  sha256: string;
}

export const PINNED_STOCK_FILES: PinnedStockFile[] = [
  {
    path: 'css/currentStyle.css',
    sha256: '45f7d016571351942baf18489716fb342532a305feda38f2f98112109933e22c',
  },
  {
    path: 'frameworks/keyed/vanillajs/index.html',
    sha256: '57e517067f4746cdce621e2642f7f88c793830bd51282a13e0bafb62740b1b44',
  },
  {
    path: 'frameworks/keyed/vanillajs/src/Main.js',
    sha256: '08a5cb7d5cec199396561ed28b3c2db77577f066480f33c19f22ce6b0b0c980f',
  },
  {
    path: 'frameworks/keyed/preact-signals/index.html',
    sha256: 'c381d1b4c79d59ff6b1a72a0a970e991706dc26f870dcea1d894fd364c12e557',
  },
  {
    path: 'frameworks/keyed/preact-signals/src/main.jsx',
    sha256: '12d11e2ca6f26049a8b80f22545a41775d3d98eaaa4dbbc99b4f1d881077a582',
  },
  {
    path: 'frameworks/keyed/lit/index.html',
    sha256: '9b44bd90c69420ff0c5a028f07b3869d76c3b7579af91230e1bb854b437efbad',
  },
  {
    path: 'frameworks/keyed/lit/src/main.ts',
    sha256: 'edb287f1a3ff9cf39c5749892b69afd484b8deb867e2eaa4d92f3257b7d738f6',
  },
  {
    path: 'frameworks/keyed/lit/src/store.ts',
    sha256: 'f5976195e9c2b3239c1821b08f4d6f96c5ab8433758aa72d0bee576c18b7e326',
  },
  {
    path: 'frameworks/keyed/lit/tsconfig.json',
    sha256: '08b0a665245188e480b2e1bb47f229e5891c8337ebd6b99b1c57de4b8e70c212',
  },
  {
    path: 'frameworks/keyed/solid/index.html',
    sha256: 'c381d1b4c79d59ff6b1a72a0a970e991706dc26f870dcea1d894fd364c12e557',
  },
  {
    path: 'frameworks/keyed/solid/src/main.jsx',
    sha256: '6b6a3c2843e37a222202a5d3c567069f033c1b2464aac68f65cee107e18f75e2',
  },
  {
    path: 'frameworks/keyed/vue/index.html',
    sha256: '30846b5e0453fd15397799b494dad3ef71d7778afa0583bd60f7d7779b8f40d0',
  },
  {
    path: 'frameworks/keyed/vue/src/main.js',
    sha256: '50cb9f18b1c7115799ae456f0d0038840278b49ea520b5549d468ec76c248fb9',
  },
  {
    path: 'frameworks/keyed/vue/src/App.vue',
    sha256: '9106cc0b702d1d97ebd7a0a0b22d0684327a49ada355157b3c51a22a3468bca8',
  },
  {
    path: 'frameworks/keyed/vue/src/data.js',
    sha256: '9fb1b13b3dab8b6ce55fc2c88127b260df0b60a15fccd9eb176e43e6ff055f17',
  },
  {
    path: 'frameworks/keyed/svelte/index.html',
    sha256: '237699b8ff66b36170ab2a8d92280e0997951e7a57d4216e04f34e5535032245',
  },
  {
    path: 'frameworks/keyed/svelte/src/main.js',
    sha256: '9d41e9f525c2005693cc9d8ae2cecd8d036edb6be0235d4f0877f33a4cd98c75',
  },
  {
    path: 'frameworks/keyed/svelte/src/Main.svelte',
    sha256: '2f7699f132f12bb9934ec2dead99d10afafd7a2000ba05838f7413654246ae15',
  },
];

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface FetchStockOptions {
  /** Local JFB checkout; must be at JFB_COMMIT. */
  jfbPath?: string;
}

/**
 * Fetch every pinned stock file into `destDir` (preserving the JFB-relative
 * layout) and return the per-file verification record.
 */
export async function fetchStockSources(
  destDir: string,
  options: FetchStockOptions = {},
): Promise<Array<{ path: string; sha256: string; source: 'network' | 'local-checkout' }>> {
  const records: Array<{ path: string; sha256: string; source: 'network' | 'local-checkout' }> = [];
  let localRoot: string | undefined;
  if (options.jfbPath) {
    const rev = new Deno.Command('git', {
      args: ['-C', options.jfbPath, 'rev-parse', 'HEAD'],
      stdout: 'piped',
      stderr: 'piped',
    });
    const result = await rev.output();
    const head = new TextDecoder().decode(result.stdout).trim();
    if (!result.success || head !== JFB_COMMIT) {
      throw new Error(
        `[jfb-harness] local JFB checkout must be at pinned commit ${JFB_COMMIT}, found "${head}"`,
      );
    }
    localRoot = options.jfbPath;
  }
  for (const pinned of PINNED_STOCK_FILES) {
    let bytes: Uint8Array;
    let source: 'network' | 'local-checkout';
    if (localRoot) {
      bytes = await Deno.readFile(join(localRoot, pinned.path));
      source = 'local-checkout';
    } else {
      const url = `https://raw.githubusercontent.com/${JFB_REPO}/${JFB_COMMIT}/${pinned.path}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`[jfb-harness] failed to fetch ${url}: HTTP ${response.status}`);
      }
      bytes = new Uint8Array(await response.arrayBuffer());
      source = 'network';
    }
    const digest = await sha256Hex(bytes);
    if (digest !== pinned.sha256) {
      throw new Error(
        `[jfb-harness] sha256 mismatch for ${pinned.path}: expected ${pinned.sha256}, got ${digest}`,
      );
    }
    const target = join(destDir, pinned.path);
    await Deno.mkdir(join(target, '..'), { recursive: true });
    await Deno.writeFile(target, bytes);
    records.push({ path: pinned.path, sha256: digest, source });
  }
  return records;
}
