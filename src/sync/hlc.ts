/**
 * Hybrid logical clock folded into a single epoch-ms number.
 * `now()` never goes backwards and is always > anything observed, so a local
 * edit made after importing remote data wins over that data even with clock skew.
 */
export class HybridClock {
  private last: number;

  constructor(
    private readonly wall: () => number = Date.now,
    initial = 0,
  ) {
    this.last = initial;
  }

  now(): number {
    this.last = Math.max(this.wall(), this.last + 1);
    return this.last;
  }

  /** Advance past a timestamp seen from another device. */
  observe(remote: number): void {
    if (Number.isFinite(remote) && remote > this.last) this.last = remote;
  }

  peek(): number {
    return this.last;
  }
}
