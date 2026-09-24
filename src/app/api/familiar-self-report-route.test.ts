import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseSelfReportJsonObject,
  stripSelfReportJsonFence,
} from "../../lib/server/self-report-json.ts";

const routeSource = readFileSync(
  fileURLToPath(new URL("./familiars/[id]/self-report/route.ts", import.meta.url)),
  "utf8",
);

describe("reflection auto-archive wiring", () => {
  it("archives the reflected thread through the shared policy helper", () => {
    assert.doesNotMatch(
      routeSource,
      /shouldAutoArchiveOnReflection|loadState/,
      "route must not make a stale state/policy decision before the atomic mutator",
    );
    assert.match(
      routeSource,
      /lastActivityAt: reflectedSession\.lastActivityAt,/,
      "route must feed the thread's last activity to the auto-trigger idle gate (cave-9q24)",
    );
    assert.match(
      routeSource,
      /normalizeChatAutoArchivePolicy\(config\.chatAutoArchive\)/,
      "route must read the policy from cave config, tolerating partial storage",
    );
    assert.match(
      routeSource,
      /autoArchiveReflectedSessionLocal\(\s*sessionId,\s*\{\s*trigger,\s*policy,\s*lastActivityAt: reflectedSession\.lastActivityAt,/,
      "route must pass trigger and external context to the atomic reflection helper",
    );
    assert.match(
      routeSource,
      /loadReflectedSession\(sessionId\)[\s\S]*?if \(!reflectedSession\) return null;/,
      "a reflection for a missing local/daemon session is an archive no-op",
    );
    assert.match(
      routeSource,
      /sessionExists: async \(\) => Boolean\(await loadReflectedSession\(sessionId\)\),/,
      "the authoritative existence recheck is owned by the archive helper",
    );
    assert.match(
      routeSource,
      /await resolveArchiveNudges\(sessionId\)/,
      "archiving on reflection must resolve any pending archive nudges",
    );
  });

  it("keeps the archive best-effort and reports archivedAt to the client", () => {
    assert.match(
      routeSource,
      /async function maybeAutoArchiveReflectedThread[\s\S]*?catch \{\s*return null;\s*\}/,
      "an archive failure must never fail the self-report that triggered it",
    );
    assert.match(
      routeSource,
      /ok: true,\s*report,[\s\S]*?\.\.\.\(archivedAt \? \{ archivedAt \} : \{\}\),/,
      "POST response must carry archivedAt so the chat can refresh its list",
    );
  });
});

describe("reflection archive missing-session guard", () => {
  it("uses loadReflectedSession for authoritative existence, not local-only or always-true", () => {
    // sessionExists must be derived from loadReflectedSession (checks both local
    // conversation and daemon) — never a synthetic `return true` that would
    // archive tombstones for nonexistent sessions.
    assert.match(
      routeSource,
      /sessionExists: async \(\) => Boolean\(await loadReflectedSession\(sessionId\)\)/,
      "sessionExists is derived from loadReflectedSession (local + daemon), not assumed",
    );
    assert.doesNotMatch(
      routeSource,
      /sessionExists: async \(\) => true/,
      "sessionExists must not unconditionally return true",
    );
    // loadReflectedSession returns null when the session is absent from both
    // local storage and daemon. The early guard converts that null into a hard
    // no-op so no archive write is attempted.
    assert.match(
      routeSource,
      /if \(!reflectedSession\) return null;/,
      "null reflectedSession (not found anywhere) is a hard no-archive gate",
    );
  });

  it("daemon-only session absence (not in list) and lookup failure both prevent archive", () => {
    // When the daemon call succeeds but the session is absent from the list,
    // loadReflectedSession returns null — identical to daemon-down. Both paths
    // must hit the !reflectedSession guard and be no-ops.
    assert.match(
      routeSource,
      /if \(!daemonSession\) return null;/,
      "absent daemon session is a no-archive path, not a fallback to archive",
    );
    // Daemon call failures are caught and return null (not rethrown). A thrown
    // response therefore cannot bypass the !reflectedSession guard.
    assert.match(
      routeSource,
      /callDaemon[\s\S]*?\.catch\(\(\) => null\)/,
      "daemon call errors are caught as null so lookup failures are treated as missing",
    );
  });

  it("local conversation can trigger archive through the shared policy helper", () => {
    // A present local conversation is the primary existence source. When found,
    // its updatedAt is used as lastActivityAt for the auto-trigger idle gate.
    assert.match(
      routeSource,
      /if \(conversation\) return \{ lastActivityAt: conversation\.updatedAt \}/,
      "local conversation provides the existence proof and lastActivityAt",
    );
    // The archive then goes through the atomic helper (not a direct state write).
    assert.match(
      routeSource,
      /autoArchiveReflectedSessionLocal/,
      "route delegates to the atomic archive helper",
    );
  });

  it("daemon-only session (no local conversation) can archive via sessionExists recheck", () => {
    // When loadConversation returns null but the daemon has the session,
    // loadReflectedSession returns a non-null ReflectedSession with
    // lastActivityAt from daemon's updated_at (or null if absent).
    // The archive then proceeds through the sessionExists recheck.
    assert.match(
      routeSource,
      /typeof daemonSession\.updated_at === "string" \? daemonSession\.updated_at : null/,
      "daemon-only session activity timestamp is extracted without assuming non-null",
    );
    // The recheck re-calls loadReflectedSession under the archive helper, so a
    // session deleted between the first check and the write is caught.
    assert.match(
      routeSource,
      /sessionExists: async \(\) => Boolean\(await loadReflectedSession\(sessionId\)\)/,
      "existence recheck uses the same authoritative lookup as the initial check",
    );
  });
});


describe("self-report route JSON parsing", () => {
  it("parses fenced JSON without using an ambiguous closing-fence regex in the route", () => {
    assert.doesNotMatch(
      routeSource,
      /replace\(\s*\/\\s\*```\\\$\/[gimsyu]*/,
      "closing code-fence cleanup must not use a backtracking \\s* end-anchor regex on user input",
    );

    const parsed = parseSelfReportJsonObject("```json\n{\"overallConfidence\":80}\n\t\t```");

    assert.deepEqual(parsed, { overallConfidence: 80 });
  });

  it("strips code fences with linear string operations", () => {
    assert.equal(stripSelfReportJsonFence("```JSON\t\n{\"ok\":true}\n\t```"), "{\"ok\":true}");
    assert.equal(stripSelfReportJsonFence("```\n{\"ok\":true}\n```"), "{\"ok\":true}");
    assert.equal(stripSelfReportJsonFence("{\"ok\":true}\t\t"), "{\"ok\":true}");
  });
});

describe("reflection auto-archive CTA gate and review-run archive", () => {
  it("derives the call-to-action from the persisted report and feeds it to the thread archive", () => {
    assert.match(
      routeSource,
      /const requiresHumanAction = selfReportRequiresHumanAction\(report\);/,
      "the CTA decision comes from the shared pure helper, on the normalized report",
    );
    assert.match(
      routeSource,
      /maybeAutoArchiveReflectedThread\(\s*sessionId,\s*body\.trigger as ReflectionTrigger,\s*requiresHumanAction,\s*\)/,
      "the reflected-thread archive receives the CTA flag",
    );
    assert.match(
      routeSource,
      /lastActivityAt: reflectedSession\.lastActivityAt,\s*requiresHumanAction,/,
      "the atomic reflection helper is told about the CTA inside the same request",
    );
  });

  it("archives a verified review run whatever the CTA, never the reflected thread, and validates its id", () => {
    assert.match(
      routeSource,
      /if \(reviewSessionId && !SELF_REPORT_SESSION_ID_RE\.test\(reviewSessionId\)\)/,
      "a supplied review session id is validated with the same session-id rule",
    );
    assert.match(
      routeSource,
      /async function maybeAutoArchiveReviewRun[\s\S]*?if \(!reviewSessionId \|\| reviewSessionId === reflectedSessionId\) return null;\s*try \{/,
      "the review run is left alone only when it is the reflected thread; a CTA stays on that thread",
    );
    assert.match(
      routeSource,
      /async function isReviewRunOf[\s\S]*?loadConversation\(reviewSessionId\)[\s\S]*?origin === "enhance" && conversation\.familiarId === familiarId/,
      "provenance is resolved server-side: an enhance run of the reporting familiar",
    );
    assert.match(
      routeSource,
      /return await autoArchiveReviewRunLocal\(\s*reviewSessionId,\s*\(\) => isReviewRunOf\(reviewSessionId, familiarId\),\s*\);[\s\S]*?catch \{\s*return null;\s*\}/,
      "review-run archiving is best-effort and goes through the provenance-gated state helper",
    );
    assert.match(
      routeSource,
      /maybeAutoArchiveReviewRun\(reviewSessionId, sessionId, id\)/,
      "the reporting familiar id scopes the provenance check",
    );
    assert.match(
      routeSource,
      /requiresHumanAction,\s*\.\.\.\(archivedAt \? \{ archivedAt \} : \{\}\),\s*\.\.\.\(reviewArchivedAt \? \{ reviewArchivedAt \} : \{\}\),/,
      "the response reports the CTA verdict and both archive outcomes",
    );
  });
});
