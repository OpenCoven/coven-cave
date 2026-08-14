// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const diffRoute = readFileSync(new URL("./[id]/diff/route.ts", import.meta.url), "utf8");
const commitRoute = readFileSync(new URL("./[id]/commit/route.ts", import.meta.url), "utf8");

describe("AFS daemon proxy routes", () => {
  it("forwards an optional encoded file path without changing list-diff requests", () => {
    assert.match(diffRoute, /new URL\(req\.url\)\.searchParams\.get\("path"\)/);
    assert.match(diffRoute, /encodeURIComponent\(path\)/);
    assert.match(diffRoute, /path === null/);
    assert.match(diffRoute, /res\.data \?\? \{ error: res\.error \}/, "structured daemon errors pass through");
  });

  it("forwards dryRun while preserving commit sanitization and transport safety", () => {
    assert.match(commitRoute, /dryRun\?: boolean \| null/);
    assert.match(commitRoute, /typeof body\.dryRun === "boolean"/);
    assert.match(commitRoute, /\{ dryRun: body\.dryRun \}/);
    assert.match(commitRoute, /branch\.trim\(\)/);
    assert.match(commitRoute, /message\.trim\(\)/);
    assert.match(commitRoute, /coAuthors\.filter/);
    assert.match(commitRoute, /timeoutMs: 60_000/);
    assert.match(commitRoute, /retryTransportFailure: false/);
    assert.doesNotMatch(commitRoute, /no dryRun mode/i);
  });
});
