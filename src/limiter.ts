/** A rolling one-minute window of call timestamps. */
export class MinuteLimiter {
  private readonly stamps: number[] = [];
  constructor(private readonly limit: number, private readonly now: () => number = Date.now) {}

  take(): boolean {
    const t = this.now();
    while (this.stamps.length && t - this.stamps[0]! >= 60_000) this.stamps.shift();
    if (this.stamps.length >= this.limit) return false;
    this.stamps.push(t);
    return true;
  }
}
