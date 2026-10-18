// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Settings → Local models API (#6049): anyone signed in may read; only this
// computer may change where prompts go.
const scratch = mkdtempSync(path.join(tmpdir(), "cave-local-models-route-"));
const saved = Object.fromEntries(["COVEN_CAVE_HOME", "CAVE_OLLAMA_URL", "CAVE_LMSTUDIO_URL", "CAVE_LOCAL_MODELS_ALLOW_REMOTE", "COVEN_CAVE_AUTH_TOKEN"].map((key) => [key, process.env[key]]));
process.env.COVEN_CAVE_HOME = scratch;
for (const key of ["CAVE_OLLAMA_URL", "CAVE_LMSTUDIO_URL", "CAVE_LOCAL_MODELS_ALLOW_REMOTE", "COVEN_CAVE_AUTH_TOKEN"]) delete process.env[key];

// Ollama answers on 127.0.0.1:11500 only; LM Studio is stopped.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const json = (value) => ({ ok: true, status: 200, json: async () => value });
  if (url === "http://127.0.0.1:11500/api/version") return json({ version: "0.21.0" });
  if (url === "http://127.0.0.1:11500/api/tags") return json({ models: [{ name: "qwen3:8b" }] });
  if (url === "http://127.0.0.1:11500/api/show") return json({ capabilities: ["completion", "tools"], model_info: { "qwen3.context_length": 40960 } });
  if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://gpu-box.lan:")) throw new TypeError("fetch failed");
  return realFetch(input, init);
};

const local = { host: "127.0.0.1:3000" };
const phone = { host: "phone.example:3000" };
const request = (method, headers, body) => new Request("http://127.0.0.1:3000/api/local-models", {
  method,
  headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
  ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
});
const file = path.join(scratch, "local-models.json");

try {
  const { GET, PUT } = await import("./route.ts");

  let response = await GET(request("GET", phone));
  assert.equal(response.status, 200, "another device can read the status");
  let status = await response.json();
  assert.equal(status.editable, false, "…and is told it cannot change it");
  assert.deepEqual(status.backends.map((backend) => [backend.backend, backend.source, backend.server.state]), [
    ["ollama", "default", "stopped"],
    ["lmstudio", "default", "stopped"],
  ]);

  response = await PUT(request("PUT", phone, { endpoints: { ollama: "http://127.0.0.1:11500" } }));
  assert.equal(response.status, 403, "another device cannot redirect prompts");
  assert.equal(existsSync(file), false);

  response = await PUT(request("PUT", local, { endpoints: { ollama: "http://gpu-box.lan:11434" } }));
  assert.equal(response.status, 400);
  const refused = await response.json();
  assert.equal(refused.field, "ollama");
  assert.match(refused.error, /isn't this computer/);
  assert.equal(existsSync(file), false, "a refused change writes nothing");

  response = await PUT(request("PUT", local, "{ nope"));
  assert.equal(response.status, 400);

  response = await PUT(request("PUT", local, { endpoints: { ollama: "http://127.0.0.1:11500/" } }));
  assert.equal(response.status, 200, await response.clone().text());
  status = await response.json();
  assert.equal(status.editable, true);
  const ollama = status.backends[0];
  assert.equal(ollama.source, "settings");
  assert.equal(ollama.endpoint, "http://127.0.0.1:11500");
  assert.deepEqual(ollama.server, { state: "running", version: "0.21.0", models: [{ name: "qwen3:8b", tools: true, contextLength: 40960 }] },
    "the reply re-reads the server at its new address");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { version: 1, endpoints: { ollama: "http://127.0.0.1:11500" }, allowRemote: false });

  response = await GET(request("GET", local));
  assert.equal((await response.json()).backends[0].server.state, "running", "later reads use the saved address");

  response = await PUT(request("PUT", local, { endpoints: { ollama: null } }));
  status = await response.json();
  assert.equal(status.backends[0].source, "default");
  assert.equal(status.backends[0].server.state, "stopped", "clearing the address returns to the default server, not a cached answer");
} finally {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
}
console.log("local-models route: ok");
