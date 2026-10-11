// @ts-nocheck
// #5930: the PR card and the Code PR panel offer Comment only on your own
// pull request. The item route's `pull` block and the checks route say
// whether the token's login wrote the PR (`viewerIsAuthor`), from REST only.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "github-item-viewer-"));
process.env.HOME = home;
process.env.COVEN_HOME = path.join(home, ".coven");
process.env.COVEN_CAVE_HOME = path.join(home, ".coven", "cave");
process.env.GITHUB_TOKEN = "test-token-viewer";

let viewer = "bunsdev";
const urls = [];
globalThis.fetch = async (url) => {
  const href = String(url);
  urls.push(href);
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (href === "https://api.github.com/user") return json({ login: viewer });
  const issue = href.match(/\/repos\/OpenCoven\/coven-cave\/issues\/(\d+)$/);
  if (issue) {
    const n = Number(issue[1]);
    return json({
      number: n,
      title: "t",
      state: "open",
      draft: false,
      body: "",
      user: { login: n === 1 ? "BunsDev" : "someone-else" },
      pull_request: { merged_at: null },
      html_url: `https://github.com/OpenCoven/coven-cave/pull/${n}`,
    });
  }
  const pull = href.match(/\/repos\/OpenCoven\/coven-cave\/pulls\/(\d+)$/);
  if (pull) {
    const n = Number(pull[1]);
    return json({
      head: { ref: "h", sha: `sha${n}` },
      base: { ref: "main", sha: "b" },
      user: { login: n === 1 ? "BunsDev" : "someone-else" },
      commits: 1,
    });
  }
  if (href.includes("/reviews")) return json([]);
  if (href.includes("/check-runs")) return json({ total_count: 0, check_runs: [] });
  if (href.endsWith("/status")) return json({ state: "success", total_count: 0, statuses: [] });
  throw new Error(`unexpected fetch ${href}`);
};

const item = await import("./route.ts");
const checks = await import("../checks/route.ts");
const ask = (route, query) => route.GET(new Request(`http://localhost/api/github/x?${query}`));

const mine = await (await ask(item, "repo=OpenCoven/coven-cave&number=1&pull=1")).json();
assert.equal(mine.pull.viewerIsAuthor, true, "your own PR (logins compare case-insensitively)");
const theirs = await (await ask(item, "repo=OpenCoven/coven-cave&number=2&pull=1")).json();
assert.equal(theirs.pull.viewerIsAuthor, false, "someone else's PR");

// Without pull=1 the payload stays exactly what every other caller parses.
const plain = await (await ask(item, "repo=OpenCoven/coven-cave&number=1")).json();
assert.equal("pull" in plain, false);

const myChecks = await (await ask(checks, "repo=OpenCoven/coven-cave&number=1")).json();
assert.equal(myChecks.ok, true);
assert.equal(myChecks.viewerIsAuthor, true, "the checks read says the panel's PR is yours");
const theirChecks = await (await ask(checks, "repo=OpenCoven/coven-cave&number=2")).json();
assert.equal(theirChecks.viewerIsAuthor, false);

// Never GraphQL: that budget is shared by every agent signed in as the user.
assert.ok(urls.every((u) => !u.includes("/graphql")), "REST only");
assert.equal(urls.filter((u) => u === "https://api.github.com/user").length, 1, "the viewer is asked once");

console.log("github item/checks route-viewer.test.ts: ok");
