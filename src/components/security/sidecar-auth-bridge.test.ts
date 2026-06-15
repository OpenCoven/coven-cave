// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The bridge lives in a .tsx (JSX) so it can't be imported under
// --experimental-strip-types. Extract the inline-script template literal and
// run it against a mock window to exercise real behavior.
const source = readFileSync(new URL("./sidecar-auth-bridge.tsx", import.meta.url), "utf8");
const match = source.match(/SIDECAR_AUTH_BRIDGE = `([\s\S]*?)`;/);
assert.ok(match, "should find the SIDECAR_AUTH_BRIDGE script literal");
const SCRIPT = match[1];

const TOKEN_HEADER = "x-coven-cave-token";

function makeWindow({ search = "", hash = "", origin = "http://localhost:3210" }) {
  const store = new Map();
  const fetchCalls = [];
  const win = {
    location: { search, hash, pathname: "/", origin, href: origin + "/" + search + hash },
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    history: { state: { a: 1 }, replaceState(_s, _t, url) { win.__replacedUrl = url; } },
    fetch: (input, init) => { fetchCalls.push({ input, init }); return Promise.resolve("ok"); },
    EventSource: function NativeES() {},
  };
  win.__store = store;
  win.__fetchCalls = fetchCalls;
  return win;
}

function run(win) {
  // eslint-disable-next-line no-new-func
  new Function("window", SCRIPT)(win);
}

test("reads the token from the URL hash and strips it", () => {
  const win = makeWindow({ hash: "#covenCaveToken=tok_hash_123" });
  run(win);
  assert.equal(win.__store.get("coven-cave:sidecar-auth-token"), "tok_hash_123");
  assert.equal(win.__replacedUrl, "/", "token must be stripped from the visible URL (no leftover hash/query)");
});

test("still reads the token from the legacy query string", () => {
  const win = makeWindow({ search: "?covenCaveToken=tok_query_9" });
  run(win);
  assert.equal(win.__store.get("coven-cave:sidecar-auth-token"), "tok_query_9");
  assert.equal(win.__replacedUrl, "/");
});

test("preserves other hash/query params while removing only the token", () => {
  const win = makeWindow({ search: "?a=1", hash: "#covenCaveToken=t&keep=2" });
  run(win);
  assert.equal(win.__store.get("coven-cave:sidecar-auth-token"), "t");
  assert.equal(win.__replacedUrl, "/?a=1#keep=2");
});

test("attaches the token header to same-origin /api/ fetches", async () => {
  const win = makeWindow({ hash: "#covenCaveToken=tok_api" });
  run(win);
  await win.fetch("/api/sessions/list", {});
  const last = win.__fetchCalls.at(-1);
  const headers = last.init.headers;
  assert.equal(headers.get(TOKEN_HEADER), "tok_api", "/api/ requests carry the sidecar token header");
});

test("does not touch non-/api/ or cross-origin fetches", async () => {
  const win = makeWindow({ hash: "#covenCaveToken=tok_x" });
  run(win);
  await win.fetch("https://example.com/thing", {});
  const last = win.__fetchCalls.at(-1);
  // cross-origin: init passed through unchanged (no Headers injected)
  assert.ok(!last.init || !last.init.headers || typeof last.init.headers.get !== "function" || !last.init.headers.get(TOKEN_HEADER));
});

test("no token anywhere → leaves fetch and URL untouched", () => {
  const win = makeWindow({});
  const originalFetch = win.fetch;
  run(win);
  assert.equal(win.fetch, originalFetch, "fetch is not wrapped when there is no token");
  assert.equal(win.__replacedUrl, undefined, "URL is not rewritten when there is no token");
});

console.log("sidecar-auth-bridge.test.ts: ok");
