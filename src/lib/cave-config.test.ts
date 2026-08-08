// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const previousHome = process.env.HOME;
const tempHome = await mkdtemp(path.join(process.cwd(), ".cave-config-test-"));
process.env.HOME = tempHome;

const config = await import("./cave-config.ts");
const conversations = await import("./cave-conversations.ts");
const { DEFAULT_CHAT_AUTO_ARCHIVE_POLICY } = await import("./chat-auto-archive.ts");
const { sessionsListCache } = await import("./server/sessions-list-cache.ts");

try {
  assert.deepEqual(await config.loadState(), {
    sessionFamiliar: {},
    sessionTitles: {},
    sessionTitleAuto: {},
    sessionTitleManual: {},
    sessionTitleRevision: {},
    sessionArchived: {},
    sessionSacrificed: {},
    sessionKeep: {},
    sessionPinned: {},
    sessionArchiveExtendedUntil: {},
    sessionOwned: {},
    mergedPrAutoArchived: {},
    travel: {
      manualOffline: false,
      hubUnreachableSince: null,
      lastHubReachableAt: null,
      staleCache: false,
      localSubdaemonWakeRequestedAt: null,
      localBindHost: "127.0.0.1",
      offlineQueue: [],
    },
  });
  const reconciliationSource = await readFile(
    new URL("./server/cave-home-reconciliation.ts", import.meta.url),
    "utf8",
  );
  for (const mapName of ["sessionTitleAuto", "sessionTitleManual"]) {
    assert.match(
      reconciliationSource,
      new RegExp(`const STATE_MAPS[^;]+["']${mapName}["']`, "s"),
      `${mapName} must survive Cave-home state reconciliation`,
    );
    assert.match(
      reconciliationSource,
      new RegExp(`const DELETABLE_STATE_MAPS[^;]+["']${mapName}["']`, "s"),
      `${mapName} deletions must not be resurrected during state reconciliation`,
    );
  }
  assert.match(
    reconciliationSource,
    /function mergeSessionTitleRevisions[\s\S]+Math\.max[\s\S]+value\.sessionTitleRevision = titleRevisions\.value/,
    "title revisions must use their monotonic Cave-home reconciliation path",
  );

  await config.recordSessionFamiliar("session-1", "cody");
  assert.equal(await config.setSessionTitle("session-1", "  Renamed session  "), "Renamed session");

  const archivedAt = await config.archiveSessionLocal("session-1");
  assert.ok(Number.isFinite(Date.parse(archivedAt)));

  let state = await config.loadState();
  assert.deepEqual(state.sessionFamiliar, { "session-1": "cody" });
  assert.deepEqual(state.sessionTitles, { "session-1": "Renamed session" });
  assert.equal(state.sessionArchived["session-1"], archivedAt);
  assert.deepEqual(state.sessionSacrificed, {});

  await config.summonSessionLocal("session-1");
  state = await config.loadState();
  assert.deepEqual(state.sessionArchived, {});
  // Summon leaves a grace extension so the next auto-archive sweep skips the
  // freshly restored chat.
  const summonGraceUntil = state.sessionArchiveExtendedUntil["session-1"];
  assert.ok(Date.parse(summonGraceUntil) > Date.now(), "summon writes a future grace deadline");

  // Merged-PR auto-archive: archives + records the one-shot (session, PR) pair,
  // and summoning afterwards clears the archive but keeps the record.
  const mergedAt = await config.archiveSessionsForMergedPrs([
    { sessionId: "session-1", prKey: "OpenCoven/coven-cave#42" },
  ]);
  state = await config.loadState();
  assert.equal(state.sessionArchived["session-1"], mergedAt);
  assert.deepEqual(state.mergedPrAutoArchived, { "session-1": "OpenCoven/coven-cave#42" });
  await config.summonSessionLocal("session-1");
  state = await config.loadState();
  assert.deepEqual(state.sessionArchived, {});
  assert.deepEqual(state.mergedPrAutoArchived, { "session-1": "OpenCoven/coven-cave#42" });

  assert.equal(await config.setSessionTitle("session-1", "  "), null);
  state = await config.loadState();
  assert.deepEqual(state.sessionTitles, {});

  // Auto-rename provenance (chat-auto-rename): setSessionTitleAuto records that
  // this feature owns the title; a later manual setSessionTitle replaces that
  // with explicit manual ownership so the periodic rename backs off. Empty auto
  // titles are a no-op.
  assert.equal(await config.setSessionTitleAuto("session-3", "  Ship the widget "), "Ship the widget");
  state = await config.loadState();
  assert.deepEqual(state.sessionTitles["session-3"], "Ship the widget");
  assert.deepEqual(state.sessionTitleAuto["session-3"], "Ship the widget");
  assert.equal(await config.setSessionTitleAuto("session-3", "   "), null, "blank auto title is a no-op");
  await config.setSessionTitle("session-3", "My hand-picked name");
  state = await config.loadState();
  assert.equal(state.sessionTitles["session-3"], "My hand-picked name");
  assert.equal(state.sessionTitleManual["session-3"], true, "manual title ownership persisted");
  assert.equal(
    state.sessionTitleAuto["session-3"],
    undefined,
    "a manual rename clears auto-rename provenance",
  );
  await config.setSessionTitleAuto("session-3", "Automatic replacement");
  state = await config.loadState();
  assert.equal(
    state.sessionTitleManual["session-3"],
    undefined,
    "an automatic setter clears prior manual ownership",
  );
  assert.equal(state.sessionTitleAuto["session-3"], "Automatic replacement");
  // Clear session-3 so the whole-state assertion below still sees empty titles.
  await config.setSessionTitle("session-3", "");
  state = await config.loadState();
  assert.equal(
    state.sessionTitleManual["session-3"],
    undefined,
    "clearing a title also clears explicit manual ownership",
  );

  // ── setSessionTitleAutoIfOwned: atomic ownership-gated auto provenance ──────
  // Missing title → writes with provenance.
  const ownedResult = await config.setSessionTitleAutoIfOwned(
    "session-owned",
    "Auto title A",
    new Set(["Auto title A", "New chat"]),
  );
  assert.equal(ownedResult, "Auto title A", "absent title → writes and returns the title");
  state = await config.loadState();
  assert.equal(state.sessionTitles["session-owned"], "Auto title A", "title persisted");
  assert.equal(state.sessionTitleAuto["session-owned"], "Auto title A", "provenance persisted");

  // Prior auto title (still in autoDefaults) → can update.
  const ownedUpdate = await config.setSessionTitleAutoIfOwned(
    "session-owned",
    "Auto title B",
    new Set(["Auto title A", "Auto title B", "New chat"]),
  );
  assert.equal(ownedUpdate, "Auto title B", "auto-default title → updates to new title");
  state = await config.loadState();
  assert.equal(state.sessionTitleAuto["session-owned"], "Auto title B", "provenance updated");

  // Prior auto title recognized via provenance (not in autoDefaults) → can update.
  const provenanceUpdate = await config.setSessionTitleAutoIfOwned(
    "session-owned",
    "Auto title C",
    new Set(["New chat"]), // does NOT include "Auto title B"
  );
  assert.equal(provenanceUpdate, "Auto title C", "auto-provenance owned title → updates via provenance");
  state = await config.loadState();
  assert.equal(state.sessionTitleAuto["session-owned"], "Auto title C", "provenance updated");

  // Manual title present → preserved, returns null.
  await config.setSessionTitle("session-owned", "My manual title");
  state = await config.loadState();
  assert.equal(state.sessionTitleAuto["session-owned"], undefined, "manual set cleared provenance");
  const skipped = await config.setSessionTitleAutoIfOwned(
    "session-owned",
    "Auto title D",
    new Set(["New chat"]),
  );
  assert.equal(skipped, null, "manual title present → returns null (not overwritten)");
  state = await config.loadState();
  assert.equal(state.sessionTitles["session-owned"], "My manual title", "manual title preserved");
  assert.equal(state.sessionTitleAuto["session-owned"], undefined, "provenance still absent");

  // Explicit manual ownership wins even when the chosen text is also a known
  // automatic default. Text equality alone cannot recover authorship.
  await config.setSessionTitle("manual-new-chat", "New chat");
  assert.equal(
    await config.setSessionTitleAutoIfOwned(
      "manual-new-chat",
      "Generated replacement",
      new Set(["New chat"]),
    ),
    null,
    "a manually chosen New chat title is never claimed as an automatic default",
  );
  state = await config.loadState();
  assert.equal(state.sessionTitles["manual-new-chat"], "New chat");
  assert.equal(state.sessionTitleManual["manual-new-chat"], true);

  const promptDefault = "Fix parser";
  await config.setSessionTitle("manual-prompt-default", promptDefault);
  assert.equal(
    await config.setSessionTitleAutoIfOwned(
      "manual-prompt-default",
      "Generated replacement",
      new Set([promptDefault]),
    ),
    null,
    "a manually chosen prompt-default title remains manual",
  );
  state = await config.loadState();
  assert.equal(state.sessionTitles["manual-prompt-default"], promptDefault);
  assert.equal(state.sessionTitleManual["manual-prompt-default"], true);

  // Legacy state has neither explicit manual ownership nor auto provenance.
  // Known defaults remain claimable so existing sessions still migrate forward.
  const statePath = path.join(tempHome, ".coven", "cave", "state.json");
  const legacyState = JSON.parse(await readFile(statePath, "utf8"));
  legacyState.sessionTitles["legacy-default"] = "New chat";
  delete legacyState.sessionTitleAuto["legacy-default"];
  delete legacyState.sessionTitleManual["legacy-default"];
  await writeFile(statePath, JSON.stringify(legacyState));
  assert.equal(
    await config.setSessionTitleAutoIfOwned(
      "legacy-default",
      "Generated legacy replacement",
      new Set(["New chat"]),
    ),
    "Generated legacy replacement",
    "legacy known defaults without a manual marker remain claimable",
  );
  state = await config.loadState();
  assert.equal(state.sessionTitleAuto["legacy-default"], "Generated legacy replacement");
  assert.equal(state.sessionTitleManual["legacy-default"], undefined);

  const malformedManualState = JSON.parse(await readFile(statePath, "utf8"));
  malformedManualState.sessionTitleManual = {
    ...malformedManualState.sessionTitleManual,
    valid: true,
    falseMarker: false,
    stringMarker: "true",
  };
  await writeFile(statePath, JSON.stringify(malformedManualState));
  state = await config.loadState();
  assert.deepEqual(
    state.sessionTitleManual,
    {
      "manual-new-chat": true,
      "manual-prompt-default": true,
      "session-owned": true,
      valid: true,
    },
    "manual ownership state is normalized to explicit true markers",
  );
  await config.setSessionTitle("valid", "");

  // preserveManualTitles=false keeps the policy's explicit takeover behavior,
  // while still recording provenance in the same atomic state update.
  const forced = await config.setSessionTitleAutoIfOwned(
    "session-owned",
    "Policy-selected title",
    new Set(["New chat"]),
    false,
  );
  assert.equal(forced, "Policy-selected title", "preserve-off policy may replace a manual title");
  state = await config.loadState();
  assert.equal(state.sessionTitles["session-owned"], "Policy-selected title");
  assert.equal(state.sessionTitleManual["session-owned"], undefined);
  assert.equal(
    state.sessionTitleAuto["session-owned"],
    "Policy-selected title",
    "policy takeover records automatic provenance",
  );

  // An explicit sparkle takeover observes the current title before its write.
  // A manual rename that lands after that observation must win the atomic
  // compare-and-set rather than being overwritten by the generated title.
  const observedTakeoverRevision = config.sessionTitleRevision(state, "session-owned");
  await config.setSessionTitle("session-owned", "Newer manual title");
  const conflictedTakeover = await config.setSessionTitleAutoIfOwned(
    "session-owned",
    "Stale sparkle title",
    new Set(["New chat"]),
    false,
    observedTakeoverRevision,
    "Policy-selected title",
  );
  assert.equal(conflictedTakeover, null, "stale explicit takeover reports a conflict");
  state = await config.loadState();
  assert.equal(
    state.sessionTitles["session-owned"],
    "Newer manual title",
    "a manual rename after sparkle observation is preserved",
  );
  assert.equal(state.sessionTitleManual["session-owned"], true);
  assert.equal(state.sessionTitleAuto["session-owned"], undefined);

  // Ownership is part of the version: choosing the same visible text manually
  // after observation is still a conflict and must not be reclaimed.
  await config.setSessionTitleAuto("session-owned", "Same visible title");
  state = await config.loadState();
  const observedAutoRevision = config.sessionTitleRevision(state, "session-owned");
  await config.setSessionTitle("session-owned", "Same visible title");
  assert.equal(
    await config.setSessionTitleAutoIfOwned(
      "session-owned",
      "Stale same-text sparkle",
      new Set(["New chat"]),
      false,
      observedAutoRevision,
      "Same visible title",
    ),
    null,
    "an ownership-only change conflicts with an explicit takeover",
  );
  state = await config.loadState();
  assert.equal(state.sessionTitles["session-owned"], "Same visible title");
  assert.equal(state.sessionTitleManual["session-owned"], true);

  // Without an intervening change, the same version authorizes the explicit
  // takeover and preserves normal automatic provenance.
  const uncontestedRevision = config.sessionTitleRevision(state, "session-owned");
  assert.equal(
    await config.setSessionTitleAutoIfOwned(
      "session-owned",
      "Fresh sparkle title",
      new Set(["New chat"]),
      false,
      uncontestedRevision,
      "Same visible title",
    ),
    "Fresh sparkle title",
  );
  state = await config.loadState();
  assert.equal(state.sessionTitleAuto["session-owned"], "Fresh sparkle title");
  assert.equal(state.sessionTitleManual["session-owned"], undefined);

  const exhaustedState = JSON.parse(await readFile(statePath, "utf8"));
  exhaustedState.sessionTitleRevision["revision-exhausted"] = Number.MAX_SAFE_INTEGER;
  await writeFile(statePath, JSON.stringify(exhaustedState));
  await assert.rejects(
    config.setSessionTitle("revision-exhausted", "Must not wrap"),
    /session title revision exhausted/,
    "ownership revisions fail closed instead of wrapping to a prior value",
  );
  state = await config.loadState();
  assert.equal(state.sessionTitles["revision-exhausted"], undefined);
  assert.equal(
    state.sessionTitleRevision["revision-exhausted"],
    Number.MAX_SAFE_INTEGER,
  );

  // Trim/empty input is a no-op (returns null).
  assert.equal(
    await config.setSessionTitleAutoIfOwned("session-owned2", "   ", new Set(["New chat"])),
    null,
    "blank input is a no-op",
  );
  state = await config.loadState();
  assert.equal(state.sessionTitles["session-owned2"], undefined, "blank input leaves title unset");

  // Voice-chat creation exposes the conversation before initializing its
  // generated default. A manual rename that lands in that window must win,
  // while an uncontested initialization records automatic provenance.
  assert.equal(
    await config.initializeSessionTitleOwnership("voice-initialized", "New chat"),
    "New chat",
  );
  state = await config.loadState();
  assert.equal(state.sessionTitles["voice-initialized"], "New chat");
  assert.equal(state.sessionTitleAuto["voice-initialized"], "New chat");
  assert.equal(state.sessionTitleManual["voice-initialized"], undefined);

  await config.setSessionTitle("voice-concurrent-manual", "Call notes");
  assert.equal(
    await config.initializeSessionTitleOwnership("voice-concurrent-manual", "New chat"),
    null,
    "initialization observes and preserves a manual rename from the exposure window",
  );
  state = await config.loadState();
  assert.equal(
    state.sessionTitles["voice-concurrent-manual"],
    "Call notes",
    "a concurrent manual rename wins title initialization",
  );
  assert.equal(state.sessionTitleManual["voice-concurrent-manual"], true);
  assert.equal(
    state.sessionTitleAuto["voice-concurrent-manual"],
    undefined,
    "preserved manual titles never gain automatic provenance",
  );
  await config.setSessionTitle("voice-initialized", "");
  await config.setSessionTitle("voice-concurrent-manual", "");

  // ── Issue 4: Atomic auto ownership defaults ───────────────────────────────
  // Identical current title WITHOUT provenance must be preserved and must NOT
  // gain provenance. This guards against the caller including the proposed
  // title in autoDefaults and thereby misclassifying a concurrent human rename
  // as an auto-owned default. autoDefaults here contains only neutral defaults
  // ("New chat"), NOT the proposed title — which is the correct caller contract.
  {
    const statePath = path.join(tempHome, ".coven", "cave", "state.json");
    const rawState = JSON.parse(await readFile(statePath, "utf8"));
    rawState.sessionTitles["daemon-no-provenance"] = "Generate reply";
    // No sessionTitleAuto / sessionTitleManual entry: title came from daemon sync.
    await writeFile(statePath, JSON.stringify(rawState));

    const result = await config.setSessionTitleAutoIfOwned(
      "daemon-no-provenance",
      "Generate reply",
      new Set(["New chat"]),   // autoDefaults does NOT include the proposed title
    );
    assert.equal(result, null, "identical title without provenance: preserved, not reclaimed as auto");
    const stateAfter = await config.loadState();
    assert.equal(stateAfter.sessionTitleAuto["daemon-no-provenance"], undefined, "no provenance gained");
    assert.equal(stateAfter.sessionTitles["daemon-no-provenance"], "Generate reply", "title unchanged");

    // Clean up
    await config.setSessionTitle("daemon-no-provenance", "");
  }

  // Identical current title WITH matching sessionTitleAuto provenance must
  // remain auto-owned and updatable (same-text re-write is allowed).
  {
    const provenanceSession = "auto-provenance-same";
    await config.setSessionTitleAutoIfOwned(
      provenanceSession,
      "Generate reply",
      new Set(["New chat"]),
    );
    const firstState = await config.loadState();
    assert.equal(firstState.sessionTitleAuto[provenanceSession], "Generate reply", "provenance established");

    const result = await config.setSessionTitleAutoIfOwned(
      provenanceSession,
      "Generate reply",
      new Set(["New chat"]),
    );
    assert.equal(result, "Generate reply", "identical text with provenance: auto-owned, can update");
    const stateAfter = await config.loadState();
    assert.equal(stateAfter.sessionTitleAuto[provenanceSession], "Generate reply", "provenance preserved");

    // Clean up
    await config.setSessionTitle(provenanceSession, "");
  }

  // Clean up so the whole-state assertion below still sees empty titles.
  await config.setSessionTitle("session-owned", "");
  await config.setSessionTitle("manual-new-chat", "");
  await config.setSessionTitle("manual-prompt-default", "");
  await config.setSessionTitle("legacy-default", "");

  const sacrificedAt = await config.sacrificeSessionLocal("session-1");
  assert.ok(Number.isFinite(Date.parse(sacrificedAt)));

  // Keep / extend / batch auto-archive primitives.
  assert.equal(await config.setSessionKeepLocal("session-2", true), true);
  state = await config.loadState();
  assert.ok(state.sessionKeep["session-2"], "keep mark persisted");
  assert.equal(await config.setSessionKeepLocal("session-2", false), false);
  state = await config.loadState();
  assert.deepEqual(state.sessionKeep, {});

  const until = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(await config.extendSessionAutoArchiveLocal("session-2", until), until);
  state = await config.loadState();
  assert.equal(state.sessionArchiveExtendedUntil["session-2"], until);

  const swept = await config.autoArchiveSessionsLocal(["session-1", "session-2", "session-3"]);
  assert.deepEqual(
    [...swept.keys()].sort(),
    ["session-2", "session-3"],
    "batch archive skips sacrificed sessions and stamps the rest",
  );
  state = await config.loadState();
  assert.equal(state.sessionArchived["session-2"], swept.get("session-2"));
  const rearchive = await config.autoArchiveSessionsLocal(["session-2"]);
  assert.equal(rearchive.size, 0, "already-archived sessions are not restamped");
  await config.summonSessionLocal("session-2");
  await config.summonSessionLocal("session-3");

  // ── autoArchiveReflectedSessionLocal: atomic keep / skip guard ───────────────
  // Archives an eligible session and returns the archive timestamp.
  {
    const reflectionRequest = {
      trigger: "manual",
      policy: DEFAULT_CHAT_AUTO_ARCHIVE_POLICY,
      lastActivityAt: null,
    };
    const missingResult = await config.autoArchiveReflectedSessionLocal(
      "reflect-missing",
      reflectionRequest,
    );
    assert.equal(missingResult, null, "a reflected session missing from authoritative storage is a no-op");
    state = await config.loadState();
    assert.equal(
      state.sessionArchived["reflect-missing"],
      undefined,
      "a missing reflected session never creates a sessionArchived tombstone",
    );

    await conversations.saveConversation({
      sessionId: "reflect-eligible",
      familiarId: "nova",
      harness: "codex",
      title: "Existing reflected chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turns: [],
    });
    const eligibleCacheKey = "reflection:eligible";
    await sessionsListCache.get(eligibleCacheKey, async () => ({
      payload: { ok: true, sessions: [{ id: "reflect-eligible" }] },
    }));
    const reflectedAt = await config.autoArchiveReflectedSessionLocal(
      "reflect-eligible",
      reflectionRequest,
    );
    assert.ok(
      typeof reflectedAt === "string" && Number.isFinite(Date.parse(reflectedAt)),
      "eligible session is archived and a timestamp is returned",
    );
    let eligibleRecomputes = 0;
    const refreshedList = await sessionsListCache.get(eligibleCacheKey, async () => {
      eligibleRecomputes++;
      return { payload: { ok: true, sessions: [] } };
    });
    assert.equal(eligibleRecomputes, 1, "successful reflection archive invalidates the sessions-list cache");
    assert.deepEqual(
      refreshedList.payload.sessions,
      [],
      "an immediate refresh cannot serve the cached pre-archive session",
    );
    state = await config.loadState();
    assert.equal(state.sessionArchived["reflect-eligible"], reflectedAt, "archive timestamp persisted in state");

    // Idempotent: already-archived session must return null without restamping.
    const idempotentResult = await config.autoArchiveReflectedSessionLocal(
      "reflect-eligible",
      reflectionRequest,
    );
    assert.equal(idempotentResult, null, "already-archived session returns null");

    // Keep prevents archive — checked atomically inside the state write so a
    // concurrent setSessionKeepLocal cannot race with the archive decision.
    await conversations.saveConversation({
      sessionId: "reflect-kept",
      familiarId: "nova",
      harness: "codex",
      title: "Kept reflected chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turns: [],
    });
    await config.setSessionKeepLocal("reflect-kept", true);
    const keptCacheKey = "reflection:kept";
    await sessionsListCache.get(keptCacheKey, async () => ({
      payload: { ok: true, sessions: [{ id: "reflect-kept" }] },
    }));
    const keptResult = await config.autoArchiveReflectedSessionLocal(
      "reflect-kept",
      reflectionRequest,
    );
    assert.equal(keptResult, null, "kept session returns null — keep prevents archive");
    let keptRecomputes = 0;
    const keptList = await sessionsListCache.get(keptCacheKey, async () => {
      keptRecomputes++;
      return { payload: { ok: true, sessions: [] } };
    });
    assert.equal(keptRecomputes, 0, "skipped reflection archive leaves the sessions-list cache intact");
    assert.equal(keptList.payload.sessions[0]?.id, "reflect-kept");
    state = await config.loadState();
    assert.equal(
      state.sessionArchived["reflect-kept"],
      undefined,
      "sessionArchived not written when sessionKeep is set for the session",
    );
    await config.setSessionKeepLocal("reflect-kept", false);

    await conversations.saveConversation({
      sessionId: "reflect-race",
      familiarId: "nova",
      harness: "codex",
      title: "Concurrent keep race",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turns: [],
    });
    const [, racedArchive] = await Promise.all([
      config.setSessionKeepLocal("reflect-race", true),
      config.autoArchiveReflectedSessionLocal("reflect-race", reflectionRequest),
    ]);
    assert.equal(racedArchive, null, "a concurrent Keep queued before reflection archive wins");
    state = await config.loadState();
    assert.ok(state.sessionKeep["reflect-race"], "concurrent Keep is persisted");
    assert.equal(
      state.sessionArchived["reflect-race"],
      undefined,
      "reflection archive rechecks Keep in its atomic state mutation",
    );
    await config.setSessionKeepLocal("reflect-race", false);

    await conversations.saveConversation({
      sessionId: "reflect-policy-gated",
      familiarId: "nova",
      harness: "codex",
      title: "Policy-gated reflection",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turns: [],
    });
    for (const request of [
      {
        ...reflectionRequest,
        policy: { ...DEFAULT_CHAT_AUTO_ARCHIVE_POLICY, enabled: false },
      },
      {
        ...reflectionRequest,
        policy: { ...DEFAULT_CHAT_AUTO_ARCHIVE_POLICY, archiveOnReflection: false },
      },
      { ...reflectionRequest, trigger: "periodic" },
      {
        ...reflectionRequest,
        trigger: "auto",
        lastActivityAt: new Date().toISOString(),
      },
    ]) {
      assert.equal(
        await config.autoArchiveReflectedSessionLocal("reflect-policy-gated", request),
        null,
        "reflection mutator preserves policy, periodic, and auto-idle gates",
      );
    }
    state = await config.loadState();
    assert.equal(
      state.sessionArchived["reflect-policy-gated"],
      undefined,
      "policy-gated reflection attempts do not archive",
    );

    // Explicit sessionExists:false — simulates a session found nowhere (not
    // in local storage, not in daemon). A no-op: no archive, no tombstone.
    const neverExistsResult = await config.autoArchiveReflectedSessionLocal(
      "reflect-never-exists",
      {
        ...reflectionRequest,
        sessionExists: async () => false,
      },
    );
    assert.equal(neverExistsResult, null, "explicit sessionExists:false is a no-op");
    state = await config.loadState();
    assert.equal(
      state.sessionArchived["reflect-never-exists"],
      undefined,
      "explicit sessionExists:false never creates an archive tombstone",
    );

    // sessionExists throws — existence lookup failed (daemon unreachable, IO
    // error, etc). Must fail closed: no archive, no tombstone. The self-report
    // that triggered the archive is already committed; only the archive
    // side-effect is suppressed.
    const lookupFailureResult = await config.autoArchiveReflectedSessionLocal(
      "reflect-lookup-failure",
      {
        ...reflectionRequest,
        sessionExists: async () => { throw new Error("daemon unreachable"); },
      },
    );
    assert.equal(lookupFailureResult, null, "sessionExists throw is an archive no-op (fail-closed)");
    state = await config.loadState();
    assert.equal(
      state.sessionArchived["reflect-lookup-failure"],
      undefined,
      "lookup failure never creates an archive tombstone",
    );

    // A daemon-only session has no local conversation file. Its authoritative
    // existence callback may load Cave config while resolving through the
    // daemon; invoking that callback under updateState's reconciliation lock
    // deadlocks because the lock is non-reentrant.
    let daemonExistenceChecks = 0;
    let deadlockTimer;
    const daemonOnlyArchive = config.autoArchiveReflectedSessionLocal(
      "reflect-daemon-only",
      {
        ...reflectionRequest,
        sessionExists: async () => {
          daemonExistenceChecks++;
          await config.loadConfig();
          return true;
        },
      },
    );
    const daemonOnlyResult = await Promise.race([
      daemonOnlyArchive,
      new Promise((_, reject) => {
        deadlockTimer = setTimeout(
          () => reject(new Error("daemon-only reflection archive deadlocked")),
          1_000,
        );
      }),
    ]).finally(() => clearTimeout(deadlockTimer));
    assert.equal(daemonExistenceChecks, 1, "daemon existence is resolved once before the state transaction");
    assert.ok(
      typeof daemonOnlyResult === "string" && Number.isFinite(Date.parse(daemonOnlyResult)),
      "daemon-only reflected session archives without a local conversation file",
    );
    state = await config.loadState();
    assert.equal(
      state.sessionArchived["reflect-daemon-only"],
      daemonOnlyResult,
      "daemon-only archive is committed after the external lookup completes",
    );
    await config.summonSessionLocal("reflect-daemon-only");

    // Sacrificed session (session-1 is already sacrificed above) skips.
    const sacrificedResult = await config.autoArchiveReflectedSessionLocal(
      "session-1",
      reflectionRequest,
    );
    assert.equal(sacrificedResult, null, "sacrificed session returns null");

    // Clean up: summon removes reflect-eligible from sessionArchived.
    // sessionArchiveExtendedUntil["reflect-eligible"] is deleted before the
    // final deepEqual assertion below, so no residue there either.
    await config.summonSessionLocal("reflect-eligible");
  }

  await config.recordTravelHubReachability(false, new Date("2026-06-30T10:00:00.000Z"));
  const manualDuringOutageAt = await config.setManualTravelMode(true, new Date("2026-06-30T10:00:05.000Z"));
  assert.equal(manualDuringOutageAt, "2026-06-30T10:00:05.000Z");

  state = await config.loadState();
  assert.equal(state.travel.manualOffline, true);
  assert.equal(state.travel.hubUnreachableSince, "2026-06-30T10:00:00.000Z");
  assert.equal(state.travel.staleCache, true);
  assert.equal(state.travel.localSubdaemonWakeRequestedAt, "2026-06-30T10:00:05.000Z");

  await config.setManualTravelMode(false, new Date("2026-06-30T10:00:06.000Z"));
  state = await config.loadState();
  assert.equal(state.travel.manualOffline, false);
  assert.equal(state.travel.hubUnreachableSince, "2026-06-30T10:00:00.000Z");
  assert.equal(state.travel.staleCache, true);
  assert.equal(
    state.travel.localSubdaemonWakeRequestedAt,
    null,
    "manual wake stamps must not survive back into automatic outage handling",
  );
  await config.recordTravelHubReachability(true, new Date("2026-06-30T10:01:00.000Z"));

  const raw = await readFile(path.join(tempHome, ".coven", "cave", "state.json"), "utf8");
  const rawState = JSON.parse(raw);
  // Summon grace timestamps vary per run; the shape checks above cover them.
  delete rawState.sessionArchiveExtendedUntil;
  assert.ok(
    Object.values(rawState.sessionTitleRevision).every(
      (revision) => Number.isSafeInteger(revision) && revision > 0,
    ),
    "persisted title revisions are positive safe integers",
  );
  delete rawState.sessionTitleRevision;
  assert.deepEqual(rawState, {
    sessionFamiliar: { "session-1": "cody" },
    sessionTitles: {},
    sessionTitleAuto: {},
    sessionTitleManual: {},
    sessionArchived: {},
    sessionSacrificed: { "session-1": sacrificedAt },
    sessionKeep: {},
    sessionPinned: {},
    sessionOwned: {},
    mergedPrAutoArchived: { "session-1": "OpenCoven/coven-cave#42" },
    travel: {
      manualOffline: false,
      hubUnreachableSince: null,
      lastHubReachableAt: "2026-06-30T10:01:00.000Z",
      staleCache: false,
      localSubdaemonWakeRequestedAt: null,
      localBindHost: "127.0.0.1",
      offlineQueue: [],
    },
  });

  const installedAt = await config.installMarketplacePlugin("github", "0.1.0", "catalog");
  assert.ok(Number.isFinite(Date.parse(installedAt)));

  let cfg = await config.loadConfig();
  assert.deepEqual(cfg.multiHost, {
    mode: "local",
    hubUrl: "",
    executorUrls: [],
  });
  assert.equal(cfg.marketplace.installed.github.version, "0.1.0");
  assert.equal(cfg.marketplace.installed.github.source, "catalog");
  assert.equal(cfg.marketplace.installed.github.installedAt, installedAt);
  assert.equal(cfg.marketplace.installed.github.runtime, undefined, "legacy install entries remain valid");

  const craftVerifiedAt = "2026-07-09T23:30:00.000Z";
  await config.installMarketplacePlugin("seekers-lens", "0.1.0", "catalog", {
    runtime: "codex",
    verifiedAt: craftVerifiedAt,
    craftVersion: "0.1.0",
  });
  cfg = await config.loadConfig();
  assert.equal(cfg.marketplace.installed["seekers-lens"].runtime, "codex");
  assert.equal(cfg.marketplace.installed["seekers-lens"].verifiedAt, craftVerifiedAt);
  assert.equal(cfg.marketplace.installed["seekers-lens"].craftVersion, "0.1.0");

  await config.uninstallMarketplacePlugin("github");
  cfg = await config.loadConfig();
  assert.deepEqual(Object.keys(cfg.marketplace.installed), ["seekers-lens"]);
  await config.uninstallMarketplacePlugin("seekers-lens");

  const vaultSeededAt = await config.recordKnowledgePackSeed("worldbuilding", { target: "vault" });
  assert.ok(Number.isFinite(Date.parse(vaultSeededAt)));
  await config.recordKnowledgePackSeed("worldbuilding", { target: "project", root: "/story" });
  await config.recordKnowledgePackSeed("worldbuilding", { target: "project", root: "/story" });
  cfg = await config.loadConfig();
  assert.equal(cfg.marketplace.knowledgePacks.length, 2, "knowledge pack seed records dedupe by id, target, and root");
  assert.ok(cfg.marketplace.knowledgePacks.some((entry) => entry.target === "vault"));
  assert.ok(cfg.marketplace.knowledgePacks.some((entry) => entry.target === "project" && entry.root === "/story"));

  await config.saveConfig({
    multiHost: {
      mode: "hub",
      hubUrl: "  server.tailnet:8787  ",
      executorUrls: ["  macbook.tailnet:8787  ", "", "macbook.tailnet:8787", "linux.tailnet:8787"],
    },
  });
  {
    let computes = 0;
    const compute = async () => ({
      payload: { ok: true, sessions: [], error: `compute-${++computes}` },
    });
    const first = await sessionsListCache.get("test:save-config-invalidation", compute);
    const cached = await sessionsListCache.get("test:save-config-invalidation", compute);
    assert.equal(first.payload.error, "compute-1");
    assert.equal(cached.payload.error, "compute-1");

    await config.saveConfig({
      addons: { github: true },
    });

    const recomputed = await sessionsListCache.get("test:save-config-invalidation", compute);
    assert.equal(
      recomputed.payload.error,
      "compute-2",
      "saveConfig invalidates the warmed sessions cache after persistence",
    );
    sessionsListCache.clear();
  }
  cfg = await config.loadConfig();
  assert.deepEqual(cfg.multiHost, {
    mode: "hub",
    hubUrl: "server.tailnet:8787",
    executorUrls: ["macbook.tailnet:8787", "linux.tailnet:8787"],
  });

  await config.saveConfig({
    familiars: {
      nova: {
        harness: "claude",
        model: "anthropic/claude-sonnet-4-6",
        voiceProvider: "openai",
        autoSelfReport: true,
      },
    },
  });
  await config.saveConfig({
    familiars: {
      nova: {
        display_name: "Nova Prime",
        role: "review familiar",
      },
    },
  });
  cfg = await config.loadConfig();
  assert.deepEqual(cfg.familiars.nova, {
    harness: "claude",
    model: "anthropic/claude-sonnet-4-6",
    voiceProvider: "openai",
    autoSelfReport: true,
    display_name: "Nova Prime",
    role: "review familiar",
  });

  await config.saveConfig({ familiars: { nova: { model: "" } } });
  cfg = await config.loadConfig();
  assert.equal(
    cfg.familiars.nova.model,
    "",
    "clearing a familiar model persists an explicit runtime-default sentinel",
  );
  assert.equal(
    config.bindingFor(cfg, "nova").model,
    "",
    "binding resolution must preserve the explicit runtime-default sentinel",
  );
  await config.saveConfig({ familiars: { nova: { model: null } } });
  cfg = await config.loadConfig();
  assert.equal(
    cfg.familiars.nova.model,
    "",
    "a null model patch must preserve the runtime-default sentinel through config merges",
  );
  assert.equal(config.bindingFor(cfg, "nova").model, "");
  await config.saveConfig({ familiars: { nova: { model: "anthropic/claude-sonnet-4-6" } } });
  cfg = await config.loadConfig();

  const novaBinding = config.bindingFor(cfg, "nova");
  assert.equal(novaBinding.display_name, "Nova Prime");
  assert.equal(novaBinding.role, "review familiar");
  assert.equal(novaBinding.autoSelfReport, true);
  assert.equal(config.bindingFor(cfg, "missing").autoSelfReport, false);
  assert.equal(config.bindingFor(cfg, "missing").xResearchEnabled, false);
  assert.equal(config.bindingFor(cfg, "missing").xPublishEnabled, false);

  const modelOwnershipConfig = {
    ...cfg,
    familiars: {
      ...cfg.familiars,
      grokDefault: { harness: "grok" },
      grokExplicit: { harness: "grok", model: "xai/grok-4" },
      claudeDefault: { harness: "claude" },
    },
  };
  assert.equal(
    config.bindingFor(modelOwnershipConfig, "grokDefault").model,
    "",
    "a runtime-owned default must remain absent during binding resolution",
  );
  assert.equal(
    config.bindingFor(modelOwnershipConfig, "grokExplicit").model,
    "xai/grok-4",
    "an explicit model remains authoritative for a runtime-owned default",
  );
  assert.equal(
    config.bindingFor(modelOwnershipConfig, "claudeDefault").model,
    cfg.defaults.model,
    "a Cave-owned runtime still inherits the global default model",
  );

  await config.saveConfig({
    defaults: {
      xResearchEnabled: true,
      xPublishEnabled: true,
    },
    familiars: {
      nova: { xResearchEnabled: true },
      wren: { xPublishEnabled: true },
    },
  });
  cfg = await config.loadConfig();
  assert.equal(
    config.bindingFor(cfg, "missing").xResearchEnabled,
    false,
    "app defaults must never grant X research",
  );
  assert.equal(
    config.bindingFor(cfg, "missing").xPublishEnabled,
    false,
    "app defaults must never grant X publishing",
  );
  assert.equal(config.bindingFor(cfg, "nova").xResearchEnabled, true);
  assert.equal(config.bindingFor(cfg, "nova").xPublishEnabled, false);
  assert.equal(config.bindingFor(cfg, "wren").xResearchEnabled, false);
  assert.equal(config.bindingFor(cfg, "wren").xPublishEnabled, true);

  await config.saveConfig({
    familiars: {
      nova: { xResearchEnabled: null, xPublishEnabled: true },
    },
  });
  cfg = await config.loadConfig();
  assert.equal(config.bindingFor(cfg, "nova").xResearchEnabled, false);
  assert.equal(config.bindingFor(cfg, "nova").xPublishEnabled, true);

  await config.saveConfig({
    defaults: {
      runtime: { kind: "ssh", host: "build-box", cwd: "/srv/work", command: "coven" },
    },
    familiars: {
      local: { runtime: { kind: "local" } },
    },
  });
  cfg = await config.loadConfig();
  assert.deepEqual(
    cfg.familiars.local.runtime,
    { kind: "local" },
    "an explicit local runtime must survive config persistence",
  );
  const explicitLocalBinding = config.bindingFor(cfg, "local");
  assert.deepEqual(
    explicitLocalBinding.runtime,
    { kind: "local" },
    "an explicit local familiar binding must override a workspace SSH default",
  );
  assert.deepEqual(
    config.bindingFor(cfg, "missing").runtime,
    { kind: "ssh", host: "build-box", cwd: "/srv/work", command: "coven" },
    "familiars without an explicit runtime must continue to inherit the workspace default",
  );

  await config.saveConfig({
    familiars: {
      hermesResearch: {
        harness: "hermes",
        hermesProfile: { id: "research", homePath: "/home/cave/.hermes/profiles/research" },
      },
    },
  });
  cfg = await config.loadConfig();
  assert.deepEqual(
    config.bindingFor(cfg, "hermesResearch").hermesProfile,
    { id: "research", homePath: "/home/cave/.hermes/profiles/research" },
    "an explicit Hermes profile binding survives config persistence and resolution",
  );
  assert.equal(
    config.bindingFor({
      defaults: {
        harness: "hermes",
        model: "hermes",
        hermesProfile: { id: "research", homePath: "/home/cave/.hermes/profiles/research" },
      },
      familiars: { bareHermes: { harness: "hermes" } },
    }, "bareHermes").hermesProfile,
    undefined,
    "bare Hermes never inherits a profile from global defaults",
  );
  await assert.rejects(
    () => config.saveConfig({ familiars: { invalidHermes: { hermesProfile: { id: "../escape", homePath: "/tmp/escape" } } } }),
    /Invalid Hermes profile binding/,
    "saveConfig rejects invalid profile bindings before persistence",
  );
  assert.equal(
    config.bindingFor({
      defaults: { harness: "codex", model: "openai/gpt-5.6-sol" },
      familiars: {
        malformedHermes: {
          harness: "hermes",
          hermesProfile: { id: "research", homePath: "relative/profile-home" },
        },
      },
    }, "malformedHermes").hasInvalidHermesProfileBinding,
    true,
    "a malformed persisted Hermes profile binding remains visible to launch routes instead of degrading to bare Hermes",
  );

  await config.saveConfig({
    familiars: {
      nova: {
        voiceProvider: null,
      },
    },
  });
  cfg = await config.loadConfig();
  assert.deepEqual(cfg.familiars.nova, {
    harness: "claude",
    model: "anthropic/claude-sonnet-4-6",
    autoSelfReport: true,
    display_name: "Nova Prime",
    role: "review familiar",
    xPublishEnabled: true,
  });

  await config.saveConfig({ familiars: { nova: null, local: null } });
  cfg = await config.loadConfig();
  assert.equal(cfg.familiars.nova, undefined);
} finally {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  await rm(tempHome, { recursive: true, force: true });
}

// ── Config write-race mutex (2026-07-03 settings audit) ──────────────────────
// All cave-config.json writers serialize their read-modify-write through
// one in-process lock, mirroring the state mutex — otherwise concurrent PATCHes
// clobber each other's fields.
{
  const src = fs.readFileSync(new URL("./cave-config.ts", import.meta.url), "utf8");
  assert.match(src, /async function withConfigLock<T>/, "cave-config has a config mutex helper");
  assert.equal((src.match(/return withConfigLock\(async \(\) => \{/g) || []).length, 5, "all config writers run under the lock");
}

// ── Omnigent enable toggle (explicit opt-in) ─────────────────────────────────
// The fleet master switch defaults OFF: pre-toggle configs (no `enabled`
// field) and non-boolean input normalize to false; only literal true persists.
// The Settings → Daemon toggle PATCHes exactly this field.
{
  assert.equal(config.normalizeOmnigentConfig(undefined).enabled, false, "absent omnigent config → fleet off");
  assert.equal(config.normalizeOmnigentConfig({}).enabled, false, "missing enabled field → fleet off");
  assert.equal(config.normalizeOmnigentConfig({ enabled: "yes" }).enabled, false, "non-boolean enabled → fleet off");
  assert.equal(config.normalizeOmnigentConfig({ enabled: true }).enabled, true, "explicit true persists");
}
