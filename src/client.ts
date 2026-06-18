// The thin, typed wire client for the ADtention v1 API. One method per endpoint, with the
// publisher-side obligations baked in so a caller can't get them wrong:
//   - terminal-safe ad text (control bytes stripped) on every serve
//   - automatic idempotency nonce
//   - click-URL resolution + http(s)-only safety
//   - snake_case wire <-> camelCase SDK mapping
// Universal: depends only on global `fetch` and Web Crypto.

import { AdtentionError } from './errors.js';
import { newNonce } from './crypto.js';
import { sanitizeAd } from './sanitize.js';
import { isCategory } from './types.js';
import type {
  BalanceResult,
  Category,
  Identity,
  RegisterResult,
  ServeArgs,
  ServeResult,
} from './types.js';

const DEFAULT_API_BASE = 'https://api.adtention.ai';
const DEFAULT_TIMEOUT_MS = 5000;

/** A fetch-compatible function. Defaults to the global `fetch`. */
export type FetchLike = typeof fetch;

export interface AdtentionClientOptions {
  /** The publisher account that earns. Required for `serve`/`balance`; optional if you only register. */
  publisherId?: string;
  /** Install secret — only needed for {@link AdtentionClient.bind}/`payout`. Keep it server-side. */
  secret?: string;
  /** API origin. Defaults to `https://api.adtention.ai`. Point at a local server for testing. */
  apiBase?: string;
  /** Per-request timeout in ms. Default 5000. */
  timeoutMs?: number;
  /** Override the fetch implementation (tests, custom agents). Defaults to global `fetch`. */
  fetch?: FetchLike;
}

export class AdtentionClient {
  publisherId: string | undefined;
  private secret: string | undefined;
  readonly apiBase: string;
  private readonly timeoutMs: number;
  private readonly _fetch: FetchLike;

  constructor(opts: AdtentionClientOptions = {}) {
    this.publisherId = opts.publisherId;
    this.secret = opts.secret;
    this.apiBase = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const f = opts.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!f) throw new AdtentionError('no_fetch', 'global fetch is unavailable; pass opts.fetch');
    this._fetch = f;
  }

  /** Register a new publisher. Persist the result — `secret` is needed only to bind/payout. */
  async register(args: { ref?: string; kind?: 'installer' | 'partner' } = {}): Promise<RegisterResult> {
    const body: Record<string, unknown> = {};
    if (args.ref) body.ref = args.ref;
    if (args.kind) body.kind = args.kind;
    const r = await this.request('POST', '/v1/register', body);
    const out: RegisterResult = {
      publisherId: String(r.publisher_id),
      secret: String(r.secret),
      referralCode: String(r.referral_code),
    };
    // adopt the new identity so the same client can immediately serve
    this.publisherId = out.publisherId;
    this.secret = out.secret;
    return out;
  }

  /**
   * Request one ad for {@link AdtentionClientOptions.publisherId}. Ad text comes back already
   * sanitized; `clickUrl` is absolute and http(s)-only. Throws {@link AdtentionError} on
   * `no_inventory` (503), `unknown_publisher` (404), validation errors, or transport failure.
   */
  async serve(args: ServeArgs = {}): Promise<ServeResult> {
    const publisherId = this.requirePublisher();
    const nonce = args.nonce ?? newNonce();
    const body: Record<string, unknown> = { publisher_id: publisherId, nonce };
    if (args.category) body.category = args.category;
    if (args.subject) body.subject = args.subject;
    const r = await this.request('POST', '/v1/serve', body);

    const impressionId = String(r.impression_id);
    // Fresh serves return click_url; a deduped replay returns only impression_id, so derive it.
    const rawClick = typeof r.click_url === 'string' ? r.click_url : `/v1/click/${impressionId}`;
    const cat = r.category;
    return {
      adId: String(r.ad_id),
      text: sanitizeAd(String(r.text ?? '')),
      impressionId,
      clickUrl: this.resolveClickUrl(rawClick),
      category: isCategory(cat) ? cat : null,
      billable: r.billable === true,
      credit: typeof r.credit === 'number' ? r.credit : 0,
      dedup: r.dedup === true,
    };
  }

  /** Current earnings + referral state for the publisher. */
  async balance(publisherId?: string): Promise<BalanceResult> {
    const pid = publisherId ?? this.requirePublisher();
    const r = await this.request('GET', `/v1/balance?publisher_id=${encodeURIComponent(pid)}`);
    return {
      balanceUsd: num(r.balance_usd),
      billableImpressions: num(r.billable_impressions),
      threshold: num(r.threshold),
      payable: r.payable === true,
      bound: r.bound === true,
      referralCode: r.referral_code == null ? null : String(r.referral_code),
      referredBy: r.referred_by == null ? null : String(r.referred_by),
      refBalanceUsd: num(r.ref_balance_usd),
      referralCount: num(r.referral_count),
      referralThreshold: num(r.referral_threshold),
      referralPayable: r.referral_payable === true,
    };
  }

  /**
   * Resolve a server `click_url` (absolute or server-relative) to an absolute, http(s)-only URL.
   * Returns `null` for anything that isn't http(s) — a server (or a MITM, or a bad apiBase) must
   * never be able to make a client open `file://`, `smb://`, or a custom protocol handler.
   */
  resolveClickUrl(clickUrl: string): string | null {
    const url = clickUrl.startsWith('/') ? this.apiBase + clickUrl : clickUrl;
    return url.startsWith('https://') || url.startsWith('http://') ? url : null;
  }

  /**
   * Record a click and get the advertiser destination. Hits `GET /v1/click/{impressionId}` with
   * manual redirect handling and returns the `Location` (the real destination). First click wins;
   * clicks are engagement-only and never billed. Returns `null` if the impression is unknown.
   */
  async recordClick(impressionId: string): Promise<string | null> {
    const url = `${this.apiBase}/v1/click/${encodeURIComponent(impressionId)}`;
    const res = await this.raw(url, { method: 'GET', redirect: 'manual' });
    if (res.status === 302 || res.status === 301) {
      const loc = res.headers.get('location');
      return loc && (loc.startsWith('http://') || loc.startsWith('https://')) ? loc : null;
    }
    return null;
  }

  /** Bind a payout destination (email/wallet). Requires the install secret. */
  async bind(destination: string, secret?: string): Promise<{ ok: boolean; bound: boolean }> {
    const r = await this.request('POST', '/v1/account/bind', {
      publisher_id: this.requirePublisher(),
      secret: this.requireSecret(secret),
      destination,
    });
    return { ok: r.ok === true, bound: r.bound === true };
  }

  /** Request a payout of the `earnings` ($10) or `referral` ($100) balance. Requires the secret. */
  async payout(kind: 'earnings' | 'referral' = 'earnings', secret?: string): Promise<{
    ok: boolean;
    payoutId?: string;
    amount?: number;
    status?: string;
  }> {
    const r = await this.request('POST', '/v1/payout', {
      publisher_id: this.requirePublisher(),
      secret: this.requireSecret(secret),
      kind,
    });
    return {
      ok: r.ok === true,
      payoutId: r.payout_id == null ? undefined : String(r.payout_id),
      amount: typeof r.amount === 'number' ? r.amount : undefined,
      status: r.status == null ? undefined : String(r.status),
    };
  }

  /** The identity this client currently holds (after register, or as constructed). */
  identity(): Identity | null {
    return this.publisherId ? { publisherId: this.publisherId, secret: this.secret } : null;
  }

  // --- internals ---

  private requirePublisher(): string {
    if (!this.publisherId) throw new AdtentionError('no_publisher', 'no publisherId set; register() or pass one');
    return this.publisherId;
  }

  private requireSecret(override?: string): string {
    const s = override ?? this.secret;
    if (!s) throw new AdtentionError('no_secret', 'this call needs the install secret');
    return s;
  }

  private async request(method: string, path: string, body?: unknown): Promise<Record<string, any>> {
    const res = await this.raw(this.apiBase + path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: Record<string, any> = {};
    try {
      json = (await res.json()) as Record<string, any>;
    } catch {
      if (!res.ok) throw new AdtentionError(`http_${res.status}`, `HTTP ${res.status}`, res.status);
      throw new AdtentionError('bad_response', 'response was not valid JSON', res.status);
    }
    if (!res.ok || typeof json.error === 'string') {
      const code = typeof json.error === 'string' ? json.error : `http_${res.status}`;
      throw new AdtentionError(code, typeof json.detail === 'string' ? json.detail : code, res.status);
    }
    return json;
  }

  private async raw(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this._fetch(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw new AdtentionError('timeout', `timed out after ${this.timeoutMs}ms`);
      throw new AdtentionError('network_error', e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(t);
    }
  }
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}
