// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

const previousHome = process.env.HOME;
const previousCovenHome = process.env.COVEN_HOME;
const testHome = await mkdtemp(path.join(process.cwd(), ".board-id-route-test-"));
process.env.HOME = testHome;
process.env.COVEN_HOME = path.join(testHome, ".coven");

try {
  const board = await import("../../../../lib/cave-board.ts");
  const { PATCH } = await import("./route.ts");
  const card = await board.createCard({
    title: "Atomic link outcome",
    links: ["https://example.com/present/"],
  });

  const response = await PATCH(
    new Request(`http://127.0.0.1/api/board/${card.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ops: {
          linkOps: [
            { op: "addNormalizedUrl", value: "https://example.com/present#selected" },
            { op: "addNormalizedUrl", value: "https://example.com/new#original" },
            { op: "addNormalizedUrl", value: "not a URL" },
          ],
        },
      }),
    }),
    { params: Promise.resolve({ id: card.id }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.operationOutcome, {
    addNormalizedUrl: {
      added: ["https://example.com/new#original"],
      duplicates: ["https://example.com/present#selected"],
      invalid: ["not a URL"],
    },
  });
  assert.deepEqual(payload.card.links, [
    "https://example.com/present/",
    "https://example.com/new#original",
  ]);

  const genericResponse = await PATCH(
    new Request(`http://127.0.0.1/api/board/${card.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ops: {
          linkOps: [{ op: "add", value: "https://example.com/generic" }],
        },
      }),
    }),
    { params: Promise.resolve({ id: card.id }) },
  );
  const genericPayload = await genericResponse.json();
  assert.equal(genericPayload.ok, true);
  assert.equal(
    "operationOutcome" in genericPayload,
    false,
    "existing generic callers keep the original response shape",
  );
} finally {
  process.env.HOME = previousHome;
  process.env.COVEN_HOME = previousCovenHome;
  await rm(testHome, { recursive: true, force: true });
}

console.log("board [id] route: ok");
