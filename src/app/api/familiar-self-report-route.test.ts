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

  const nextPaths = "\n<coven:next-paths>\n- [reply] Inspect the synthetic report\n</coven:next-paths>";

  it("parses raw JSON followed by next-path suggestions", () => {
    assert.deepEqual(parseSelfReportJsonObject('{"overallConfidence":80}' + nextPaths), {
      overallConfidence: 80,
    });
  });

  it("parses fenced JSON followed by next-path suggestions", () => {
    assert.deepEqual(parseSelfReportJsonObject('```json\n{"overallConfidence":80}\n```' + nextPaths), {
      overallConfidence: 80,
    });
  });

  it("preserves literal next-path markers in JSON strings with or without a real trailer", () => {
    for (const summary of [
      "Literal <coven:next-paths>example</coven:next-paths> text",
      "Literal <coven:next-paths> opener",
    ]) {
      const report = { summary };
      for (const suffix of ["", nextPaths]) {
        assert.deepEqual(parseSelfReportJsonObject(JSON.stringify(report) + suffix), report);
        assert.deepEqual(parseSelfReportJsonObject('```json\n' + JSON.stringify(report) + '\n```' + suffix), report);
      }
    }
  });

  it("extracts an object surrounded by prose while respecting strings and escapes", () => {
    const report = {
      summary: 'Literal } and { braces, "quoted } text", and a trailing slash \\',
      nested: { values: ["{", "}", { ok: true }] },
    };
    assert.deepEqual(
      parseSelfReportJsonObject(`Synthetic report follows.\n${JSON.stringify(report)}\nEnd of report.`),
      report,
    );
  });

  it("uses the first object rather than joining separate objects", () => {
    assert.deepEqual(parseSelfReportJsonObject('Report: {"ok":true}\nExtra: {"ok":false}'), { ok: true });
  });

  it("allows balanced bracketed prose before the report object", () => {
    assert.deepEqual(parseSelfReportJsonObject('Report [summary]: {"ok":true}'), { ok: true });
    assert.deepEqual(parseSelfReportJsonObject('Report [summary [synthetic]]: {"ok":true}'), { ok: true });
  });

  it("rejects responses with no JSON object, including suggestion-only objects", () => {
    assert.throws(() => parseSelfReportJsonObject("No report was produced."));
    assert.throws(() => parseSelfReportJsonObject('<coven:next-paths>\n{"ok":true}\n</coven:next-paths>'));
  });

  it("rejects valid top-level arrays and other non-record JSON values", () => {
    for (const raw of ['[{"ok":true}]', "[]", "null", "true", "80", '"{\\"ok\\":true}"']) {
      assert.throws(() => parseSelfReportJsonObject(raw), /response was not an object/);
    }
  });

  it("does not promote objects inside top-level JSON strings when a trailer is present", () => {
    for (const value of ["{}", '{"ok":true}', 'Escaped "quotes", \\ and {} braces']) {
      const raw = JSON.stringify(value);
      assert.throws(() => parseSelfReportJsonObject(raw + nextPaths));
      assert.throws(() => parseSelfReportJsonObject('```json\n' + raw + '\n```' + nextPaths));
    }
  });

  it("does not salvage objects from malformed or prose-wrapped arrays", () => {
    for (const raw of [
      '[{"ok":true}',
      'Report: [{"ok":true}]\nDone.',
      'Report [summary]: [[], {"ok":true}]',
      'Report [summary]: [[], {"ok":true}',
      'Report: ["]", {"ok":true}]',
      '```json\n[{"ok":true}]\n```' + nextPaths,
    ]) {
      assert.throws(() => parseSelfReportJsonObject(raw));
    }
  });

  it("recovers a missing comma only between a complete string value and an object property", () => {
    assert.deepEqual(
      parseSelfReportJsonObject(String.raw`Report: {"summary":"Complete \"quoted\" value" "overallConfidence":80}`),
      { summary: 'Complete "quoted" value', overallConfidence: 80 },
    );
  });

  it("removes a trailing object comma without changing string contents", () => {
    assert.deepEqual(
      parseSelfReportJsonObject('{"summary":"Literal ,} text","nested":{"ok":true,},}'),
      { summary: "Literal ,} text", nested: { ok: true } },
    );
  });

  it("escapes literal JSON string control characters without changing their values", () => {
    const controls = Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)).join("");
    assert.deepEqual(
      parseSelfReportJsonObject('{"summary":"before' + controls + 'after"}'),
      { summary: "before" + controls + "after" },
    );
  });

  it("preserves valid JSON string escapes and values through syntax recovery", () => {
    const report = { summary: 'Quotes " and slash \\ and literal \\n; {} ,}', nested: [null, false, -2.5e3, "\n\t\u0000"] };
    const raw = JSON.stringify(report);
    assert.deepEqual(parseSelfReportJsonObject(raw), report);
    assert.deepEqual(parseSelfReportJsonObject(raw.slice(0, -1) + ",}"), report);
  });

  it("refuses syntax repair that would invent keys, delimiters, or values", () => {
    for (const raw of [
      '{"summary":"unfinished}',
      '{summary:"value"}',
      '{"summary" "value"}',
      '{"summary":}',
      '{"summary":,}',
      '{,}',
      '{"summary":"value",,}',
      '{"summary":"value" "extra"}',
      '{"summary":"value" "extra":}',
      '{"summary":80 "extra":true}',
      '{"summary":["one" "two"]}',
      '{"summary":["one",]}',
      '{"summary":"bad\\q",}',
      '{"summary":"bad\\\n",}',
      '[{"summary":"value",}]',
    ]) {
      assert.throws(() => parseSelfReportJsonObject(raw), raw);
    }
  });

  const completeReport = {
    overallConfidence: 80,
    toolReliability: { score: 90 },
    contextPressure: "adequate",
    memoryRecallScore: 70,
    fileLocatabilityScore: 85,
  };

  it("does not promote complete reports after unclosed drafts, nested payloads, or suggestions", () => {
    const draft = '{"summary":"Abandoned draft\nStarting the complete report again.\n';
    const report = JSON.stringify(completeReport);
    for (const raw of [
      draft + report,
      draft + report.slice(0, -1),
      draft + report.slice(0, -1) + ",}",
      draft + report + "\nTrailing explanation.",
      draft + "{}",
      draft + "  " + report,
      '{"summary":}\nStarting the complete report again.\n' + report,
      '[\nStarting the complete report again.\n' + report,
      '{"nested":\n' + report,
      '{"nested":[\n' + report,
      '{"nested":\n  ' + report,
      '{"nested":\nA report example follows.\n' + report,
      '{"summary":"Abandoned\n<coven:next-paths>\nA report example follows.\n' + report,
      '<coven:next-paths>\nA report example follows.\n' + report,
      draft + '{}\nAnother attempt.\n' + report,
    ]) {
      assert.throws(() => parseSelfReportJsonObject(raw), raw);
    }
  });

  it("does not skip malformed or incomplete first objects to salvage nested or later objects", () => {
    for (const raw of [
      'Report: {"broken":, "nested":{"ok":true}}',
      'Report: {"nested":{"ok":true}',
      'Report: {"broken":} then {"ok":true}',
      'Report: {"summary":"unterminated }',
    ]) {
      assert.throws(() => parseSelfReportJsonObject(raw));
    }
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

describe("self-report routes keep the source thread id", () => {
  // redactSecretsDeep treats a `sessionId` key as a session secret. A route
  // that runs it over a report before the store sees it hands the store's
  // guard an id that is already "[redacted]", so every report lost its thread
  // link and every Thread Signal fix failed with "The source thread's project
  // is unavailable". All report redaction goes through redactSelfReport.
  const routes = [
    "./familiars/[id]/self-report/route.ts",
    "./familiars/[id]/self-reports/route.ts",
    "./familiars/[id]/self-reports/[sessionId]/route.ts",
  ];
  for (const route of routes) {
    it(`${route} redacts reports with redactSelfReport only`, () => {
      const source = readFileSync(fileURLToPath(new URL(route, import.meta.url)), "utf8");
      assert.doesNotMatch(source, /redactSecretsDeep\(/, "the generic redactor drops sessionId");
      assert.match(source, /redactSelfReport/);
    });
  }
});

describe("self-report normalization keeps the capability blocker link (#5938)", () => {
  it("copies capabilitiesLacking[].blockerId through normalizePayload as optional text", () => {
    assert.match(
      routeSource,
      /capabilitiesLacking: objectArray\(payload\.capabilitiesLacking\)\.map\(\(item\) => \(\{[\s\S]{0,400}?blockerId: optionalText\(item\.blockerId\),/,
      "a capability's blockerId survives normalization so review surfaces can fold it into its blocker",
    );
  });
});
