# @adtention/sdk

Publisher SDK for [ADtention](https://adtention.ai/integrate). Show **one sponsored line** in your app's
wait states (a coding-agent status line, a CLI spinner, a terminal idle moment) and earn a
revshare. The sponsored line is plain text. Only a category tag and an opaque per-user token ever leave your
process.

- **Terminal-safe.** Sponsor text is stripped of ANSI and control bytes before you ever see it.
  No escape injection, no log injection.
- **Idempotent.** Every serve carries a nonce, so retries never double-count.
- **Multi-tenant.** One publisher account, many end users, each rate-limited independently.
- **Universal.** The core uses only `fetch` and Web Crypto, so it runs on Node 20+, Cloudflare
  Workers, Deno, Bun, and browsers. A file-backed identity store for Node lives at
  `@adtention/sdk/node`.

```bash
npm install @adtention/sdk
```

## Two ways to earn

You choose who collects the revshare:

- **You keep it (default).** Your project holds one `publisher_id`, and every sponsored line shown across all
  your users credits that one account. This is what most integrators do, and it's what the rest of
  this guide assumes.
- **You pass it through to your users.** The tool registers a separate `publisher_id` per install, so each
  user collects their own revshare. This is the model the ADtention status-line plugin uses. See
  [Alternative model](#alternative-model-let-each-user-earn-for-themselves).

## Who this is for

You're a **developer tool**: a CLI, an editor extension, a terminal, a coding agent, an OSS
project. You want to show a sponsor line to *your* users and earn the revshare yourself (the
project earns, not the end user). You sign up **once** to receive a `publisher_id`, and every sponsored line shown
across all your users is credited to your account.

There are two shapes, and the SDK handles both:

| | **Server-backed app** | **Locally-installed tool** |
|---|---|---|
| e.g. | hosted agent, web IDE, SaaS dev tool | CLI, editor extension, terminal |
| identity | your backend holds one `publisher_id` | embed your **public** `publisher_id` in the build |
| who is `subject` | each end user (hash their user id) | each install/machine (a random stored id) |
| the `secret` | stays in your backend | stays with you, used only to withdraw |

> **`publisher_id` is public, `secret` is private.** Serving a sponsored line needs only the `publisher_id`, so
> it's safe to ship in a distributed binary or an OSS repo. The `secret` is needed only to bind a
> payout destination and withdraw, so keep it out of anything you distribute.

## Get a publisher account

Before you can serve, you need a `publisher_id`. Create one in the
[ADtention portal](https://adtention.ai/onboard): it gives you your `publisher_id`, your
`clientTag`, and your payout setup. This is a **one-time** step for you. Your end
users never register.

Then wire it in:
- **Hosted app:** put `publisherId` in your backend env (e.g. `ADTENTION_PUBLISHER_ID`).
- **Distributed tool:** embed `publisherId` as a public constant in your build.

> **Provisioning is separate from serving.** Creating the account is a one-time step in the portal.
> The thing you *deploy* should serve only: pass `serveOnly: true` so it requires the provisioned
> `publisherId` and can never call `register()`. That keeps account creation in one place, so the
> embed won't create a stray account.
>
> ```ts
> const slot = new SponsorSlot({ publisherId: 'pub_your_id', serveOnly: true, category: 'devops' });
> ```

To get paid, add a payout destination in the portal and withdraw once you pass the $10 threshold.

## Quick start

### High-level: a sponsor slot in your wait state

`SponsorSlot` is the high-level path. It rate-limits per end user (so you can call it on every
render), caches the last served sponsored line, and never throws into your UI.

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
  render(`${ad.text}  -> ${ad.clickUrl}`); // ad.text is already terminal-safe
}
```

`slot.next()` only hits the network once per ~15s per `subject` (the server's dwell window). In
between it returns the cached line. A transient error returns the last ad (or `null`), never throws.

### Low-level: the typed client

`AdtentionClient` is a thin, typed wrapper over the v1 API for when you want full control.

```ts
import { AdtentionClient } from '@adtention/sdk';

const client = new AdtentionClient({ publisherId: 'pub_your_id' });

const ad = await client.serve({ category: 'web', subject });
// ad.text is sanitized; ad.clickUrl is absolute and http(s)-only
console.log(ad.text, ad.billable, ad.credit);

// Record a click (engagement only, never billed) and get the destination to open:
const dest = await client.recordClick(ad.impressionId);

// Check earnings (account-level: the project's running balance, for your own dashboard):
const bal = await client.balance();
console.log(bal.balanceUsd, bal.payable);
```

### A distributed CLI/extension (project earns)

Same model as above, but the `publisher_id` is a public constant baked into your build, and each
install gets a stable random `subject` so users are rate-limited independently. All credit pools
into your one account.

```ts
import { SponsorSlot } from '@adtention/sdk';

const ADTENTION_PUBLISHER_ID = 'pub_your_id'; // public, safe to commit/ship

const slot = new SponsorSlot({ publisherId: ADTENTION_PUBLISHER_ID, category: 'devops' });
const subject = getOrCreateMachineId(); // a random id you persist once per install (e.g. crypto.randomUUID)
const ad = await slot.next({ subject });
if (ad) console.log(ad.text);
```

## Alternative model: let each user earn for themselves

The models above all have **you** (the project) earn. If instead you want **each end user** to earn
their own revshare (the model the ADtention status-line plugins for Claude Code and OpenCode use), let the tool self-register a
*separate* `publisher_id` per install and persist it. On Node, use the file-backed store: the slot
registers once, reuses it forever, and self-heals if the server forgets the account. Here you do
**not** pass a `subject`, because each install is already its own publisher.

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

> Self-registration (and self-heal) happens only when you provide an `identityStore`. If you pass a
> fixed `publisherId`, the SDK never silently mints a new account, which would otherwise orphan your
> earnings.

## Categories

The six categories are the targeting enum. Import the type and your editor autocompletes the values:

```ts
import type { Category } from '@adtention/sdk';
// 'web3' | 'web' | 'devops' | 'data' | 'systems' | 'general'
```

You don't have to set a category:

- **Do nothing.** It defaults to `general`, which always fills from broad/run-of-network ads. You
  still earn.
- **Set it once.** Most tools have a fixed niche (a Solidity tool is always `web3`). One line.
- **Classify text you already have.** The optional `classify()` and `classifyFiles()` helpers port
  the reference client's keyword/file heuristics and run entirely on your side:

```ts
import { classify, classifyFiles } from '@adtention/sdk';
classify('we set up docker and a ci/cd pipeline');     // 'devops'
classifyFiles(['foundry.toml', 'package.json']);       // 'web3'  (priority order)
```

Getting the category right earns more (targeted campaigns bid higher), but it's optional.

## `subject`: per-end-user scoping

Pass an opaque `subject` so the server scopes its rate limits (a billable impression at most once
per ~15s, plus a daily cap) **per end user** instead of per account. Without it, all your users
share one account-wide limit, which is fine for a single-user CLI but broken for an app with many
users.

- Make it **opaque**: a random per-install id, or `hashSubject(userId)`. Never raw PII.
- Make it **stable per user** and **distinct between users**.
- `hashSubject(raw, { salt: 'my-app' })` keeps the same user uncorrelatable across apps.

All credit from every subject accrues to your one `publisher_id`.

## What leaves your process

Per serve: `publisher_id`, the `category` tag, the opaque `subject`, and a `nonce`. That's it. Never
code, file contents, prompt text, paths, repo names, or transcripts.

## API reference

### `new AdtentionClient(options)`
`{ publisherId?, secret?, clientTag?, serveOnly?, apiBase?, timeoutMs?, fetch? }`. `apiBase`
defaults to `https://api.adtention.ai`.

- `clientTag`: originating-tool slug (e.g. your app's name) sent on register and serve and recorded
  per impression, so traffic rolls up by integration. Slugified server-side (lowercased,
  `[a-z0-9._-]`, max 64 chars).
- `serveOnly`: lock the client to serving only. Requires a `publisherId` (throws without one) and
  makes `register()` throw. Use it in a distributed embed whose `publisherId` is provisioned out of
  band, so the embed can never create a new account.

- `register({ ref?, kind? })` returns `{ publisherId, secret, referralCode }` and adopts the identity.
- `serve({ category?, subject?, nonce? })` returns a `ServeResult` (sanitized `text`, absolute
  `clickUrl`, `billable`, `credit`, `dedup`).
- `balance(publisherId?)` returns a `BalanceResult` (account-level earnings, for the project's own
  dashboard, not the end-user render).
- `recordClick(impressionId)` returns the destination URL as `string | null` (Node/CLI; in a
  browser, navigate to `ad.clickUrl` directly and let the browser follow the 302).
- `resolveClickUrl(clickUrl)` returns an absolute http(s) URL or `null`.
- `bind(destination, secret?)` and `payout(kind?, secret?)` are management calls and need the secret.

### `new SponsorSlot(options)`
`AdtentionClient` options (including `clientTag` and `serveOnly`) plus `{ client?, category?,
dwellMs?, cacheMax?, identityStore?, ref?, onError? }`. `serveOnly` and `identityStore` are mutually
exclusive: construction throws if both are set.

- `next({ subject?, category? })` returns `Sponsor | null` (dwell-gated, cached, never throws).
- `current(subject?)` returns the last `Sponsor` from cache.
- `api` is the underlying `AdtentionClient`.

### Helpers
`getSponsorLine(opts)`, `classify(text)`, `classifyFiles(names)`, `hashSubject(raw, opts?)`,
`newNonce()`, `sanitizeAd(s)`, `stripAnsi(s)`, `visibleWidth(s)`, `CATEGORIES`, `isCategory(v)`.
Errors are thrown as `AdtentionError` (`.code`, `.status`, `.isNoInventory`, `.isUnknownPublisher`).

## License

MIT
