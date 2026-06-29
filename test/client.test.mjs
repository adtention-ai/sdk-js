import test from 'node:test';
import assert from 'node:assert/strict';
import { AdtentionClient, AdtentionError } from '../dist/index.js';
import { fakeResponse, recordingFetch } from './_harness.mjs';

const API = 'https://api.example.test';

test('register maps snake_case -> camelCase and adopts the identity', async () => {
  const { fetch } = recordingFetch(() =>
    fakeResponse(200, { publisher_id: 'pub_abc123ff', secret: 's3cr3t', referral_code: 'wxyz234' }));
  const c = new AdtentionClient({ apiBase: API, fetch });
  const r = await c.register({ ref: 'inviter1' });
  assert.equal(r.publisherId, 'pub_abc123ff');
  assert.equal(r.secret, 's3cr3t');
  assert.equal(r.referralCode, 'wxyz234');
  assert.equal(c.publisherId, 'pub_abc123ff'); // adopted, can serve immediately
});

test('serve sanitizes ad text, derives camelCase, sends publisher_id + nonce', async () => {
  const { fetch, calls } = recordingFetch((path) => {
    assert.equal(path, '/v1/serve');
    return fakeResponse(200, {
      ad_id: 'c_vercel', text: '\x1b[36m▲ Vercel\x1b[0m\n', click_url: '/v1/click/imp_1',
      impression_id: 'imp_1', category: 'web', billable: true, credit: 0.012, balance_usd: 0.34,
    });
  });
  const c = new AdtentionClient({ apiBase: API, publisherId: 'pub_deadbeef', fetch });
  const res = await c.serve({ category: 'web', subject: 'u1' });
  assert.equal(res.text, '▲ Vercel'); // escape + newline stripped
  assert.equal(res.adId, 'c_vercel');
  assert.equal(res.clickUrl, `${API}/v1/click/imp_1`); // relative resolved to absolute
  assert.equal(res.billable, true);
  assert.equal(res.credit, 0.012);
  assert.equal(res.category, 'web');
  assert.equal(res.dedup, false);
  // body carried the publisher, category, subject, and an auto nonce
  assert.equal(calls[0].body.publisher_id, 'pub_deadbeef');
  assert.equal(calls[0].body.category, 'web');
  assert.equal(calls[0].body.subject, 'u1');
  assert.ok(typeof calls[0].body.nonce === 'string' && calls[0].body.nonce.length > 0);
});

test('the `client` field is never sent on register or serve (derived server-side from the publisher)', async () => {
  const { fetch, calls } = recordingFetch((path) =>
    path === '/v1/register'
      ? fakeResponse(200, { publisher_id: 'pub_abc123ff', secret: 's', referral_code: 'wxyz234' })
      : fakeResponse(200, { ad_id: 'c_x', text: 'hi', impression_id: 'imp_1', billable: true, credit: 0.01 }));
  const c = new AdtentionClient({ apiBase: API, publisherId: 'pub_deadbeef', fetch });
  await c.register();
  await c.serve({ category: 'web', subject: 'u1' });
  assert.ok(!('client' in calls[0].body)); // register: absent, not null/empty
  assert.ok(!('client' in calls[1].body)); // serve: absent, not null/empty
});

test('serveOnly without a publisherId throws at construction', () => {
  assert.throws(() => new AdtentionClient({ apiBase: API, serveOnly: true, fetch: globalThis.fetch }), (e) => {
    assert.ok(e instanceof AdtentionError);
    assert.equal(e.code, 'no_publisher');
    return true;
  });
});

test('serveOnly disables register()', async () => {
  const { fetch, calls } = recordingFetch(() => fakeResponse(200, {}));
  const c = new AdtentionClient({ apiBase: API, publisherId: 'pub_deadbeef', serveOnly: true, fetch });
  await assert.rejects(() => c.register(), (e) => e instanceof AdtentionError && e.code === 'serve_only');
  assert.equal(calls.length, 0); // never hit the network
});

test('serveOnly still serves normally with a provisioned publisherId', async () => {
  const { fetch, calls } = recordingFetch(() =>
    fakeResponse(200, { ad_id: 'c_x', text: 'hi', impression_id: 'imp_1', billable: true, credit: 0.01 }));
  const c = new AdtentionClient({ apiBase: API, publisherId: 'pub_deadbeef', serveOnly: true, fetch });
  const res = await c.serve({ category: 'web', subject: 'u1' });
  assert.equal(res.billable, true);
  assert.ok(!('client' in calls[0].body));
});

test('serve derives clickUrl on a deduped replay (server omits click_url)', async () => {
  const { fetch } = recordingFetch(() =>
    fakeResponse(200, { ad_id: 'c_x', text: 'hi', impression_id: 'imp_9', billable: false, dedup: true, balance_usd: 1 }));
  const c = new AdtentionClient({ apiBase: API, publisherId: 'pub_deadbeef', fetch });
  const res = await c.serve({ category: 'web', nonce: 'fixed' });
  assert.equal(res.dedup, true);
  assert.equal(res.clickUrl, `${API}/v1/click/imp_9`); // derived from impression_id
  assert.equal(res.category, null); // server didn't echo it on dedup
  assert.equal(res.credit, 0);
});

test('serve throws a typed AdtentionError on no_inventory (503)', async () => {
  const { fetch } = recordingFetch(() => fakeResponse(503, { error: 'no_inventory', status: 503 }));
  const c = new AdtentionClient({ apiBase: API, publisherId: 'pub_deadbeef', fetch });
  await assert.rejects(() => c.serve({ category: 'web' }), (e) => {
    assert.ok(e instanceof AdtentionError);
    assert.equal(e.code, 'no_inventory');
    assert.equal(e.isNoInventory, true);
    assert.equal(e.status, 503);
    return true;
  });
});

test('serve throws unknown_publisher (404) with the flag set', async () => {
  const { fetch } = recordingFetch(() => fakeResponse(404, { error: 'unknown_publisher', status: 404 }));
  const c = new AdtentionClient({ apiBase: API, publisherId: 'pub_deadbeef', fetch });
  await assert.rejects(() => c.serve({}), (e) => e instanceof AdtentionError && e.isUnknownPublisher);
});

test('resolveClickUrl refuses non-web schemes (no file://, no custom handlers)', () => {
  const c = new AdtentionClient({ apiBase: API, publisherId: 'pub_deadbeef', fetch: async () => fakeResponse(200, {}) });
  assert.equal(c.resolveClickUrl('/v1/click/x'), `${API}/v1/click/x`);
  assert.equal(c.resolveClickUrl('https://advertiser.com'), 'https://advertiser.com');
  assert.equal(c.resolveClickUrl('file:///etc/passwd'), null);
  assert.equal(c.resolveClickUrl('javascript:alert(1)'), null);
});

test('recordClick returns the 302 Location (web-only) and null for unknown', async () => {
  const { fetch } = recordingFetch((path) =>
    path.includes('imp_known')
      ? fakeResponse(302, null, { location: 'https://advertiser.com/landing' })
      : fakeResponse(404, { error: 'unknown_impression' }));
  const c = new AdtentionClient({ apiBase: API, publisherId: 'pub_deadbeef', fetch });
  assert.equal(await c.recordClick('imp_known'), 'https://advertiser.com/landing');
  assert.equal(await c.recordClick('imp_missing'), null);
});

test('balance maps every field', async () => {
  const { fetch } = recordingFetch(() => fakeResponse(200, {
    balance_usd: 1.5, billable_impressions: 12, threshold: 10, payable: false, bound: true,
    referral_code: 'abc2345', referred_by: 'pub_parent01', ref_balance_usd: 0.2,
    referral_count: 3, referral_threshold: 100, referral_payable: false,
  }));
  const c = new AdtentionClient({ apiBase: API, publisherId: 'pub_deadbeef', fetch });
  const b = await c.balance();
  assert.equal(b.balanceUsd, 1.5);
  assert.equal(b.billableImpressions, 12);
  assert.equal(b.bound, true);
  assert.equal(b.referralCode, 'abc2345');
  assert.equal(b.referredBy, 'pub_parent01');
  assert.equal(b.referralCount, 3);
});

test('serve without a publisher id throws before any network call', async () => {
  let hit = false;
  const c = new AdtentionClient({ apiBase: API, fetch: async () => { hit = true; return fakeResponse(200, {}); } });
  await assert.rejects(() => c.serve({}), (e) => e instanceof AdtentionError && e.code === 'no_publisher');
  assert.equal(hit, false);
});

test('a network failure surfaces as AdtentionError(network_error)', async () => {
  const c = new AdtentionClient({ apiBase: API, publisherId: 'pub_deadbeef', fetch: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(() => c.serve({}), (e) => e instanceof AdtentionError && e.code === 'network_error');
});
