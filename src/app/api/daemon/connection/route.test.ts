// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{[^}]*loadDaemonConnectionSnapshot[^}]*\} from "@\/lib\/server\/daemon-connection-snapshot"/,
  "daemon connection route should delegate to the shared snapshot loader",
);

assert.match(
  source,
  /export const dynamic = "force-dynamic"/,
  "daemon connection route should opt out of caching",
);

assert.match(
  source,
  /export const runtime = "nodejs"/,
  "daemon connection route should run in the Node runtime",
);

assert.match(
  source,
  /export async function GET\(request: NextRequest\)/,
  "daemon connection route should accept the request object",
);

assert.match(
  source,
  /request\.nextUrl\.searchParams\.get\("fresh"\) === "1"/,
  "daemon connection route should only treat an exact fresh=1 query as fresh",
);

assert.match(
  source,
  /loadDaemonConnectionSnapshot\(\{ fresh \}\)/,
  "daemon connection route should forward the parsed fresh flag",
);

assert.match(
  source,
  /const snapshot = await loadDaemonConnectionSnapshot\(\{ fresh \}\);[\s\S]*?return NextResponse\.json\(snapshot\);/,
  "daemon connection route should return the shared snapshot directly without awaiting travel reconciliation",
);

assert.match(
  source,
  /console\.warn\(code\);/,
  "daemon connection route should log only a stable error code on fallback",
);

assert.match(
  source,
  /function stableErrorCode\(error: unknown\): string \{[\s\S]*?String\(\(error as NodeJS\.ErrnoException\)\.code \?\? "connection-snapshot"\)/,
  "daemon connection route should derive a privacy-safe stable fallback code",
);

assert.match(
  source,
  /return NextResponse\.json\(\{[\s\S]*?running: false,[\s\S]*?availability: "status-unavailable"[\s\S]*?reason: "Daemon connection status is temporarily unavailable",[\s\S]*?checkedAt: new Date\(\)\.toISOString\(\)[\s\S]*?\}\);/,
  "daemon connection route should return the unavailable status shape on failure",
);

assert.match(
  source,
  /reason: "Daemon connection status is temporarily unavailable"/,
  "daemon connection route should use the privacy-safe fallback reason",
);

assert.match(
  source,
  /checkedAt: new Date\(\)\.toISOString\(\)/,
  "daemon connection route should timestamp its fallback response",
);

assert.doesNotMatch(
  source,
  /daemon-travel-reconcile|reconcileDaemonTravelHeartbeatSnapshot|syncOfflineTravelQueue|startLocalDaemon|recordTravelHubReachability/,
  "daemon connection route should remain a read-only snapshot endpoint with no travel reconciliation imports",
);

assert.doesNotMatch(
  source,
  /executorStatusesForConfig|installedCovenVersion|target:\s*target|targetSummary|daemonTargetForConfig|loadDaemonStatusSnapshot/,
  "daemon connection route should not build broader daemon-status metadata or target summaries",
);

console.log("daemon connection route.test.ts: ok");
