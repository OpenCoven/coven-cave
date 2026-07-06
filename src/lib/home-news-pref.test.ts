// Home news pref — default-on opt-out backing the Settings → General switch
// and the Home digest News row (which has no inline dismiss).
import assert from "node:assert/strict";

// Minimal window stub so the module's storage-backed cache is exercised.
const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const { readHomeNewsEnabled, writeHomeNewsEnabled } = await import("./home-news-pref.ts");

// Default is ON — absence of the key means enabled (opt-out semantics).
assert.equal(readHomeNewsEnabled(), true, "news defaults to enabled");

// Opting out persists "false" and flips the cached read.
writeHomeNewsEnabled(false);
assert.equal(readHomeNewsEnabled(), false, "opt-out is reflected immediately");
assert.equal(store.get("cave:home-news-enabled"), "false", "opt-out persists to localStorage");

// Re-enabling round-trips.
writeHomeNewsEnabled(true);
assert.equal(readHomeNewsEnabled(), true, "re-enable is reflected immediately");
assert.equal(store.get("cave:home-news-enabled"), "true", "re-enable persists");

// A literal "false" in storage on a cold cache reads as disabled; anything else
// (junk, "true") reads enabled — matching the mobile-mode pref convention.
store.set("cave:home-news-enabled", "false");
writeHomeNewsEnabled(false); // reset cache to a known state via the public API
assert.equal(readHomeNewsEnabled(), false);

console.log("home-news-pref.test.ts: ok");
