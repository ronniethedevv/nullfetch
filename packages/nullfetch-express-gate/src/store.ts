import type { Challenge, ChallengeStore } from './types';

/**
 * Default challenge store. Single-instance only — challenges live in
 * the Node process's memory and don't survive restarts or scale across
 * dynos. Provide a Redis/KV/database adapter for horizontal scaling.
 *
 * A background sweep runs every minute to drop expired entries so a
 * pathological client can't grow the map unbounded.
 */
export class InMemoryChallengeStore implements ChallengeStore {
  private readonly map = new Map<string, Challenge>();
  private readonly sweepHandle: NodeJS.Timeout;

  constructor() {
    this.sweepHandle = setInterval(() => this.sweep(), 60_000);
    if (typeof (this.sweepHandle as { unref?: () => void }).unref === 'function') {
      (this.sweepHandle as { unref: () => void }).unref();
    }
  }

  async get(wallet: string): Promise<Challenge | null> {
    return this.map.get(wallet.toLowerCase()) ?? null;
  }

  async set(wallet: string, challenge: Challenge): Promise<void> {
    this.map.set(wallet.toLowerCase(), challenge);
  }

  async delete(wallet: string): Promise<void> {
    this.map.delete(wallet.toLowerCase());
  }

  private sweep(): void {
    const now = Date.now();
    for (const [wallet, challenge] of this.map) {
      if (now > challenge.expiresAt) this.map.delete(wallet);
    }
  }

  /** For tests / graceful shutdown. */
  stop(): void {
    clearInterval(this.sweepHandle);
  }
}
