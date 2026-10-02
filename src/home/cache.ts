/**
 * A bounded, expiring in-memory map. Reads move an entry to the back, so a full
 * cache drops the least recently used entry first. `get` counts hits and misses
 * for health; `peek` answers without counting or reordering.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>();
  hits = 0;
  misses = 0;

  constructor(private readonly maxEntries: number, private readonly ttlMs: number, private readonly now: () => number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("cache size must be a whole number of at least 1");
  }

  peek(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) { this.entries.delete(key); return undefined; }
    return entry.value;
  }

  get(key: string): V | undefined {
    const value = this.peek(key);
    const entry = this.entries.get(key);
    if (value === undefined || !entry) { this.misses++; return undefined; }
    this.hits++;
    // Recency only: the expiry stays where the upstream answer put it.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  get size(): number { return this.entries.size; }

  stats(): { hits: number; misses: number; entries: number } {
    return { hits: this.hits, misses: this.misses, entries: this.entries.size };
  }
}
