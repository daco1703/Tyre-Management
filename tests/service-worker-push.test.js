import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function worker({ windows = [] } = {}) {
  const handlers = {}, shown = [], opened = [], messages = [];
  const self = {
    location: { origin: 'https://fleet.example' },
    addEventListener: (name, fn) => { handlers[name] = fn; },
    registration: { showNotification: async (...args) => shown.push(args) },
    clients: {
      matchAll: async () => windows,
      openWindow: async url => opened.push(url),
    },
  };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, URL });
  const dispatch = async (name, data = {}) => {
    let promise;
    handlers[name]({ ...data, waitUntil: value => { promise = value; } });
    await promise;
  };
  return { dispatch, shown, opened, messages };
}

test('service worker shows reminder push while no app window is open', async () => {
  const w = worker();
  await w.dispatch('push', { data: { json: () => ({ title: 'Shepards', body: '3 inspection reminders', tag: 'daily', url: 'https://other.example', data: { kind: 'reminders' } }) } });
  assert.equal(w.shown.length, 1);
  assert.equal(w.shown[0][0], 'Shepards');
  assert.equal(w.shown[0][1].body, '3 inspection reminders');
  assert.equal(w.shown[0][1].data.url, '/?reminders=1');
  assert.equal(w.shown[0][1].data.kind, 'reminders');
});

test('malformed and unrelated pushes cannot cause an unhandled event or notification', async () => {
  const w = worker();
  for (const data of [undefined, { json: () => { throw new Error('bad JSON'); } }, { json: () => null }, { json: () => ({ data: { kind: 'other' } }) }])
    await w.dispatch('push', { data });
  assert.equal(w.shown.length, 0);
});

test('notification click opens only the app reminders route', async () => {
  const w = worker(); let closed = false;
  await w.dispatch('notificationclick', { notification: { close: () => { closed = true; }, data: { url: 'https://untrusted.example' } } });
  assert.equal(closed, true);
  assert.deepEqual(w.opened, ['https://fleet.example/?reminders=1']);
});

test('notification click focuses an existing same-origin client and signals reminders', async () => {
  let focused = false; const messages = [];
  const w = worker({ windows: [
    { url: 'https://other.example', focus: () => assert.fail('external window') },
    { url: 'https://fleet.example/', postMessage: msg => messages.push(msg), focus: async () => { focused = true; } },
  ] });
  await w.dispatch('notificationclick', { notification: { close() {} } });
  assert.equal(focused, true);
  assert.equal(messages[0].type, 'fleet-reminders-open');
  assert.equal(w.opened.length, 0);
});

test('expired browser subscriptions request a foreground recheck without automatic consent', async () => {
  const messages = [];
  const w = worker({ windows: [{ url: 'https://fleet.example/', postMessage: msg => messages.push(msg) }] });
  await w.dispatch('pushsubscriptionchange');
  assert.equal(messages[0].type, 'fleet-push-subscription-changed');
  assert.equal(w.shown.length, 0);
});
