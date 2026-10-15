// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
// GET's status logic lives in the shared PAT status module so /api/connectors
// reports the same "connected" without importing this route module.
const status = readFileSync(new URL("../../../../lib/server/pat-status.ts", import.meta.url), "utf8");
const githubView = readFileSync(new URL("../../../../components/github-view.tsx", import.meta.url), "utf8");

assert.match(
  route,
  /export async function GET\(\) \{\s*return NextResponse\.json\(readGitHubPatStatus\(\)\);\s*\}/,
  "GET reports the shared PAT status and nothing else",
);
assert.match(
  status,
  /import \{ resolveGitHubToken \} from "@\/lib\/github-token"/,
  "PAT status should use the shared resolver used by all GitHub routes",
);
assert.match(
  status,
  /const hasPat = !!resolveGitHubToken\(\);/,
  "launcher-provided credentials should count as authenticated in the GitHub setup status",
);
assert.match(
  status,
  /const canRemoveStoredPat = hasEncryptedPat \|\| !!localEnvPat;/,
  "only encrypted or local-env credentials Cave can delete should offer the removal action",
);
assert.match(
  status,
  /const localEnvPat = readEnvLocalValue\(GITHUB_PAT_KEY\);[\s\S]*const hasEncryptedPat = hasLocalEncryptedSecret\(GITHUB_PAT_KEY\);/,
  "an external launcher GITHUB_PAT must not be mistaken for Cave-managed storage",
);
assert.match(
  route,
  /if \(processPat && \(processPat === localEnvPat \|\| processPat === encryptedPat\)\) \{[\s\S]*delete process\.env\[PAT_KEY\]/,
  "removing a local token must retain a distinct launcher-provided GITHUB_PAT",
);
assert.match(
  githubView,
  /canRemoveStoredPat=\{patStatus\?\.canRemoveStoredPat \?\? false\}/,
  "the GitHub surface must not offer to remove an external launcher credential",
);

console.log("github-pat-route.test.ts: ok");
