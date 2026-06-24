// @ts-nocheck
import assert from "node:assert/strict";
import { hasValidator, validateSecret, validateGithubToken } from "./secret-validators.ts";

const fakeFetch = (status, jsonBody) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => jsonBody,
});
const throwingFetch = async () => { throw new Error("network down"); };

assert.equal(hasValidator("GITHUB_PERSONAL_ACCESS_TOKEN"), true);
assert.equal(hasValidator("COVEN_MCP_FILESYSTEM_ROOT"), false);
assert.equal(hasValidator("NOPE"), false);

let r = await validateGithubToken("tok", fakeFetch(200, { login: "octocat" }));
assert.deepEqual(r, { ok: true, login: "octocat" });

r = await validateGithubToken("tok", fakeFetch(200, {}));
assert.equal(r.ok, true);
assert.equal(r.login, undefined);

r = await validateGithubToken("tok", fakeFetch(401, {}));
assert.equal(r.ok, false);
assert.match(r.error, /rejected/i);

r = await validateGithubToken("tok", fakeFetch(403, {}));
assert.equal(r.ok, false);

r = await validateGithubToken("tok", fakeFetch(500, {}));
assert.equal(r.ok, false);
assert.match(r.error, /500/);

r = await validateGithubToken("tok", throwingFetch);
assert.equal(r.ok, false);
assert.match(r.error, /reach/i);

const vs = await validateSecret("GITHUB_PERSONAL_ACCESS_TOKEN", "tok", fakeFetch(200, { login: "me" }));
assert.deepEqual(vs, { ok: true, login: "me" });

const none = await validateSecret("UNKNOWN_ENV", "x", fakeFetch(200, {}));
assert.equal(none.ok, false);
assert.match(none.error, /no validator/i);

console.log("secret-validators.test.ts: ok");
