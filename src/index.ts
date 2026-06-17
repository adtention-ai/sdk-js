// @adtention/sdk — publisher SDK for ADtention.
//
// Two layers:
//   - AdtentionClient: a thin, typed wire client (register/serve/click/balance) with terminal-safe
//     ad text, idempotency nonces, and click-URL safety baked in.
//   - SponsorSlot: a high-level "show a sponsor line in my wait state" helper with per-end-user
//     dwell, caching, and optional self-managed identity.
//
// The core is universal (global fetch + Web Crypto only): Node 18+, Workers, Deno, Bun, browsers.
// A Node file-backed identity store is available from "@adtention/sdk/node".

export { AdtentionClient } from './client.js';
export type { AdtentionClientOptions, FetchLike } from './client.js';

export { SponsorSlot, getSponsorLine } from './render.js';
export type { Sponsor, SponsorSlotOptions } from './render.js';

export { AdtentionError } from './errors.js';

export { MemoryIdentityStore } from './identity.js';
export type { IdentityStore } from './identity.js';

export { classify, classifyFiles } from './classify.js';
export { sanitizeAd, stripAnsi, visibleWidth } from './sanitize.js';
export { hashSubject, newNonce, randomHex } from './crypto.js';

export { CATEGORIES, isCategory } from './types.js';
export type {
  BalanceResult,
  Category,
  Identity,
  RegisterResult,
  ServeArgs,
  ServeResult,
} from './types.js';
