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
      /\{ ok: true, report, \.\.\.\(archivedAt \? \{ archivedAt \} : \{\}\) \}/,
      "POST response must carry archivedAt so the chat can refresh its list",
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
