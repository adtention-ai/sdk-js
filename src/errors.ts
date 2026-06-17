/**
 * A structured error from the ADtention API or transport. `code` is the server's machine error
 * (e.g. `no_inventory`, `unknown_publisher`, `bad_publisher_id`) or a transport code
 * (`network_error`, `timeout`, `http_500`). `status` is the HTTP status when there was one.
 *
 * The high-level {@link SponsorSlot} catches these on the render path and falls back to the last
 * cached ad, so a failed serve never throws into your UI. The low-level {@link AdtentionClient}
 * throws them so you can decide.
 */
export class AdtentionError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  constructor(code: string, message?: string, status?: number) {
    super(message ?? code);
    this.name = 'AdtentionError';
    this.code = code;
    this.status = status;
  }

  /** No campaign was eligible for this serve (HTTP 503). Transient — try again later. */
  get isNoInventory(): boolean {
    return this.code === 'no_inventory';
  }

  /** The publisher id is unknown to the server (HTTP 404) — e.g. wrong env, or a wiped DB. */
  get isUnknownPublisher(): boolean {
    return this.code === 'unknown_publisher';
  }
}
