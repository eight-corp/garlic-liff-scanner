const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function authWith(fetch) {
  const items = new Map([['business.session.v1', 'saved-session']]);
  const storage = {
    getItem: key => items.get(key) || null,
    setItem: (key, value) => items.set(key, value),
    removeItem: key => items.delete(key),
  };
  const window = { fetch, addEventListener() {} };
  const context = { window, localStorage: storage, sessionStorage: { ...storage, getItem: () => null, removeItem() {} }, Headers, Request, URL, location: { href: 'https://example.com/' } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../shared/business-auth.js'), 'utf8'), context);
  window.BusinessAuth.init('https://example.supabase.co', 'public-key');
  return { auth: window.BusinessAuth, items };
}

test('network failure preserves saved login', async () => {
  const { auth, items } = authWith(async () => { throw new Error('offline'); });
  assert.equal(await auth.session(), null);
  assert.equal(items.get('business.session.v1'), 'saved-session');
});

test('server failure preserves saved login', async () => {
  const { auth, items } = authWith(async () => ({ ok: false, json: async () => ({ message: 'unavailable' }) }));
  assert.equal(await auth.session(), null);
  assert.equal(items.get('business.session.v1'), 'saved-session');
});

test('confirmed invalid session clears saved login', async () => {
  const { auth, items } = authWith(async () => ({ ok: true, json: async () => ({ ok: false, error: 'invalid session' }) }));
  assert.equal(await auth.session(), null);
  assert.equal(items.has('business.session.v1'), false);
});
