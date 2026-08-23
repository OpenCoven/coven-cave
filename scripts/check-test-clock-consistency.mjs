#!/usr/bin/env node
// CI guard against "frozen-write / live-read" time bombs in tests.
//
// THE DEFECT (cave-p36ov, which took `main` red with no commit responsible).
// `src/lib/server/research-mission-x-hydration.test.ts` seeded a TTL-bearing
// cache at a FROZEN calendar instant:
//
//     const NOW = new Date("2026-08-22T12:00:00.000Z");
//     await cacheNormalizedXPosts([post("1001")], NOW);
//
// and then read it back through the LIVE clock — `getCachedXPost` defaults its
// `now` to `new Date()`, and `x-sources.ts` sets `CACHE_TTL_MS` to 24h. The
// seeded entry was therefore fresh until 2026-08-23T12:00:00Z and dead in every
// run after. Measured: run #4867 passed at 09:30:49Z, run #4939 failed at
// 12:04:11Z. Nothing changed in between except the wall clock.
//
// **The defect is NOT the hard-coded date.** It is mixing a frozen write with a
// live read. Either alone is fine, which is why a blanket "no absolute dates in
// fixtures" rule would be wrong: it would flag `src/lib/server/x-sources.test.ts`,
// which tests the same module and is the CORRECT specification —
//
//     seed with frozen `now`     -> getCachedXPost("100", now)      MATCHED
//     seed with the real clock   -> getCachedXPost("100")           MATCHED
//     explicit `fetched` + `expiredAt` to pin a boundary DELIBERATELY
//
// Every write there is read back through the clock it was written with.
//
// WHY THE READ IS INVISIBLE, AND WHAT THAT FORCES.
// The obvious check — "pair each frozen write with a frozen read" — cannot be
// written, because in the failing file the read is not in the test at all. The
// test calls `hydrateMissionXSources(mission)`, which takes no clock and
// internally reaches `deps.getCachedXPost(source.postId)`. So the guard cannot
// require the read to be visible; it has to conclude from the WRITE side alone.
// That is what clause 2 below does, and it is the clause that catches the
// original bug.
//
// THE RULE. Inside a single test block, calls to TTL-bearing helpers must be
// clock-consistent:
//
//   1. A frozen clock argument must not be mixed with a DEFAULTED (live) one.
//      One call trusts the fixture instant, the other trusts the wall clock;
//      the moment they disagree by more than the TTL the test flips.
//
//   2. A frozen clock argument in a block that makes no OTHER TTL-bearing call
//      is an error. A lone frozen write is, by construction, judged later by a
//      reader the test never handed the clock to — which is precisely the
//      original bug. Pass the same instant to the read, or anchor the seed to
//      the real clock (`new Date(Date.now() - 25 * 60 * 60 * 1000)`), which is
//      the shape PR #4942 used to repair it.
//
// SCOPE, deliberately narrow. Only helpers whose bodies derive an expiry or
// staleness decision from their clock parameter are considered. A pure
// formatter that takes an explicit `now` — `relDayWord`, `parseWhen`,
// `draftReminderFromText` — persists nothing across the clock boundary and can
// never be a time bomb, so it is not registered and its many frozen fixtures
// are not flagged. Persistence across the clock boundary is the whole defect.
//
// A FROZEN instant is one fixed on the calendar: `new Date("2026-08-22T…")`,
// `new Date(1750000000000)`, or a binding holding one. An instant anchored to
// the live clock — `new Date()`, `new Date(Date.now() - 25 * 60 * 60 * 1000)` —
// is NOT frozen: it moves with the run, so it cannot expire. That distinction
// is what makes the sanctioned repair actually pass this guard.
//
// Run: `node scripts/check-test-clock-consistency.mjs` (wired as
// `pnpm check:test-clocks`, and into `pnpm lint`).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { isDirectRun } from "./direct-run.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Parameter names that denote "the current instant" rather than a data field. */
const CLOCK_PARAM_NAME = /^(now|nowMs|asOf|asOfMs|at|atMs|currentTime)$/;

/**
 * A body that decides freshness from its clock. This is what separates a cache
 * from a formatter, and therefore what separates a real time bomb from an
 * absolute date that is merely absolute.
 */
const TTL_BODY_MARKER = /\b(expiresAt|expiredAt|expiry|expiresIn|isExpired|staleAt|isStale|staleAfter|TTL|Ttl|MAX_AGE_MS|maxAgeMs)\b/;

/**
 * A body that writes state outliving the call. Persistence is the other half of
 * the defect: a frozen instant that never leaves the call stack cannot rot,
 * which is why the many pure formatters taking an explicit `now` are not bombs
 * and must not be flagged.
 */
// Deliberately restricted to calls that leave the process. A bare `.set` was
// tried first and is wrong: `deriveChatRecencyBuckets` builds a local
// `new Map()` and calls `byKey.set(...)`, which made a pure bucketing function
// look like a cache and flagged four correct tests. In-memory mutation is not
// persistence — the frozen instant still dies with the call.
const PERSIST_BODY_MARKER = /\b(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|rename|unlink|rmdir|localStorage|sessionStorage|setItem)\b/;

/** Directories that never hold first-party source. */
const SKIP_DIRS = new Set(["node_modules", ".next", "target", "gen", "dist", "build", "out"]);

const TEST_FILE = /\.test\.(tsx?|mjs)$/;
const SOURCE_FILE = /\.(tsx?)$/;

function walk(dir, acc, predicate) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc; // a directory that does not exist contributes nothing
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc, predicate);
    else if (predicate(entry.name)) acc.push(full);
  }
  return acc;
}

function parse(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, /* setParentNodes */ true);
}

/**
 * One spelling for a path, so a module key built by the scanner and one built
 * from an import specifier compare equal. Windows produces backslashes from
 * `path.join`/`path.resolve` while specifiers are always POSIX, and CI is
 * Linux — without this the import resolution below silently matches nothing on
 * one of the two platforms and every helper falls back to by-name lookup.
 */
const asKey = (file) => file.split(path.sep).join("/").replace(/\\/g, "/");

/** `new Date()` — the live clock, taken now. */
function isLiveDateConstruction(node) {
  return ts.isNewExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === "Date"
    && (node.arguments?.length ?? 0) === 0;
}

/** `Date.now()` — the live clock as a number. */
function isDateNowCall(node) {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "Date"
    && node.expression.name.text === "now";
}

/** Any use of the live clock anywhere inside an expression. */
function referencesLiveClock(node) {
  let found = false;
  const visit = (child) => {
    if (found) return;
    if (isLiveDateConstruction(child) || isDateNowCall(child)) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/**
 * Does this expression name a fixed point on the calendar?
 *
 * Frozen: `new Date("2026-08-22T12:00:00.000Z")`, `new Date(1750000000000)`,
 * and anything derived from one WITHOUT touching the live clock — including
 * `new Date(NOW.getTime() + 60_000)` and `FROZEN.toISOString()`.
 *
 * Not frozen: anything that reads the live clock, however deeply. This is the
 * load-bearing exclusion — `new Date(Date.now() - 25 * 60 * 60 * 1000)` looks
 * like a fixture date and is not one, because it moves with the run. Checking
 * it first means a live-anchored expression can never be misread as frozen.
 *
 * @returns {{frozen: boolean, instant: string | null}}
 */
function classifyInstant(node, bindings, seen = new Set()) {
  if (!node) return { frozen: false, instant: null };

  // Live clock anywhere wins outright.
  if (referencesLiveClock(node)) return { frozen: false, instant: null };

  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Date") {
    const [arg] = node.arguments ?? [];
    if (!arg) return { frozen: false, instant: null }; // `new Date()` — already excluded above
    if (ts.isStringLiteral(arg)) {
      const parsed = Date.parse(arg.text);
      return Number.isNaN(parsed)
        ? { frozen: false, instant: null }
        : { frozen: true, instant: new Date(parsed).toISOString() };
    }
    if (ts.isNumericLiteral(arg)) {
      const parts = (node.arguments ?? []).filter(ts.isNumericLiteral).map((n) => Number(n.text));
      // `new Date(2026, 6, 3, 12, 0, 0)` is a LOCAL calendar construction, not
      // an epoch offset. Reading only the first argument dated it to
      // 1970-01-01T00:00:02.026Z, which was frozen but reported nonsense.
      if (parts.length === (node.arguments ?? []).length && parts.length > 1) {
        const built = new Date(parts[0], parts[1], parts[2] ?? 1, parts[3] ?? 0, parts[4] ?? 0, parts[5] ?? 0);
        return Number.isNaN(built.getTime())
          ? { frozen: false, instant: null }
          : { frozen: true, instant: built.toISOString() };
      }
      const ms = Number(arg.text);
      return Number.isFinite(ms)
        ? { frozen: true, instant: new Date(ms).toISOString() }
        : { frozen: false, instant: null };
    }
    // `new Date(FROZEN.getTime() + 60_000)` — frozen if its source is.
    const inner = classifyInstant(arg, bindings, seen);
    return inner.frozen ? { frozen: true, instant: inner.instant } : { frozen: false, instant: null };
  }

  // `FROZEN.getTime()`, `FROZEN.toISOString()`, `FROZEN.getTime() + 60_000`.
  if (ts.isPropertyAccessExpression(node)) return classifyInstant(node.expression, bindings, seen);
  if (ts.isCallExpression(node)) return classifyInstant(node.expression, bindings, seen);
  if (ts.isBinaryExpression(node)) {
    const left = classifyInstant(node.left, bindings, seen);
    return left.frozen ? left : classifyInstant(node.right, bindings, seen);
  }
  if (ts.isParenthesizedExpression(node)) return classifyInstant(node.expression, bindings, seen);

  // A binding — resolve it once, guarding against a cycle.
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return { frozen: false, instant: null };
    const initializer = bindings.get(node.text);
    if (!initializer) return { frozen: false, instant: null };
    seen.add(node.text);
    return classifyInstant(initializer, bindings, seen);
  }

  return { frozen: false, instant: null };
}

/**
 * Every `const`/`let` initializer in the file, by name.
 *
 * Deliberately flat rather than scope-aware: the frozen constant is nearly
 * always at module scope (`const NOW = …`) while its use is deep inside a test
 * block, and a scope-aware resolver would have to model closures to see it. A
 * name collision between two frozen constants changes which instant is
 * REPORTED, never whether the block is flagged.
 */
function collectBindings(sourceFile) {
  const bindings = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (!bindings.has(node.name.text)) bindings.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

/**
 * Build the registry of TTL-bearing helpers from production source.
 *
 * A function qualifies when it takes a clock-named parameter AND decides
 * freshness from a clock. Both halves matter: the first locates the argument
 * position a test would have to pass, the second excludes every pure formatter
 * that merely accepts a `now`.
 *
 * THE SECOND HALF MUST BE TRANSITIVE, and this is not a refinement — without it
 * the guard does not catch the bug it exists for. Neither of the two functions
 * in the original defect carries a TTL token in its own body:
 *
 *     cacheNormalizedXPosts -> normalizedCacheEntries   // `expiresAt` lives here
 *     getCachedXPost        -> getCachedXPostUnlocked   // the expiry comparison lives here
 *
 * A body-text-only registry silently omits both, reports a clean tree, and the
 * next `cacheNormalizedXPosts([post], NOW)` lands unnoticed. So the call graph
 * is walked to a fixpoint and both properties propagate from callee to caller.
 *
 * Propagation is MODULE-LOCAL — an edge is followed only to a definition in the
 * same file. The call graph is keyed by name, and names collide across a
 * codebase this size: propagating globally marked the pure parser `parseWhen`
 * as persisting, because some unrelated module defines a same-named helper that
 * writes to disk. That flagged `parse-when.test.ts`, which passes its frozen
 * clock to every call and computes every expectation from it — correct code,
 * and precisely the kind of false positive that gets a guard deleted. Every
 * real chain in the original defect is intra-module
 * (`cacheNormalizedXPosts` -> `normalizedCacheEntries` -> `writeCacheEntriesUnlocked`),
 * so nothing is lost.
 *
 * Within a module the walk is still deliberately loose: an edge counts whether
 * or not the clock is the argument forwarded, because missing a real bomb is
 * worse than registering one extra helper.
 *
 * @returns {Map<string, {clockParamIndex: number, optional: boolean, file: string, persists: boolean}>}
 */
export function collectTtlBearingApis(sourceFiles) {
  /** @type {Map<string, {clockParamIndex: number, optional: boolean, file: string, ttl: boolean, persists: boolean, calls: Set<string>}>} */
  const functions = new Map();

  for (const { file, text } of sourceFiles) {
    const sourceFile = parse(file, text);

    const consider = (name, node) => {
      if (!name || !node.parameters || !node.body) return;
      const key = `${asKey(file)}::${name}`;
      if (functions.has(key)) return; // first definition in this file wins

      const index = node.parameters.findIndex(
        (parameter) => ts.isIdentifier(parameter.name) && CLOCK_PARAM_NAME.test(parameter.name.text),
      );
      const parameter = index === -1 ? null : node.parameters[index];
      const body = node.body.getText(sourceFile);

      // Callees, so TTL and persistence can propagate up to this function.
      const calls = new Set();
      const collect = (child) => {
        if (ts.isCallExpression(child)) {
          const callee = calleeName(child);
          if (callee) calls.add(callee);
        }
        ts.forEachChild(child, collect);
      };
      collect(node.body);

      functions.set(key, {
        name,
        clockParamIndex: index,
        optional: parameter ? Boolean(parameter.initializer) || Boolean(parameter.questionToken) : false,
        file,
        ttl: TTL_BODY_MARKER.test(body),
        persists: PERSIST_BODY_MARKER.test(body),
        calls,
      });
    };

    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) consider(node.name.text, node);
      else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) consider(node.name.text, node);
      else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
        && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        consider(node.name.text, node.initializer);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  // Propagate `ttl` and `persists` along call edges until nothing changes.
  // Monotonic (flags only ever turn on) over a finite set, so this terminates
  // and recursion in the call graph is harmless.
  for (let changed = true; changed;) {
    changed = false;
    for (const entry of functions.values()) {
      if (entry.ttl && entry.persists) continue;
      for (const callee of entry.calls) {
        const target = functions.get(`${asKey(entry.file)}::${callee}`);
        if (!target) continue;
        if (target.ttl && !entry.ttl) {
          entry.ttl = true;
          changed = true;
        }
        if (target.persists && !entry.persists) {
          entry.persists = true;
          changed = true;
        }
      }
    }
  }

  const byName = new Map();
  const byModule = new Map();
  for (const entry of functions.values()) {
    if (entry.clockParamIndex === -1 || !entry.ttl) continue;
    const record = {
      name: entry.name,
      clockParamIndex: entry.clockParamIndex,
      optional: entry.optional,
      file: entry.file,
      persists: entry.persists,
    };
    byModule.set(`${asKey(entry.file)}::${entry.name}`, record);
    if (!byName.has(entry.name)) byName.set(entry.name, record); // first wins
  }

  return {
    byName,
    byModule,
    /** Convenience for callers that only have a name (and for tests). */
    get: (name) => byName.get(name),
    has: (name) => byName.has(name),
    get size() {
      return byName.size;
    },
    /**
     * Resolve a name as used in `fromFile`.
     *
     * When the test file's import for that name resolves to a first-party
     * module, ONLY that module's definition counts — so a same-named helper
     * elsewhere can neither lend its persistence nor register a name the test
     * never imported. Falling back to the by-name map keeps the guard working
     * for a name whose import cannot be resolved (a package, an alias), where
     * over-matching is the safer direction.
     */
    resolve(name, importedFrom) {
      if (importedFrom) {
        const exact = byModule.get(`${asKey(importedFrom)}::${name}`);
        return exact ?? null;
      }
      return byName.get(name) ?? null;
    },
  };
}

/** The callee's plain name, for `foo()` and `mod.foo()` alike. */
function calleeName(node) {
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text;
  return null;
}

/**
 * Does this block install a fake system clock? If so the live default is under
 * the test's control and the mixing rule does not apply.
 */
const FAKE_CLOCK = /\b(useFakeTimers|setSystemTime|MockDate|mock\.timers\.enable|installClock)\b/;

/**
 * Does this block pin the expiry boundary on purpose?
 *
 * This is the second half of the safety test, and it came out of the incident
 * rather than out of theory. A mutation run on the REPAIRED file — "never
 * expire a cache entry" — was NOT caught: 27 passed, 0 failed. Nothing in that
 * suite asserted expiry semantics at all, which is exactly why the fuse was
 * invisible from inside it for a whole day.
 *
 * So safety is a DISJUNCTION, not a single shape:
 *
 *     safe  ==  avoids the frozen-write/live-read mix  OR  pins expiry explicitly
 *
 * A frozen instant is entirely legitimate when the test is deliberately driving
 * the boundary — `x-sources.test.ts` seeds at `fetched` and reads at
 * `expiredAt`, one millisecond past the TTL, and asserts the entry is gone.
 * That test cannot rot, because the relationship it asserts is between two
 * fixture instants and never involves the wall clock.
 */
const PINS_EXPIRY = /\b(expiresAt|expiredAt|sweepExpired|isExpired|expiry)\b/;

/**
 * The token must appear inside an ASSERTION, not merely somewhere in the block.
 *
 * A plain text search over the block is far too generous: the repaired
 * hydration file carries a fixture field literally named `expiresAt`, so a text
 * match reports it as pinning the boundary when the mutation evidence says the
 * opposite — "never expire a cache entry" ran 27/0 against it. Reading a fixture
 * field as an expiry assertion would grant the disjunction to exactly the files
 * that most need it withheld.
 */
function pinsExpiry(blockNode, sourceFile) {
  let pinned = false;
  const visit = (node) => {
    if (pinned) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      if (/^(assert|expect|t\.assert)\b/.test(callee) && PINS_EXPIRY.test(node.getText(sourceFile))) {
        pinned = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(blockNode);
  return pinned;
}

/** The TTL assumed when classifying a frozen seed as already-dead. */
export const ASSUMED_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Analyze one test file.
 *
 * Test blocks are located by their callback, so a `test(...)`/`it(...)` body is
 * one unit and module-level setup is another. Granularity below the file is
 * essential: `x-sources.test.ts` mixes frozen-pair and live-pair scenarios
 * across the file and is correct, so a file-level rule would flag the very file
 * that defines the discipline.
 *
 * @returns {Array<{file: string, line: number, test: string, kind: string, message: string, instant: string | null}>}
 */
export function analyzeTestSource(file, text, registry, relativeTo = root) {
  const sourceFile = parse(file, text);
  const bindings = collectBindings(sourceFile);
  const relative = path.relative(relativeTo, file).split(path.sep).join("/");
  const findings = [];

  // Where each imported name comes from, so a helper is matched against the
  // module the test actually imports it from rather than against any file in
  // the repository that happens to define that name.
  const importedFrom = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith(".")) continue; // a package, not first-party
    const bindingsNode = statement.importClause?.namedBindings;
    if (!bindingsNode || !ts.isNamedImports(bindingsNode)) continue;
    // Resolved in POSIX space against the already-normalized path. `path.resolve`
    // is wrong here on Windows: given a POSIX-rooted path it prepends the current
    // drive, so the candidate never equals the key the scanner stored.
    const base = path.posix.resolve(path.posix.dirname(asKey(file)), specifier);
    // `./x-sources.ts`, `./x-sources`, `./x-sources/index.ts` all appear here.
    const candidates = [
      base,
      base.replace(/\.(m?[jt]sx?)$/, ".ts"),
      base.replace(/\.(m?[jt]sx?)$/, ".tsx"),
      `${base}.ts`,
      `${base}.tsx`,
      path.posix.join(base, "index.ts"),
      path.posix.join(base, "index.tsx"),
    ];
    for (const element of bindingsNode.elements) {
      const local = element.name.text;
      const original = element.propertyName?.text ?? local;
      const hit = candidates.find((candidate) => registry.byModule?.has(`${candidate}::${original}`));
      importedFrom.set(local, { file: hit ?? null, original, resolved: Boolean(hit) });
    }
  }

  /** The registry entry for a callee, honouring where it was imported from. */
  const lookup = (name) => {
    const imported = importedFrom.get(name);
    if (!imported) return registry.get(name) ?? null;
    // Imported from a first-party module that defines no such TTL-bearing
    // helper -> this is a different function that merely shares a name.
    if (!imported.resolved) return null;
    return registry.resolve(imported.original, imported.file);
  };

  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  /** Collect the TTL-bearing calls in one block, not descending into nested blocks. */
  const collectCalls = (blockNode, stopAt) => {
    const calls = [];
    let fakeClock = false;
    const visit = (node) => {
      if (node !== blockNode && stopAt.has(node)) return; // a nested test owns its own calls
      if (ts.isCallExpression(node)) {
        const name = calleeName(node);
        if (name && FAKE_CLOCK.test(name)) fakeClock = true;
        const entry = name ? lookup(name) : null;
        if (entry) {
          const argument = node.arguments[entry.clockParamIndex] ?? null;
          if (!argument) {
            if (entry.optional) {
              calls.push({ node, name, clock: "defaulted", instant: null, persists: entry.persists });
            }
          } else {
            const { frozen, instant } = classifyInstant(argument, bindings);
            calls.push({
              node,
              name,
              clock: frozen ? "frozen" : "live",
              instant,
              persists: entry.persists,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(blockNode);
    if (FAKE_CLOCK.test(blockNode.getText(sourceFile))) fakeClock = true;
    return { calls, fakeClock };
  };

  // Locate every test block and its title.
  const blocks = [];
  const blockNodes = new Set();
  const findBlocks = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name && /^(test|it)$/.test(name)) {
        const body = node.arguments.find((argument) =>
          ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
        const title = node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])
          ? node.arguments[0].text
          : "(untitled)";
        if (body) {
          blocks.push({ node: body, title, anchor: node });
          blockNodes.add(body);
        }
      }
    }
    ts.forEachChild(node, findBlocks);
  };
  findBlocks(sourceFile);

  // Module-scope helpers count as blocks too. Without this the guard has a hole
  // exactly where the sanctioned repair puts its code: PR #4942 moves the
  // seeding into a `cacheLivePost(postId)` helper, so a later edit changing that
  // helper's body back to `cacheNormalizedXPosts([post(postId)], NOW)` would sit
  // outside every `test(...)` callback and be invisible. One frozen seed in a
  // shared helper re-arms every test that calls it, which makes this the highest
  // -leverage place in the file to watch rather than a corner case.
  const findHelpers = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      blocks.push({ node: node.body, title: `helper ${node.name.text}()`, anchor: node });
      blockNodes.add(node.body);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      && node.initializer.body) {
      blocks.push({ node: node.initializer.body, title: `helper ${node.name.text}()`, anchor: node });
      blockNodes.add(node.initializer.body);
    }
    ts.forEachChild(node, findHelpers);
  };
  findHelpers(sourceFile);

  for (const block of blocks) {
    const { calls, fakeClock } = collectCalls(block.node, blockNodes);
    if (fakeClock) continue;

    const frozen = calls.filter((call) => call.clock === "frozen");
    if (frozen.length === 0) continue;

    // The disjunction: a block that drives the expiry boundary deliberately is
    // safe with frozen instants, because the relationship it asserts holds
    // between two fixtures and never consults the wall clock.
    const distinctFrozen = new Set(frozen.map((call) => call.instant));
    if (pinsExpiry(block.node, sourceFile) || distinctFrozen.size > 1) continue;

    const defaulted = calls.filter((call) => call.clock === "defaulted");

    if (defaulted.length > 0) {
      findings.push({
        file: relative,
        line: lineOf(frozen[0].node),
        test: block.title,
        kind: "mixed",
        instant: frozen[0].instant,
        message:
          `\`${frozen[0].name}\` is given the frozen instant ${frozen[0].instant}, but `
          + `\`${defaulted[0].name}\` (line ${lineOf(defaulted[0].node)}) is left to default to the live clock. `
          + `The seeded record expires against the wall clock while the fixture never moves.`,
      });
      continue;
    }

    // Clause 2 — a frozen seed with nothing to read it back.
    //
    // Restricted to PERSISTING helpers, because only those leave a record for a
    // later reader to judge. A pure `surfaceStateFromPayload(payload, FROZEN)`
    // computes and returns; its frozen instant dies with the call and can never
    // rot, so flagging it would be exactly the blanket "no absolute dates" rule
    // this guard is designed not to be.
    //
    // Counted by DISTINCT helper, not by call site: the discipline being
    // enforced is that the write is accompanied by a read, and two frozen
    // writes of the same helper still have no reader. `x-sources.test.ts` pairs
    // `cacheNormalizedXPosts` with `getCachedXPost` and so reaches two.
    const seeds = frozen.filter((call) => call.persists);
    const distinct = new Set(calls.map((call) => call.name));
    if (seeds.length > 0 && distinct.size === 1) {
      // Already dead vs not yet dead. Same defect and same remedy, different
      // urgency and a completely different signature: a BOMB breaks CI on a
      // schedule, whereas an INERT fixture was already past its TTL the first
      // time it ran and so has never failed — it silently stopped exercising
      // the guard it names. Two of the tests repaired in #4942 were this, and
      // no red CI would ever have surfaced them.
      const dead = isExpired(seeds[0].instant, ASSUMED_TTL_MS);
      findings.push({
        file: relative,
        line: lineOf(seeds[0].node),
        test: block.title,
        kind: dead ? "inert" : "bomb",
        instant: seeds[0].instant,
        message: dead
          ? `\`${seeds[0].name}\` seeds durable state at ${seeds[0].instant}, which is already more than one `
            + `TTL in the past. The record is dead on arrival, so this test no longer exercises what it names — `
            + `it passes by not reaching the assertion it was written for.`
          : `\`${seeds[0].name}\` seeds durable state at the frozen instant ${seeds[0].instant}, and nothing `
            + `in this test reads it back through that same instant. Whatever judges the record's freshness `
            + `is therefore using the live clock, so this test starts failing once that instant plus the TTL passes.`,
      });
    }
  }

  return findings;
}

/**
 * Files whose repair is already in flight on another branch.
 *
 * This is a RATCHET, not a waiver. An entry suppresses the failure, and the
 * check then fails if the listed file stops producing a finding — so the entry
 * cannot outlive the fix it is waiting for. Landing this guard would otherwise
 * have to wait on an unrelated PR's merge, and a guard that waits is a guard
 * that gets dropped.
 *
 * Key = repo-relative path. Value = why, and what removes it.
 */
export const IN_FLIGHT_REPAIRS = new Map([
  // Empty, and the ratchet is why it is safe to leave the machinery here.
  //
  // It held `src/lib/server/research-mission-x-hydration.test.ts` while PR #4942
  // was in flight. When #4942 landed the entry stopped matching a finding and
  // this check failed with "stale IN_FLIGHT_REPAIRS entry" until it was deleted
  // — which is the mechanism working, not a nuisance. Adding an entry means
  // suppressing a real, reproduced defect, so name the PR that removes it.
]);

/** Has this instant already passed? Reported so an expired bomb sorts first. */
export function isExpired(instant, ttlMs, asOf = new Date()) {
  if (!instant) return false;
  const parsed = Date.parse(instant);
  if (Number.isNaN(parsed)) return false;
  return parsed + ttlMs <= asOf.getTime();
}

export function findClockTimeBombs({ cwd = root } = {}) {
  const productionFiles = [
    ...walk(path.join(cwd, "src"), [], (name) => SOURCE_FILE.test(name) && !TEST_FILE.test(name)),
    ...walk(path.join(cwd, "scripts"), [], (name) => SOURCE_FILE.test(name) && !TEST_FILE.test(name)),
  ].map((file) => ({ file, text: readFileSync(file, "utf8") }));

  const registry = collectTtlBearingApis(productionFiles);

  const testFiles = [
    ...walk(path.join(cwd, "src"), [], (name) => TEST_FILE.test(name)),
    ...walk(path.join(cwd, "scripts"), [], (name) => TEST_FILE.test(name)),
    ...walk(path.join(cwd, "tests"), [], (name) => TEST_FILE.test(name)),
  ];

  const findings = [];
  for (const file of testFiles) {
    findings.push(...analyzeTestSource(file, readFileSync(file, "utf8"), registry, cwd));
  }
  return { registry, findings };
}

/**
 * Split findings into the ones that fail the build, the ones a listed in-flight
 * repair defers, and the entries that no longer describe a real defect.
 *
 * Extracted so the ratchet is reachable from a test. It is the half of the
 * mechanism that is easy to get wrong and impossible to notice: an entry that
 * outlives its fix silently suppresses the NEXT bomb in that file, and nothing
 * about a passing build would ever say so.
 *
 * @returns {{active: Array, deferred: Set<string>, stale: string[]}}
 */
export function partitionFindings(all, inFlight = IN_FLIGHT_REPAIRS) {
  const deferred = new Set(all.filter((f) => inFlight.has(f.file)).map((f) => f.file));
  return {
    active: all.filter((f) => !inFlight.has(f.file)),
    deferred,
    stale: [...inFlight.keys()].filter((file) => !deferred.has(file)),
  };
}

function main() {
  const { registry, findings: all } = findClockTimeBombs();

  const { active: findings, deferred, stale } = partitionFindings(all);

  if (stale.length > 0) {
    console.error("✗ stale IN_FLIGHT_REPAIRS entr(ies) in scripts/check-test-clock-consistency.mjs:");
    for (const file of stale) {
      console.error(`    ${file} — no longer reports a finding, so its repair has landed.`);
    }
    console.error("");
    console.error("Delete these entries. Leaving one in place would suppress the NEXT bomb in that file.");
    process.exit(1);
  }

  for (const file of deferred) {
    console.log(`… deferred: ${file}`);
    console.log(`    ${IN_FLIGHT_REPAIRS.get(file)}`);
  }

  if (findings.length === 0) {
    console.log(`✓ no frozen-write / live-read time bombs (${registry.size} TTL-bearing helpers registered)`);
    return;
  }

  console.error(`✗ frozen-write / live-read time bomb(s) in ${new Set(findings.map((f) => f.file)).size} file(s):`);
  console.error("");
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  [${finding.kind}]`);
    console.error(`    test: ${finding.test}`);
    console.error(`    ${finding.message}`);
    console.error("");
  }
  console.error("A test that seeds a TTL-bearing store at a fixed calendar instant passes until that");
  console.error("instant plus the TTL, then fails in every run afterwards — with no commit responsible.");
  console.error("");
  console.error("Fix it one of two ways:");
  console.error("  1. Anchor the seed to the real clock, e.g. new Date(Date.now() - 25 * 60 * 60 * 1000).");
  console.error("  2. Pass the same frozen instant to the read, as x-sources.test.ts does.");
  process.exit(1);
}

if (isDirectRun(import.meta.url)) main();
