import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { XApiError } from "../x-api.ts";
import {
  X_API_BASE_URL,
  X_AUTHORIZE_URL,
  X_OAUTH_CALLBACK_PORT,
  X_OAUTH_REDIRECT_URI,
  X_PUBLISH_SCOPES,
  X_RESEARCH_SCOPES,
  X_TOKEN_URL,
  getXClientId,
  resolveXClientId,
} from "./x-app-config.ts";

const root = new URL("../../../", import.meta.url);
void getXClientId;

function runConfigModule(source: string, env: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    [
      "--require",
      "./scripts/css-source-contract-hook.cjs",
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      source,
    ],
    { cwd: root, encoding: "utf8", env },
  );
}

const source = await readFile(new URL("./x-app-config.ts", import.meta.url), "utf8");
assert.match(
  source,
  /const X_PACKAGED_PRODUCTION_CLIENT_ID = process\.env\.COVEN_CAVE_X_PRODUCTION_CLIENT_ID\?\.trim\(\) \?\? "";/,
  "the packaged production client ID must use Next's direct environment reference for build-time inlining",
);
assert.doesNotMatch(
  source,
  /const \w+ = process\.env;[\s\S]*?COVEN_CAVE_X_PRODUCTION_CLIENT_ID/,
  "the packaged production client ID must not depend on an aliased environment object",
);

assert.equal(X_AUTHORIZE_URL, "https://x.com/i/oauth2/authorize");
assert.equal(X_TOKEN_URL, "https://api.x.com/2/oauth2/token");
assert.equal(X_API_BASE_URL, "https://api.x.com/2");
assert.equal(X_OAUTH_REDIRECT_URI, "http://127.0.0.1:1456/x/oauth/callback");
assert.equal(X_OAUTH_CALLBACK_PORT, 1456);
assert.deepEqual(X_RESEARCH_SCOPES, ["tweet.read", "users.read", "offline.access"]);
assert.deepEqual(X_PUBLISH_SCOPES, ["tweet.read", "users.read", "offline.access", "tweet.write"]);
assert.equal(Object.isFrozen(X_RESEARCH_SCOPES), true);
assert.equal(Object.isFrozen(X_PUBLISH_SCOPES), true);
assert.throws(
  () => Array.prototype.push.call(X_RESEARCH_SCOPES, "tweet.write"),
  TypeError,
  "exported research scopes cannot be mutated at runtime",
);

assert.equal(
  resolveXClientId({
    COVEN_CAVE_X_CLIENT_ID: "  development-client-id  ",
    COVEN_CAVE_X_PRODUCTION_CLIENT_ID: "production-client-id",
  }),
  "development-client-id",
  "the development override takes precedence and is trimmed",
);
assert.equal(
  resolveXClientId({ COVEN_CAVE_X_PRODUCTION_CLIENT_ID: "  production-client-id  " }),
  "production-client-id",
  "the configured production client ID is trimmed",
);
const injectedProduction = runConfigModule(
  "import { resolveXClientId } from './src/lib/server/x-app-config.ts'; process.stdout.write(resolveXClientId({ COVEN_CAVE_X_PRODUCTION_CLIENT_ID: 'injected-client-id' }));",
  { ...process.env, COVEN_CAVE_X_PRODUCTION_CLIENT_ID: "ambient-client-id" },
);
assert.equal(injectedProduction.status, 0);
assert.equal(
  injectedProduction.stdout,
  "injected-client-id",
  "the pure resolver must use its explicit production input instead of ambient module configuration",
);

const capturedProduction = runConfigModule(
  "import { getXClientId } from './src/lib/server/x-app-config.ts'; process.stdout.write(getXClientId({ COVEN_CAVE_X_CLIENT_ID: '  ' }));",
  { ...process.env, COVEN_CAVE_X_PRODUCTION_CLIENT_ID: "captured-client-id" },
);
assert.equal(capturedProduction.status, 0);
assert.equal(
  capturedProduction.stdout,
  "captured-client-id",
  "the production accessor falls back to the module-captured packaged client ID when runtime production configuration is absent",
);
assert.throws(
  () => resolveXClientId({ COVEN_CAVE_X_CLIENT_ID: "  ", COVEN_CAVE_X_PRODUCTION_CLIENT_ID: "\t" }),
  (error: unknown) =>
    error instanceof XApiError &&
    error.code === "not-configured" &&
    error.safeMessage === "OpenCoven X app configuration is unavailable" &&
    !error.message.includes("COVEN_CAVE_X_CLIENT_ID") &&
    !error.message.includes("COVEN_CAVE_X_PRODUCTION_CLIENT_ID"),
  "missing client IDs fail with a sanitized typed error",
);

console.log("x-app-config.test.ts: ok");
