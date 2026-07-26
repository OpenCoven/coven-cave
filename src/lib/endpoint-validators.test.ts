// @ts-nocheck
import assert from "node:assert/strict";
import { checkMcpEndpoint } from "./endpoint-validators.ts";

const fakeFetch = (status) => async () => ({ ok: status >= 200 && status < 300, status });
const throwingFetch = async () => { throw new Error("ECONNREFUSED"); };

let r = await checkMcpEndpoint("https://mcp.example/mcp", fakeFetch(200));
assert.equal(r.reachable, true);
assert.match(r.detail, /live/i);

r = await checkMcpEndpoint("https://mcp.example/mcp", fakeFetch(401));
assert.equal(r.reachable, true);
assert.match(r.detail, /sign in|connect/i);

r = await checkMcpEndpoint("https://mcp.example/mcp", fakeFetch(403));
assert.equal(r.reachable, true);
assert.match(r.detail, /sign in|connect/i);

r = await checkMcpEndpoint("https://mcp.example/mcp", fakeFetch(500));
assert.equal(r.reachable, true);
assert.match(r.detail, /500/);

r = await checkMcpEndpoint("https://mcp.example/mcp", throwingFetch);
assert.equal(r.reachable, false);
assert.match(r.error, /reach/i);

console.log("endpoint-validators.test.ts: ok");
