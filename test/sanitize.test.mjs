import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAd, stripAnsi, visibleWidth, classify, classifyFiles, CATEGORIES, isCategory, newNonce, hashSubject } from '../dist/index.js';

test('sanitizeAd strips ANSI/escape injection and trims', () => {
  // a malicious ad trying to inject a red-color escape + a fake prompt via newline
  const evil = '\x1b[31mBUY NOW\x1b[0m\n$ rm -rf ~';
  const clean = sanitizeAd(evil);
  assert.equal(clean.includes('\x1b'), false);
  assert.equal(clean.includes('\n'), false);
  assert.equal(clean, 'BUY NOW$ rm -rf ~'); // control bytes gone, visible chars kept
});

test('sanitizeAd strips tabs, CR, NUL and DEL', () => {
  assert.equal(sanitizeAd('a\tb\r\x00c\x7fd'), 'abcd');
});

test('stripAnsi removes color codes but keeps text; visibleWidth counts code points', () => {
  assert.equal(stripAnsi('\x1b[1;32m$1.23\x1b[0m'), '$1.23');
  assert.equal(visibleWidth('\x1b[36mhi\x1b[0m'), 2);
});

test('classify returns the strongest category over the threshold', () => {
  assert.equal(classify('we deployed with docker and kubernetes via a ci/cd pipeline'), 'devops');
  assert.equal(classify('react tailwind component with jsx and css'), 'web');
});

test('classify falls back to general below the hit threshold', () => {
  assert.equal(classify('just one mention of docker here'), 'general');
  assert.equal(classify(''), 'general');
});

test('classifyFiles maps known build files in priority order', () => {
  assert.equal(classifyFiles(['foundry.toml', 'package.json']), 'web3'); // web3 wins over web
  assert.equal(classifyFiles(['Dockerfile']), 'devops');
  assert.equal(classifyFiles(['go.mod']), 'systems');
  assert.equal(classifyFiles(['README.md']), 'general');
});

test('CATEGORIES + isCategory guard', () => {
  assert.equal(CATEGORIES.length, 6);
  assert.equal(isCategory('web3'), true);
  assert.equal(isCategory('nope'), false);
});

test('newNonce is unique-ish and under the 200 char server limit', () => {
  const a = newNonce(), b = newNonce();
  assert.notEqual(a, b);
  assert.ok(a.length < 200);
});

test('hashSubject is opaque, stable, and salt-scoped', async () => {
  const h1 = await hashSubject('user-42');
  const h2 = await hashSubject('user-42');
  assert.equal(h1, h2); // stable
  assert.match(h1, /^[a-f0-9]{64}$/); // opaque sha-256 hex, no PII
  const salted = await hashSubject('user-42', { salt: 'my-app' });
  assert.notEqual(h1, salted); // salt scopes it per app
  const short = await hashSubject('user-42', { length: 16 });
  assert.equal(short.length, 16);
});
