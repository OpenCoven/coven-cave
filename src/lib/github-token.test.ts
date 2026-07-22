import assert from "node:assert/strict";
import { GITHUB_TOKEN_ENV_KEYS, resolveGitHubTokenFromEnvironment } from "./github-token.ts";

assert.deepEqual(
  GITHUB_TOKEN_ENV_KEYS,
  ["GITHUB_TOKEN", "COVEN_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_PERSONAL_ACCESS_TOKEN"],
  "GitHub API routes support the common environment names used by shell, Cave, and MCP/harness installs",
);
assert.equal(
  resolveGitHubTokenFromEnvironment({ GITHUB_TOKEN: "  token-from-github  " }),
  "token-from-github",
  "GITHUB_TOKEN is accepted and trimmed",
);
assert.equal(
  resolveGitHubTokenFromEnvironment({ GITHUB_TOKEN: " ", GH_TOKEN: "token-from-gh" }),
  "token-from-gh",
  "an empty higher-priority environment variable does not mask another configured token",
);
assert.equal(
  resolveGitHubTokenFromEnvironment({ GITHUB_PERSONAL_ACCESS_TOKEN: "token-from-mcp" }),
  "token-from-mcp",
  "MCP-style GitHub token environments are accepted",
);
assert.equal(resolveGitHubTokenFromEnvironment({}), null, "missing environment credentials resolve to null");
