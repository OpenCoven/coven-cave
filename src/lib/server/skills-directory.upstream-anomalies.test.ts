// The skills.sh directory and the raw SKILL.md preview under every upstream
// anomaly (#6359).
//
// Three fetches, two registry entries. The directory listing and the search
// endpoint (www.skills.sh, `skills-directory`) degrade to the bundled
// fallback fixture and never throw; the SKILL.md preview
// (raw.githubusercontent.com, `github-raw`) degrades to null. Each has a
// ten-minute cache, stepped past between matrix calls; the explicit tests at
// the end pin what each cache remembers about a failure, with two documented
// findings where an empty or failed answer is held for the TTL.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../testing/upstream-anomaly-fetch.ts";
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

/** A 200 is a preview: the module shows whatever text GitHub served, markdown or not. */
const previewOfWhateverCameBack = (outcome: MatrixOutcome) => {
  const preview = outcome.body as { text: string; source: string } | null;
  assert.ok(preview, "a 2xx body is shown as the preview");
  assert.equal(preview.source, "github-raw");
  assert.notEqual(preview.text, SKILL_MD);
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
      "malformed-json": previewOfWhateverCameBack,
      "empty-body": previewOfWhateverCameBack,
      "schema-drift": previewOfWhateverCameBack,
    },
  });
});

test("a directory failure is not cached: the first listing after skills.sh heals is live, no clock needed", async () => {
  stepPastCache();
  harness.inject("skills-directory", { kind: "http", status: 503 });
  harness.reset();
  bundledFallback(await outcomeOf(listSkillDirectoryEntries()));
  assert.equal(harness.calls("skills-directory").length, 1);

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

test("a search 200 with no skills is cached as an empty result for the TTL (documented, not fixed)", async () => {
  // Finding: readSkillsShSearchEntries caches whatever parsed, including the
  // empty list a drifted schema produces, so a bad deploy at skills.sh pins a
  // query to the fallback for ten minutes after it recovers. The directory
  // listing beside it only caches non-empty answers. Bounded by the TTL, so
  // recorded here rather than changed.
  stepPastCache();
  harness.inject("skills-directory", { kind: "schema-drift" });
  harness.reset();
  bundledFallback(await outcomeOf(listSkillDirectoryEntries("frontend")));
  harness.heal("skills-directory");
  harness.reset();
  bundledFallback(await outcomeOf(listSkillDirectoryEntries("frontend")));
  assert.equal(harness.calls("skills-directory").length, 0, "the empty parse is served from the search cache");
  stepPastCache();
  harness.reset();
  assert.equal((await listSkillDirectoryEntries("frontend")).source, "live");
  assert.equal(harness.calls("skills-directory").length, 1, "past the TTL the search is live again");
});

test("a failed preview is negatively cached for the TTL (documented, not fixed)", async () => {
  // Finding: readRemoteSkillMarkdown records a null preview for every failed
  // URL for ten minutes, so a blip at raw.githubusercontent.com hides a
  // skill's preview until the TTL passes. Bounded; recorded, not changed.
  stepPastCache();
  harness.inject("github-raw", { kind: "http", status: 500 });
  harness.reset();
  assert.equal(await readRemoteSkillMarkdown(previewEntry), null);
  harness.heal("github-raw");
  harness.reset();
  assert.equal(await readRemoteSkillMarkdown(previewEntry), null, "the negative entry answers");
  assert.equal(harness.calls("github-raw").length, 0);
  stepPastCache();
  harness.reset();
  livePreview(await outcomeOf(readRemoteSkillMarkdown(previewEntry)));
  assert.equal(harness.calls("github-raw").length, 1, "past the TTL the preview is fetched again");
});

test("every upstream call carries a deadline", () => {
  for (const call of harness.calls()) assert.equal(call.hasDeadline, true, call.url);
});

async function outcomeOf(pending: Promise<unknown>): Promise<MatrixOutcome> {
  const value = await pending;
  return { value, response: null, status: null, text: JSON.stringify(value), body: value, threw: undefined };
}
