// Tests for the frozen-write / live-read guard.
//
// Every case below is a SHAPE, expressed as a synthetic production module plus
// a synthetic test file, so the suite asserts the rule rather than the current
// contents of the repository. That matters twice over: the repo is expected to
// stay clean, so a repo-reading test would assert nothing after today; and the
// original defect has now been repaired upstream, so the only durable record of
// what it looked like is a fixture.
//
// The fixtures are deliberately clock-free where they can be. Where a case is
// ABOUT the wall clock — inert vs bomb — the instant is computed relative to
// `Date.now()` at run time, never written as a literal. A literal there would
// make this suite the very thing it exists to prevent.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSUMED_TTL_MS,
  IN_FLIGHT_REPAIRS,
  analyzeTestSource,
  collectTtlBearingApis,
  isExpired,
  partitionFindings,
} from "./check-test-clock-consistency.mjs";

/**
 * A production module shaped like the real one: the TTL and the write both sit
 * one call BELOW the exported entry points, which is what defeated the first
 * version of this guard and is therefore the shape worth pinning.
 */
const PRODUCTION = `
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheEntries(posts, now) {
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS).toISOString();
  return posts.map((post) => ({ ...post, expiresAt }));
}

async function writeEntries(entries) {
  await writeFile("cache.json", JSON.stringify(entries), "utf8");
}

function readEntryUnlocked(id, now) {
  const entry = load(id);
  if (Date.parse(entry.expiresAt) <= now.getTime()) return null;
  return entry;
}

export async function seedCache(posts, now = new Date()) {
  await writeEntries(cacheEntries(posts, now));
}

export async function readCache(id, now = new Date()) {
  return readEntryUnlocked(id, now);
}

export function formatDay(date, now = new Date()) {
  return date.getTime() === now.getTime() ? "today" : "other";
}

export function bucket(rows, nowMs) {
  const byKey = new Map();
  for (const row of rows) byKey.set(row.key, row);
  return [...byKey.values()].filter((row) => row.at > nowMs - 1000);
}

export function staleRows(rows, now) {
  const seen = new Map();
  for (const row of rows) seen.set(row.id, row);
  return [...seen.values()].filter((row) => isStale(row, now));
}

export function pending(rows, now) {
  const expiry = now.getTime();
  return recordSweep(rows).filter((row) => row.at > expiry);
}
`;

/**
 * A SECOND module that happens to define a function with the same name as one
 * in the first — and that one writes to disk. Name collisions are ordinary in a
 * codebase this size, and a call graph keyed by bare name cannot tell the two
 * apart: propagating globally marked the pure parser `parseWhen` as persisting
 * because of a same-named helper elsewhere, and flagged a correct test file.
 */
const OTHER_MODULE = `
export async function bucket(rows, nowMs) {
  const expiresAt = nowMs + 1000;
  await writeFile("elsewhere.json", JSON.stringify({ rows, expiresAt }), "utf8");
}

export async function recordSweep(rows) {
  await writeFile("sweep.json", JSON.stringify(rows), "utf8");
  return rows;
}
`;

const registry = collectTtlBearingApis([
  { file: "/repo/src/lib/cache.ts", text: PRODUCTION },
  { file: "/repo/src/lib/other.ts", text: OTHER_MODULE },
]);

/**
 * Analyze a synthetic test file against the synthetic production modules.
 *
 * The import header is real, because resolution is part of what is under test:
 * the guard matches a helper against the module the test imports it FROM, so a
 * fixture with no imports would exercise only the by-name fallback.
 */
const IMPORTS = `import { seedCache, readCache, formatDay, bucket } from "./cache.ts";\n`;

function findings(source, header = IMPORTS) {
  return analyzeTestSource("/repo/src/lib/cache.test.ts", header + source, registry, "/repo");
}

const wrap = (body) => `test("a case", async () => {\n${body}\n});\n`;

/** An instant far enough in the past that one TTL has certainly elapsed. */
const longDead = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
/** An instant far enough ahead that one TTL certainly has not elapsed. */
const stillLive = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

// ---------------------------------------------------------------------------
// The registry — the half that silently did nothing in the first version
// ---------------------------------------------------------------------------

test("TTL and persistence propagate from callees, so the real entry points register", () => {
  // Neither `seedCache` nor `readCache` mentions a TTL or a write in its own
  // body. A body-text-only registry omits both and reports every tree clean,
  // which is precisely how the original bug would have survived this guard.
  assert.equal(registry.get("seedCache").clockParamIndex, 1);
  assert.equal(registry.get("seedCache").persists, true);
  assert.equal(registry.get("readCache").clockParamIndex, 1);
});

test("pure helpers that merely accept a clock are not registered or not persisting", () => {
  // `formatDay` decides nothing about freshness -> never registered.
  assert.equal(registry.has("formatDay"), false);
  // `cache.ts`'s `bucket` writes only to a local Map, and decides no expiry, so
  // it is not registered for that module at all. In-memory mutation is not
  // persistence — treating `.set` as a write made this pure bucketing function
  // look like a cache and flagged four correct tests in `chat-recency`.
  // (`other.ts` defines a same-named function that IS a cache; that collision is
  // the subject of the next test.)
  assert.equal(registry.byModule.has("/repo/src/lib/cache.ts::bucket"), false);
});

test("a local Map write is not persistence, even in a TTL-bearing helper", () => {
  // `staleRows` DOES decide freshness (`isStale`), so it is registered — and it
  // mutates only a local `new Map()`. Registration is what makes this the case
  // that matters: treating `.set(` as a write would flag every frozen call to
  // it, which is exactly what happened to four correct `chat-recency` tests.
  assert.equal(registry.byModule.get("/repo/src/lib/cache.ts::staleRows")?.persists, false);
  assert.deepEqual(
    findings(
      wrap(`  const NOW = new Date("${stillLive()}");\n  staleRows([], NOW);`),
      `import { staleRows } from "./cache.ts";\n`,
    ),
    [],
  );
});

test("persistence does not leak from a same-named callee in another module", () => {
  // `cache.ts`'s `pending` calls `recordSweep`, which `cache.ts` does NOT
  // define — `other.ts` does, and that one writes to disk. A call graph keyed by
  // bare name happily joins those two across the module boundary and hands the
  // disk write to a pure caller. That is exactly how the pure parser `parseWhen`
  // was marked as persisting, which flagged a correct test file.
  assert.equal(registry.byModule.get("/repo/src/lib/cache.ts::pending")?.persists, false);
  assert.deepEqual(
    findings(
      wrap(`  const NOW = new Date("${stillLive()}");\n  pending([], NOW);`),
      `import { pending } from "./cache.ts";\n`,
    ),
    [],
  );
});

test("a same-named function in another module is not confused for this one", () => {
  // `other.ts` exports a `bucket` that really is a TTL-bearing disk write, and
  // `cache.ts` exports a pure one. Keyed by bare name they are the same entry —
  // which is how the pure parser `parseWhen` inherited a same-named helper's
  // persistence and got a correct test file flagged. A test importing the pure
  // one must be judged against the pure one.
  assert.equal(registry.byModule.has("/repo/src/lib/other.ts::bucket"), true);
  assert.equal(registry.byModule.has("/repo/src/lib/cache.ts::bucket"), false);
  assert.deepEqual(
    findings(wrap(`  const NOW = new Date("2026-07-14T10:00:00.000Z");\n  await bucket([], NOW.getTime());`)),
    [],
    "importing the pure bucket must not inherit the other module's persistence",
  );
  // …and importing the real one is still caught.
  const found = findings(
    wrap(`  const NOW = new Date("${stillLive()}");\n  await bucket([], NOW.getTime());`),
    `import { bucket } from "./other.ts";\n`,
  );
  assert.equal(found.length, 1, "the genuinely persisting bucket is still flagged");
});

test("a local-time calendar construction is dated correctly, not read as epoch ms", () => {
  // `new Date(2026, 6, 3, 12, 0, 0)` is a local calendar date. Reading only its
  // first argument dated it to 1970-01-01T00:00:02.026Z — still "frozen", but
  // reported as an instant 56 years off, which would classify a live bomb as an
  // inert fixture and send someone to the wrong remedy.
  const found = findings(wrap(`  await seedCache([post], new Date(2126, 6, 3, 12, 0, 0));`));
  assert.equal(found.length, 1);
  assert.ok(found[0].instant.startsWith("2126-"), `expected a 2126 instant, got ${found[0].instant}`);
  assert.equal(found[0].kind, "bomb", "a far-future seed is a bomb, not an inert fixture");
});

// ---------------------------------------------------------------------------
// The defect
// ---------------------------------------------------------------------------

test("a lone frozen seed is caught — the original cave-p36ov shape", () => {
  const found = findings(wrap(`  const NOW = new Date("${stillLive()}");\n  await seedCache([post], NOW);`));
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "bomb");
});

test("a frozen write mixed with a defaulted read is caught", () => {
  const found = findings(wrap(
    `  const NOW = new Date("${stillLive()}");\n  await seedCache([post], NOW);\n  await readCache("1");`,
  ));
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "mixed");
});

test("a frozen seed hidden in a module-scope helper is still caught", () => {
  // The sanctioned repair moves seeding into a helper, so the helper body is
  // exactly where a regression would land — and it sits outside every
  // `test(...)` callback.
  const found = findings(
    `async function seed(id) {\n  const NOW = new Date("${stillLive()}");\n  await seedCache([id], NOW);\n}\n`
    + wrap(`  await seed("1");`),
  );
  assert.equal(found.length, 1);
  assert.ok(found[0].test.includes("helper seed()"));
});

// ---------------------------------------------------------------------------
// Both sanctioned repairs, and the correctness this guard must NOT flag
// ---------------------------------------------------------------------------

test("repair A — a seed anchored to the live clock passes", () => {
  // The shape PR #4942 used. It reads like a fixture date and is not one: it
  // moves with the run, so it can never expire.
  assert.deepEqual(findings(wrap(`  await seedCache([post], new Date(Date.now() - 25 * 60 * 60 * 1000));`)), []);
});

test("repair A2 — letting the clock default passes", () => {
  assert.deepEqual(findings(wrap(`  await seedCache([post]);`)), []);
});

test("repair B — a frozen write read back through the same instant passes", () => {
  assert.deepEqual(
    findings(wrap(`  const NOW = new Date("${stillLive()}");\n  await seedCache([post], NOW);\n  await readCache("1", NOW);`)),
    [],
  );
});

test("a block that pins the expiry boundary deliberately passes", () => {
  // The disjunction. `x-sources.test.ts` seeds at `fetched` and reads one
  // millisecond past the TTL at `expiredAt`, asserting the entry is gone. That
  // relationship holds between two fixtures and never consults the wall clock,
  // so frozen instants are correct there. A mutation on the REPAIRED hydration
  // file — "never expire a cache entry" — went uncaught 27/0 precisely because
  // nothing in it pinned this boundary; a file with a frozen write is safe when
  // it asserts expiry, and unsafe when it merely avoids the subject.
  const found = findings(wrap(
    `  const fetched = new Date("2026-07-30T12:00:00.000Z");\n`
    + `  await seedCache([post], fetched);\n`
    + `  const expiredAt = new Date("2026-07-31T12:00:00.001Z");\n`
    + `  assert.equal(await readCache("1", expiredAt), null);`,
  ));
  assert.deepEqual(found, []);
});

test("pinning expiry rescues a block that is otherwise a lone frozen seed", () => {
  // The case above passes for TWO reasons at once — it pins expiry AND it calls
  // two different helpers — so deleting the disjunction leaves it green and the
  // rule untested. This one isolates the disjunction: a single helper, called
  // once, with a frozen instant, rescued ONLY by asserting the boundary.
  const seedOnly = `  const fetched = new Date("2026-07-30T12:00:00.000Z");\n  await seedCache([post], fetched);\n`;
  assert.equal(findings(wrap(seedOnly)).length, 1, "without an expiry assertion this is a finding");
  assert.deepEqual(
    findings(wrap(`${seedOnly}  assert.ok(entry.expiresAt > fetched.toISOString());`)),
    [],
    "asserting the expiry boundary makes the same frozen seed correct",
  );
});

test("a fixture FIELD named expiresAt does not count as pinning the boundary", () => {
  // The repaired hydration file carries exactly this — a fixture object with an
  // `expiresAt` property — and a mutation proving it does not test expiry at all
  // survived it 27/0. A text search over the block would read that field as an
  // assertion and hand the disjunction to the one file that most needed it
  // withheld, so the token only counts inside an assertion.
  const found = findings(wrap(
    `  const NOW = new Date("${stillLive()}");\n`
    + `  const fixture = { id: "1", expiresAt: "2026-01-01T00:00:00.000Z" };\n`
    + `  await seedCache([fixture], NOW);`,
  ));
  assert.equal(found.length, 1, "a mentioned field name must not rescue a lone frozen seed");
});

test("the live clock wins over a frozen operand in a mixed expression", () => {
  // `new Date(FROZEN.getTime() + Date.now() % 1000)` has a frozen left operand,
  // so a checker that returns on the first frozen sub-expression calls the whole
  // thing frozen. It is not: it moves with the run, and flagging it would reject
  // a legitimate jittered fixture.
  assert.deepEqual(
    findings(wrap(
      `  const NOW = new Date("2026-07-30T12:00:00.000Z");\n`
      + `  await seedCache([post], new Date(NOW.getTime() + (Date.now() % 1000)));`,
    )),
    [],
  );
});

test("an absolute date passed to a pure helper is never flagged", () => {
  // The blanket "no absolute dates in fixtures" rule this guard refuses to be.
  // `formatDay` and `bucket` persist nothing, so their frozen instants die with
  // the call.
  assert.deepEqual(findings(wrap(
    `  const NOW = new Date("2026-07-14T10:00:00.000Z");\n`
    + `  assert.equal(formatDay(NOW, NOW), "today");\n`
    + `  assert.deepEqual(bucket([], NOW.getTime()), []);`,
  )), []);
});

test("a block that installs a fake system clock is not flagged", () => {
  assert.deepEqual(findings(wrap(
    `  vi.setSystemTime(new Date("${stillLive()}"));\n`
    + `  const NOW = new Date("${stillLive()}");\n  await seedCache([post], NOW);`,
  )), []);
});

// ---------------------------------------------------------------------------
// inert vs bomb — the quiet failure that no red CI will ever surface
// ---------------------------------------------------------------------------

test("a fixture already more than one TTL in the past is classified inert, not bomb", () => {
  // Two tests repaired in #4942 were this: seeding an entry that was already
  // dead when written, so they passed by never reaching the assertion they
  // name. Same remedy as a bomb, different urgency — and no failing run ever
  // points at them.
  const found = findings(wrap(`  const NOW = new Date("${longDead()}");\n  await seedCache([post], NOW);`));
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "inert");
});

test("isExpired measures the instant plus one TTL against the clock it is given", () => {
  const base = Date.parse("2026-01-10T00:00:00.000Z");
  const instant = new Date(base).toISOString();
  assert.equal(isExpired(instant, ASSUMED_TTL_MS, new Date(base + ASSUMED_TTL_MS - 1)), false);
  assert.equal(isExpired(instant, ASSUMED_TTL_MS, new Date(base + ASSUMED_TTL_MS)), true);
  assert.equal(isExpired(null, ASSUMED_TTL_MS, new Date(base)), false);
});

// ---------------------------------------------------------------------------
// Clock independence — the property a same-day green run cannot demonstrate
// ---------------------------------------------------------------------------

test("the structural verdict does not depend on the wall clock", () => {
  // A guard against time bombs that itself changes verdict with the date would
  // be the same defect one level up. Only the inert/bomb LABEL may move with
  // the clock; whether a shape is reported at all may not.
  const bomb = wrap(`  const NOW = new Date("${stillLive()}");\n  await seedCache([post], NOW);`);
  const safe = wrap(`  await seedCache([post]);`);

  const RealDate = Date;
  for (const shiftDays of [-3650, 0, 3650, 36500]) {
    class Shifted extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(RealDate.now() + shiftDays * 86_400_000);
        else super(...args);
      }
      static now() {
        return RealDate.now() + shiftDays * 86_400_000;
      }
    }
    globalThis.Date = Shifted;
    try {
      assert.equal(findings(bomb).length, 1, `bomb must be reported at shift ${shiftDays}d`);
      assert.equal(findings(safe).length, 0, `safe must stay clean at shift ${shiftDays}d`);
    } finally {
      globalThis.Date = RealDate;
    }
  }
});

// ---------------------------------------------------------------------------
// The ratchet
// ---------------------------------------------------------------------------

test("the ratchet defers a listed file and reports an entry that outlived its fix", () => {
  // Both halves matter, and only the first is obvious. Deferring lets the guard
  // land while a repair is in flight; reporting the STALE entry is what stops
  // that deferral from quietly becoming permanent and swallowing the next bomb
  // in the same file. This ran for real: the entry was added while PR #4942 was
  // open and the check failed the moment #4942 landed.
  const inFlight = new Map([["src/a.test.ts", "repaired by PR #1, remove when it lands"]]);

  const whileOpen = partitionFindings(
    [{ file: "src/a.test.ts", kind: "bomb" }, { file: "src/b.test.ts", kind: "bomb" }],
    inFlight,
  );
  assert.deepEqual(whileOpen.active.map((f) => f.file), ["src/b.test.ts"], "an unlisted file still fails");
  assert.deepEqual([...whileOpen.deferred], ["src/a.test.ts"]);
  assert.deepEqual(whileOpen.stale, [], "the entry still describes a real defect");

  const afterMerge = partitionFindings([{ file: "src/b.test.ts", kind: "bomb" }], inFlight);
  assert.deepEqual(afterMerge.stale, ["src/a.test.ts"], "the fix landed, so the entry must go");
});

test("IN_FLIGHT_REPAIRS is empty, and an entry must name what removes it", () => {
  // It is empty today. If a future entry appears, it must carry a justification
  // long enough to name the PR that deletes it — the check itself fails once a
  // listed file stops reporting a finding, so an entry cannot outlive its fix.
  for (const [file, reason] of IN_FLIGHT_REPAIRS) {
    assert.ok(reason.length > 40, `${file} needs a real justification, not a placeholder`);
  }
  assert.equal(IN_FLIGHT_REPAIRS.size, 0, "no repair is currently in flight");
});
