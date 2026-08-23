// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPlaceholders, diagnoseEntry, diagnoseRegistry } from "./mcp-doctor.ts";

// Behavioral tests for the MCP doctor: verdicts must be honest (probed, not
// assumed), requirement *names* must surface, and secret values must never
// appear in any output.

const liveProbe = async () => ({ reachable: true, detail: "endpoint live" });
const authProbe = async () => ({ reachable: true, detail: "reachable — sign in on connect" });
const deadProbe = async () => ({ reachable: false, error: "could not reach endpoint" });
const haveCommand = async () => true;
const noCommand = async () => false;

test("extractPlaceholders: names from url, args, and env values — deduped and sorted", () => {
  assert.deepEqual(
    extractPlaceholders({
      url: "${ACTIVEPIECES_MCP_URL}",
      args: ["--http", "${NETDATA_MCP_URL}", "--root", "${NETDATA_MCP_URL}"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PAT}" },
    }),
    ["ACTIVEPIECES_MCP_URL", "GITHUB_PAT", "NETDATA_MCP_URL"],
  );
  assert.deepEqual(extractPlaceholders({ command: "npx", args: ["-y", "some-pkg"] }), []);
});

test("http endpoint that answers the initialize probe is ready", async () => {
  const h = await diagnoseEntry("linear", { type: "http", url: "https://mcp.linear.app/mcp" }, { probe: liveProbe, commandExists: noCommand });
  assert.equal(h.status, "ready");
  assert.equal(h.transport, "http");
  assert.match(h.detail, /live/);
});

test("http endpoint behind auth is still ready — sign-in happens in the client", async () => {
  const h = await diagnoseEntry("canva", { type: "http", url: "https://mcp.canva.com/mcp" }, { probe: authProbe, commandExists: noCommand });
  assert.equal(h.status, "ready");
  assert.match(h.detail, /sign in/);
});

test("unreachable http endpoint is unavailable, with the probe's error", async () => {
  const h = await diagnoseEntry("vercel", { type: "http", url: "https://mcp.vercel.com" }, { probe: deadProbe, commandExists: noCommand });
  assert.equal(h.status, "unavailable");
  assert.match(h.detail, /could not reach/);
});

test("remote entry with a placeholder url needs config and is never probed", async () => {
  let probed = 0;
  const countingProbe = async () => {
    probed += 1;
    return { reachable: true };
  };
  const h = await diagnoseEntry("activepieces", { type: "sse", url: "${ACTIVEPIECES_MCP_URL}" }, { probe: countingProbe, commandExists: noCommand });
  assert.equal(h.status, "needs-config");
  assert.deepEqual(h.requires, ["ACTIVEPIECES_MCP_URL"]);
  assert.equal(probed, 0, "a ${...} url must not be fetched");
});

test("stdio entry whose launcher is missing is unavailable, requirements still listed", async () => {
  const h = await diagnoseEntry(
    "git",
    { type: "stdio", command: "uvx", args: ["mcp-server-git", "--repository", "${COVEN_MCP_GIT_REPOSITORY}"] },
    { probe: liveProbe, commandExists: noCommand },
  );
  assert.equal(h.status, "unavailable");
  assert.match(h.detail, /"uvx" is not installed/);
  assert.deepEqual(h.requires, ["COVEN_MCP_GIT_REPOSITORY"]);
});

test("stdio entry with launcher installed but unmet placeholders needs config", async () => {
  const h = await diagnoseEntry(
    "github",
    { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PAT}" } },
    { probe: liveProbe, commandExists: haveCommand },
  );
  assert.equal(h.status, "needs-config");
  assert.deepEqual(h.requires, ["GITHUB_PAT"]);
  assert.match(h.detail, /set GITHUB_PAT/);
});

test("stdio entry with launcher installed and nothing to configure is ready", async () => {
  const h = await diagnoseEntry("fetch", { type: "stdio", command: "uvx", args: ["mcp-server-fetch"] }, { probe: liveProbe, commandExists: haveCommand });
  assert.equal(h.status, "ready");
  assert.match(h.detail, /"uvx" installed/);
});

test("entries missing both url and command are flagged, not crashed on", async () => {
  const remote = await diagnoseEntry("broken-remote", { type: "http" }, { probe: liveProbe, commandExists: haveCommand });
  assert.equal(remote.status, "needs-config");
  assert.match(remote.detail, /no url/);
  const local = await diagnoseEntry("broken-stdio", {}, { probe: liveProbe, commandExists: haveCommand });
  assert.equal(local.status, "needs-config");
  assert.match(local.detail, /no command/);
});

test("diagnoseRegistry: tolerates malformed documents and sorts results by id", async () => {
  assert.deepEqual(await diagnoseRegistry(null, { probe: liveProbe, commandExists: haveCommand }), []);
  assert.deepEqual(await diagnoseRegistry({ mcpServers: "nope" }, { probe: liveProbe, commandExists: haveCommand }), []);
  const out = await diagnoseRegistry(
    {
      mcpServers: {
        zeta: { type: "http", url: "https://z.example/mcp" },
        alpha: { type: "stdio", command: "npx", args: ["-y", "pkg"] },
      },
    },
    { probe: liveProbe, commandExists: haveCommand },
  );
  assert.deepEqual(out.map((h) => h.id), ["alpha", "zeta"]);
});

test("no env values ever leak into the report — names only", async () => {
  const out = await diagnoseRegistry(
    {
      mcpServers: {
        leaky: {
          type: "stdio",
          command: "npx",
          args: ["-y", "pkg"],
          env: { API_TOKEN: "super-secret-value", OTHER: "${WANTED_NAME}" },
        },
      },
    },
    { probe: liveProbe, commandExists: haveCommand },
  );
  const serialized = JSON.stringify(out);
  assert.doesNotMatch(serialized, /super-secret-value/, "concrete env values must never appear");
  assert.match(serialized, /WANTED_NAME/, "placeholder names must appear");
  assert.doesNotMatch(serialized, /API_TOKEN/, "only unmet placeholder names are reported, not env keys with concrete values");
});
