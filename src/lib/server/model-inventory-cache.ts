import type { RuntimeModelOption } from "../runtime-models.ts";

export function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

type Entry = { expiresAt: number; models: RuntimeModelOption[] };

export class ModelInventoryCache {
  private entries = new Map<string, Entry>();
  private earliestExpiry = Infinity;

  private prune(now: number): void {
    if (now < this.earliestExpiry) return;
    this.earliestExpiry = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
      else if (entry.expiresAt < this.earliestExpiry) this.earliestExpiry = entry.expiresAt;
    }
  }

  get(key: string, now: number): Entry | undefined {
    this.prune(now);
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  set(key: string, entry: Entry, maxEntries: number, now: number): void {
    this.prune(now);
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (entry.expiresAt < this.earliestExpiry) this.earliestExpiry = entry.expiresAt;
    while (this.entries.size > maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
    this.earliestExpiry = Infinity;
  }
}
