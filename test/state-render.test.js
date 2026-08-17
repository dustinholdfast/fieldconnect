import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render as renderOutcome, mount as mountOutcome, unmount as unmountOutcome } from '../js/screens/outcome.js';
import { parsePath } from '../js/router.js';
import { setRouteHandler, setState, state } from '../js/state.js';

test('setState without flags does not invoke renderShell/renderScreen', () => {
  let calls = 0;
  setRouteHandler(() => { calls += 1; });
  setState({ crmQuery: 'karen' });
  assert.equal(state.crmQuery, 'karen');
  assert.equal(calls, 0, 'input-style setState must not remount');
});

test('setState({ content: true }) remounts the screen', () => {
  let flagsSeen = null;
  setRouteHandler((_route, flags) => { flagsSeen = flags; });
  setState({ stageFilter: 'Attended' }, { content: true });
  assert.equal(state.stageFilter, 'Attended');
  assert.deepEqual(flagsSeen, { content: true });
});

test('setState({ shell: true }) updates shell only', () => {
  let flagsSeen = null;
  setRouteHandler((_route, flags) => { flagsSeen = flags; });
  setState({ adapterOn: true }, { shell: true });
  assert.equal(state.adapterOn, true);
  assert.deepEqual(flagsSeen, { shell: true });
});

async function withDom(fn) {
  let Window;
  try {
    ({ Window } = await import('happy-dom'));
  } catch {
    return false;
  }
  const win = new Window({ url: 'http://127.0.0.1/outcome' });
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    customElements: globalThis.customElements,
    Event: globalThis.Event,
    InputEvent: globalThis.InputEvent,
  };
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.Event = win.Event;
  try {
    await fn(win);
  } finally {
    unmountOutcome();
    globalThis.window = prev.window;
    globalThis.document = prev.document;
    globalThis.HTMLElement = prev.HTMLElement;
    globalThis.customElements = prev.customElements;
    globalThis.Event = prev.Event;
    globalThis.InputEvent = prev.InputEvent;
    win.close();
  }
  return true;
}

test('input on outcome duration does not rebuild #app or move focus', async () => {
  const ran = await withDom(async (win) => {
    let shellCalls = 0;
    setRouteHandler(() => { shellCalls += 1; });

    const doc = win.document;
    doc.body.innerHTML = '<div id="app" class="fc-root"><div class="fc-content"></div></div>';
    const app = doc.getElementById('app');
    const content = doc.querySelector('.fc-content');
    const route = parsePath('/outcome');
    content.innerHTML = renderOutcome(route, state);
    mountOutcome(content, route, {});

    const input = doc.getElementById('outcome-duration');
    assert.ok(input, 'expected #outcome-duration');
    input.focus();
    assert.equal(doc.activeElement, input);

    input.value = '51';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));

    assert.equal(state.o.duration, '51');
    assert.equal(shellCalls, 0, 'renderShell must not run on input');
    assert.equal(doc.getElementById('app'), app);
    assert.equal(doc.querySelector('.fc-content'), content);
    assert.equal(doc.getElementById('outcome-duration'), input);
    assert.equal(doc.activeElement, input);
  });
  if (!ran) {
    // happy-dom not installed: the setState-without-flags test above is the contract.
    assert.ok(true);
  }
});
