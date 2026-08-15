import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchHfPaperMetadata } from "./hf-paper-metadata.ts";

const PAYLOAD = {
  id: "2401.12345",
  title: "Distributionally Robust Receive Beamforming",
  authors: [{ name: "Shixiong Wang" }, { name: "Wei Dai" }],
  publishedAt: "2024-01-22T20:20:48.000Z",
  summary: "This article investigates signal estimation.",
};

test("maps the HF payload", async () => {
  const result = await fetchHfPaperMetadata("2401.12345", {
    fetchImpl: async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }),
  });
  assert.deepEqual(result, {
    title: "Distributionally Robust Receive Beamforming",
    authors: ["Shixiong Wang", "Wei Dai"],
    abstract: "This article investigates signal estimation.",
    publishedAt: "2024-01-22T20:20:48.000Z",
  });
});

test("degrades to null on a non-OK response", async () => {
  const result = await fetchHfPaperMetadata("2401.12345", {
    fetchImpl: async () => new Response("nope", { status: 404 }),
  });
  assert.equal(result, null);
});

test("degrades to null when the fetch throws", async () => {
  const result = await fetchHfPaperMetadata("2401.12345", {
    fetchImpl: async () => { throw new Error("network down"); },
  });
  assert.equal(result, null);
});

test("degrades to null on malformed JSON", async () => {
  const result = await fetchHfPaperMetadata("2401.12345", {
    fetchImpl: async () => new Response("not json at all", { status: 200 }),
  });
  assert.equal(result, null);
});

test("refuses an id that is not an arXiv id, without issuing a request", async () => {
  let called = false;
  const result = await fetchHfPaperMetadata("../etc/passwd", {
    fetchImpl: async () => { called = true; return new Response("{}", { status: 200 }); },
  });
  assert.equal(result, null);
  assert.equal(called, false, "must not issue a request for an invalid id");
});

test("tolerates missing optional fields but requires a title", async () => {
  const noTitle = await fetchHfPaperMetadata("2401.12345", {
    fetchImpl: async () => new Response(JSON.stringify({ id: "2401.12345" }), { status: 200 }),
  });
  assert.equal(noTitle, null, "a paper with no title is not useful metadata");

  const sparse = await fetchHfPaperMetadata("2401.12345", {
    fetchImpl: async () => new Response(JSON.stringify({ title: "T" }), { status: 200 }),
  });
  assert.deepEqual(sparse, { title: "T", authors: [], abstract: "", publishedAt: "" });
});
