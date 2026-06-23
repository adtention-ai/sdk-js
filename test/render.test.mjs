import test from 'node:test';
import assert from 'node:assert/strict';
import { SponsorSlot, MemoryIdentityStore, getSponsorLine, AdtentionError } from '../dist/index.js';
import { fakeResponse, recordingFetch } from './_harness.mjs';

const API = 'https://api.example.test';

test('serveOnly + identityStore is rejected at construction (contradictory)', () => {
  assert.throws(
    () => new SponsorSlot({ apiBase: API, publisherId: 'pub_deadbeef', serveOnly: true, identityStore: new MemoryIdentityStore(), fetch: globalThis.fetch }),
    (e) => e instanceof AdtentionError && e.code === 'serve_only',
  );
});

const adResponse = (text = 'hi', id = 'imp_1') =>
  fakeResponse(200, { ad_id: 'c_x', text, click_url: `/v1/click/${id}`, impression_id: id, category: 'web', billable: true, credit: 0.01, balance_usd: 1 });

test('identityStore: a failed first register degrades to null (no throw) and retries next call', async () => {
  let registerCalls = 0;
  const { fetch } = recordingFetch((path) => {
    if (path === '/v1/register') {
      registerCalls += 1;
      if (registerCalls === 1) return fakeResponse(500, { error: 'server_error' }); // first attempt fails
      return fakeResponse(200, { publisher_id: 'pub_abc123ff', secret: 's', referral_code: 'wxyz234' });
    }
    return adResponse(); // serve
  });
  const errors = [];
  const slot = new SponsorSlot({ apiBase: API, identityStore: new MemoryIdentityStore(), fetch, onError: (e) => errors.push(e) });

  const first = await slot.next();   // register fails on our side
  assert.equal(first, null);         // degraded, did NOT throw into the caller
  assert.ok(errors.length >= 1);     // reported via onError instead

  const second = await slot.next();  // latch cleared -> retries register (succeeds) -> serves
  assert.ok(second && second.text);  // got an ad
  assert.equal(registerCalls, 2);    // it retried, was not permanently latched
});

test('next() dwell-gates: a second call within dwell reuses cache, no extra serve', async () => {
  const { fetch, calls } = recordingFetch(() => adResponse());
  const slot = new SponsorSlot({ apiBase: API, publisherId: 'pub_deadbeef', fetch, dwellMs: 15000 });
  const a = await slot.next({ subject: 'u1' });
  const b = await slot.next({ subject: 'u1' });
  assert.equal(a.fromCache, false);
  assert.equal(b.fromCache, true);          // served from cache
  assert.equal(b.text, 'hi');
  assert.equal(calls.length, 1);            // only ONE network serve
});

test('different subjects each get their own serve (not cross-throttled)', async () => {
  const { fetch, calls } = recordingFetch(() => adResponse());
  const slot = new SponsorSlot({ apiBase: API, publisherId: 'pub_deadbeef', fetch, dwellMs: 15000 });
  await slot.next({ subject: 'u1' });
  await slot.next({ subject: 'u2' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.subject, 'u1');
  assert.equal(calls[1].body.subject, 'u2');
});

test('with dwellMs 0 every call serves afresh', async () => {
  const { fetch, calls } = recordingFetch(() => adResponse());
  const slot = new SponsorSlot({ apiBase: API, publisherId: 'pub_deadbeef', fetch, dwellMs: 0 });
  await slot.next({ subject: 'u1' });
  await slot.next({ subject: 'u1' });
  assert.equal(calls.length, 2);
});

test('a serve error never throws into the UI: falls back to cache and reports via onError', async () => {
  let n = 0;
  const errors = [];
  const { fetch } = recordingFetch(() => (n++ === 0 ? adResponse('first') : fakeResponse(503, { error: 'no_inventory' })));
  const slot = new SponsorSlot({ apiBase: API, publisherId: 'pub_deadbeef', fetch, dwellMs: 0, onError: (e) => errors.push(e.code) });
  const a = await slot.next({ subject: 'u1' });
  const b = await slot.next({ subject: 'u1' });
  assert.equal(a.text, 'first');
  assert.equal(b.text, 'first');     // stale cache returned instead of throwing
  assert.equal(b.fromCache, true);
  assert.deepEqual(errors, ['no_inventory']);
});

test('no cache + error yields null (nothing to show), still no throw', async () => {
  const { fetch } = recordingFetch(() => fakeResponse(503, { error: 'no_inventory' }));
  const slot = new SponsorSlot({ apiBase: API, publisherId: 'pub_deadbeef', fetch, dwellMs: 0 });
  assert.equal(await slot.next({ subject: 'u1' }), null);
});

test('managed identity: registers once, persists, and serves under the new id', async () => {
  const store = new MemoryIdentityStore();
  const { fetch, calls } = recordingFetch((path) => {
    if (path === '/v1/register') return fakeResponse(200, { publisher_id: 'pub_new00001', secret: 's', referral_code: 'r' });
    return adResponse();
  });
  const slot = new SponsorSlot({ apiBase: API, fetch, dwellMs: 0, identityStore: store, ref: 'inviter1' });
  await slot.next({ subject: 'u1' });
  assert.equal(store.load().publisherId, 'pub_new00001'); // persisted
  assert.equal(calls[0].path, '/v1/register');
  assert.equal(calls[0].body.ref, 'inviter1');            // referral rode the first register
  assert.equal(calls[1].body.publisher_id, 'pub_new00001');
});

test('managed identity self-heals on unknown_publisher (re-register, no re-attribution)', async () => {
  const store = new MemoryIdentityStore({ publisherId: 'pub_stale0001' });
  let registered = 0;
  const { fetch } = recordingFetch((path, _m, _i) => {
    if (path === '/v1/register') { registered++; return fakeResponse(200, { publisher_id: 'pub_fresh0001', secret: 's', referral_code: 'r' }); }
    // stale id is rejected once; the healed id serves fine
    return store.load().publisherId === 'pub_stale0001'
      ? fakeResponse(404, { error: 'unknown_publisher' })
      : adResponse('healed');
  });
  const slot = new SponsorSlot({ apiBase: API, fetch, dwellMs: 0, identityStore: store, ref: 'inviter1' });
  const ad = await slot.next({ subject: 'u1' });
  assert.equal(ad.text, 'healed');
  assert.equal(registered, 1);
  assert.equal(store.load().publisherId, 'pub_fresh0001');
});

test('fixed publisherId is NEVER silently re-registered on unknown_publisher', async () => {
  let registered = 0;
  const { fetch } = recordingFetch((path) => {
    if (path === '/v1/register') { registered++; return fakeResponse(200, { publisher_id: 'pub_x', secret: 's', referral_code: 'r' }); }
    return fakeResponse(404, { error: 'unknown_publisher' });
  });
  const slot = new SponsorSlot({ apiBase: API, publisherId: 'pub_fixed0001', fetch, dwellMs: 0 });
  const ad = await slot.next({ subject: 'u1' });
  assert.equal(ad, null);          // no ad, but...
  assert.equal(registered, 0);     // ...we did NOT mint a new earning account
});

test('getSponsorLine one-shot returns a line, null on error', async () => {
  const ok = recordingFetch(() => adResponse('one-shot'));
  assert.equal((await getSponsorLine({ apiBase: API, publisherId: 'pub_deadbeef', fetch: ok.fetch, category: 'web' })).text, 'one-shot');
  const bad = recordingFetch(() => fakeResponse(503, { error: 'no_inventory' }));
  assert.equal(await getSponsorLine({ apiBase: API, publisherId: 'pub_deadbeef', fetch: bad.fetch }), null);
});
