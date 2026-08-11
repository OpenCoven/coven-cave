import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");

// Re-pointing where a machine stores its workspaces is a host-level change.
// The folder browser that feeds this route is loopback-only; so is this.
assert.match(
  source,
  /export async function GET\(req: NextRequest\) \{\s*const denied = rejectNonLocalRequest\(req\);\s*if \(denied\) return denied;/,
  "GET is loopback-gated",
);
assert.match(
  source,
  /export async function POST\(req: NextRequest\) \{\s*const denied = rejectNonLocalRequest\(req\);\s*if \(denied\) return denied;/,
  "POST is loopback-gated",
);

assert.match(
  source,
  /import \{ saveWorkspaceRoot, workspaceRootStatus \} from "@\/lib\/server\/workspace-root-store"/,
  "the route delegates validation and persistence to the store",
);
assert.doesNotMatch(
  source,
  /writeFile|mkdir|JSON\.parse\(readFileSync/,
  "the route never writes the override itself",
);

assert.match(
  source,
  /const dir = typeof body\?\.dir === "string" \? body\.dir : "";/,
  "a non-string dir is coerced to an empty request rather than trusted",
);

// Each refusal reason maps to a distinct status so the field can tell "you
// can't change this" from "that folder is wrong".
for (const [reason, status] of [
  ["env-pinned", "409"],
  ["invalid-path", "400"],
  ["unbounded", "400"],
  ["write-failed", "500"],
] as const) {
  assert.match(
    source,
    new RegExp(`case "${reason}":[\\s\\S]*?status: ${status}`),
    `${reason} answers ${status}`,
  );
}

assert.match(
  source,
  /return NextResponse\.json\(\{ ok: true, \.\.\.workspaceRootStatus\(\) \}\);/,
  "a successful save answers with the freshly resolved status",
);

console.log("config/workspace-path route.test.ts: ok");
