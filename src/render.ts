// The high-level "show a sponsor line in my wait state" helper. It owns the things an integrator
// would otherwise re-implement (and get subtly wrong):
//   - client-side dwell: never hits the network more than once per `dwellMs` per end user, so you
//     can call next() freely inside a render loop;
//   - a bounded per-subject cache of the last ad, returned while throttled or on transient error,
//     so your UI always has something to show and a failed serve never throws into it;
//   - optional self-managed identity (register-once + persist + self-heal) for tools that aren't
//     handed a publisher id.
// Ad text is already sanitized by the client, so `sponsor.text` is safe to print directly.

import { AdtentionClient } from './client.js';
import type { AdtentionClientOptions } from './client.js';
import { AdtentionError } from './errors.js';
import type { IdentityStore } from './identity.js';
import type { Category, ServeResult } from './types.js';

/** A render-ready sponsor line. `text` and `clickUrl` are sanitized/safe. */
export interface Sponsor {
  /** Sanitized one-line ad copy — safe to print to a terminal/status line. */
  text: string;
  /** Absolute http(s) click URL (302s through the server), or `null` if none/unsafe. */
  clickUrl: string | null;
  adId: string;
  impressionId: string;
  category: Category | null;
  billable: boolean;
  credit: number;
  /** Was this returned from cache (throttled/error) rather than a fresh serve this call? */
  fromCache: boolean;
}

export interface SponsorSlotOptions extends AdtentionClientOptions {
  /** Use an existing client instead of constructing one from the connection options. */
  client?: AdtentionClient;
  /** Default category for serves (per-call category overrides it). */
  category?: Category;
  /** Minimum ms between network serves per end user (per subject). Default 15000 (the server's dwell). */
  dwellMs?: number;
  /** Max number of distinct subjects to keep a cached ad for. Default 1000. */
  cacheMax?: number;
  /**
   * Self-managed identity: when set and no `publisherId` is given, the slot loads an identity
   * (or registers one and saves it) on first use, and self-heals if the server forgets it. Leave
   * unset for multi-tenant apps that pass a fixed `publisherId` (you never want to silently mint a
   * new earning account there).
   */
  identityStore?: IdentityStore;
  /** Referral code attributed on the FIRST register (only with `identityStore`). */
  ref?: string;
  /** Called with any non-fatal serve error (the slot then falls back to cache). */
  onError?: (err: AdtentionError) => void;
}

interface CacheEntry {
  lastServeMs: number;
  ad: Sponsor | null;
}

export class SponsorSlot {
  private readonly client: AdtentionClient;
  private readonly category: Category | undefined;
  private readonly dwellMs: number;
  private readonly cacheMax: number;
  private readonly identityStore: IdentityStore | undefined;
  private readonly ref: string | undefined;
  private readonly onError: ((err: AdtentionError) => void) | undefined;
  private readonly cache = new Map<string, CacheEntry>();
  private identityReady: Promise<void> | null = null;

  constructor(opts: SponsorSlotOptions = {}) {
    // serveOnly (provisioned publisherId) and identityStore (self-managed identity) are mutually
    // exclusive: one means "never register", the other means "register + self-heal".
    if (opts.serveOnly && opts.identityStore) {
      throw new AdtentionError('serve_only', 'serveOnly cannot be combined with identityStore: pick one (a provisioned publisherId, or self-managed identity)');
    }
    this.client = opts.client ?? new AdtentionClient(opts);
    this.category = opts.category;
    this.dwellMs = opts.dwellMs ?? 15000;
    this.cacheMax = opts.cacheMax ?? 1000;
    this.identityStore = opts.identityStore;
    this.ref = opts.ref;
    this.onError = opts.onError;
  }

  /**
   * Get a sponsor line for one end user. Dwell-gated: within `dwellMs` of the last serve for this
   * `subject` it returns the cached ad without touching the network, so it's safe to call on every
   * render. Returns `null` only when there's nothing to show (no inventory yet and no cache).
   * Never throws on a serve failure — it reports via `onError` and falls back to cache.
   */
  async next(args: { subject?: string; category?: Category } = {}): Promise<Sponsor | null> {
    const key = args.subject ?? '';
    try {
      await this.ensureIdentity();
    } catch (e) {
      // Identity not ready (e.g. the first register failed because the server was down). Honor the
      // "never throws into your UI" contract: report and fall back to cache. ensureIdentity has
      // cleared its latch, so the next call retries registration.
      this.onError?.(e instanceof AdtentionError ? e : new AdtentionError('unknown', String(e)));
      const cached = this.cache.get(key)?.ad ?? null;
      return cached ? { ...cached, fromCache: true } : null;
    }
    const now = Date.now();
    const entry = this.cache.get(key);

    // Dwell gate: too soon since this subject's last serve → serve nothing new, reuse the cache.
    if (entry && now - entry.lastServeMs < this.dwellMs) {
      return entry.ad ? { ...entry.ad, fromCache: true } : null;
    }
    // Mark the attempt now (optimistic) so concurrent calls for the same subject don't all serve.
    this.touch(key, now, entry?.ad ?? null);

    try {
      const res = await this.client.serve({ category: args.category ?? this.category, subject: args.subject });
      const ad = toSponsor(res);
      this.touch(key, now, ad);
      return { ...ad, fromCache: false };
    } catch (e) {
      const err = e instanceof AdtentionError ? e : new AdtentionError('unknown', String(e));
      // Self-heal a forgotten identity ONLY when we own it (managed). Never re-register a caller's
      // fixed publisherId — that would orphan its earnings.
      if (err.isUnknownPublisher && this.identityStore) {
        const healed = await this.reregister().catch(() => false);
        if (healed) {
          try {
            const res = await this.client.serve({ category: args.category ?? this.category, subject: args.subject });
            const ad = toSponsor(res);
            this.touch(key, now, ad);
            return { ...ad, fromCache: false };
          } catch (e2) {
            this.onError?.(e2 instanceof AdtentionError ? e2 : new AdtentionError('unknown', String(e2)));
          }
        }
      } else {
        this.onError?.(err);
      }
      const cached = this.cache.get(key)?.ad ?? null;
      return cached ? { ...cached, fromCache: true } : null;
    }
  }

  /** The last ad shown to `subject`, from cache only (no network). */
  current(subject = ''): Sponsor | null {
    const ad = this.cache.get(subject)?.ad ?? null;
    return ad ? { ...ad, fromCache: true } : null;
  }

  /** The underlying typed client (for balance, click recording, etc.). */
  get api(): AdtentionClient {
    return this.client;
  }

  // --- internals ---

  private touch(key: string, ts: number, ad: Sponsor | null): void {
    this.cache.delete(key); // reinsert to keep Map in LRU-ish insertion order
    this.cache.set(key, { lastServeMs: ts, ad });
    if (this.cache.size > this.cacheMax) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  private ensureIdentity(): Promise<void> {
    if (this.client.publisherId || !this.identityStore) return Promise.resolve();
    // register-or-load exactly once, even under concurrent next() calls
    if (!this.identityReady) {
      this.identityReady = (async () => {
        const store = this.identityStore!;
        const saved = await store.load();
        if (saved?.publisherId) {
          this.client.publisherId = saved.publisherId;
          return;
        }
        const reg = await this.client.register(this.ref ? { ref: this.ref } : {});
        await store.save({ publisherId: reg.publisherId, secret: reg.secret, referralCode: reg.referralCode });
      })().catch((e) => {
        this.identityReady = null; // first attempt failed: clear the latch so the next call retries
        throw e;
      });
    }
    return this.identityReady;
  }

  private async reregister(): Promise<boolean> {
    if (!this.identityStore) return false;
    // self-heal: new account, no referral re-attribution (the invite was a one-shot on first install)
    const reg = await this.client.register();
    await this.identityStore.save({ publisherId: reg.publisherId, secret: reg.secret, referralCode: reg.referralCode });
    return true;
  }
}

function toSponsor(res: ServeResult): Sponsor {
  return {
    text: res.text,
    clickUrl: res.clickUrl,
    adId: res.adId,
    impressionId: res.impressionId,
    category: res.category,
    billable: res.billable,
    credit: res.credit,
    fromCache: false,
  };
}

/**
 * One-shot convenience: serve a single sponsor line and return it (or `null` on no inventory /
 * error). No caching or dwell — for a quick "show one ad now". For anything rendered repeatedly,
 * use {@link SponsorSlot}.
 */
export async function getSponsorLine(
  opts: AdtentionClientOptions & { subject?: string; category?: Category },
): Promise<Sponsor | null> {
  const client = new AdtentionClient(opts);
  try {
    return toSponsor(await client.serve({ category: opts.category, subject: opts.subject }));
  } catch {
    return null;
  }
}
