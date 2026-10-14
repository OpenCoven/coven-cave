// Exercises the bundled Vane MCP server (marketplace/plugins/vane/server/
// vane-mcp.mjs) end to end: a fake Vane on an ephemeral loopback port, the
// real server spawned over stdio, and JSON-RPC traffic through its stdin/stdout.
// No network beyond 127.0.0.1, and nothing under ~/.coven is touched.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "marketplace", "plugins", "vane", "server", "vane-mcp.mjs");
const REQUEST_TIMEOUT_MS = 15_000;

const PROVIDERS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Embeddings Only",
    chatModels: [],
    embeddingModels: [{ name: "Embed One", key: "embed-one" }],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Chat Provider",
    chatModels: [{ name: "Chat Alpha", key: "chat-alpha" }, { name: "Chat Beta", key: "chat-beta" }],
    embeddingModels: [{ name: "Embed Two", key: "embed-two" }],
  },
];

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function startFakeVane({ providers = PROVIDERS, search } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ method: req.method, path: req.url, body });
      if (req.method === "GET" && req.url === "/api/providers") {
        json(res, 200, { providers });
        return;
      }
      if (req.method === "POST" && req.url === "/api/search") {
        const out = search ? search(body) : { body: { message: "unused", sources: [] } };
        json(res, out.status ?? 200, out.body);
        return;
      }
      json(res, 404, { message: "not found" });
    });
  });
  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

/** A loopback port nothing listens on (bound once, then released). */
async function closedPort() {
  const probe = net.createServer();
  const port = await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => resolve(probe.address().port));
  });
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function startServer(env) {
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH ?? "", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const pending = new Map();
  const unsolicited = [];
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  reader.on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    } else {
      unsolicited.push(message);
    }
  });
  let nextId = 1;
  const api = {
    child,
    unsolicited,
    stderr: () => stderr,
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`timed out waiting for ${method} (id ${id}); stderr: ${stderr}`));
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    async call(name, args) {
      const response = await api.request("tools/call", { name, arguments: args });
      assert.equal(response.error, undefined, `tools/call ${name} returned a protocol error: ${JSON.stringify(response.error)}`);
      return response.result;
    },
    async stop() {
      const exit = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
      child.stdin.end();
      return exit;
    },
  };
  return api;
}

async function initialized(server) {
  const init = await server.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "vane-mcp-test", version: "0" },
  });
  server.notify("notifications/initialized", {});
  return init;
}

function textOf(result) {
  return result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
}

// ---------------------------------------------------------------------------
// Handshake and discovery.
{
  const vane = await startFakeVane();
  const server = startServer({ VANE_URL: vane.url });
  try {
    const init = await initialized(server);
    assert.equal(init.jsonrpc, "2.0");
    assert.equal(init.result.protocolVersion, "2025-06-18");
    assert.equal(init.result.serverInfo.name, "vane-mcp");
    assert.ok(init.result.capabilities.tools, "the server advertises tools");

    const ping = await server.request("ping", {});
    assert.deepEqual(ping.result, {});

    const list = await server.request("tools/list", {});
    assert.deepEqual(
      list.result.tools.map((tool) => tool.name),
      ["vane_search", "vane_providers"],
    );
    const search = list.result.tools.find((tool) => tool.name === "vane_search");
    assert.deepEqual(search.inputSchema.required, ["query"]);
    assert.deepEqual(search.inputSchema.properties.sources.items.enum, ["web", "academic", "discussions"]);
    assert.deepEqual(search.inputSchema.properties.mode.enum, ["speed", "balanced", "quality"]);
    assert.match(search.description, /lead/i, "the tool description warns the answer is a lead");

    const unknown = await server.request("nope/method", {});
    assert.equal(unknown.error.code, -32601);

    const badTool = await server.request("tools/call", { name: "missing_tool", arguments: {} });
    assert.equal(badTool.error.code, -32602);

    assert.deepEqual(server.unsolicited, [], "notifications never produce a reply");
    assert.equal(vane.requests.length, 0, "handshake and discovery never touch Vane");
  } finally {
    await server.stop();
    await vane.close();
  }
}

// ---------------------------------------------------------------------------
// Happy path: default models, source formatting, provider lookup cached.
{
  const vane = await startFakeVane({
    search: () => ({
      body: {
        message: "The sky looks blue because of Rayleigh scattering [1][2].",
        sources: [
          {
            content: "Rayleigh scattering   is the elastic scattering of light by particles\n much smaller than the wavelength.",
            metadata: { title: "Rayleigh scattering", url: "https://example.org/rayleigh" },
          },
          {
            content: "x".repeat(400),
            metadata: { url: "https://example.org/untitled" },
          },
        ],
      },
    }),
  });
  const server = startServer({ VANE_URL: vane.url });
  try {
    await initialized(server);
    const result = await server.call("vane_search", { query: "why is the sky blue" });
    assert.notEqual(result.isError, true, textOf(result));
    const text = textOf(result);
    assert.match(text, /^The sky looks blue because of Rayleigh scattering \[1\]\[2\]\./);
    assert.match(text, /\nSources:\n1\. Rayleigh scattering — https:\/\/example\.org\/rayleigh\n   Rayleigh scattering is the elastic scattering of light by particles much smaller than the wavelength\.\n/);
    assert.match(text, /2\. https:\/\/example\.org\/untitled — https:\/\/example\.org\/untitled\n   x{199}…/);
    assert.equal(result.structuredContent.sources.length, 2);
    assert.deepEqual(result.structuredContent.sources[0], {
      title: "Rayleigh scattering",
      url: "https://example.org/rayleigh",
      snippet: "Rayleigh scattering is the elastic scattering of light by particles much smaller than the wavelength.",
    });
    assert.equal(result.structuredContent.message, "The sky looks blue because of Rayleigh scattering [1][2].");

    const search = vane.requests.find((entry) => entry.path === "/api/search");
    assert.deepEqual(search.body, {
      chatModel: { providerId: PROVIDERS[1].id, key: "chat-alpha" },
      embeddingModel: { providerId: PROVIDERS[0].id, key: "embed-one" },
      optimizationMode: "speed",
      sources: ["web"],
      query: "why is the sky blue",
      stream: false,
    });

    const second = await server.call("vane_search", {
      query: "and at sunset?",
      sources: ["web", "academic", "web"],
      mode: "quality",
      systemInstructions: "Answer in one sentence.",
      history: [["human", "why is the sky blue"], ["assistant", "Rayleigh scattering."]],
    });
    assert.notEqual(second.isError, true, textOf(second));
    const searches = vane.requests.filter((entry) => entry.path === "/api/search");
    assert.equal(searches.length, 2);
    assert.deepEqual(searches[1].body.sources, ["web", "academic"]);
    assert.equal(searches[1].body.optimizationMode, "quality");
    assert.equal(searches[1].body.systemInstructions, "Answer in one sentence.");
    assert.deepEqual(searches[1].body.history, [["human", "why is the sky blue"], ["assistant", "Rayleigh scattering."]]);
    assert.equal(
      vane.requests.filter((entry) => entry.path === "/api/providers").length,
      1,
      "the provider lookup is cached across calls",
    );

    const invalid = await server.call("vane_search", { query: "x", sources: ["news"] });
    assert.equal(invalid.isError, true);
    assert.match(textOf(invalid), /Unknown source "news"/);
    const empty = await server.call("vane_search", { query: "   " });
    assert.equal(empty.isError, true);
    assert.match(textOf(empty), /query must be a non-empty string/);

    const providers = await server.call("vane_providers", {});
    assert.notEqual(providers.isError, true, textOf(providers));
    assert.match(textOf(providers), /2\. Chat Provider \(id: 22222222-2222-4222-8222-222222222222\)\n   chat: chat-alpha, chat-beta\n   embedding: embed-two/);
    assert.equal(providers.structuredContent.providers.length, 2);
  } finally {
    await server.stop();
    await vane.close();
  }
}

// ---------------------------------------------------------------------------
// Env-pinned models skip discovery entirely.
{
  const vane = await startFakeVane({ search: () => ({ body: { message: "pinned", sources: [] } }) });
  const server = startServer({
    VANE_URL: vane.url,
    VANE_CHAT_PROVIDER_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    VANE_CHAT_MODEL: "pinned-chat",
    VANE_EMBEDDING_PROVIDER_ID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    VANE_EMBEDDING_MODEL: "pinned-embed",
  });
  try {
    await initialized(server);
    const result = await server.call("vane_search", { query: "pinned?" });
    assert.notEqual(result.isError, true, textOf(result));
    assert.match(textOf(result), /^pinned\n\nSources: none returned\.$/);
    assert.equal(vane.requests.filter((entry) => entry.path === "/api/providers").length, 0, "fully pinned models never fetch /api/providers");
    const search = vane.requests.find((entry) => entry.path === "/api/search");
    assert.deepEqual(search.body.chatModel, { providerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", key: "pinned-chat" });
    assert.deepEqual(search.body.embeddingModel, { providerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", key: "pinned-embed" });
  } finally {
    await server.stop();
    await vane.close();
  }
}

// Partial pins resolve the rest from discovery and validate the pinned key.
{
  const vane = await startFakeVane({ search: () => ({ body: { message: "partial", sources: [] } }) });
  const server = startServer({ VANE_URL: vane.url, VANE_CHAT_MODEL: "chat-beta" });
  try {
    await initialized(server);
    const result = await server.call("vane_search", { query: "partial?" });
    assert.notEqual(result.isError, true, textOf(result));
    const search = vane.requests.find((entry) => entry.path === "/api/search");
    assert.deepEqual(search.body.chatModel, { providerId: PROVIDERS[1].id, key: "chat-beta" });
    assert.deepEqual(search.body.embeddingModel, { providerId: PROVIDERS[0].id, key: "embed-one" });
  } finally {
    await server.stop();
    await vane.close();
  }
  const vane2 = await startFakeVane();
  const server2 = startServer({ VANE_URL: vane2.url, VANE_CHAT_PROVIDER_ID: PROVIDERS[1].id, VANE_CHAT_MODEL: "chat-gamma" });
  try {
    await initialized(server2);
    const result = await server2.call("vane_search", { query: "bad pin" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Pinned chat model "chat-gamma" is not offered by provider Chat Provider\. Available: chat-alpha, chat-beta\./);
  } finally {
    await server2.stop();
    await vane2.close();
  }
}

// ---------------------------------------------------------------------------
// Vane not running: clear error that names the docker command.
{
  const port = await closedPort();
  const server = startServer({ VANE_URL: `http://127.0.0.1:${port}` });
  try {
    await initialized(server);
    const result = await server.call("vane_search", { query: "anyone home?" });
    assert.equal(result.isError, true);
    const text = textOf(result);
    assert.match(text, new RegExp(`Vane is unreachable at http://127\\.0\\.0\\.1:${port} \\(ECONNREFUSED\\)`));
    assert.match(text, /docker run -d -p 127\.0\.0\.1:3030:3000 -v vane-data:\/home\/vane\/data --name vane itzcrazykns1337\/vane:latest/);
    const providers = await server.call("vane_providers", {});
    assert.equal(providers.isError, true);
    assert.match(textOf(providers), /Vane is unreachable/);
  } finally {
    await server.stop();
  }
}

// ---------------------------------------------------------------------------
// Empty provider list and HTTP failures.
{
  const vane = await startFakeVane({ providers: [] });
  const server = startServer({ VANE_URL: vane.url });
  try {
    await initialized(server);
    const result = await server.call("vane_search", { query: "no providers" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /No providers configured in Vane at http:\/\/127\.0\.0\.1:\d+\. Open it in a browser/);
    assert.equal(vane.requests.filter((entry) => entry.path === "/api/search").length, 0, "no search is attempted without models");
    const providers = await server.call("vane_providers", {});
    assert.equal(providers.isError, true);
    assert.match(textOf(providers), /No providers configured/);
  } finally {
    await server.stop();
    await vane.close();
  }
}
{
  const vane = await startFakeVane({ search: () => ({ status: 500, body: { message: "An error has occurred." } }) });
  const server = startServer({ VANE_URL: vane.url });
  try {
    await initialized(server);
    const result = await server.call("vane_search", { query: "boom" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /^Vane returned HTTP 500 for \/api\/search: \{"message":"An error has occurred\."\}$/);
  } finally {
    await server.stop();
    await vane.close();
  }
}
{
  // Only providers with a chat model AND one with an embedding model make a usable pair.
  const vane = await startFakeVane({ providers: [{ id: "c", name: "Chat only", chatModels: [{ key: "c1" }], embeddingModels: [] }] });
  const server = startServer({ VANE_URL: vane.url });
  try {
    await initialized(server);
    const result = await server.call("vane_search", { query: "half configured" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /No Vane provider exposes a embedding model/);
  } finally {
    await server.stop();
    await vane.close();
  }
}

// ---------------------------------------------------------------------------
// Non-loopback URLs are refused unless the operator opts in.
{
  const server = startServer({ VANE_URL: "http://vane.internal.example:3030" });
  try {
    await initialized(server);
    const list = await server.request("tools/list", {});
    assert.equal(list.result.tools.length, 2, "discovery still works so the refusal is visible to the agent");
    const result = await server.call("vane_search", { query: "leaks?" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Refusing to query the non-loopback Vane URL http:\/\/vane\.internal\.example:3030/);
    assert.match(textOf(result), /VANE_ALLOW_REMOTE=1/);
    const providers = await server.call("vane_providers", {});
    assert.equal(providers.isError, true);
    assert.match(textOf(providers), /Refusing to query/);
  } finally {
    const code = await server.stop();
    assert.equal(code, 0);
    assert.match(server.stderr(), /non-loopback VANE_URL/);
  }
}
{
  // Loopback spellings all pass; an opted-in remote host proceeds to the network.
  const { isLoopbackHost, readConfig } = await import(SERVER);
  for (const host of ["127.0.0.1", "127.9.9.9", "localhost", "LOCALHOST", "::1", "[::1]", "app.localhost", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ["0.0.0.0", "10.0.0.5", "vane.example.com", "", "128.0.0.1"]) {
    assert.equal(isLoopbackHost(host), false, host);
  }
  const remote = readConfig({ VANE_URL: "https://vane.example.com/base/", VANE_ALLOW_REMOTE: "1", VANE_TIMEOUT_MS: "250" });
  assert.equal(remote.loopback, false);
  assert.equal(remote.allowRemote, true);
  assert.equal(remote.baseUrl, "https://vane.example.com/base");
  assert.equal(remote.timeoutMs, 250);
  assert.equal(readConfig({}).baseUrl, "http://127.0.0.1:3030");
  assert.equal(readConfig({ VANE_TIMEOUT_MS: "nope" }).timeoutMs, 120_000);
  assert.match(readConfig({ VANE_URL: "not a url" }).error, /VANE_URL is not a valid URL/);
}

// ---------------------------------------------------------------------------
// Request timeout surfaces as a tool error, not a hang.
{
  const vane = await startFakeVane({ search: () => ({ body: { message: "late", sources: [] } }) });
  const slow = http.createServer((req, res) => {
    // Never answer the search; the server's own timeout must fire first.
    if (req.url === "/api/providers") json(res, 200, { providers: PROVIDERS });
    else setTimeout(() => res.end(), 5_000).unref();
  });
  const slowPort = await new Promise((resolve) => slow.listen(0, "127.0.0.1", () => resolve(slow.address().port)));
  const server = startServer({ VANE_URL: `http://127.0.0.1:${slowPort}`, VANE_TIMEOUT_MS: "300" });
  try {
    await initialized(server);
    const result = await server.call("vane_search", { query: "slow" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Vane did not answer \/api\/search within 300 ms/);
  } finally {
    await server.stop();
    slow.closeAllConnections();
    await new Promise((resolve) => slow.close(resolve));
    await vane.close();
  }
}

console.log("vane-mcp-server: ok");
