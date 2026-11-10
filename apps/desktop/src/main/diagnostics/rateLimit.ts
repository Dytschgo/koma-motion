/**
 * A token bucket. `capacity` actions may happen at once; afterwards one more
 * becomes possible every `refillMs` milliseconds.
 */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number | null = null;

  constructor(
    private readonly capacity: number,
    private readonly refillMs: number,
  ) {
    this.tokens = capacity;
  }

  /** Takes one token. `now` is a time in milliseconds that never goes backwards. */
  take(now: number): boolean {
    if (this.updatedAt !== null && now > this.updatedAt) {
      this.tokens = Math.min(this.capacity, this.tokens + (now - this.updatedAt) / this.refillMs);
    }
    this.updatedAt = Math.max(now, this.updatedAt ?? now);
    if (this.tokens < 1) {
      return false;
    }
    this.tokens -= 1;
    return true;
  }
}
