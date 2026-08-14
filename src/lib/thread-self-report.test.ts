import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateThreadSignals,
  buildReflectTranscript,
  buildThreadReflectPrompt,
  buildThreadSignalBatchResolutionPrompt,
  buildThreadSignalResolutionPrompt,
  buildThreadSignalRows,
  buildThreadSignalScoreTiles,
  compositeTone,
  contextPressureLabel,
  deriveThreadScore,
  metricTone,
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

  it("records visible attachment evidence, including attachment-only turns", () => {
    const out = buildReflectTranscript([
      {
        role: "assistant",
        text: "The banner is shown below.",
        attachments: [{ name: "launch-banner.png", mimeType: "image/png" }],
      },
      {
        role: "assistant",
        text: "",
        attachments: [{ name: "alternate.webp", type: "image/webp" }],
      },
    ]);
    assert.equal(
      out,
      "assistant: The banner is shown below. [visible attachments: launch-banner.png (image/png)]\n"
        + "assistant: [visible attachments: alternate.webp (image/webp)]",
    );
  });

  it("keeps only the most recent turns and truncates long ones", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ role: "user" as const, text: `m${i}` }));
    const out = buildReflectTranscript(many);
    assert.equal(out.split("\n").length, 36, "caps at the most recent 36 turns");
    assert.ok(out.includes("m39") && !out.includes("m0\n") && !out.startsWith("user: m0"));

    const long = buildReflectTranscript([{ role: "assistant", text: "x".repeat(2000) }]);
    assert.ok(long.length < 1000 && long.endsWith("…"), "long turns are clipped with an ellipsis");
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
    assert.ok(prompt.includes("No transcript was captured"));
    assert.ok(prompt.includes("session: sess-2"));
    assert.ok(
      /do not treat the missing transcript as a finding/i.test(prompt),
      "an absent transcript must not be reported as a thread finding",
    );
  });

  // Regression: reflection runs used to rate their OWN condensed view, producing
  // `critical` contextPressure for threads that had none ("only the session ID
  // was provided"; "the actual exchange is truncated while a very large
  // knowledge vault dominates the context"). The prompt must scope the rating to
  // the thread under review.
  it("scopes contextPressure to the reflected thread, not the reflection run", () => {
    const prompt = buildThreadReflectPrompt({ sessionId: "sess-3", transcript: "user: hi" });
    assert.ok(
      /rate the THREAD ABOVE, not this reflection run/i.test(prompt),
      "prompt states the scope rule for contextPressure",
    );
    assert.ok(
      /Do NOT rate pressure on how much of the transcript you can see/i.test(prompt),
      "a clipped transcript is explicitly not evidence of pressure",
    );
    assert.ok(
      /too thin to judge, use "adequate"/i.test(prompt),
      "insufficient evidence falls back to adequate, not an inflated rating",
    );
  });

  it("requires concrete delivery evidence instead of inferring completion from narration", () => {
    const prompt = buildThreadReflectPrompt({
      sessionId: "sess-delivery",
      transcript: "assistant: I am about to push the branch and schedule the reminder.",
    });
    assert.match(prompt, /Do NOT infer completion from plans, narration, or intent/i);
    assert.match(prompt, /remote ref, artifact path, receipt, message id, or equivalent/i);
    assert.match(prompt, /incomplete or unverified/i);
  });

  it("treats rendered attachment metadata as delivery proof instead of trusting prose", () => {
    const prompt = buildThreadReflectPrompt({
      sessionId: "sess-image",
      transcript: "assistant: The banner is complete.",
    });
    assert.match(prompt, /A prose claim that an image was shown is not delivery evidence/i);
    assert.match(prompt, /\[visible attachments:/i);
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
    assert.match(prompt, /classify every requested deliverable/i);
    assert.match(prompt, /verified with exact evidence, incomplete, or blocked/i);
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

describe("aggregateThreadSignals stale signal clearing", () => {
  function reportAt(
    id: string,
    reportedAt: string,
    overrides: Partial<ThreadSelfReport>,
  ): ThreadSelfReport {
    return {
      ...fullReport(),
      id,
      sessionId: id,
      reportedAt,
      ...overrides,
    };
  }

  it("clears stale capabilitiesLacking rows when newer reports no longer list them", () => {
    const stale = reportAt("session-old", "2026-07-10T08:00:00.000Z", {
      capabilitiesLacking: [
        {
          name: "Reliable granted-root write enforcement",
          importance: "blocking",
          detail: "Writes and repo-local commands were denied.",
        },
      ],
    });
    const recovered = reportAt("session-new", "2026-07-14T09:00:00.000Z", {
      capabilitiesLacking: [],
    });

    for (const reports of [
      [stale, recovered],
      [recovered, stale],
    ]) {
      assert.deepEqual(aggregateThreadSignals(reports).capabilitiesLacking, []);
    }
  });

  it("clears stale persistent blockers when newer reports resolve them", () => {
    const stale = reportAt("session-old", "2026-07-10T08:00:00.000Z", {
      persistentBlockers: [
        {
          id: "granted-root-write-denied",
          title: "coven-cave grant not reflected in tool execution",
          category: "permission",
          impact: "blocking",
          detail: "Writes and cwd changes were denied in the target repo.",
        },
      ],
    });
    const recovered = reportAt("session-new", "2026-07-14T09:00:00.000Z", {
      persistentBlockers: [],
    });

    for (const reports of [
      [stale, recovered],
      [recovered, stale],
    ]) {
      assert.deepEqual(aggregateThreadSignals(reports).persistentBlockers, []);
    }
  });

  it("uses descending report ID to break reportedAt ties regardless of input order", () => {
    const stale = reportAt("report-a", "2026-07-14T09:00:00.000Z", {
      capabilitiesLacking: [
        {
          name: "Shell access",
          importance: "blocking",
          detail: "Commands were denied.",
        },
      ],
      persistentBlockers: [
        {
          id: "shell-denied",
          title: "Shell denied",
          category: "permission",
          impact: "blocking",
          detail: "Commands were denied.",
        },
      ],
    });
    const recovered = reportAt("report-z", stale.reportedAt, {
      capabilitiesLacking: [],
      persistentBlockers: [],
    });

    for (const reports of [
      [stale, recovered],
      [recovered, stale],
    ]) {
      const aggregate = aggregateThreadSignals(reports);
      assert.deepEqual(aggregate.capabilitiesLacking, []);
      assert.deepEqual(aggregate.persistentBlockers, []);
    }
  });

  it("keeps historical frequency only for blockers still active in the newest report", () => {
    const staleOnly = reportAt("session-oldest", "2026-07-08T08:00:00.000Z", {
      persistentBlockers: [
        {
          id: "old-only",
          title: "Old blocker",
          category: "other",
          impact: "high",
          detail: "Only appears in old sessions.",
        },
        {
          id: "still-active",
          title: "Still active",
          category: "infra",
          impact: "medium",
          detail: "Persists into newer sessions.",
        },
      ],
    });
    const older = reportAt("session-old", "2026-07-10T08:00:00.000Z", {
      persistentBlockers: [
        {
          id: "still-active",
          title: "Still active",
          category: "infra",
          impact: "medium",
          detail: "Persists into newer sessions.",
        },
      ],
    });
    const newest = reportAt("session-new", "2026-07-14T09:00:00.000Z", {
      persistentBlockers: [
        {
          id: "still-active",
          title: "Still active",
          category: "infra",
          impact: "medium",
          detail: "Persists into newer sessions.",
        },
      ],
    });

    const aggregate = aggregateThreadSignals([staleOnly, older, newest]);
    assert.deepEqual(aggregate.persistentBlockers.map((item) => item.id), ["still-active"]);
    assert.equal(aggregate.persistentBlockers[0].frequency, 3);
  });
});

describe("in-chat Thread Signal card builders", () => {
  it("grades the composite harder than its inputs", () => {
    // 60 is a warning for the headline number and merely unremarkable for one
    // contributing metric — the card's two scales, pinned so they cannot merge.
    assert.equal(compositeTone(60), "warn");
    assert.equal(metricTone(60), "neutral");
    assert.equal(compositeTone(39), "crit");
    assert.equal(metricTone(39), "crit");
    assert.equal(metricTone(59), "warn");
    assert.equal(metricTone(95), "ok");
    assert.equal(compositeTone(70), "ok");
  });

  it("builds six score tiles whose rationale quotes the report", () => {
    const tiles = buildThreadSignalScoreTiles(fullReport());
    assert.deepEqual(
      tiles.map((tile) => tile.id),
      ["score", "confidence", "tools", "memory", "files", "context"],
    );
    assert.equal(tiles[0].value, "71");
    assert.equal(tiles[0].formula, "conf x .35 + tools x .25 + memory x .20 + files x .20");
    // Only the composite carries a formula line.
    assert.deepEqual(tiles.slice(1).map((tile) => tile.formula), [undefined, undefined, undefined, undefined, undefined]);
    assert.equal(tiles[1].rationale, "Most signals were healthy.");
    assert.equal(tiles[2].rationale, "One transient failure.");
    assert.equal(tiles[5].value, "Tight");
    assert.equal(tiles[5].weight, "not scored");
    // The composite names its own extremes, which no single field records.
    assert.match(tiles[0].rationale, /Strongest input files at 90, weakest memory at 50\./);
  });

  it("falls back to derived tool copy when the report left notes empty", () => {
    const report = fullReport();
    report.toolReliability = { score: 100, failedTools: [], unreliableTools: [] };
    assert.equal(
      buildThreadSignalScoreTiles(report)[2].rationale,
      "No failed or unreliable tools reported this thread.",
    );
    report.toolReliability = { score: 40, failedTools: ["build"], unreliableTools: ["search"] };
    assert.equal(
      buildThreadSignalScoreTiles(report)[2].rationale,
      "Failed: build. Unreliable: search.",
    );
  });

  it("ranks one report's signals critical-first, then by rank", () => {
    const rows = buildThreadSignalRows(fullReport());
    assert.deepEqual(
      rows.map((row) => `${row.severity}:${row.kind}`),
      [
        "critical:capability",
        "critical:skill-access",
        "warning:blocker",
        "warning:context-pressure",
        "warning:skill-clarity",
        "warning:low-score",
      ],
    );
    assert.equal(rows[0].kindLabel, "Capability");
    assert.equal(rows[2].resolution, "Mock route responses.");
    assert.equal(rows[2].meta, "infra · medium impact");
  });

  it("does not inherit the aggregate's frequency-based criticality", () => {
    // aggregateThreadSignals([one report]) scores every blocker crit because
    // frequency / total is always 1. A single report grades on impact instead.
    const report = fullReport();
    report.capabilitiesLacking = [];
    report.skillsNeedingAccess = [];
    const rows = buildThreadSignalRows(report);
    const blocker = rows.find((row) => row.kind === "blocker");
    assert.equal(blocker?.severity, "warning", "a medium-impact blocker is not critical");
  });

  it("promotes high-impact blockers and drops nice-to-have capability gaps", () => {
    const report = fullReport();
    report.persistentBlockers = [
      { id: "b", title: "Stale cache", category: "infra", impact: "high", detail: "d" },
    ];
    report.capabilitiesLacking = [
      { name: "Nice thing", importance: "nice-to-have", detail: "d" },
      { name: "Needed thing", importance: "important", detail: "d" },
    ];
    const rows = buildThreadSignalRows(report);
    assert.equal(rows.find((row) => row.kind === "blocker")?.severity, "critical");
    assert.deepEqual(
      rows.filter((row) => row.kind === "capability").map((row) => row.title),
      ["Needed thing"],
    );
  });

  it("returns no rows for a clean thread", () => {
    const report = fullReport();
    report.persistentBlockers = [];
    report.capabilitiesLacking = [];
    report.skillsNeedingAccess = [];
    report.skillsNeedingClarity = [];
    report.contextPressure = "adequate";
    report.memoryRecallScore = 90;
    assert.deepEqual(buildThreadSignalRows(report), []);
  });

  it("caps the queue at six rows", () => {
    const report = fullReport();
    report.persistentBlockers = Array.from({ length: 9 }, (_unused, index) => ({
      id: `b${index}`,
      title: `Blocker ${index}`,
      category: "infra" as const,
      impact: "blocking" as const,
      detail: "d",
    }));
    assert.equal(buildThreadSignalRows(report).length, 6);
  });

  it("batches several signals into one resolution thread", () => {
    const rows = buildThreadSignalRows(fullReport()).slice(0, 2);
    const prompt = buildThreadSignalBatchResolutionPrompt(rows);
    assert.match(prompt, /Resolve these 2 signals/);
    assert.match(prompt, /1\. \*\*Self-report API\*\*/);
    assert.match(prompt, /2\. \*\*github\*\*/);
    assert.match(prompt, /Verify each fix/);
  });

  it("degrades a one-item batch to the single-signal prompt", () => {
    const [row] = buildThreadSignalRows(fullReport());
    assert.equal(buildThreadSignalBatchResolutionPrompt([row]), buildThreadSignalResolutionPrompt(row));
  });
});
