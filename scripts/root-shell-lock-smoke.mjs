import assert from "node:assert/strict";

const base = process.env.ROOT_SHELL_SMOKE_URL?.replace(/\/$/, "");
if (!base) {
  throw new Error("ROOT_SHELL_SMOKE_URL is required; start Cave with an actively held .migration.lock");
}

const samples = [];
let html = "";
for (let attempt = 0; attempt < 20; attempt += 1) {
  const startedAt = performance.now();
  const response = await fetch(`${base}/`, { cache: "no-store" });
  html = await response.text();
  samples.push(performance.now() - startedAt);
  assert.equal(response.status, 200);
}

assert.match(html, /class="[^"]*\bshell-root\b[^"]*"/, "the real shell is delivered");
assert.match(html, /aria-label="Open navigation/, "global navigation is delivered");
assert.match(html, /data-authoritative="false"/, "the root embeds only paint bootstrap state");

const ordered = [...samples].sort((left, right) => left - right);
const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1];
assert.ok(p95 < 500, `root shell p95 ${p95.toFixed(1)}ms exceeded the 500ms budget`);
console.log(`root-shell-lock-smoke: p95=${p95.toFixed(1)}ms samples=${samples.map((value) => value.toFixed(1)).join(",")}`);
