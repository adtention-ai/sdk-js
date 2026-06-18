# @adtention/sdk

Publisher SDK for [ADtention](https://adtention.ai) — show **one sponsored line** in your app's
wait states (a coding-agent status line, a CLI spinner, a terminal idle moment) and earn a
revshare. The ad is plain text. Only a category tag and an opaque per-user token ever leave your
process.

- **Terminal-safe by construction** — advertiser text is stripped of ANSI/control bytes before you
  ever see it. No escape injection, no log injection.
- **Idempotent** — every serve carries a nonce; retries never double-count.
- **Multi-tenant** — one publisher account, many end users, each rate-limited independently.
- **Universal** — the core uses only `fetch` + Web Crypto, so it runs on Node 20+, Cloudflare
  Workers, Deno, Bun, and browsers. A file-backed identity store for Node lives at
  `@adtention/sdk/node`.

```bash
npm install @adtention/sdk
```

## Who this is for

You're a **developer tool** — a CLI, an editor extension, a terminal, a coding agent, an OSS
project — and you want to show a sponsor line to *your* users and earn the revshare yourself (the
project earns, not the end user). You sign up **once** for a `publisher_id`; every ad shown across
all your users credits that one account.

There are two shapes, and the SDK handles both:

| | **Server-backed app** | **Locally-installed tool** |
|---|---|---|
| e.g. | hosted agent, web IDE, SaaS dev tool | CLI, editor extension, terminal |
| identity | your backend holds one `publisher_id` | embed your **public** `publisher_id` in the build |
| who is `subject` | each end user (hash their user id) | each install/machine (a random stored id) |
| the `secret` | stays in your backend | stays with you — used only to withdraw |

> **`publisher_id` is public; `secret` is private.** Serving an ad needs only the `publisher_id`, so
> it's safe to ship in a distributed binary or an OSS repo. The `secret` is needed *only* to bind a
> payout destination and withdraw — keep it out of anything you distribute.

## Get a publisher account

Before you can serve, you need a `publisher_id`. This is a **one-time** step for you, the integrator
— your end users never register.

```ts
import { AdtentionClient } from '@adtention/sdk';
const { publisherId, secret } = await new AdtentionClient().register();
// Save BOTH. `publisherId` is safe to embed/commit; keep `secret` private — it's only for payout.
```

…or from a shell:

```bash
curl -sX POST https://api.adtention.ai/v1/register
# => {"publisher_id":"pub_…","secret":"…","referral_code":"…"}
```

Then wire it in:
- **Hosted app** — put `publisherId` in your backend env (e.g. `ADTENTION_PUBLISHER_ID`).
- **Distributed tool** — embed `publisherId` as a public constant in your build.

To get paid later, bind a payout destination once (needs the `secret`) and withdraw past the $10
threshold: `await client.bind('you@example.com', secret)` then `await client.payout()`.

## Quick start

### High-level: a sponsor slot in your wait state

`SponsorSlot` is the batteries-included path. It rate-limits per end user (so you can call it on
every render), caches the last ad, and never throws into your UI.

```ts
import { SponsorSlot, hashSubject } from '@adtention/sdk';

const slot = new SponsorSlot({
  publisherId: 'pub_your_id',   // your earning account (public)
  category: 'devops',           // your app's niche; omit for 'general'
});

// In your render loop / wait state, per end user:
const subject = await hashSubject(currentUserId); // opaque, PII-free
const ad = await slot.next({ subject });
if (ad) {
  render(`${ad.text}  → ${ad.clickUrl}`); // ad.text is already terminal-safe
}
```

`slot.next()` only hits the network once per ~15s per `subject` (the server's dwell window); in
between it returns the cached line. A transient error returns the last ad (or `null`), never throws.

### Low-level: the typed client

`AdtentionClient` is a thin, typed wrapper over the v1 API when you want full control.

```ts
import { AdtentionClient } from '@adtention/sdk';

const client = new AdtentionClient({ publisherId: 'pub_your_id' });

const ad = await client.serve({ category: 'web', subject });
// ad.text is sanitized; ad.clickUrl is absolute + http(s)-only
console.log(ad.text, ad.billable, ad.credit);

// Record a click (engagement only, never billed) and get the destination to open:
const dest = await client.recordClick(ad.impressionId);

// Check earnings (account-level — the project's running balance, for your own dashboard):
const bal = await client.balance();
console.log(bal.balanceUsd, bal.payable);
```

### A distributed CLI/extension (project earns)

Same model as above, but the `publisher_id` is a public constant baked into your build, and each
install gets a stable random `subject` so users are rate-limited independently. All credit pools
into your one account.

```ts
import { SponsorSlot } from '@adtention/sdk';

const ADTENTION_PUBLISHER_ID = 'pub_your_id'; // public — safe to commit/ship

const slot = new SponsorSlot({ publisherId: ADTENTION_PUBLISHER_ID, category: 'devops' });
const subject = getOrCreateMachineId(); // a random id you persist once per install (e.g. crypto.randomUUID)
const ad = await slot.next({ subject });
if (ad) console.log(ad.text);
```

## Alternative model: let each user earn for themselves

The above models all have **you** (the project) earn. If instead you want **each end user** to earn
their own revshare — the model the ADtention status-line plugin uses — let the tool self-register a
*separate* `publisher_id` per install and persist it. On Node, use the file-backed store; the slot
registers once, reuses it forever, and self-heals if the server forgets the account. Here you do
**not** pass a `subject` (each install is already its own publisher).

```ts
import { SponsorSlot } from '@adtention/sdk';
import { FileIdentityStore } from '@adtention/sdk/node';
import { homedir } from 'node:os';
import { join } from 'node:path';

const slot = new SponsorSlot({
  identityStore: new FileIdentityStore(join(homedir(), '.myapp', 'adtention.json')),
  category: 'systems',
  ref: process.env.MYAPP_ADTENTION_REF, // optional referral code, attributed on first register
});

const ad = await slot.next(); // no subject: this install IS the publisher
```

> Self-registration (and self-heal) happens **only** when you provide an `identityStore`. If you pass
> a fixed `publisherId`, the SDK will **never** silently mint a new account — that would orphan your
> earnings.

## Categories

The six categories are the targeting enum. Import the type; your editor autocompletes the values:

```ts
import type { Category } from '@adtention/sdk';
// 'web3' | 'web' | 'devops' | 'data' | 'systems' | 'general'
```

You don't have to determine a category. Effort is a quality lever, not a requirement:

- **Do nothing** → it defaults to `general`, which always fills from broad/run-of-network ads. You
  still earn.
- **Set it once** → most tools have a fixed niche (a Solidity tool is always `web3`). One line.
- **Classify text you already have** → the optional `classify()` / `classifyFiles()` helpers port
  the reference client's keyword/file heuristics and run entirely on your side:

```ts
import { classify, classifyFiles } from '@adtention/sdk';
classify('we set up docker and a ci/cd pipeline');     // 'devops'
classifyFiles(['foundry.toml', 'package.json']);       // 'web3'  (priority order)
```

Correct categorization earns more (targeted campaigns bid higher), but it's strictly upside.

## `subject`: per-end-user scoping

Pass an opaque `subject` so the server scopes its rate limits (a billable impression at most once per
~15s, plus a daily cap) **per end user** instead of per account. Without it, all your users would
share one account-wide limit — fine for a single-user CLI, broken for an app with many users.

- Make it **opaque** — a random per-install id, or `hashSubject(userId)`. Never raw PII.
- Make it **stable per user** and **distinct between users**.
- `hashSubject(raw, { salt: 'my-app' })` lets you keep the same user uncorrelatable across apps.

All credit from every subject accrues to your one `publisher_id`.

## What leaves your process

Per serve: `publisher_id`, the `category` tag, the opaque `subject`, and a `nonce`. That's it. Never
code, file contents, prompt text, paths, repo names, or transcripts.

## API reference

### `new AdtentionClient(options)`
`{ publisherId?, secret?, apiBase?, timeoutMs?, fetch? }`. `apiBase` defaults to
`https://api.adtention.ai`.

- `register({ ref?, kind? })` → `{ publisherId, secret, referralCode }` (adopts the identity)
- `serve({ category?, subject?, nonce? })` → `ServeResult` (sanitized `text`, absolute `clickUrl`,
  `billable`, `credit`, `dedup`)
- `balance(publisherId?)` → `BalanceResult` (account-level earnings — for the project's own dashboard,
  not the end-user render)
- `recordClick(impressionId)` → destination URL `string | null` (Node/CLI; in a browser, navigate
  to `ad.clickUrl` directly and let the browser follow the 302)
- `resolveClickUrl(clickUrl)` → absolute http(s) URL or `null`
- `bind(destination, secret?)` / `payout(kind?, secret?)` — management; need the secret

### `new SponsorSlot(options)`
`AdtentionClient` options plus `{ client?, category?, dwellMs?, cacheMax?, identityStore?, ref?, onError? }`.

- `next({ subject?, category? })` → `Sponsor | null` (dwell-gated, cached, never throws)
- `current(subject?)` → last `Sponsor` from cache
- `api` → the underlying `AdtentionClient`

### Helpers
`getSponsorLine(opts)`, `classify(text)`, `classifyFiles(names)`, `hashSubject(raw, opts?)`,
`newNonce()`, `sanitizeAd(s)`, `stripAnsi(s)`, `visibleWidth(s)`, `CATEGORIES`, `isCategory(v)`.
Errors are thrown as `AdtentionError` (`.code`, `.status`, `.isNoInventory`, `.isUnknownPublisher`).

## License

MIT
