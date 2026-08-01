import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeProjectRoot } from "./cave-projects-types.ts";
import { normalizeChatProjectRoot } from "./chat-projects.ts";
import { deriveComuxProjects } from "./comux-projects.ts";
import type { SessionRow } from "./types.ts";

/**
 * cave-zz12: four competing project-root normalizers collapse to two.
 *
 * The safety claim of that change is behavioural, so it is tested behaviourally:
 * the two that were folded in produced identical output for the inputs their
 * call sites actually pass, which is why no persisted key moves. Roots are the
 * keys of IDB projectAvatars, cave:chat:project-overrides, and comux pins and
 * order — if normalization shifted, those would silently empty out.
 */

// Every shape a project root arrives in, plus the awkward ones.
const CASES = [
  "/w/app",
  "/w/app/",
  "/w/app///",
  "C:\\code\\app",
  "C:\\code\\app\\",
  "/w/app with spaces",
  "~/code/app",
  "~",
  "/",
  "//",
  "",
  "   ",
  "  /w/app  ",
  "/w/app/.worktrees/feature",
];

test("the chat normalizer is exactly the shared one", () => {
  for (const input of CASES) {
    assert.equal(
      normalizeChatProjectRoot(input),
      normalizeProjectRoot(input),
      `diverged on ${JSON.stringify(input)}`,
    );
  }
});

// The chat normalizer was a character-for-character copy, so this is not a
// refactor that "should" preserve behaviour — it provably does. Pinned because
// re-introducing a second implementation is exactly how the two drift apart.
test("chat-projects no longer carries its own implementation", () => {
  const src = readFileSync(new URL("./chat-projects.ts", import.meta.url), "utf8");
  assert.match(
    src,
    // Whitespace-tolerant: a reformat should not fail a test about delegation.
    /export function normalizeChatProjectRoot\s*\(\s*root:\s*string\s*\)\s*:\s*string\s*\{\s*return normalizeProjectRoot\(root\);\s*\}/,
    "it delegates rather than re-implementing trim/backslash/trailing-slash",
  );
  // Narrowly the normalizer idiom — chat-projects legitimately flips
  // backslashes elsewhere when splitting a root into path segments, so
  // matching that would be a false positive.
  assert.doesNotMatch(
    src,
    /replace\(\/\\\/\+\$\/, ""\)/,
    "no second trailing-slash-stripping normalizer",
  );
});

test("comux no longer carries its own implementation", () => {
  const src = readFileSync(new URL("./comux-projects.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /function normalizeRoot\(/, "the private copy is gone");
  assert.match(src, /normalizeProjectRoot\(raw\)/, "bucketing keys through the shared normalizer");
});

// No `as SessionRow`: every required field is supplied, so the compiler checks
// the shape. A cast here would let a future edit build an invalid session and
// silently change what deriveComuxProjects sees, with no type error.
function session(over: Partial<SessionRow> & { id: string }): SessionRow {
  return {
    project_root: "/w/app",
    harness: "copilot",
    title: "session",
    status: "idle",
    exit_code: null,
    archived_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    familiarId: "cody",
    ...over,
  };
}

// comux's normalizer differed from the shared one ONLY by not trimming, and
// its keying call site already trims (`session.project_root?.trim()`). So the
// bucket keys — which back comux pins and ordering — cannot move.
test("comux buckets trailing-slash variants together, exactly as before", () => {
  const projects = deriveComuxProjects(
    [
      session({ id: "a", project_root: "/w/app" }),
      session({ id: "b", project_root: "/w/app/" }),
      session({ id: "c", project_root: "/w/app///" }),
      session({ id: "d", project_root: "/w/other" }),
    ],
  );
  const roots = projects.map((p) => p.root).sort();
  assert.deepEqual(roots, ["/w/app", "/w/other"], "one bucket per real project");
  const app = projects.find((p) => p.root === "/w/app");
  assert.equal(app?.sessionCount, 3, "all three spellings landed in the same bucket");
});

test("comux still buckets a windows root to forward slashes", () => {
  const projects = deriveComuxProjects([session({ id: "a", project_root: "C:\\code\\app\\" })], undefined);
  assert.equal(projects[0]?.root, "C:/code/app");
});

// The surrounding-whitespace case is the one place comux's missing trim could
// ever have mattered. Its call site strips first, so the outcome is unchanged —
// and now it would be right even if that stripping went away.
test("a root arriving with whitespace still buckets with its clean twin", () => {
  const projects = deriveComuxProjects(
    [session({ id: "a", project_root: "/w/app" }), session({ id: "b", project_root: "  /w/app  " })],
  );
  assert.equal(projects.length, 1, "one project, not two");
  assert.equal(projects[0].sessionCount, 2);
});

// The ~-expanding server normalizer is deliberately NOT folded in: expanding ~
// changes what a root normalizes to, which would re-key the persisted stores.
test("the shared normalizer still does not expand ~", () => {
  assert.equal(normalizeProjectRoot("~/code/app"), "~/code/app");
  assert.equal(normalizeProjectRoot("~"), "~");
});

test("the server normalizer is named for what it does, not left anonymous", () => {
  const src = readFileSync(new URL("./cave-projects.ts", import.meta.url), "utf8");
  assert.match(src, /function normalizeRootExpandingHome\(/, "the ~ expander says so in its name");
  assert.doesNotMatch(src, /\bfunction normalizeRoot\(/, "no anonymous third normalizer");
  assert.match(
    src,
    /migration pass/,
    "and it documents why it is not merged — the re-key risk",
  );
});

console.log("project-root-normalizers.test.ts: ok");
