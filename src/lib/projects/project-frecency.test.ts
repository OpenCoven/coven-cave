import assert from "node:assert/strict";
import test from "node:test";

import type { CaveProject } from "./cave-projects-types.ts";
import {
  FRECENCY_HALF_LIFE_MS,
  MAX_TRACKED_PROJECTS,
  frecencyScore,
  loadFrecencyStore,
  pruneStore,
  rankProjectsByFrecency,
  recordProjectPick,
  rememberProjectPick,
  resetFrecencyStoreForTests,
  saveFrecencyStore,
  type FrecencyStore,
} from "./project-frecency.ts";

const NOW = Date.UTC(2026, 7, 1);
const DAY = 24 * 60 * 60 * 1000;

function project(name: string, root: string): CaveProject {
  return {
    id: `id-${name}`,
    name,
    root,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as CaveProject;
}

// A-Z, the order the cache hands us.
const ALPHA = project("Alpha", "/w/alpha");
const BRAVO = project("Bravo", "/w/bravo");
const CHARLIE = project("Charlie", "/w/charlie");
const DELTA = project("Delta", "/w/delta");
const LIST = [ALPHA, BRAVO, CHARLIE, DELTA];

// ── scoring ─────────────────────────────────────────────────────────────────

test("recency halves every half-life", () => {
  const entry = { picks: 4, lastPickedAt: NOW };
  const fresh = frecencyScore(entry, NOW);
  const oneHalfLife = frecencyScore(entry, NOW + FRECENCY_HALF_LIFE_MS);
  const two = frecencyScore(entry, NOW + 2 * FRECENCY_HALF_LIFE_MS);
  assert.ok(Math.abs(oneHalfLife - fresh / 2) < 1e-9, "one half-life halves the score");
  assert.ok(Math.abs(two - fresh / 4) < 1e-9, "two half-lives quarter it");
});

// The point of frecency: a lot of old picks must not beat a recent one
// forever, and one recent pick must not instantly beat sustained use.
test("frequency is damped so it cannot swamp recency", () => {
  const heavyButStale = { picks: 100, lastPickedAt: NOW - 60 * DAY };
  const lightButFresh = { picks: 2, lastPickedAt: NOW };
  assert.ok(
    frecencyScore(lightButFresh, NOW) > frecencyScore(heavyButStale, NOW),
    "today's project outranks one abandoned two months ago despite 50x the picks",
  );

  const usedDaily = { picks: 30, lastPickedAt: NOW - DAY };
  const openedOnce = { picks: 1, lastPickedAt: NOW };
  assert.ok(
    frecencyScore(usedDaily, NOW) > frecencyScore(openedOnce, NOW),
    "sustained use still beats a single pick made an hour later",
  );
});

test("a future timestamp does not inflate the score", () => {
  // Clock skew or an edited store must not produce a permanent number-one.
  const skewed = { picks: 1, lastPickedAt: NOW + 365 * DAY };
  assert.equal(frecencyScore(skewed, NOW), frecencyScore({ picks: 1, lastPickedAt: NOW }, NOW));
});

// ── recording ───────────────────────────────────────────────────────────────

test("recording a pick is pure and accumulates", () => {
  const empty: FrecencyStore = {};
  const once = recordProjectPick(empty, "/w/alpha", NOW);
  assert.deepEqual(empty, {}, "the input store is not mutated");
  assert.equal(once["/w/alpha"].picks, 1);

  const twice = recordProjectPick(once, "/w/alpha", NOW + DAY);
  assert.equal(twice["/w/alpha"].picks, 2);
  assert.equal(twice["/w/alpha"].lastPickedAt, NOW + DAY, "last pick wins the timestamp");
});

test("roots are normalized, so the same path is one entry", () => {
  let store: FrecencyStore = {};
  store = recordProjectPick(store, "/w/alpha", NOW);
  store = recordProjectPick(store, "/w/alpha/", NOW + 1);
  assert.equal(Object.keys(store).length, 1, "a trailing slash is the same project");
  assert.equal(Object.values(store)[0].picks, 2);
});

test("an empty root is ignored rather than stored under a blank key", () => {
  const store = recordProjectPick({}, "   ", NOW);
  assert.deepEqual(store, {});
});

test("the store stays bounded, dropping the least recently used", () => {
  let store: FrecencyStore = {};
  for (let i = 0; i < MAX_TRACKED_PROJECTS + 10; i += 1) {
    store = recordProjectPick(store, `/w/p${i}`, NOW + i);
  }
  assert.equal(Object.keys(store).length, MAX_TRACKED_PROJECTS);
  assert.ok(!store["/w/p0"], "the oldest pick was evicted");
  assert.ok(store[`/w/p${MAX_TRACKED_PROJECTS + 9}`], "the newest survived");
});

test("pruning is a no-op below the cap", () => {
  const store: FrecencyStore = { "/w/a": { picks: 1, lastPickedAt: NOW } };
  assert.equal(pruneStore(store), store, "same object back — no needless copy");
});

// ── ranking ─────────────────────────────────────────────────────────────────

test("with no history there is no Recent section and the list is untouched", () => {
  const { recent, all } = rankProjectsByFrecency(LIST, {}, NOW);
  assert.deepEqual(recent, []);
  assert.deepEqual(all.map((p) => p.name), ["Alpha", "Bravo", "Charlie", "Delta"]);
});

// This is the design's stated tradeoff: a list that reorders under the cursor
// is worse than one that never learns.
test("`all` is the caller's own array by reference, not a copy", () => {
  const { all } = rankProjectsByFrecency(LIST, {}, NOW);
  assert.equal(all, LIST, "no defensive copy — the contract is pass-through, enforced readonly");
});

test("the full list is NEVER reordered or filtered — Recent is additive", () => {
  const store: FrecencyStore = {
    "/w/delta": { picks: 10, lastPickedAt: NOW },
    "/w/charlie": { picks: 3, lastPickedAt: NOW },
  };
  const { recent, all } = rankProjectsByFrecency(LIST, store, NOW);
  assert.deepEqual(recent.map((p) => p.name), ["Delta", "Charlie"], "most frecent first");
  assert.deepEqual(
    all.map((p) => p.name),
    ["Alpha", "Bravo", "Charlie", "Delta"],
    "the A-Z list is exactly as it arrived — Delta did not jump, nothing was removed",
  );
});

test("the Recent section is capped", () => {
  const store: FrecencyStore = Object.fromEntries(
    LIST.map((p, i) => [p.root, { picks: 5 + i, lastPickedAt: NOW }]),
  );
  const { recent } = rankProjectsByFrecency(LIST, store, NOW, 2);
  assert.equal(recent.length, 2);
  assert.deepEqual(recent.map((p) => p.name), ["Delta", "Charlie"], "the top two by score");
});

test("history for a project that is no longer registered is ignored", () => {
  const store: FrecencyStore = { "/w/deleted": { picks: 50, lastPickedAt: NOW } };
  const { recent } = rankProjectsByFrecency(LIST, store, NOW);
  assert.deepEqual(recent, [], "a deregistered project cannot appear in the picker");
});

test("a long-abandoned project falls out of Recent instead of pinning forever", () => {
  const store: FrecencyStore = { "/w/alpha": { picks: 1, lastPickedAt: NOW - 200 * DAY } };
  const { recent } = rankProjectsByFrecency(LIST, store, NOW);
  assert.deepEqual(recent, [], "one pick most of a year ago is below the floor");
});

test("equal scores break ties alphabetically, so rows never shuffle between renders", () => {
  const store: FrecencyStore = {
    "/w/delta": { picks: 4, lastPickedAt: NOW },
    "/w/bravo": { picks: 4, lastPickedAt: NOW },
  };
  const first = rankProjectsByFrecency(LIST, store, NOW).recent.map((p) => p.name);
  const second = rankProjectsByFrecency([...LIST].reverse(), store, NOW).recent.map((p) => p.name);
  assert.deepEqual(first, ["Bravo", "Delta"]);
  assert.deepEqual(second, first, "input order does not change the Recent ordering");
});

test("a zero limit disables the section entirely", () => {
  const store: FrecencyStore = { "/w/alpha": { picks: 9, lastPickedAt: NOW } };
  assert.deepEqual(rankProjectsByFrecency(LIST, store, NOW, 0).recent, []);
});

// ── persistence ─────────────────────────────────────────────────────────────

function withLocalStorage(run: () => void): void {
  const backing = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
  try {
    run();
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

test("a pick round-trips through storage", () => {
  withLocalStorage(() => {
    resetFrecencyStoreForTests();
    rememberProjectPick("/w/alpha", NOW);
    rememberProjectPick("/w/alpha", NOW + DAY);
    const store = loadFrecencyStore();
    assert.equal(store["/w/alpha"].picks, 2);
    assert.equal(store["/w/alpha"].lastPickedAt, NOW + DAY);
  });
});

// A broken picker is far worse than an unranked one, so every malformed shape
// must degrade to "no history" rather than throw on the way to rendering.
test("corrupt or hostile stored values degrade to no history", () => {
  withLocalStorage(() => {
    for (const bad of [
      "not json",
      "null",
      "[1,2,3]",
      '"a string"',
      '{"/w/a": null}',
      '{"/w/a": {"picks": "many", "lastPickedAt": 1}}',
      '{"/w/a": {"picks": 1}}',
      '{"/w/a": {"picks": 0, "lastPickedAt": 1}}',
      '{"/w/a": {"picks": 1, "lastPickedAt": "yesterday"}}',
    ]) {
      localStorage.setItem("cave:project-frecency:v1", bad);
      const store = loadFrecencyStore();
      // Keys, not deepEqual({}): the store is intentionally null-prototype,
      // and deepStrictEqual compares prototypes.
      assert.deepEqual(Object.keys(store), [], `\`${bad}\` yields no history`);
    }
  });
});

test("valid entries survive alongside invalid ones being dropped", () => {
  withLocalStorage(() => {
    localStorage.setItem(
      "cave:project-frecency:v1",
      JSON.stringify({ "/w/a": { picks: 2, lastPickedAt: NOW }, "/w/b": { picks: -1, lastPickedAt: NOW } }),
    );
    const store = loadFrecencyStore();
    assert.deepEqual(Object.keys(store), ["/w/a"]);
  });
});

test("a storage write failure does not throw at the call site", () => {
  const backing = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: (k: string) => void backing.delete(k),
  };
  try {
    assert.doesNotThrow(() => saveFrecencyStore({ "/w/a": { picks: 1, lastPickedAt: NOW } }));
    assert.doesNotThrow(() => rememberProjectPick("/w/a", NOW));
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("with no localStorage at all (SSR) everything is inert", () => {
  assert.deepEqual(loadFrecencyStore(), {});
  assert.doesNotThrow(() => saveFrecencyStore({ "/w/a": { picks: 1, lastPickedAt: NOW } }));
});

// localStorage is attacker-reachable in a compromised renderer, and assigning
// a "__proto__" key onto a plain object literal mutates the prototype rather
// than adding an own property.
test("a hostile __proto__ key cannot pollute the prototype", () => {
  withLocalStorage(() => {
    localStorage.setItem(
      "cave:project-frecency:v1",
      '{"__proto__": {"picks": 1, "lastPickedAt": 1, "polluted": true}}',
    );
    const store = loadFrecencyStore();
    assert.equal(({} as Record<string, unknown>).polluted, undefined, "Object.prototype is clean");
    assert.equal(Object.getPrototypeOf(store), null, "the store has no prototype to pollute");
  });
});

test("keys written by an older build are re-normalized so their history counts", () => {
  withLocalStorage(() => {
    // A raw root with a trailing slash would never match rootKey() at ranking
    // time, so the history would be silently ignored.
    localStorage.setItem(
      "cave:project-frecency:v1",
      JSON.stringify({ "/w/alpha/": { picks: 4, lastPickedAt: NOW } }),
    );
    const store = loadFrecencyStore();
    assert.deepEqual(Object.keys(store), ["/w/alpha"]);
    const { recent } = rankProjectsByFrecency(LIST, store, NOW);
    assert.deepEqual(recent.map((p) => p.name), ["Alpha"], "the legacy entry now ranks");
  });
});

test("two stored spellings of one root merge instead of shadowing", () => {
  withLocalStorage(() => {
    localStorage.setItem(
      "cave:project-frecency:v1",
      JSON.stringify({
        "/w/alpha": { picks: 2, lastPickedAt: NOW - DAY },
        "/w/alpha/": { picks: 3, lastPickedAt: NOW },
      }),
    );
    const store = loadFrecencyStore();
    assert.equal(Object.keys(store).length, 1);
    assert.equal(store["/w/alpha"].picks, 5, "picks add up");
    assert.equal(store["/w/alpha"].lastPickedAt, NOW, "the newer timestamp wins");
  });
});

test("a bare / key is dropped rather than ranked", () => {
  withLocalStorage(() => {
    localStorage.setItem("cave:project-frecency:v1", '{"/": {"picks": 9, "lastPickedAt": 1}}');
    assert.deepEqual(Object.keys(loadFrecencyStore()), []);
  });
});

test("an oversized stored map is capped on read, not just on write", () => {
  withLocalStorage(() => {
    const hostile: Record<string, unknown> = {};
    for (let i = 0; i < MAX_TRACKED_PROJECTS + 50; i += 1) {
      hostile[`/w/p${i}`] = { picks: 1, lastPickedAt: NOW + i };
    }
    localStorage.setItem("cave:project-frecency:v1", JSON.stringify(hostile));
    assert.equal(Object.keys(loadFrecencyStore()).length, MAX_TRACKED_PROJECTS);
  });
});

console.log("project-frecency.test.ts: ok");
