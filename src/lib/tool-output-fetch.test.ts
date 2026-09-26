// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { clearToolOutputCache, fetchToolOutput, ToolOutputFetchError } from "./tool-output-fetch.ts";

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("repeated opens share one request and the url is encoded", async () => {
  clearToolOutputCache();
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return response(200, { ok: true, output: "full output" });
  };
  const [a, b] = await Promise.all([
    fetchToolOutput("s 1", "tool/1", fetchImpl),
    fetchToolOutput("s 1", "tool/1", fetchImpl),
  ]);
  assert.equal(a, "full output");
  assert.equal(b, "full output");
  assert.deepEqual(urls, ["/api/chat/conversation/s%201/tool-output?toolId=tool%2F1"]);
});

test("a failure is reported and forgotten so Retry asks again", async () => {
  clearToolOutputCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1 ? response(404, { ok: false, error: "not found" }) : response(200, { ok: true, output: "later" });
  };
  await assert.rejects(fetchToolOutput("s", "t", fetchImpl), (error) => error instanceof ToolOutputFetchError && error.status === 404);
  assert.equal(await fetchToolOutput("s", "t", fetchImpl), "later");
  assert.equal(calls, 2);
});
