/** M12 S2 with the authored Board shared by the source acceptance test. */
import { strict as assert } from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { S2_BOARD } from '../../packages/compiler/__tests__/semantic-ir/testlib/s2-board.ts';
import { assertAuthoredSourceMap, runConsumerOrThrow } from './consumer-packaged-shared.ts';

type Item = { id: string; label: string };
type Cell<T> = { value: T };
type Owner = { dispose(detach?: boolean): void };
type Resources = {
  owners: number;
  regions: number;
  projections: number;
  rangeCleanups: number;
  subscriptions: number;
  unsubscribed: number;
};
type Harness = {
  LifetimeScope: new () => Owner;
  signal<T>(value: T): Cell<T>;
  runtimeProbe: { snapshot(): Resources; reset(): void };
  createBoardRecipe(owner: Owner, host: object): unknown;
  createCompositionRecipe(owner: Owner, host: object): unknown;
  claimRecipe(owner: Owner, recipe: unknown, parent: Node): Owner;
  insertRecipe(owner: Owner, recipe: unknown, parent: Node): Owner;
};

const initial: Item[] = [
  { id: 'a', label: 'A' },
  { id: 'c', label: 'C' },
];

export async function buildPackedBoard(author: string, consumer: string): Promise<void> {
  // Keep the Board's authored body identical to the source acceptance test. The
  // rest of the same module supplies the standalone island policy and the
  // composition sites that the controlled recipe harness claims alongside it.
  await writeFile(
    join(author, 'packed-board.tsx'),
    `${S2_BOARD}
function defineIslandConfig(config) { return config; }
export const openElement = defineIslandConfig({tag: 'packed-board', hydrate: 'load', ssr: true, root: 'shadow'});

function Frame(props) {
  return <main>{props.children}{props.children}</main>;
}

function Composition(props) {
  const label = signal('x');
  const value = <i class="reused">{label.value}</i>;
  return <article>
    {value}{value}
    <Frame><b class="projected">{label.value}</b></Frame>
  </article>;
}
`,
  );
  await writeFile(
    join(author, 'board-browser.js'),
    `import Board, {createBoardRecipe, createCompositionRecipe} from './packed-board.tsx';
import {signal} from '@openelement/element';
import {LifetimeScope} from './node_modules/@openelement/element/src/internal/compiled/lifetime-scope.js';
import {claimRecipe, insertRecipe} from './node_modules/@openelement/element/src/internal/compiled/runtime/recipe.js';
import {runtimeProbe} from './node_modules/@openelement/element/src/internal/compiled/runtime/observability.js';
window.__packedS2 = {createBoardRecipe, createCompositionRecipe, signal, LifetimeScope, claimRecipe, insertRecipe, runtimeProbe};
customElements.define('packed-board', Board);
`,
  );
  await writeFile(
    join(author, 'board-ssr.js'),
    `export {Board__ssr, Board__ssrHost, Composition__ssr} from './packed-board.tsx';\n`,
  );
  await writeFile(
    join(author, 'vite.board.config.js'),
    `import {element} from '@openelement/compiler/vite';
export default ({isSsrBuild}) => ({
  plugins: [
    element({generatedElementSite: (id) => id === 'packed-board.tsx' ? {tag: 'packed-board', root: 'shadow'} : null}),
    {name:'packed-board-boundary', generateBundle(){if(!isSsrBuild) for(const id of this.getModuleIds()){
      if(/compiler|router\\/src\\/(?:vite|cli)|node:/.test(id))this.error('Browser tooling leak: '+id);
    }}},
  ],
  ssr: {noExternal: true},
  build: isSsrBuild
    ? {ssr:'board-ssr.js',outDir:'board-ssr',rollupOptions:{output:{entryFileNames:'board-ssr.js'}}}
    : {outDir:'board-browser',sourcemap:true,lib:{entry:'board-browser.js',formats:['es'],fileName:'board'}},
});`,
  );
  const vite = ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.board.config.js'];
  await runConsumerOrThrow('node', vite, author);
  await runConsumerOrThrow('node', [...vite, '--ssr', 'board-ssr.js'], author);
  const map = JSON.parse(await readFile(join(author, 'board-browser/board.js.map'), 'utf8'));
  assertAuthoredSourceMap(map, 'packed-board.tsx', 10);

  const ssr = (await import(pathToFileURL(join(author, 'board-ssr/board-ssr.js')).href)) as {
    Board__ssr(props: object, host: object): string;
    Board__ssrHost(): string;
    Composition__ssr(props: object, host: object): string;
  };
  const board = ssr.Board__ssr(
    {},
    {
      bindings: { items: { value: initial }, open: { value: true }, count: { value: 0 } },
    },
  );
  const composition = ssr.Composition__ssr({}, { bindings: { label: { value: 'x' } } });
  const boardHost = ssr.Board__ssrHost();
  assert.ok(
    boardHost.includes(`<template shadowrootmode="open">${board}</template>`),
    'the public host producer emits the same Board inside a declarative shadow root',
  );
  assert.match(board, /<!--oe:k:s:61--><li><!--oe:t:0-->A/);
  assert.match(composition, /class="reused"/);

  await writeFile(
    join(consumer, 'board.js'),
    await readFile(join(author, 'board-browser/board.js')),
  );
  await writeFile(join(consumer, 'board.js.map'), JSON.stringify(map));
  await writeFile(
    join(consumer, 'board-upgrade.html'),
    `<!doctype html><meta charset="utf-8">${boardHost}`,
  );
  await writeFile(
    join(consumer, 'board.html'),
    `<!doctype html><meta charset="utf-8">
<div id="board">${board}</div>
<div id="peer">${board}</div>
<div id="composition">${composition}</div>
<div id="invalid-board">${board}</div>
<div id="mount"></div>
<script type="module" src="/board.js"></script>`,
  );
}

async function provePackedBoardUpgrade(page: Page, origin: string): Promise<void> {
  const response = await page.goto(`${origin}/board-upgrade`);
  assert.strictEqual(response?.status(), 200);
  const input = page.locator('packed-board #board-field');
  assert.strictEqual(await input.inputValue(), 'server');
  await input.fill('draft typed before upgrade');
  await page.evaluate(() => {
    const host = document.querySelector('packed-board')!;
    const shadow = host.shadowRoot!;
    const field = shadow.querySelector<HTMLInputElement>('#board-field')!;
    field.setSelectionRange(2, 8);
    const errors: string[] = [];
    window.addEventListener('error', (event) => errors.push(event.message));
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    const observation = { subtree: true, childList: true, attributes: true, characterData: true };
    observer.observe(host, observation);
    observer.observe(shadow, observation);
    Object.assign(window, {
      boardUpgrade: {
        host,
        shadow,
        field,
        errors,
        mutations,
        observer,
        beforeUpgrade: customElements.get('packed-board') === undefined,
        html: shadow.innerHTML,
        rows: [...shadow.querySelectorAll('li')],
      },
    });
  });
  await page.addScriptTag({ url: `${origin}/board.js`, type: 'module' });
  const adoption = await page.evaluate(() => {
    const evidence = (
      window as unknown as {
        boardUpgrade: {
          host: Element;
          shadow: ShadowRoot;
          field: HTMLInputElement;
          errors: string[];
          mutations: MutationRecord[];
          observer: MutationObserver;
          beforeUpgrade: boolean;
          html: string;
          rows: HTMLLIElement[];
        };
      }
    ).boardUpgrade;
    const { host, shadow, field, errors, mutations, observer, beforeUpgrade, html, rows } =
      evidence;
    const mutationCount = mutations.length + observer.takeRecords().length;
    observer.disconnect();
    const ctor = customElements.get('packed-board');
    return {
      errors,
      beforeUpgrade,
      upgraded: ctor !== undefined && host instanceof ctor,
      sameHost: document.querySelector('packed-board') === host,
      sameRoot: host.shadowRoot === shadow,
      sameInput: shadow.querySelector('#board-field') === field,
      sameRows: [...shadow.querySelectorAll('li')].every((row, i) => row === rows[i]),
      sameBytes: shadow.innerHTML === html,
      mutationCount,
      focus: shadow.activeElement === field,
      selection: [field.selectionStart, field.selectionEnd],
      value: field.value,
      attributeValue: field.getAttribute('value'),
    };
  });
  assert.deepStrictEqual(
    adoption,
    {
      errors: [],
      beforeUpgrade: true,
      upgraded: true,
      sameHost: true,
      sameRoot: true,
      sameInput: true,
      sameRows: true,
      sameBytes: true,
      mutationCount: 0,
      focus: true,
      selection: [2, 8],
      value: 'draft typed before upgrade',
      attributeValue: 'server',
    },
    'native upgrade claims the Board in place and keeps the pre-upgrade input state',
  );
  await input.fill('draft typed after upgrade');
  assert.strictEqual(await input.inputValue(), 'draft typed after upgrade');
  assert.deepStrictEqual(await page.locator('packed-board li').allTextContents(), ['A: 1', 'C: 1']);
}

export async function provePackedBoard(page: Page, origin: string): Promise<string> {
  await provePackedBoardUpgrade(page, origin);
  const response = await page.goto(`${origin}/board`);
  assert.strictEqual(response?.status(), 200);
  const proof = await page.evaluate(
    ({ initial }) => {
      const {
        createBoardRecipe,
        createCompositionRecipe,
        signal,
        LifetimeScope,
        claimRecipe,
        insertRecipe,
        runtimeProbe,
      } = (window as unknown as { __packedS2: Harness }).__packedS2;
      const board = document.querySelector('#board')!;
      const peer = document.querySelector('#peer')!;
      const composition = document.querySelector('#composition')!;
      const invalid = document.querySelector('#invalid-board')!;
      const mount = document.querySelector('#mount')!;
      const owner = new LifetimeScope();
      const peerOwner = new LifetimeScope();
      const boardBindings = () => ({
        items: signal(initial),
        open: signal(true),
        count: signal(0),
      });
      const boardRecipe = (bindings: ReturnType<typeof boardBindings>, definitionOwner = owner) =>
        createBoardRecipe(definitionOwner, { props: {}, bindings, propsChanged: signal(0) });
      const rows = (parent: Element) => [...parent.querySelectorAll('li')];
      const labels = (entries: Element[]) => entries.map((entry) => entry.textContent);
      const counts = () => runtimeProbe.snapshot();
      const live = (snapshot: Resources) => snapshot.subscriptions - snapshot.unsubscribed;
      const bindings = boardBindings();
      const [a, c] = rows(board);
      const [peerA, peerC] = rows(peer);
      const draft = board.querySelector<HTMLElement>('#draft')!;
      const draftText = draft.firstChild as Text;
      const selection = window.getSelection()!;
      const selectDraft = () => {
        draft.focus();
        const range = new Range();
        range.setStart(draftText, 1);
        range.setEnd(draftText, 4);
        selection.removeAllRanges();
        selection.addRange(range);
      };
      selectDraft();
      const retainsDraft = (value = 'local draft') =>
        board.querySelector('#draft') === draft &&
        draft.firstChild === draftText &&
        draftText.data === value &&
        document.activeElement === draft &&
        selection.anchorNode === draftText &&
        selection.anchorOffset === 1 &&
        selection.focusNode === draftText &&
        selection.focusOffset === 4;

      const boardHtml = board.innerHTML;
      const observer = new MutationObserver(() => {});
      observer.observe(board, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      runtimeProbe.reset();
      const projection = claimRecipe(owner, boardRecipe(bindings), board);
      const claimedCounts = counts();
      const claim = {
        mutations: observer.takeRecords().length,
        sameBytes: boardHtml === board.innerHTML,
        sameRows: rows(board)[0] === a && rows(board)[1] === c,
        draft: retainsDraft('note'),
      };
      const peerBindings = boardBindings();
      const peerProjection = claimRecipe(peerOwner, boardRecipe(peerBindings, peerOwner), peer);

      const mounted = insertRecipe(owner, boardRecipe(boardBindings()), mount);
      const mountParity =
        mount.querySelector('ul')!.innerHTML === board.querySelector('ul')!.innerHTML;
      mounted.dispose(true);
      const beforeUpdate = counts();

      draftText.data = 'local draft';
      selectDraft();
      bindings.count.value = 7;
      const draftWrite = {
        labels: labels(rows(board)),
        sameRows: rows(board)[0] === a && rows(board)[1] === c,
        focus: retainsDraft(),
      };
      const condition = board.querySelector('.on');
      bindings.items.value = [initial[1]!, initial[0]!];
      const reorder = {
        labels: labels(rows(board)),
        sameRows: rows(board)[0] === c && rows(board)[1] === a,
        sameCondition: board.querySelector('.on') === condition,
        focus: retainsDraft(),
        counts: counts(),
      };
      bindings.items.value = [{ id: 'c', label: 'C updated' }, initial[0]!];
      const replacement = {
        labels: labels(rows(board)),
        sameRows: rows(board)[0] === c && rows(board)[1] === a,
        counts: counts(),
      };
      bindings.items.value = [initial[0]!, { id: 'b', label: 'B' }, initial[1]!];
      const inserted = rows(board);
      const afterInsert = counts();
      const insertion = {
        labels: labels(inserted),
        retained: inserted[0] === a && inserted[2] === c && inserted[1] !== a && inserted[1] !== c,
      };
      bindings.items.value = initial;
      bindings.count.value = 9;
      const deletion = {
        labels: labels(rows(board)),
        kept: rows(board)[0] === a && rows(board)[1] === c,
        detached: !inserted[1]!.isConnected,
        detachedText: inserted[1]!.textContent,
        counts: counts(),
      };
      bindings.open.value = false;
      const close = board.querySelector('.off')?.textContent;
      bindings.open.value = true;
      const toggle = {
        close,
        reopened: board.querySelector('.on')?.textContent,
        sameRows: rows(board)[0] === a && rows(board)[1] === c,
        focus: retainsDraft(),
        peer:
          rows(peer)[0] === peerA &&
          rows(peer)[1] === peerC &&
          labels(rows(peer)).join(',') === 'A: 0,C: 0',
        live: live(counts()),
      };
      // The editable carrier is a static text seed. Restore that seed before
      // exercising a new claim; text edits remain intact across live updates.
      draftText.data = 'note';
      const updatedHtml = board.innerHTML;
      projection.dispose(false);
      const kept = board.innerHTML === updatedHtml && rows(board)[0] === a;
      const afterKeep = counts();
      bindings.count.value = 11;
      peerBindings.count.value = 6;
      const isolation = {
        disposedUnchanged: board.innerHTML === updatedHtml && rows(board)[0] === a,
        peerRows: rows(peer)[0] === peerA && rows(peer)[1] === peerC,
        peerLabels: labels(rows(peer)),
      };
      bindings.count.value = 9;
      const reclaimed = claimRecipe(owner, boardRecipe(bindings), board);
      const sameReclaim = rows(board)[0] === a && board.innerHTML === updatedHtml;
      const afterReclaim = counts();
      reclaimed.dispose(true);
      peerProjection.dispose(true);
      peerOwner.dispose(true);
      const boardCleanup = {
        empty: board.childNodes.length + peer.childNodes.length,
        counts: counts(),
      };
      observer.disconnect();

      runtimeProbe.reset();
      const label = signal('x');
      const compositionNodes = [...composition.querySelectorAll('i, b')];
      const compositionObserver = new MutationObserver(() => {});
      compositionObserver.observe(composition, {
        childList: true,
        characterData: true,
        attributes: true,
        subtree: true,
      });
      const composed = claimRecipe(
        owner,
        createCompositionRecipe(owner, {
          props: {},
          bindings: { label },
          propsChanged: signal(0),
        }),
        composition,
      );
      const compositionClaim = counts();
      const compositionMutations = compositionObserver.takeRecords().length;
      label.value = 'updated';
      const compositionValues = labels([...composition.querySelectorAll('i, b')]);
      const compositionIdentity = compositionNodes.every(
        (node, i) => node === composition.querySelectorAll('i, b')[i],
      );
      composed.dispose(true);
      const compositionCleanup = { empty: composition.childNodes.length, counts: counts() };
      compositionObserver.disconnect();

      // Retain the actual parsed row and corrupt its key marker before claim.
      runtimeProbe.reset();
      const wrongKey = invalid.querySelector('ul')!.childNodes[1] as Comment;
      const key = wrongKey.data;
      const invalidRows = rows(invalid);
      wrongKey.data = 'oe:k:s:7a';
      const invalidObserver = new MutationObserver(() => {});
      invalidObserver.observe(invalid, { childList: true, characterData: true, subtree: true });
      const invalidBytes = invalid.innerHTML;
      let code: unknown;
      try {
        claimRecipe(owner, boardRecipe(boardBindings()), invalid);
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      const rejected = {
        code,
        mutations: invalidObserver.takeRecords().length,
        sameRows: rows(invalid).every((row, i) => row === invalidRows[i]),
        sameBytes: invalid.innerHTML === invalidBytes,
        counts: counts(),
      };
      invalidObserver.disconnect();
      wrongKey.data = key;
      const retry = boardBindings();
      const retried = claimRecipe(owner, boardRecipe(retry), invalid);
      retry.count.value = 5;
      const recovery = {
        live: labels(rows(invalid)),
        sameRows: rows(invalid).every((row, i) => row === invalidRows[i]),
      };
      retried.dispose(true);
      owner.dispose(true);

      return {
        claim,
        claimedCounts,
        mountParity,
        beforeUpdate,
        draftWrite,
        reorder,
        replacement,
        insertion,
        afterInsert,
        deletion,
        toggle,
        kept,
        afterKeep,
        isolation,
        sameReclaim,
        afterReclaim,
        boardCleanup,
        compositionClaim,
        compositionMutations,
        compositionValues,
        compositionIdentity,
        compositionCleanup,
        rejected,
        recovery,
      };
    },
    { initial },
  );

  const live = (snapshot: Resources) => snapshot.subscriptions - snapshot.unsubscribed;
  assert.deepStrictEqual(proof.claim, {
    mutations: 0,
    sameBytes: true,
    sameRows: true,
    draft: true,
  });
  assert.ok(proof.mountParity, 'packed mount and SSR agree on the same authored list');
  assert.ok(
    proof.claimedCounts.owners > 0 && live(proof.claimedCounts) > 0,
    'compiled claims must contribute to the packed probe',
  );
  assert.deepStrictEqual(proof.draftWrite, {
    labels: ['A: 7', 'C: 7'],
    sameRows: true,
    focus: true,
  });
  assert.deepStrictEqual(
    proof.reorder,
    {
      labels: ['C: 7', 'A: 7'],
      sameRows: true,
      sameCondition: true,
      focus: true,
      counts: proof.beforeUpdate,
    },
    'reorder retains resources, identity, focus and selection',
  );
  assert.deepStrictEqual(
    proof.replacement,
    {
      labels: ['C updated: 7', 'A: 7'],
      sameRows: true,
      counts: proof.beforeUpdate,
    },
    'same-key replacement updates text and retains the entry resources',
  );
  assert.deepStrictEqual(proof.insertion, { labels: ['A: 7', 'B: 7', 'C: 7'], retained: true });
  assert.strictEqual(
    live(proof.afterInsert),
    live(proof.beforeUpdate) + 1,
    'insert opens one row subscription',
  );
  assert.deepStrictEqual(proof.deletion.labels, ['A: 9', 'C: 9']);
  assert.ok(proof.deletion.kept && proof.deletion.detached, 'only the removed row is detached');
  assert.strictEqual(
    proof.deletion.detachedText,
    'B: 7',
    'removed row no longer receives draft writes',
  );
  assert.strictEqual(proof.deletion.counts.unsubscribed, proof.afterInsert.unsubscribed + 1);
  assert.strictEqual(live(proof.deletion.counts), live(proof.beforeUpdate));
  assert.deepStrictEqual(proof.toggle, {
    close: 'closed',
    reopened: 'open',
    sameRows: true,
    focus: true,
    peer: true,
    live: live(proof.beforeUpdate),
  });
  assert.ok(
    proof.kept && proof.sameReclaim,
    'dispose(false) preserves borrowed DOM and retry adopts it',
  );
  assert.deepStrictEqual(
    proof.isolation,
    {
      disposedUnchanged: true,
      peerRows: true,
      peerLabels: ['A: 6', 'C: 6'],
    },
    'disposing one Board neither wakes its own bindings nor stops the independent peer',
  );
  assert.strictEqual(live(proof.afterKeep), live(proof.claimedCounts));
  assert.strictEqual(live(proof.afterReclaim), 2 * live(proof.claimedCounts));
  assert.strictEqual(proof.boardCleanup.empty, 0, 'dispose(true) removes the Board region');
  assert.strictEqual(live(proof.boardCleanup.counts), 0, 'all Board subscriptions released');
  assert.strictEqual(proof.compositionMutations, 0);
  assert.ok(
    proof.compositionIdentity,
    'each composition insertion site preserves its distinct node',
  );
  assert.deepStrictEqual(proof.compositionValues, ['updated', 'updated', 'updated', 'updated']);
  assert.strictEqual(
    proof.compositionClaim.projections,
    5,
    'one root and four distinct recipe projections',
  );
  assert.strictEqual(proof.compositionClaim.owners, 5, 'each projection sits in its own owner');
  assert.strictEqual(live(proof.compositionClaim), 4, 'one live subscription per insertion site');
  assert.strictEqual(proof.compositionCleanup.empty, 0);
  assert.strictEqual(live(proof.compositionCleanup.counts), 0, 'composition subs released');
  assert.strictEqual(proof.rejected.code, 'OEIR_LEAF_CLAIM_MISMATCH');
  assert.strictEqual(proof.rejected.mutations, 0);
  assert.ok(proof.rejected.sameRows && proof.rejected.sameBytes);
  assert.strictEqual(proof.rejected.counts.projections, 0);
  assert.strictEqual(proof.rejected.counts.subscriptions, 0);
  assert.deepStrictEqual(proof.recovery, { live: ['A: 5', 'C: 5'], sameRows: true });
  return `same authored S2 Board host SSR/native upgrade with pre-activation input; recipe SSR/claim/mount: own draft, focus/selection, replace/reorder/insert/delete, owner isolation, composition, dispose and keyed mismatch/retry; Board liveSubs=${live(proof.claimedCounts)}→0, composed owners=${proof.compositionClaim.owners}`;
}
