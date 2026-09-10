/**
 * WTR overlay matrix (#1339 §5 case 8, Beta.2.2): the dialog/dropdown slice
 * of the alpha-maturation "First cases", run against the REAL production
 * packages/ui components compiled through the pilot's official fixture path
 * (tools/compile-fixtures.ts -> generated/open-dialog.ts /
 * generated/open-dropdown.ts; their component-recipes.ts / instance-state.ts
 * imports are served from packages/ui/src by the ui-source plugin — no
 * copies, no parallel fakes).
 *
 * Contracts asserted in Chromium, Firefox and WebKit:
 *   - Escape closes (dialog cancel handler; popover native light dismiss),
 *   - light dismiss on an outside pointer press (dropdown popover),
 *   - focus returns to the trigger after dismiss,
 *   - repeated open/close cycles keep node identity and single event counts,
 *   - disconnect/reconnect leaves a clean, working component.
 *
 * Trusted input (Escape, pointer) goes through @web/test-runner-commands
 * sendKeys/sendMouse (Playwright input pipeline) because synthetic untrusted
 * events do not trigger native cancel/light-dismiss. No sleeps: every async
 * settle is awaited through waitFor predicates.
 */
import { assert } from 'chai';
import { sendKeys, sendMouse } from '@web/test-runner-commands';
import { OpenDialog } from '../generated/open-dialog.ts';
import { OpenDropdown } from '../generated/open-dropdown.ts';

customElements.define('open-dialog', OpenDialog);
customElements.define('open-dropdown', OpenDropdown);
await Promise.all([
  customElements.whenDefined('open-dialog'),
  customElements.whenDefined('open-dropdown'),
]);

/** Poll a predicate on animation frames; fail with a label on timeout. */
async function waitFor(predicate, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  assert.fail(`timed out waiting for ${label}`);
}

/** The focused element across shadow-root boundaries. */
function deepActive() {
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

function setupDialog() {
  const host = document.createElement('open-dialog');
  host.setAttribute('label', 'Platform dialog');
  const trigger = document.createElement('button');
  trigger.slot = 'trigger';
  trigger.textContent = 'Open dialog';
  const body = document.createElement('p');
  body.textContent = 'Dialog body';
  host.append(trigger, body);
  document.body.appendChild(host);
  return { host, trigger };
}

function setupDropdown() {
  // Keep the host away from the [5,5] outside-click point.
  const wrap = document.createElement('div');
  wrap.style.margin = '120px 0 0 120px';
  const host = document.createElement('open-dropdown');
  const trigger = document.createElement('button');
  trigger.slot = 'trigger';
  trigger.textContent = 'Menu';
  const item = document.createElement('button');
  item.textContent = 'Item one';
  host.append(trigger, item);
  wrap.appendChild(host);
  document.body.appendChild(wrap);
  return { host, trigger, item, wrap };
}

function dialogEl(host) {
  return host.shadowRoot.querySelector('dialog');
}

function contentEl(host) {
  return host.shadowRoot.querySelector('.content');
}

describe('overlay contract: open-dialog (production packages/ui component)', () => {
  it('trigger opens the modal dialog, Escape closes it, focus returns to the trigger', async () => {
    const { host, trigger } = setupDialog();
    await waitFor(() => dialogEl(host) !== null, 'dialog shadow render');

    trigger.focus();
    trigger.click();
    await waitFor(() => dialogEl(host).open, 'dialog open');
    assert.strictEqual(dialogEl(host).matches(':modal'), true, 'showModal() entered the top layer');
    assert.strictEqual(host.hasAttribute('open'), true, 'the open property reflects');

    await sendKeys({ press: 'Escape' });
    await waitFor(() => !dialogEl(host).open, 'Escape-driven close');
    assert.strictEqual(host.hasAttribute('open'), false, 'host state followed the cancel');
    await waitFor(
      () => deepActive() === trigger,
      'focus restored to the trigger after the modal session',
    );

    host.remove();
  });

  it('repeated open/close cycles keep the dialog node and fire one close event per close', async () => {
    const { host, trigger } = setupDialog();
    await waitFor(() => dialogEl(host) !== null, 'dialog shadow render');
    const dialog = dialogEl(host);
    const closeButton = host.shadowRoot.querySelector('.dialog-close');
    let closeEvents = 0;
    host.addEventListener('open-dialog-close', () => closeEvents++);

    for (let cycle = 0; cycle < 3; cycle++) {
      trigger.click();
      await waitFor(() => dialog.open, `open cycle ${cycle}`);
      closeButton.click();
      await waitFor(() => !dialog.open, `close cycle ${cycle}`);
      assert.strictEqual(host.shadowRoot.querySelector('dialog'), dialog, 'dialog node kept');
    }
    assert.strictEqual(closeEvents, 3, 'exactly one open-dialog-close per close');

    host.remove();
  });

  it('disconnect/reconnect leaves a working dialog with single-event closes', async () => {
    const { host, trigger } = setupDialog();
    await waitFor(() => dialogEl(host) !== null, 'dialog shadow render');
    const dialog = dialogEl(host);
    let closeEvents = 0;
    host.addEventListener('open-dialog-close', () => closeEvents++);

    trigger.click();
    await waitFor(() => dialog.open, 'open before disconnect');
    host.shadowRoot.querySelector('.dialog-close').click();
    await waitFor(() => !dialog.open, 'close before disconnect');

    host.remove();
    document.body.appendChild(host);
    await waitFor(() => host.isConnected && dialogEl(host) === dialog, 'reconnect in place');

    trigger.click();
    await waitFor(() => dialog.open, 'open after reconnect');
    host.shadowRoot.querySelector('.dialog-close').click();
    await waitFor(() => !dialog.open, 'close after reconnect');
    assert.strictEqual(closeEvents, 2, 'no duplicated close events after reconnect');

    host.remove();
  });
});

describe('overlay contract: open-dropdown (production packages/ui component)', () => {
  // Focus-return ordering contract: the popover 'open' toggle event is
  // dispatched in a queued task. Focus entering the popover BEFORE that task
  // runs (same-task programmatic focus from a composing menu widget, on either
  // the trigger-click path or a direct showPopover() call) must still return
  // on close — the component anchors its record at the synchronous
  // 'beforetoggle' point, so the queued 'open' handler cannot wipe it. The
  // first test models the plain user path (focus moves after the open toggle
  // settles); the next two pin the racy orderings against regression.
  it('trigger opens the popover, Escape closes it, focus returns to the trigger', async () => {
    const { host, trigger, item, wrap } = setupDropdown();
    await waitFor(() => contentEl(host) !== null, 'dropdown shadow render');
    const content = contentEl(host);
    let openSettled = false;
    content.addEventListener('toggle', (event) => {
      if (event.newState === 'open') openSettled = true;
    });

    trigger.focus();
    trigger.click();
    await waitFor(() => content.matches(':popover-open'), 'popover open');
    await waitFor(() => openSettled, 'open toggle event settled');

    // The component restores focus only when the popover actually held it.
    item.focus();
    assert.strictEqual(deepActive(), item, 'focus moved into the popover');

    await sendKeys({ press: 'Escape' });
    await waitFor(() => !content.matches(':popover-open'), 'Escape light dismiss');
    await waitFor(
      () => deepActive() === trigger,
      'focus restored to the trigger after Escape',
    );

    wrap.remove();
  });

  it('same-task focus into the popover on open still returns focus on Escape (race regression)', async () => {
    const { host, trigger, item, wrap } = setupDropdown();
    await waitFor(() => contentEl(host) !== null, 'dropdown shadow render');
    const content = contentEl(host);

    trigger.focus();
    // The menu-button composition pattern: the opening click moves focus to
    // the first item synchronously — BEFORE the queued 'open' toggle task
    // runs. A focusin record wiped by that task would silently disable focus
    // return; the synchronous 'beforetoggle' anchor must not lose it.
    trigger.click();
    item.focus();
    assert.strictEqual(deepActive(), item, 'focus moved into the popover in the opening task');
    await waitFor(() => content.matches(':popover-open'), 'popover open');

    await sendKeys({ press: 'Escape' });
    await waitFor(() => !content.matches(':popover-open'), 'Escape light dismiss');
    await waitFor(
      () => deepActive() === trigger,
      'focus restored to the trigger after the same-task race',
    );

    wrap.remove();
  });

  it('direct showPopover() open with same-task focus still returns focus on Escape (race regression)', async () => {
    const { host, trigger, item, wrap } = setupDropdown();
    await waitFor(() => contentEl(host) !== null, 'dropdown shadow render');
    const content = contentEl(host);

    trigger.focus();
    // An open path that never passes through toggle(): the host component
    // calls showPopover() itself, and a composing widget moves focus into the
    // popover synchronously. The return-focus target can only come from the
    // synchronous 'beforetoggle' capture, and the focusin record must survive
    // the queued 'open' toggle task.
    content.showPopover();
    item.focus();
    assert.strictEqual(deepActive(), item, 'focus moved into the popover in the opening task');
    await waitFor(() => content.matches(':popover-open'), 'popover open');

    await sendKeys({ press: 'Escape' });
    await waitFor(() => !content.matches(':popover-open'), 'Escape light dismiss');
    await waitFor(
      () => deepActive() === trigger,
      'focus restored to the trigger after the direct-showPopover race',
    );

    wrap.remove();
  });

  it('an outside pointer press light-dismisses the popover', async () => {
    const { host, trigger, wrap } = setupDropdown();
    await waitFor(() => contentEl(host) !== null, 'dropdown shadow render');
    const content = contentEl(host);

    trigger.click();
    await waitFor(() => content.matches(':popover-open'), 'popover open');

    // Bottom-right corner: away from the trigger AND from the popover box
    // (in Chromium the anchored popover lands near the top-left here).
    await sendMouse({ type: 'click', position: [700, 500] });
    await waitFor(() => !content.matches(':popover-open'), 'light dismiss on outside press');

    wrap.remove();
  });

  it('repeated open/close cycles keep the content node and fire settled toggle events', async () => {
    const { host, trigger, wrap } = setupDropdown();
    await waitFor(() => contentEl(host) !== null, 'dropdown shadow render');
    const content = contentEl(host);
    // Per the HTML spec, toggle events are queued as tasks and coalesce when
    // the popover flips back before the task runs — so each transition here is
    // explicitly settled (state AND its event) before the next click.
    let opens = 0;
    let closes = 0;
    content.addEventListener('toggle', (event) => {
      if (event.newState === 'open') opens++;
      if (event.newState === 'closed') closes++;
    });

    for (let cycle = 0; cycle < 3; cycle++) {
      trigger.click();
      await waitFor(() => content.matches(':popover-open'), `open cycle ${cycle}`);
      await waitFor(() => opens === cycle + 1, `open toggle event cycle ${cycle}`);
      trigger.click();
      await waitFor(() => !content.matches(':popover-open'), `close cycle ${cycle}`);
      await waitFor(() => closes === cycle + 1, `close toggle event cycle ${cycle}`);
      assert.strictEqual(contentEl(host), content, 'content node kept');
    }
    assert.strictEqual(opens, 3, 'exactly one open toggle per settled cycle');
    assert.strictEqual(closes, 3, 'exactly one close toggle per settled cycle');

    wrap.remove();
  });

  it('disconnect/reconnect keeps the anchor pairing and a working toggle', async () => {
    const { host, trigger, wrap } = setupDropdown();
    await waitFor(() => contentEl(host) !== null, 'dropdown shadow render');
    const content = contentEl(host);
    const anchorName = host.style.getPropertyValue('anchor-name');
    assert.notStrictEqual(anchorName, '', 'anchor name assigned at activation');

    host.remove();
    wrap.appendChild(host);
    await waitFor(() => host.isConnected && contentEl(host) === content, 'reconnect in place');
    assert.strictEqual(
      host.style.getPropertyValue('anchor-name'),
      anchorName,
      'the realm-unique anchor name survives reconnect',
    );

    trigger.click();
    await waitFor(() => content.matches(':popover-open'), 'open after reconnect');
    await sendKeys({ press: 'Escape' });
    await waitFor(() => !content.matches(':popover-open'), 'close after reconnect');

    wrap.remove();
  });
});
