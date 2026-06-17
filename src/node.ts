// Node-only helpers. Kept out of the core entry so "@adtention/sdk" stays universal (no node:*
// imports). Import from "@adtention/sdk/node".

import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IdentityStore } from './identity.js';
import type { Identity } from './types.js';

/**
 * File-backed {@link IdentityStore} for locally-installed tools that self-register. Persists the
 * publisher identity as JSON at `path` (default mode 0600 — it holds the install secret). Writes
 * atomically (temp file + rename) so a crash can't truncate it.
 */
export class FileIdentityStore implements IdentityStore {
  constructor(private readonly path: string) {}

  load(): Identity | null {
    try {
      const raw = readFileSync(this.path, 'utf8');
      const j = JSON.parse(raw) as Record<string, unknown>;
      // accept either camelCase (our own writes) or the server's snake_case register response
      const publisherId = (j.publisherId ?? j.publisher_id) as string | undefined;
      if (!publisherId) return null;
      return {
        publisherId,
        secret: (j.secret as string | undefined) ?? undefined,
        referralCode: (j.referralCode ?? j.referral_code) as string | undefined,
      };
    } catch {
      return null;
    }
  }

  save(identity: Identity): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(identity), { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}
