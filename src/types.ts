// Wire contract types for the ADtention serve API. The API speaks snake_case; this SDK exposes
// camelCase to callers and maps at the edge.

/**
 * The six targeting categories the network supports. These ARE the enum — an integrator never
 * invents a category, they pick one of these (or let {@link classify} pick). `general` is the
 * "couldn't tell" bucket: it always fills from broad / run-of-network campaigns, so passing it
 * (or passing nothing) still earns.
 */
export const CATEGORIES = ['web3', 'web', 'devops', 'data', 'systems', 'general'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Is `v` one of the six known categories? */
export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}

/** Result of registering a publisher. Persist all three — `secret` is needed only to bind/payout. */
export interface RegisterResult {
  /** `pub_…` — the earning account. Safe to embed in a distributed client (serving needs no secret). */
  publisherId: string;
  /** Long-lived secret. KEEP PRIVATE — required only by {@link AdtentionClient.bind}/`payout`. */
  secret: string;
  /** Shareable referral code for this publisher (`adtention.ai/r/CODE`). */
  referralCode: string;
}

/** Arguments to {@link AdtentionClient.serve}. */
export interface ServeArgs {
  /** Targeting category. Omit/`undefined` → `general` (still earns from broad inventory). */
  category?: Category;
  /**
   * Opaque, PII-free end-user tag for MULTI-TENANT publishers (an app serving its own many users
   * under one publisher id). Scopes the 15s dwell + daily cap + rotation per end user on the
   * server, while credit accrues to the publisher. Omit for single-tenant/CLI use. Use
   * {@link hashSubject} to derive one from a raw user id. Max 200 chars.
   */
  subject?: string;
  /**
   * Idempotency key. A retry with the SAME nonce never double-counts the impression. Auto-generated
   * per call if omitted; pass your own to make a retry safe across process restarts.
   */
  nonce?: string;
}

/** A served ad. `text` and `clickUrl` are already sanitized and safe to render in a terminal. */
export interface ServeResult {
  /** Campaign id, e.g. `c_vercel`. */
  adId: string;
  /** Sanitized ad copy — control bytes/ANSI stripped, trimmed. Safe to print to a terminal. */
  text: string;
  /** `imp_…` — the impression this serve created (or replayed). */
  impressionId: string;
  /** Absolute, http(s)-only click URL that 302-redirects through the server. `null` if unsafe. */
  clickUrl: string | null;
  /** The impression's category. `null` on a deduped replay (the server doesn't echo it). */
  category: Category | null;
  /** Did this impression earn? `false` when throttled (<15s), daily-capped, or a deduped replay. */
  billable: boolean;
  /** USD credited to the publisher for this impression (0 when not billable). */
  credit: number;
  /** `true` when this was an idempotent replay of a prior nonce (no new impression, no credit). */
  dedup: boolean;
}

/** Result of {@link AdtentionClient.balance}. */
export interface BalanceResult {
  balanceUsd: number;
  billableImpressions: number;
  threshold: number;
  payable: boolean;
  bound: boolean;
  referralCode: string | null;
  referredBy: string | null;
  refBalanceUsd: number;
  referralCount: number;
  referralThreshold: number;
  referralPayable: boolean;
}

/** Persisted publisher identity (what {@link RegisterResult} carries, for an IdentityStore). */
export interface Identity {
  publisherId: string;
  secret?: string;
  referralCode?: string;
}
