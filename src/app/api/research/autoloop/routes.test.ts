import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function routeSource(relative: string): string {
  const url = new URL(relative, import.meta.url);
  assert.ok(existsSync(url), `${relative} route must exist`);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
}

test("stream is local-only, snapshot-first, watched, and cleans up resources", () => {
  const source = routeSource("./stream/route.ts");
  assert.match(source, /rejectNonLocalRequest\(req\)/);
  assert.match(source, /loadAutoresearchSnapshot/);
  assert.match(source, /watchAutoresearchSources/);
  assert.match(source, /text\/event-stream/);
  assert.match(source, /stopWatching\?\.\(\)/);
  assert.match(source, /clearInterval\(heartbeat\)/);
  assert.doesNotMatch(
    source,
    /setInterval\([^)]*loadAutoresearchSnapshot/,
    "source refresh must be file-watched, not polled",
  );
});

test("document route is local-only and delegates to the contained, bounded reader", () => {
  const source = routeSource("./document/route.ts");
  assert.match(source, /rejectNonLocalRequest\(req\)/);
  assert.match(source, /readAutoresearchDocument/);
  assert.match(source, /path required/);
  assert.match(source, /document unavailable/);
});
