import assert from "node:assert/strict";

import {
  linksFromFollowUpSource,
  saveFollowUpLinks,
} from "./chat-follow-up-links.ts";

assert.deepEqual(
  linksFromFollowUpSource(
    "Read https://example.com/docs/ and duplicate https://example.com/docs#intro; ignore ftp://example.com/file.",
  ),
  ["https://example.com/docs/"],
  "linksFromFollowUpSource dedupes by normalized URL and keeps the first valid http(s) URL",
);

{
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      ok: true,
      added: [{ url: "https://example.com/docs" }],
      duplicates: ["https://example.com/already-saved"],
      invalid: ["not-a-url"],
    });
  };

  const result = await saveFollowUpLinks(
    { destination: "resources", urls: ["https://example.com/docs"] },
    fetchImpl,
  );

  assert.deepEqual(result, {
    ok: true,
    message: "1 saved, 1 already saved, 1 invalid in Research Resources.",
    added: 1,
    duplicates: 1,
    invalid: 1,
  });
  assert.equal(calls[0]?.url, "/api/research/links");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    urls: ["https://example.com/docs"],
    source: "chat",
  });
}

assert.deepEqual(
  await saveFollowUpLinks(
    { destination: "resources", urls: [] },
    async () => {
      throw new Error("fetch should not run");
    },
  ),
  { ok: false, error: "Select at least one link." },
);

assert.deepEqual(
  await saveFollowUpLinks(
    { destination: "resources", urls: ["https://example.com"] },
    async () =>
      Response.json(
        { ok: false, error: "failed to write the saved-links store" },
        { status: 500 },
      ),
  ),
  { ok: false, error: "failed to write the saved-links store" },
);

assert.deepEqual(
  await saveFollowUpLinks(
    { destination: "resources", urls: ["https://example.com"] },
    async () =>
      Response.json({
        ok: true,
        added: [7],
        duplicates: { length: 3 },
        invalid: null,
      }),
  ),
  { ok: false, error: "Research Resources returned an invalid save result." },
);

{
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      ok: true,
      card: {
        links: ["https://example.com/docs/", "https://example.com/new#section"],
      },
      operationOutcome: {
        addNormalizedUrl: {
          added: ["https://example.com/new#section"],
          duplicates: ["https://example.com/docs"],
          invalid: ["ftp://bad.example/file"],
        },
      },
    });
  };

  const result = await saveFollowUpLinks(
    {
      destination: "task",
      taskId: "task/1",
      urls: [
        "https://example.com/docs",
        "https://example.com/new#section",
        "ftp://bad.example/file",
      ],
    },
    fetchImpl,
  );

  assert.deepEqual(result, {
    ok: true,
    message:
      "1 selected link is now on the current task. 1 selected link was already there. 1 selected link was invalid.",
    added: 1,
    duplicates: 1,
    invalid: 1,
  });
  assert.equal(calls.length, 1, "task saves issue exactly one request");
  assert.equal(calls[0]?.url, "/api/board/task%2F1");
  assert.equal(calls[0]?.init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    ops: {
      linkOps: [
        { op: "addNormalizedUrl", value: "https://example.com/docs" },
        { op: "addNormalizedUrl", value: "https://example.com/new#section" },
        { op: "addNormalizedUrl", value: "ftp://bad.example/file" },
      ],
    },
  });
}

{
  let calls = 0;
  const result = await saveFollowUpLinks(
    {
      destination: "task",
      taskId: "task-1",
      urls: ["https://example.com/docs"],
    },
    async () => {
      calls += 1;
      return Response.json({
        ok: true,
        card: { links: ["https://example.com/docs"] },
      });
    },
  );
  assert.deepEqual(result, {
    ok: false,
    error: "The current task returned an invalid link-save outcome.",
  });
  assert.equal(calls, 1, "a missing outcome never triggers a fallback GET");
}

{
  let calls = 0;
  const result = await saveFollowUpLinks(
    {
      destination: "task",
      taskId: "task-1",
      urls: ["https://example.com/docs"],
    },
    async () => {
      calls += 1;
      return Response.json({
        ok: true,
        operationOutcome: {
          addNormalizedUrl: {
            added: ["https://example.com/docs"],
            duplicates: [],
            invalid: [7],
          },
        },
      });
    },
  );
  assert.deepEqual(result, {
    ok: false,
    error: "The current task returned an invalid link-save outcome.",
  });
  assert.equal(calls, 1, "a malformed outcome never triggers a fallback GET");
}

assert.deepEqual(
  await saveFollowUpLinks(
    {
      destination: "task",
      taskId: "missing-task",
      urls: ["https://example.com/docs"],
    },
    async () =>
      Response.json({
        ok: false,
        error: "not found",
      }, { status: 404 }),
  ),
  { ok: false, error: "not found" },
);

console.log("chat-follow-up-links.test.ts: ok");
