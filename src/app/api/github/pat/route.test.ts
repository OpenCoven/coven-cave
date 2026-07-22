// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const githubView = readFileSync(new URL("../../../../components/github-view.tsx", import.meta.url), "utf8");

assert.match(
  route,
  /import \{ resolveGitHubToken \} from "@\/lib\/github-token"/,
  "PAT status should use the shared resolver used by all GitHub routes",
);
assert.match(
  route,
  /const hasPat = !!resolveGitHubToken\(\);/,
  "launcher-provided credentials should count as authenticated in the GitHub setup status",
);
assert.match(
  route,
  /const canRemoveStoredPat = !!patFromVault;/,
  "only Cave-managed credentials should offer the local removal action",
);
assert.match(
  githubView,
  /canRemoveStoredPat=\{patStatus\?\.canRemoveStoredPat \?\? false\}/,
  "the GitHub surface must not offer to remove an external launcher credential",
);

console.log("github-pat-route.test.ts: ok");
