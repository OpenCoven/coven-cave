import assert from "node:assert/strict";
import test from "node:test";
import * as salem from "./route.ts";
import * as pathfinder from "./pathfinder/route.ts";
import * as feedback from "./pathfinder/feedback/route.ts";

const routes = [
  ["/salem", "GET", salem.GET],
  ["/salem", "POST", salem.POST],
  ["/salem/pathfinder", "GET", pathfinder.GET],
  ["/salem/pathfinder", "POST", pathfinder.POST],
  ["/salem/pathfinder/feedback", "POST", feedback.POST],
] as const;

for (const [path, method, handler] of routes) {
  test(`${method} ${path} refuses retired work without reading its body or calling a provider`, async () => {
    const request = new Request(`http://localhost/api${path}`, {
      method,
      headers: { host: "localhost", origin: "http://localhost" },
    });
    let bodyReads = 0;
    let fetches = 0;
    request.json = async () => { bodyReads++; return { message: "Help", userMessage: "Help" }; };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { fetches++; throw new Error("Retired work must not contact providers"); };
    try {
      const response = await handler(request);
      assert.equal(response.status, 410);
      assert.deepEqual(await response.json(), {
        ok: false, code: "salem-retired", error: "Ask Salem has been retired from Cave.",
      });
      assert.equal(bodyReads, 0);
      assert.equal(fetches, 0);
      assert.equal(response.headers.get("cache-control"), "no-store");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
