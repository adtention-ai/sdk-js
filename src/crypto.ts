// Universal crypto helpers — Web Crypto only (globalThis.crypto), so they run on Node 20+,
// Workers, Deno, Bun, and browsers without a polyfill.

function webcrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.getRandomValues) {
    throw new Error('Web Crypto unavailable: this runtime lacks globalThis.crypto. Use Node 20+.');
  }
  return c;
}

/** `n` random bytes as lowercase hex. */
export function randomHex(n: number): string {
  const a = new Uint8Array(n);
  webcrypto().getRandomValues(a);
  let s = '';
  for (const b of a) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * A fresh idempotency nonce: millisecond timestamp + 8 random hex chars. Unique enough that two
 * concurrent serves never collide, and time-prefixed so it sorts. Always < 200 chars.
 */
export function newNonce(): string {
  return `${Date.now()}-${randomHex(4)}`;
}

/**
 * SHA-256 of `raw`, lowercase hex (optionally truncated). Use it to turn a raw user id / email into
 * an opaque {@link ServeArgs.subject} so no PII ever leaves the integrator. `salt` lets you scope
 * subjects to your app so the same user isn't correlatable across publishers.
 */
export async function hashSubject(raw: string, opts: { salt?: string; length?: number } = {}): Promise<string> {
  const data = new TextEncoder().encode((opts.salt ?? '') + '\0' + raw);
  const digest = await webcrypto().subtle.digest('SHA-256', data);
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return opts.length ? hex.slice(0, opts.length) : hex;
}
