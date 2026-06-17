// Identity persistence for tools that self-register (a locally-installed CLI/extension that owns
// its own publisher account) rather than being handed a publisher id. The core stays universal:
// only the interface + an in-memory impl live here. A file-backed store for Node is in `./node`.

import type { Identity } from './types.js';

/** Where {@link SponsorSlot} loads/saves a self-managed publisher identity. */
export interface IdentityStore {
  load(): Promise<Identity | null> | Identity | null;
  save(identity: Identity): Promise<void> | void;
}

/** In-process identity store. Fine for a single long-lived process; lost on restart. */
export class MemoryIdentityStore implements IdentityStore {
  private current: Identity | null;
  constructor(initial: Identity | null = null) {
    this.current = initial;
  }
  load(): Identity | null {
    return this.current;
  }
  save(identity: Identity): void {
    this.current = identity;
  }
}
