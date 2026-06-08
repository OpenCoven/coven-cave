// @ts-nocheck
import assert from "node:assert/strict";
import { enrichTitle, fallbackTitle } from "./title-enricher.ts";

const originalFetch = globalThis.fetch;
const calls: string[] = [];

globalThis.fetch = async (url: string | URL) => {
  const href = String(url);
  calls.push(href);

  if (href.startsWith("https://api.github.com/repos/OpenCoven/coven-cave")) {
    return new Response(
      JSON.stringify({
        full_name: "OpenCoven/coven-cave",
        description: "Cave desktop workspace",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  if (href.startsWith("https://export.arxiv.org/api/query")) {
    return new Response(
      "<feed><entry><title>Safe Paper Title</title><summary>Paper summary</summary></entry></feed>",
      { status: 200, headers: { "content-type": "application/xml" } },
    );
  }

  return new Response(
    "<!doctype html><title>Server-side HTML fetch should not run</title>",
    { status: 200, headers: { "content-type": "text/html" } },
  );
};

try {
  calls.length = 0;
  assert.equal(
    await enrichTitle("https://example.com/blog/server-side-fetch"),
    null,
    "generic public URLs should not trigger server-side HTML title fetching",
  );
  assert.deepStrictEqual(calls, []);
  assert.equal(fallbackTitle("https://example.com/blog/server-side-fetch"), "Server Side Fetch");

  for (const unsafeUrl of [
    "http://localhost:3000/admin",
    "http://127.0.0.1:3000/admin",
    "http://[::1]:3000/admin",
  ]) {
    calls.length = 0;
    assert.equal(await enrichTitle(unsafeUrl), null);
    assert.deepStrictEqual(calls, [], `${unsafeUrl} should not be fetched server-side`);
  }

  calls.length = 0;
  const github = await enrichTitle("https://github.com/OpenCoven/coven-cave");
  assert.deepStrictEqual(github, {
    title: "OpenCoven/coven-cave",
    description: "Cave desktop workspace",
  });
  assert.deepStrictEqual(calls, ["https://api.github.com/repos/OpenCoven/coven-cave"]);

  calls.length = 0;
  const arxiv = await enrichTitle("https://arxiv.org/abs/2603.12345");
  assert.deepStrictEqual(arxiv, {
    title: "Safe Paper Title",
    description: "Paper summary",
  });
  assert.deepStrictEqual(calls, ["https://export.arxiv.org/api/query?id_list=2603.12345&max_results=1"]);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("title-enricher: allowlisted fetch behavior passed");
