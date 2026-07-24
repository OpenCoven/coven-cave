import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateThreadSignals,
  buildReflectTranscript,
  buildThreadReflectPrompt,
  buildThreadSignalResolutionPrompt,
  contextPressureLabel,
  deriveThreadScore,
  type ThreadSelfReport,
} from "./thread-self-report.ts";

function fullReport(): ThreadSelfReport {
  return {
    id: "report-1",
    familiarId: "cody",
    sessionId: "session-1",
    threadTitle: "Analytics foundation",
    reportedAt: "2026-06-25T12:00:00.000Z",
    overallConfidence: 80,
    overallConfidenceReason: "Most signals were healthy.",
    toolReliability: {
      score: 60,
      failedTools: ["build"],
      unreliableTools: ["search"],
      notes: "One transient failure.",
    },
    contextPressure: "tight",
    contextNotes: "Enough room, but close.",
    skillsUsed: ["test-driven-development"],
    skillsNeedingClarity: [{ skillId: "verification-before-completion", reason: "Scope of CI checks." }],
    skillsNeedingAccess: [{ skillId: "github", reason: "Needs PR merge access." }],
    capabilitiesLacking: [
      {
        name: "Self-report API",
        importance: "blocking",
        detail: "Thread signals cannot persist yet.",
      },
    ],
    capabilitiesVital: [
      {
        name: "GitHub CLI",
        currentState: "available",
        notes: "Authenticated.",
      },
    ],
    memoryRecallScore: 50,
    memoryRecallNotes: "Memory was available.",
    fileLocatabilityScore: 90,
    fileLocatabilityNotes: "Files were easy to find.",
    persistentBlockers: [
      {
        id: "blocker-1",
        title: "Missing daemon",
        category: "infra",
        firstSeenAt: "2026-06-24T12:00:00.000Z",
        impact: "medium",
        detail: "Daemon unavailable in local tests.",
        suggestedResolution: "Mock route responses.",
      },
    ],
  };
}

describe("thread self-report helpers", () => {
  it("derives the weighted composite thread score", () => {
    assert.equal(deriveThreadScore(fullReport()), 71);
  });

  it("maps every context pressure to a display label and severity", () => {
    assert.deepEqual(contextPressureLabel("adequate"), { label: "Adequate", severity: "ok" });
    assert.deepEqual(contextPressureLabel("tight"), { label: "Tight", severity: "warn" });
    assert.deepEqual(contextPressureLabel("excess"), { label: "Excess", severity: "warn" });
    assert.deepEqual(contextPressureLabel("critical"), { label: "Critical", severity: "crit" });
  });

  it("constructs a complete ThreadSelfReport shape", () => {
    const report = fullReport();

    assert.equal(report.id, "report-1");
    assert.equal(report.persistentBlockers[0].impact, "medium");
  });
});

describe("buildReflectTranscript", () => {
  it("formats user/assistant turns and drops system/empty ones", () => {
    const out = buildReflectTranscript([
      { role: "system", text: "boot" },
      { role: "user", text: "  hi there  " },
      { role: "assistant", text: "hello" },
      { role: "assistant", text: "   " },
    ]);
    assert.equal(out, "user: hi there\nassistant: hello");
  });

  it("keeps only the most recent turns and truncates long ones", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ role: "user" as const, text: `m${i}` }));
    const out = buildReflectTranscript(many);
    assert.equal(out.split("\n").length, 24, "caps at the most recent 24 turns");
    assert.ok(out.includes("m39") && !out.includes("m0\n") && !out.startsWith("user: m0"));

    const long = buildReflectTranscript([{ role: "assistant", text: "x".repeat(2000) }]);
    assert.ok(long.length < 700 && long.endsWith("…"), "long turns are clipped with an ellipsis");
  });
});

describe("buildThreadReflectPrompt", () => {
  it("embeds the transcript and the exact JSON shape the route validates", () => {
    const prompt = buildThreadReflectPrompt({
      sessionId: "sess-1",
      transcript: "user: do the thing\nassistant: done",
    });
    assert.ok(prompt.includes("session: sess-1"));
    assert.ok(prompt.includes("user: do the thing"));
    for (const key of ["overallConfidence", "toolReliability", "contextPressure", "persistentBlockers"]) {
      assert.ok(prompt.includes(`"${key}"`), `prompt declares ${key}`);
    }
    assert.ok(/Return ONLY a valid JSON object/.test(prompt));
  });

  it("falls back to a context-free instruction when no transcript is given", () => {
    const prompt = buildThreadReflectPrompt({ sessionId: "sess-2" });
    assert.ok(prompt.includes("Reflect on the thread just completed (session: sess-2)"));
  });

  it("builds a resolution prompt that directs the thread to fix a selected review item", () => {
    const prompt = buildThreadSignalResolutionPrompt({
      kind: "skill-access",
      severity: "critical",
      sourceId: "github",
      title: "github",
      detail: "needs push access to land PRs",
    });
    assert.ok(prompt.includes("skill access gap"), "names the item kind in plain language");
    assert.ok(prompt.includes("**github**"), "highlights the topic title");
    assert.ok(prompt.includes("needs push access to land PRs"), "carries the detail");
    assert.ok(/root cause/i.test(prompt), "asks for a root-cause diagnosis");
    assert.ok(/apply the concrete fix/i.test(prompt), "instructs the thread to actually apply the fix");
    assert.ok(/verify the fix/i.test(prompt), "requires verification, not just discussion");
    assert.match(prompt, /^Resolve this /, "opens as a resolution directive");
    // every review kind maps to a label (no "undefined" leaking into the prompt)
    for (const kind of ["blocker", "skill-clarity", "capability", "context-pressure", "low-score"] as const) {
      const p = buildThreadSignalResolutionPrompt({ kind, severity: "info", sourceId: "t", title: "t", detail: "d" });
      assert.doesNotMatch(p, /undefined/, `${kind} resolves to a label`);
    }
  });
});

describe("aggregateThreadSignals vital capabilities", () => {
  function reportWithVital(
    id: string,
    reportedAt: string,
    vital: ThreadSelfReport["capabilitiesVital"],
  ): ThreadSelfReport {
    return { ...fullReport(), id, sessionId: id, reportedAt, capabilitiesVital: vital };
  }

  it("uses the latest report's currentState per capability, so recovered capabilities stop surfacing as missing", () => {
    // Regression: a capability broken in one old session (e.g. the pre-#2985
    // copilot permission regression) must not pin `status: missing` after
    // newer reports observe it available (cave-hdkx).
    const stale = reportWithVital("session-old", "2026-07-12T01:39:00.000Z", [
      { name: "command execution for builds/tests", currentState: "missing", notes: "Denied by permission layer." },
    ]);
    const recovered = reportWithVital("session-new", "2026-07-14T21:30:00.000Z", [
      { name: "command execution for builds/tests", currentState: "available", notes: "cargo/pnpm/node verified." },
    ]);
    // Order of the input array must not matter — only reportedAt recency.
    for (const reports of [
      [stale, recovered],
      [recovered, stale],
    ]) {
      const aggregate = aggregateThreadSignals(reports);
      assert.deepEqual(aggregate.capabilitiesVital, [
        { name: "command execution for builds/tests", currentState: "available", notes: "cargo/pnpm/node verified." },
      ]);
    }
  });

  it("keeps a newest-report degradation visible", () => {
    const wasFine = reportWithVital("session-old", "2026-07-10T08:00:00.000Z", [
      { name: "GitHub CLI", currentState: "available", notes: "Authenticated." },
    ]);
    const nowBroken = reportWithVital("session-new", "2026-07-14T09:00:00.000Z", [
      { name: "GitHub CLI", currentState: "missing", notes: "Token expired." },
    ]);
    const aggregate = aggregateThreadSignals([wasFine, nowBroken]);
    assert.deepEqual(aggregate.capabilitiesVital, [
      { name: "GitHub CLI", currentState: "missing", notes: "Token expired." },
    ]);
  });

  it("tracks distinct capability names independently", () => {
    const a = reportWithVital("session-a", "2026-07-13T10:00:00.000Z", [
      { name: "shell command execution", currentState: "available" },
    ]);
    const b = reportWithVital("session-b", "2026-07-14T10:00:00.000Z", [
      { name: "artifact capture", currentState: "degraded", notes: "Flaky screenshots." },
    ]);
    const aggregate = aggregateThreadSignals([b, a]);
    assert.deepEqual(
      new Map(aggregate.capabilitiesVital.map((c) => [c.name, c.currentState])),
      new Map([
        ["shell command execution", "available"],
        ["artifact capture", "degraded"],
      ]),
    );
  });
});

describe("aggregateThreadSignals skill access gaps", () => {
  function reportWithSkills(
    id: string,
    reportedAt: string,
    opts: { used?: string[]; access?: ThreadSelfReport["skillsNeedingAccess"] },
  ): ThreadSelfReport {
    return {
      ...fullReport(),
      id,
      sessionId: id,
      reportedAt,
      skillsUsed: opts.used ?? [],
      skillsNeedingAccess: opts.access ?? [],
    };
  }

  it("clears an access gap once a newer report uses the skill without re-filing it", () => {
    // Regression: skill-creator was reported blocked mid-install (07-12/07-14),
    // then worked in every later session — the row must not stay `blocked`
    // for the whole report window (same latest-wins semantics as cave-hdkx).
    const stale = reportWithSkills("session-old", "2026-07-14T15:22:31.000Z", {
      used: ["skill-creator"],
      access: [{ skillId: "skill-creator", reason: "Freshly installed skills aren't visible mid-session." }],
    });
    const recovered = reportWithSkills("session-new", "2026-07-23T19:00:00.000Z", {
      used: ["skill-creator"],
    });
    // Order of the input array must not matter — only reportedAt recency.
    for (const reports of [
      [stale, recovered],
      [recovered, stale],
    ]) {
      assert.deepEqual(aggregateThreadSignals(reports).skillsNeedingAccess, []);
    }
  });

  it("keeps the complaint when the newest mention of the skill still files one", () => {
    const usedFine = reportWithSkills("session-old", "2026-07-10T08:00:00.000Z", {
      used: ["github"],
    });
    const nowBlocked = reportWithSkills("session-new", "2026-07-14T09:00:00.000Z", {
      access: [{ skillId: "github", reason: "Needs PR merge access." }],
    });
    assert.deepEqual(aggregateThreadSignals([usedFine, nowBlocked]).skillsNeedingAccess, [
      { skillId: "github", reason: "Needs PR merge access." },
    ]);
  });

  it("lets a report's own complaint win over its own skillsUsed mention", () => {
    // A thread can drive a skill through a bash fallback (so it lands in
    // skillsUsed) while skill-tool access is still broken — that report's
    // complaint must stand until a NEWER report uses the skill cleanly.
    const fallbackRun = reportWithSkills("session-only", "2026-07-14T15:22:31.000Z", {
      used: ["skill-creator"],
      access: [{ skillId: "skill-creator", reason: "Drove it via bash scripts instead of skill invocation." }],
    });
    assert.deepEqual(aggregateThreadSignals([fallbackRun]).skillsNeedingAccess, [
      { skillId: "skill-creator", reason: "Drove it via bash scripts instead of skill invocation." },
    ]);
  });

  it("tracks distinct skill ids independently", () => {
    const older = reportWithSkills("session-a", "2026-07-13T10:00:00.000Z", {
      access: [
        { skillId: "skill-creator", reason: "Not installed yet." },
        { skillId: "github", reason: "Needs PR merge access." },
      ],
    });
    const newer = reportWithSkills("session-b", "2026-07-14T10:00:00.000Z", {
      used: ["skill-creator"],
    });
    assert.deepEqual(aggregateThreadSignals([older, newer]).skillsNeedingAccess, [
      { skillId: "github", reason: "Needs PR merge access." },
    ]);
  });
});
