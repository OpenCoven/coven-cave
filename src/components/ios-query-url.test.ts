// @ts-nocheck
// Regression guard for the iOS reader-view 404 ("Couldn't load this entry —
// Server returned status 404"). CaveClient.request() used
// `base.appendingPathComponent(path)`, which percent-encodes "?" to "%3F" — so
// "api/journal?date=…" became the bogus path "/api/journal%3Fdate=…" that the
// server 404s on. The builder must split the query off the path and reattach it
// as a real query string. iOS isn't compiled in CI, so this source-text test is
// the guard.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(
  new URL("../../apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift", import.meta.url),
  "utf8",
);

const requestFn = client.match(/private func request\([\s\S]*?\n    \}/)?.[0] ?? "";
assert.ok(requestFn, "CaveClient.request(_:) must exist");

// The query must be split off the path before path-appending…
assert.match(
  requestFn,
  /split\(separator:\s*"\?",\s*maxSplits:\s*1/,
  "request() must split the query string off the path",
);
// …only the path part is appended as a path component…
assert.match(
  requestFn,
  /appendingPathComponent\(pathPart\)/,
  "request() must append only the path part (not the raw query-bearing path)",
);
// …and the query is reattached without double-encoding.
assert.match(
  requestFn,
  /percentEncodedQuery\s*=\s*queryPart/,
  "request() must reattach the query via percentEncodedQuery",
);
// The old bug — appending the whole raw `path` (with its "?") — must be gone.
assert.doesNotMatch(
  requestFn,
  /appendingPathComponent\(path\)/,
  "request() must not append the raw query-bearing path (the 404 cause)",
);

// The journal reader still requests the query-string form that this fix repairs.
assert.match(
  client,
  /request\("api\/journal\?date=\\\(urlQuery\(date\)\)"\)/,
  "journalDay still builds api/journal?date=…",
);

console.log("ios-query-url.test.ts: ok");
