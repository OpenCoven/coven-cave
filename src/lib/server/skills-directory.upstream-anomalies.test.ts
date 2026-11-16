// The skills.sh directory and the raw SKILL.md preview under every upstream
// anomaly (#6359).
//
// Three fetches, two registry entries. The directory listing and the search
// endpoint (www.skills.sh, `skills-directory`) degrade to the bundled
// fallback fixture and never throw; the SKILL.md preview
// (raw.githubusercontent.com, `github-raw`) degrades to null. Each has a
// ten-minute cache, stepped past between matrix calls; the explicit tests at
// the end require failures to stay retryable without waiting for the TTL.
import assert from "node:assert/strict";
import test from "node:test";

import { STANDARD_UPSTREAM_ANOMALIES, installUpstreamAnomalyFetch } from "../testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../testing/upstream-anomaly-matrix.ts";

const CACHE_MS = 10 * 60 * 1000;
let now = Date.UTC(2026, 10, 1, 10);
const realNow = Date.now;
Date.now = () => now;

const harness = installUpstreamAnomalyFetch();
const { listSkillDirectoryEntries, parseSkillsShSearchResponse, readRemoteSkillMarkdown } = await import("./skills-directory.ts");
test.after(() => {
  harness.restore();
  Date.now = realNow;
});

const LIVE_SKILLS = [
  { source: "vercel-labs/skills", skillId: "find-skills", name: "find-skills", installs: 2_300_000, weeklyInstalls: [1, 2, 3], isOfficial: true },
  { source: "anthropics/skills", skillId: "frontend-design", name: "frontend-design", installs: 624_300, weeklyInstalls: [10, 11] },
];
const DIRECTORY_HTML = `<!doctype html><html><body><script>self.__next_f.push([1,${JSON.stringify(JSON.stringify({ skills: LIVE_SKILLS, totalSkills: 2 }))}])</script></body></html>`;
const SKILL_MD = "---\nname: find-skills\ndescription: Find skills on skills.sh\n---\n\n# find-skills\n";

harness.healthy("skills-directory", (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/") {
    assert.equal(request.headers.get("accept"), "text/html");
    return new Response(DIRECTORY_HTML, { status: 200, headers: { "content-type": "text/html" } });
  }
  if (url.pathname === "/api/search") {
    assert.equal(request.headers.get("accept"), "application/json");
    const q = url.searchParams.get("q") ?? "";
    return Response.json({ skills: LIVE_SKILLS.filter((skill) => skill.name.includes(q)) });
  }
  return new Response("Not Found", { status: 404 });
});
harness.healthy("github-raw", (request) => {
  assert.equal(new URL(request.url).pathname, "/vercel-labs/skills/main/skills/find-skills/SKILL.md");
  return new Response(SKILL_MD, { status: 200, headers: { "content-type": "text/plain" } });
});

const stepPastCache = () => {
  now += CACHE_MS + 1;
};

type Listing = { ok: boolean; source: string; reason?: string; entries: Array<{ id: string; owner?: string; source: string }> };

const liveDirectory = (outcome: MatrixOutcome) => {
  const listing = outcome.body as Listing;
  assert.equal(listing.ok, true);
  assert.equal(listing.source, "live");
  assert.equal(listing.reason, undefined);
  assert.deepEqual(listing.entries.map((entry) => entry.id), ["find-skills", "frontend-design"]);
  assert.equal(listing.entries[0].owner, "vercel-labs");
};

/** The directory could not be read: the bundled fixture answers, marked as such, and never throws. */
const bundledFallback = (outcome: MatrixOutcome) => {
  const listing = outcome.body as Listing;
  assert.equal(listing.ok, true, "a directory outage is still an ok listing");
  assert.equal(listing.source, "fallback");
  assert.match(listing.reason ?? "", /fallback directory fixture|Directory source unavailable/);
  assert.equal(listing.entries.some((entry) => entry.owner === "vercel-labs"), false, "no live entry leaks into the fallback answer");
  assert.ok(listing.entries.every((entry) => entry.source === "registry"), "fallback entries carry the fixture's registry source");
};

test("listSkillDirectoryEntries() (directory HTML) across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "skills-directory",
    beforeEach: stepPastCache,
    invoke: () => listSkillDirectoryEntries(),
    healthy: liveDirectory,
    degraded: { default: bundledFallback },
  });
});

test("listSkillDirectoryEntries(query) (search JSON) across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "skills-directory",
    beforeEach: stepPastCache,
    invoke: () => listSkillDirectoryEntries("find"),
    healthy: (outcome) => {
      const listing = outcome.body as Listing;
      assert.equal(listing.source, "live");
      assert.deepEqual(listing.entries.map((entry) => entry.id), ["find-skills"]);
      const call = harness.calls("skills-directory").at(-1);
      assert.equal(new URL(call!.url).searchParams.get("q"), "find");
    },
    degraded: { default: bundledFallback },
  });
});

const previewEntry = parseSkillsShSearchResponse({ skills: [LIVE_SKILLS[0]] })[0];
assert.ok(previewEntry);

const livePreview = (outcome: MatrixOutcome) => {
  const preview = outcome.body as { text: string; source: string; url: string } | null;
  assert.ok(preview, "the preview resolved");
  assert.equal(preview.source, "github-raw");
  assert.equal(preview.text, SKILL_MD);
  assert.equal(preview.url, "https://raw.githubusercontent.com/vercel-labs/skills/main/skills/find-skills/SKILL.md");
};

const noPreview = (outcome: MatrixOutcome) => {
  assert.equal(outcome.value, null, "an unreadable SKILL.md is no preview, never a throw");
};

test("readRemoteSkillMarkdown (raw.githubusercontent.com) across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github-raw",
    beforeEach: stepPastCache,
    invoke: () => readRemoteSkillMarkdown(previewEntry),
    healthy: livePreview,
    degraded: {
      "http-500": noPreview,
      "http-502": noPreview,
      "auth-revoked": noPreview,
      "rate-limit": noPreview,
      timeout: noPreview,
      network: noPreview,
      "malformed-json": noPreview,
      "empty-body": noPreview,
      "schema-drift": noPreview,
    },
  });
});

test("a directory failure is not cached: the first listing after skills.sh heals is live, no clock needed", async () => {
  stepPastCache();
  harness.inject("skills-directory", { kind: "http", status: 503 });
  harness.reset();
  bundledFallback(await outcomeOf(listSkillDirectoryEntries()));
  // upstreamFetch retries a failed read once before the route sees it.
  assert.equal(harness.calls("skills-directory").length, 2);

  harness.heal("skills-directory");
  harness.reset();
  liveDirectory(await outcomeOf(listSkillDirectoryEntries()));
  assert.equal(harness.calls("skills-directory").length, 1, "only a non-empty live listing is cached, so the healed call went upstream");

  harness.reset();
  liveDirectory(await outcomeOf(listSkillDirectoryEntries()));
  assert.equal(harness.calls("skills-directory").length, 0, "the live listing is then held for the window");
});

test("a search failure is not cached either", async () => {
  stepPastCache();
  harness.inject("skills-directory", { kind: "network" });
  harness.reset();
  bundledFallback(await outcomeOf(listSkillDirectoryEntries("find")));
  harness.heal("skills-directory");
  harness.reset();
  assert.equal((await listSkillDirectoryEntries("find")).source, "live");
  assert.equal(harness.calls("skills-directory").length, 1, "a thrown search is not written into the search cache");
});

test("a drifted search parse is not cached and heals without a clock step", async () => {
  stepPastCache();
  harness.inject("skills-directory", { kind: "schema-drift" });
  bundledFallback(await outcomeOf(listSkillDirectoryEntries("frontend")));
  harness.heal("skills-directory");
  harness.reset();
  assert.equal((await listSkillDirectoryEntries("frontend")).source, "live");
  assert.equal(harness.calls("skills-directory").length, 1);
});

test("a failed preview heals on the next call without a clock step", async () => {
  stepPastCache();
  harness.inject("github-raw", { kind: "http", status: 500 });
  assert.equal(await readRemoteSkillMarkdown(previewEntry), null);
  harness.heal("github-raw");
  harness.reset();
  livePreview(await outcomeOf(readRemoteSkillMarkdown(previewEntry)));
  assert.equal(harness.calls("github-raw").length, 1);
});

test("every upstream call carries a deadline", () => {
  for (const call of harness.calls()) assert.equal(call.hasDeadline, true, call.url);
});

async function outcomeOf(pending: Promise<unknown>): Promise<MatrixOutcome> {
  const value = await pending;
  return { value, response: null, status: null, text: JSON.stringify(value), body: value, threw: undefined };
}

test("every failed search and preview heals without resetting route caches or advancing the clock", async () => {
  for (const { name, anomaly } of STANDARD_UPSTREAM_ANOMALIES) {
    stepPastCache();
    assert.equal((await listSkillDirectoryEntries("find")).source, "live");
    livePreview(await outcomeOf(readRemoteSkillMarkdown(previewEntry)));
    stepPastCache();
    harness.inject("skills-directory", anomaly);
    harness.inject("github-raw", anomaly);
    bundledFallback(await outcomeOf(listSkillDirectoryEntries("find")));
    noPreview(await outcomeOf(readRemoteSkillMarkdown(previewEntry)));
    harness.heal();
    harness.reset();
    assert.equal((await listSkillDirectoryEntries("find")).source, "live", name);
    livePreview(await outcomeOf(readRemoteSkillMarkdown(previewEntry)));
    assert.equal(harness.calls("skills-directory").length, 1, name);
    assert.equal(harness.calls("github-raw").length, 1, name);
  }
});
