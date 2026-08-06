// @ts-nocheck
import assert from "node:assert/strict";
import { filterVisibleChatSessions } from "./chat-projects.ts";
import {
  localConversationSessionRows,
  mergeSessionRows,
} from "./session-list-merge.ts";
import { NO_CHAT_ATTENTION } from "./chat-attention.ts";

const state = {
  sessionFamiliar: { "local-1": "charm", "daemon-1": "cody" },
  sessionTitles: { "local-1": "Recovered local chat" },
  sessionArchived: {},
  sessionSacrificed: {},
};

const localConversation = {
  sessionId: "local-1",
  familiarId: "nova",
  harness: "codex",
    title: "Saved title",
    createdAt: "2026-06-08T20:00:00.000Z",
    updatedAt: "2026-06-08T20:05:00.000Z",
    initiator: { kind: "human", label: "Cave user", channel: "cave" },
  };

const recovered = localConversationSessionRows([localConversation], state, false);

assert.equal(recovered.length, 1);
assert.deepEqual(
  recovered[0],
  {
    id: "local-1",
    project_root: "",
    harness: "codex",
    title: "Recovered local chat",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-06-08T20:00:00.000Z",
    updated_at: "2026-06-08T20:05:00.000Z",
    attention: NO_CHAT_ATTENTION,
    attentionAfterOperationId: null,
    familiarId: "charm",
    origin: "chat",
    hasLocalConversation: true,
    initiator: { kind: "human", label: "Cave user", channel: "cave" },
  },
  "saved Cave conversations should become complete session rows when the daemon loses them",
);

const merged = mergeSessionRows({
  daemonSessions: [
    {
      id: "daemon-1",
      project_root: "/repo",
      harness: "codex",
      title: "Daemon chat",
      status: "running",
      exit_code: null,
      archived_at: null,
      created_at: "2026-06-08T19:00:00.000Z",
      updated_at: "2026-06-08T19:05:00.000Z",
      initiator: { kind: "familiar", label: "Cody", agentId: "cody" },
    },
  ],
  localConversations: [localConversation],
  state,
  includeArchived: false,
});

assert.deepEqual(
  merged.map((s) => s.id),
  ["local-1", "daemon-1"],
  "session list should include local-only saved chats alongside daemon sessions",
);

assert.deepEqual(
  merged.find((s) => s.id === "daemon-1")?.initiator,
  { kind: "familiar", label: "Cody", agentId: "cody" },
  "daemon sessions should preserve sanitized initiator provenance when present",
);
assert.equal(
  merged.find((s) => s.id === "local-1")?.hasLocalConversation,
  true,
  "local-only saved chats should mark that Cave has a local transcript",
);
assert.equal(
  merged.find((s) => s.id === "daemon-1")?.hasLocalConversation,
  undefined,
  "daemon-only sessions without a matching local transcript should not gain local provenance",
);
assert.equal(
  merged.find((s) => s.id === "daemon-1")?.attentionAfterOperationId,
  null,
  "daemon-only rows cannot fabricate a Cave send operation",
);

// Attention derivation (cave-zs85n task 4): local transcript evidence is
// stable summary data; mergeSessionRows projects the time-sensitive attention
// state once per list compute, independent of daemon updated_at churn.
{
  const realNow = Date.now;
  Date.now = () => Date.parse("2026-08-04T20:00:00.000Z");
  try {
    const bareState = {
      sessionFamiliar: {},
      sessionTitles: {},
      sessionArchived: {},
      sessionSacrificed: {},
    };
    const localAttention = {
      sessionId: "attention-local",
      familiarId: "nova",
      harness: "claude",
      title: "Attention local",
      runtime: "local:/repo",
      status: "completed",
      exitCode: 0,
      updatedAt: "2026-08-04T19:59:00.000Z",
      attentionEvidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-04T18:00:00.000Z",
        },
        latestUserTurnAt: "2026-08-04T17:00:00.000Z",
        attentionAfterOperationId: "run-attention-local",
        attentionOperationLineage: ["run-attention-prior", "run-attention-local"],
        request: {
          sessionId: "attention-local",
          turnId: "assistant-turn",
          requestedAt: "2026-08-04T18:00:00.000Z",
          reason: "approval",
        },
      },
    };

    const [localOnlyRow] = localConversationSessionRows([localAttention], bareState, false);
    assert.deepEqual(
      localOnlyRow?.attention,
      {
        state: "awaiting-human",
        since: "2026-08-04T18:00:00.000Z",
        reason: "approval",
      },
      "local-only rows derive attention from cached transcript evidence",
    );
    assert.equal(
      localOnlyRow?.attentionAfterOperationId,
      "run-attention-local",
      "local-only rows project the active path's stable human send identity",
    );
    assert.deepEqual(
      localOnlyRow?.attentionOperationLineage,
      ["run-attention-prior", "run-attention-local"],
      "local-only rows preserve bounded server-authored ancestry",
    );

    const mergedAttention = mergeSessionRows({
      daemonSessions: [
        {
          id: "attention-local",
          project_root: "/repo",
          harness: "claude",
          title: "Attention local",
          status: "completed",
          exit_code: 0,
          archived_at: null,
          created_at: "2026-08-04T17:00:00.000Z",
          updated_at: "2026-08-04T18:30:00.000Z",
        },
      ],
      localConversations: [localAttention],
      state: bareState,
      includeArchived: false,
    });
    assert.deepEqual(
      mergedAttention[0]?.attention,
      localOnlyRow?.attention,
      "daemon-backed rows reuse the same local evidence projection",
    );
    assert.equal(
      mergedAttention[0]?.attentionAfterOperationId,
      "run-attention-local",
      "healthy daemon-backed rows retain Cave's causal send evidence",
    );
    assert.deepEqual(
      mergedAttention[0]?.attentionOperationLineage,
      ["run-attention-prior", "run-attention-local"],
      "healthy daemon-backed rows retain Cave's causal ancestry",
    );

    const reopenedAttention = mergeSessionRows({
      daemonSessions: [
        {
          id: "attention-local",
          project_root: "/repo",
          harness: "claude",
          title: "Attention local",
          status: "completed",
          exit_code: 0,
          archived_at: null,
          created_at: "2026-08-04T17:00:00.000Z",
          updated_at: "2026-08-05T03:00:00.000Z",
        },
      ],
      localConversations: [localAttention],
      state: bareState,
      includeArchived: false,
    });
    assert.equal(
      reopenedAttention[0]?.attention.since,
      "2026-08-04T18:00:00.000Z",
      "daemon updated_at churn does not rewrite attention provenance",
    );

    const runningRow = mergeSessionRows({
      daemonSessions: [
        {
          id: "attention-running",
          project_root: "/repo",
          harness: "claude",
          title: "Attention running",
          status: "running",
          exit_code: null,
          archived_at: null,
          created_at: "2026-08-04T17:00:00.000Z",
          updated_at: "2026-08-04T19:00:00.000Z",
        },
      ],
      localConversations: [
        {
          ...localAttention,
          sessionId: "attention-running",
          updatedAt: "2026-08-04T18:00:00.000Z",
          attentionEvidence: localAttention.attentionEvidence,
        },
      ],
      state: bareState,
      includeArchived: false,
    });
    assert.deepEqual(
      runningRow[0]?.attention,
      NO_CHAT_ATTENTION,
      "canonical active sessions never surface chat attention",
    );

    const waitingRow = mergeSessionRows({
      daemonSessions: [
        {
          id: "attention-waiting",
          project_root: "/repo",
          harness: "claude",
          title: "Attention waiting",
          status: "waiting",
          exit_code: null,
          archived_at: null,
          created_at: "2026-08-04T17:00:00.000Z",
          updated_at: "2026-08-04T19:00:00.000Z",
        },
      ],
      localConversations: [
        {
          ...localAttention,
          sessionId: "attention-waiting",
          updatedAt: "2026-08-04T18:00:00.000Z",
          attentionEvidence: localAttention.attentionEvidence,
        },
      ],
      state: bareState,
      includeArchived: false,
    });
    assert.deepEqual(
      waitingRow[0]?.attention,
      NO_CHAT_ATTENTION,
      "waiting sessions stay attention-free even with explicit evidence",
    );

    const [archivedRow] = localConversationSessionRows(
      [
        {
          ...localAttention,
          sessionId: "attention-archived",
        },
      ],
      {
        ...bareState,
        sessionArchived: { "attention-archived": "2026-08-04T19:30:00.000Z" },
      },
      true,
    );
    assert.deepEqual(
      archivedRow?.attention,
      NO_CHAT_ATTENTION,
      "archived rows discard attention state at projection time",
    );
    const [archivedStatusRow] = localConversationSessionRows(
      [
        {
          ...localAttention,
          sessionId: "attention-archived-status",
          status: "archived",
        },
      ],
      bareState,
      false,
    );
    assert.equal(
      archivedStatusRow?.archived_at,
      null,
      "local archived status does not fabricate archived_at when none was stamped",
    );
    assert.deepEqual(
      archivedStatusRow?.attention,
      NO_CHAT_ATTENTION,
      "local archived status suppresses attention even before archived_at is stamped",
    );

    const daemonOnly = mergeSessionRows({
      daemonSessions: [
        {
          id: "daemon-only-attention",
          project_root: "/repo",
          harness: "claude",
          title: "Daemon only",
          status: "completed",
          exit_code: 0,
          archived_at: null,
          created_at: "2026-08-04T17:00:00.000Z",
          updated_at: "2026-08-04T19:00:00.000Z",
        },
      ],
      localConversations: [],
      state: bareState,
      includeArchived: false,
    });
    assert.deepEqual(
      daemonOnly[0]?.attention,
      NO_CHAT_ATTENTION,
      "daemon-only rows have no local evidence to project",
    );

    const [staleRequestRow] = mergeSessionRows({
      daemonSessions: [],
      localConversations: [
        {
          sessionId: "stale-request",
          familiarId: "nova",
          harness: "claude",
          title: "Stale request fallback",
          status: "completed",
          exitCode: 0,
          updatedAt: "2026-08-03T18:00:00.000Z",
          attentionEvidence: {
            latestCompletedTurn: {
              role: "assistant",
              at: "2026-08-03T18:00:00.000Z",
            },
            latestUserTurnAt: "2026-08-03T17:00:00.000Z",
            request: {
              sessionId: "stale-request",
              turnId: "assistant-request",
              requestedAt: "2026-08-03T16:00:00.000Z",
              reason: "input",
            },
          },
        },
      ],
      state: bareState,
      includeArchived: false,
    });
    assert.deepEqual(
      staleRequestRow?.attention,
      {
        state: "left-hanging",
        since: "2026-08-03T18:00:00.000Z",
        reason: null,
      },
      "a newer human reply resolves the old request and allows aged assistant fallback",
    );

    const malformedRows = mergeSessionRows({
      daemonSessions: [],
      localConversations: [
        {
          sessionId: "attention-valid",
          familiarId: "nova",
          harness: "claude",
          title: "Valid attention",
          status: "completed",
          exitCode: 0,
          updatedAt: "2026-08-04T18:00:00.000Z",
          attentionEvidence: localAttention.attentionEvidence,
        },
        {
          sessionId: "attention-malformed",
          familiarId: "nova",
          harness: "claude",
          title: "Malformed attention",
          status: "completed",
          exitCode: 0,
          updatedAt: "2026-08-04T18:01:00.000Z",
          attentionEvidence: {
            latestCompletedTurn: {
              role: "assistant",
              at: "not-a-date",
            },
            latestUserTurnAt: null,
            request: {
              sessionId: "attention-malformed",
              turnId: "assistant-turn",
              requestedAt: "2026-08-04T18:00:00.000Z",
              reason: "approval",
            },
          },
        },
      ],
      state: bareState,
      includeArchived: false,
    });
    const malformedById = new Map(malformedRows.map((row) => [row.id, row]));
    assert.deepEqual(
      malformedById.get("attention-valid")?.attention,
      {
        state: "awaiting-human",
        since: "2026-08-04T18:00:00.000Z",
        reason: "approval",
      },
      "valid rows keep their derived attention when malformed siblings are present",
    );
    assert.deepEqual(
      malformedById.get("attention-malformed")?.attention,
      NO_CHAT_ATTENTION,
      "malformed evidence fails quiet without dropping the row",
    );
  } finally {
    Date.now = realNow;
  }
}

const matchedMerged = mergeSessionRows({
  daemonSessions: [
    {
      id: "matched-1",
      project_root: "/repo",
      harness: "codex",
      title: "Matched chat",
      status: "orphaned",
      exit_code: null,
      archived_at: null,
      created_at: "2026-06-08T18:00:00.000Z",
      updated_at: "2026-06-08T18:10:00.000Z",
      initiator: { kind: "familiar", label: "Cody", agentId: "cody" },
    },
  ],
  localConversations: [
    {
      sessionId: "matched-1",
      familiarId: "nova",
      harness: "codex",
      title: "Matched chat",
      updatedAt: "2026-06-08T18:15:00.000Z",
      status: "completed",
      exitCode: 0,
    },
  ],
  state,
  includeArchived: false,
});

assert.equal(
  matchedMerged.find((s) => s.id === "matched-1")?.hasLocalConversation,
  true,
  "matched daemon/local sessions should record that Cave has a local transcript",
);
assert.equal(
  matchedMerged.find((s) => s.id === "matched-1")?.status,
  "orphaned",
  "matched daemon rows should keep an interrupted daemon status when the local transcript updated more recently",
);
assert.equal(
  matchedMerged.find((s) => s.id === "matched-1")?.familiarId,
  "nova",
  "matched daemon rows should fall back to the local conversation familiar when state has no mapping",
);
assert.deepEqual(
  filterVisibleChatSessions(matchedMerged, "nova").map((s) => s.id),
  ["matched-1"],
  "familiar-scoped chat filters should retain the recovered transcript-backed row",
);

const validRootArchived = mergeSessionRows({
  daemonSessions: [
    {
      id: "valid-root-archived",
      project_root: "/repo",
      harness: "codex",
      title: "Archived chat",
      status: "archived",
      exit_code: 143,
      archived_at: null,
      created_at: "2026-06-08T18:00:00.000Z",
      updated_at: "2026-06-08T18:10:00.000Z",
    },
  ],
  localConversations: [
    {
      sessionId: "valid-root-archived",
      familiarId: "nova",
      harness: "codex",
      title: "Archived chat",
      updatedAt: "2026-06-08T18:15:00.000Z",
      status: "completed",
      exitCode: 0,
      attentionEvidence: {
        latestCompletedTurn: { role: "assistant", at: "2026-06-08T18:10:00.000Z" },
        latestUserTurnAt: null,
        request: {
          sessionId: "valid-root-archived",
          turnId: "archived-assistant",
          requestedAt: "2026-06-08T18:05:00.000Z",
          reason: "decision",
        },
      },
    },
  ],
  state,
  includeArchived: false,
  isValidDaemonProjectRoot: (root) => root === "/repo",
});

const invalidRootInterrupted = mergeSessionRows({
  daemonSessions: [
    {
      id: "invalid-root-interrupted",
      project_root: "/invalid",
      harness: "codex",
      title: "Interrupted chat",
      status: "killed",
      exit_code: 137,
      archived_at: null,
      created_at: "2026-06-08T18:00:00.000Z",
      updated_at: "2026-06-08T18:10:00.000Z",
      initiator: { kind: "familiar", label: "Cody", agentId: "cody" },
    },
  ],
  localConversations: [
    {
      sessionId: "invalid-root-interrupted",
      familiarId: "nova",
      harness: "codex",
      runtime: "local:/repo",
      title: "Interrupted chat",
      updatedAt: "2026-06-08T18:15:00.000Z",
      status: "completed",
      exitCode: 0,
      origin: "chat",
      // Regression (cave-zs85n task 4 follow-up): a project-root mismatch
      // means the daemon can no longer vouch for this session's cwd/branch
      // identity, but the local transcript evidence is still usable — a
      // killed/orphaned/stopped recovery derives normalized attention same
      // as any other row (only an archived or actively-running recovery
      // suppresses; see the loop below and invalidRootArchivedMatched).
      attentionEvidence: {
        latestCompletedTurn: { role: "assistant", at: "2026-06-08T18:10:00.000Z" },
        latestUserTurnAt: null,
        request: {
          sessionId: "invalid-root-interrupted",
          turnId: "interrupted-assistant",
          requestedAt: "2026-06-08T18:05:00.000Z",
          reason: "input",
        },
      },
    },
  ],
  state,
  includeArchived: false,
  isValidDaemonProjectRoot: (root) => root === "/repo",
  projectRootForCwd: (cwd) => (cwd === "/repo" ? "/repo" : null),
});

assert.equal(invalidRootInterrupted.length, 1);
assert.equal(invalidRootInterrupted[0]?.id, "invalid-root-interrupted");
assert.equal(invalidRootInterrupted[0]?.project_root, "/repo");
assert.equal(invalidRootInterrupted[0]?.status, "killed");
assert.equal(invalidRootInterrupted[0]?.exit_code, 137);
assert.equal(invalidRootInterrupted[0]?.hasLocalConversation, true);
assert.deepEqual(
  invalidRootInterrupted[0]?.attention,
  {
    state: "overdue-human",
    since: "2026-06-08T18:05:00.000Z",
    reason: "input",
  },
  "a killed invalid-root recovery derives normalized attention from usable local transcript evidence",
);
assert.deepEqual(
  invalidRootInterrupted[0]?.initiator,
  { kind: "familiar", label: "Cody", agentId: "cody" },
  "invalid-root interrupted recovery should preserve daemon initiator provenance",
);

const invalidRootArchivedMatched = mergeSessionRows({
  daemonSessions: [
    {
      id: "invalid-root-archived",
      project_root: "/invalid",
      harness: "codex",
      title: "Archived chat",
      status: "archived",
      exit_code: 143,
      archived_at: null,
      created_at: "2026-06-08T18:00:00.000Z",
      updated_at: "2026-06-08T18:10:00.000Z",
      initiator: { kind: "familiar", label: "Cody", agentId: "cody" },
    },
  ],
  localConversations: [
    {
      sessionId: "invalid-root-archived",
      familiarId: "nova",
      harness: "codex",
      runtime: "local:/repo",
      title: "Archived chat",
      updatedAt: "2026-06-08T18:15:00.000Z",
      status: "completed",
      exitCode: 0,
      origin: "chat",
      attentionEvidence: {
        latestCompletedTurn: { role: "assistant", at: "2026-06-08T18:10:00.000Z" },
        latestUserTurnAt: null,
        request: {
          sessionId: "invalid-root-archived",
          turnId: "archived-assistant",
          requestedAt: "2026-06-08T18:05:00.000Z",
          reason: "decision",
        },
      },
    },
  ],
  state,
  includeArchived: false,
  isValidDaemonProjectRoot: (root) => root === "/repo",
  projectRootForCwd: (cwd) => (cwd === "/repo" ? "/repo" : null),
});

assert.equal(invalidRootArchivedMatched.length, 1, "matched invalid-root archived sessions recover exactly one row");
assert.equal(invalidRootArchivedMatched[0]?.project_root, "/repo");
assert.equal(invalidRootArchivedMatched[0]?.status, "archived");
assert.equal(invalidRootArchivedMatched[0]?.exit_code, 143);
assert.equal(invalidRootArchivedMatched[0]?.archived_at, null);
assert.equal(invalidRootArchivedMatched[0]?.hasLocalConversation, true);
assert.deepEqual(
  invalidRootArchivedMatched[0]?.attention,
  NO_CHAT_ATTENTION,
  "an archived invalid-root recovery always suppresses, even with usable local transcript evidence",
);
assert.deepEqual(
  invalidRootArchivedMatched[0]?.initiator,
  { kind: "familiar", label: "Cody", agentId: "cody" },
  "invalid-root archived recovery should preserve daemon initiator provenance",
);

for (const [status, exitCode] of [
  ["orphaned", 143],
  ["stopped", 0],
] as const) {
  const [row] = mergeSessionRows({
    daemonSessions: [
      {
        id: `invalid-root-${status}`,
        project_root: "/invalid",
        harness: "codex",
        title: `${status} chat`,
        status,
        exit_code: exitCode,
        archived_at: null,
        created_at: "2026-06-08T18:00:00.000Z",
        updated_at: "2026-06-08T18:10:00.000Z",
        initiator: { kind: "familiar", label: "Cody", agentId: "cody" },
      },
    ],
    localConversations: [
      {
        sessionId: `invalid-root-${status}`,
        familiarId: "nova",
        harness: "codex",
        runtime: "local:/repo",
        title: `${status} chat`,
        updatedAt: "2026-06-08T18:15:00.000Z",
        status: "completed",
        exitCode: 0,
        origin: "chat",
        attentionEvidence: {
          latestCompletedTurn: { role: "assistant", at: "2026-06-08T18:10:00.000Z" },
          latestUserTurnAt: null,
          request: {
            sessionId: `invalid-root-${status}`,
            turnId: `${status}-assistant`,
            requestedAt: "2026-06-08T18:05:00.000Z",
            reason: "input",
          },
        },
      },
    ],
    state,
    includeArchived: false,
    isValidDaemonProjectRoot: (root) => root === "/repo",
    projectRootForCwd: (cwd) => (cwd === "/repo" ? "/repo" : null),
  });

  assert.equal(row?.status, status);
  assert.equal(row?.exit_code, exitCode);
  assert.deepEqual(
    row?.attention,
    {
      state: "overdue-human",
      since: "2026-06-08T18:05:00.000Z",
      reason: "input",
    },
    `an invalid-root ${status} recovery derives normalized attention from usable local transcript evidence`,
  );
}

assert.equal(
  validRootArchived[0]?.status,
  "archived",
  "newer local transcripts must not overwrite a valid-root daemon archived status",
);
assert.equal(
  validRootArchived[0]?.exit_code,
  143,
  "newer local transcripts must not overwrite the daemon exit code for an archived status",
);
assert.equal(validRootArchived[0]?.archived_at, null, "the daemon status is authoritative even without archived_at");
assert.deepEqual(
  validRootArchived[0]?.attention,
  NO_CHAT_ATTENTION,
  "daemon archived status suppresses attention even when archived_at is still null",
);

const invalidRootArchived = {
  ...state,
  sessionArchived: { "invalid-root-interrupted": "2026-06-08T18:20:00.000Z" },
};

const invalidRootInterruptedArchived = {
  ...invalidRootInterrupted[0],
  archived_at: "2026-06-08T18:25:00.000Z",
  // This scenario's local conversation carries no attentionEvidence (unlike
  // invalidRootInterrupted's fixture above), and archived_at suppresses
  // regardless — so the expected row must not inherit the derived
  // overdue-human attention from the spread source.
  attention: NO_CHAT_ATTENTION,
};

assert.equal(
  mergeSessionRows({
    daemonSessions: [
      {
        id: "invalid-root-interrupted",
        project_root: "/invalid",
        harness: "codex",
        title: "Interrupted chat",
        status: "killed",
        exit_code: 137,
        archived_at: "2026-06-08T18:25:00.000Z",
        created_at: "2026-06-08T18:00:00.000Z",
        updated_at: "2026-06-08T18:10:00.000Z",
        initiator: { kind: "familiar", label: "Cody", agentId: "cody" },
      },
    ],
    localConversations: [
      {
        sessionId: "invalid-root-interrupted",
        familiarId: "nova",
        harness: "codex",
        runtime: "local:/repo",
        title: "Interrupted chat",
        updatedAt: "2026-06-08T18:15:00.000Z",
        status: "completed",
        exitCode: 0,
        origin: "chat",
      },
    ],
    state,
    includeArchived: false,
    isValidDaemonProjectRoot: (root) => root === "/repo",
    projectRootForCwd: (cwd) => (cwd === "/repo" ? "/repo" : null),
  }).length,
  0,
  "invalid-root interrupted chats with daemon archived_at should stay hidden from the active list",
);

assert.deepEqual(
  mergeSessionRows({
    daemonSessions: [
      {
        id: "invalid-root-interrupted",
        project_root: "/invalid",
        harness: "codex",
        title: "Interrupted chat",
        status: "killed",
        exit_code: 137,
        archived_at: "2026-06-08T18:25:00.000Z",
        created_at: "2026-06-08T18:00:00.000Z",
        updated_at: "2026-06-08T18:10:00.000Z",
        initiator: { kind: "familiar", label: "Cody", agentId: "cody" },
      },
    ],
    localConversations: [
      {
        sessionId: "invalid-root-interrupted",
        familiarId: "nova",
        harness: "codex",
        runtime: "local:/repo",
        title: "Interrupted chat",
        updatedAt: "2026-06-08T18:15:00.000Z",
        status: "completed",
        exitCode: 0,
        origin: "chat",
      },
    ],
    state,
    includeArchived: true,
    isValidDaemonProjectRoot: (root) => root === "/repo",
    projectRootForCwd: (cwd) => (cwd === "/repo" ? "/repo" : null),
  }),
  [invalidRootInterruptedArchived],
  "invalid-root interrupted recovery should preserve the daemon archived_at when archived rows are visible",
);

assert.equal(
  mergeSessionRows({
    daemonSessions: [
      {
        id: "invalid-root-interrupted",
        project_root: "/invalid",
        harness: "codex",
        title: "Interrupted chat",
        status: "killed",
        exit_code: 137,
        archived_at: "2026-06-08T18:25:00.000Z",
        created_at: "2026-06-08T18:00:00.000Z",
        updated_at: "2026-06-08T18:10:00.000Z",
        initiator: { kind: "familiar", label: "Cody", agentId: "cody" },
      },
    ],
    localConversations: [
      {
        sessionId: "invalid-root-interrupted",
        familiarId: "nova",
        harness: "codex",
        runtime: "local:/repo",
        title: "Interrupted chat",
        updatedAt: "2026-06-08T18:15:00.000Z",
        status: "completed",
        exitCode: 0,
        origin: "chat",
      },
    ],
    state: invalidRootArchived,
    includeArchived: true,
    isValidDaemonProjectRoot: (root) => root === "/repo",
    projectRootForCwd: (cwd) => (cwd === "/repo" ? "/repo" : null),
  })[0]?.archived_at,
  "2026-06-08T18:20:00.000Z",
  "invalid-root interrupted recovery should still honor the Cave-local archive override",
);

// Regression (cave-zs85n reviewer follow-up): an invalid-root daemon session
// that is still actively running was never marked `seen` by recovery, which
// previously handled only the authoritative terminal statuses (archived,
// killed, orphaned, stopped). The local conversation then fell through to the
// local-only path and derived attention from its own ("completed") status,
// surfacing stale attention for a session the daemon says is still running.
const invalidRootRunning = mergeSessionRows({
  daemonSessions: [
    {
      id: "invalid-root-running",
      project_root: "/invalid",
      harness: "codex",
      title: "Running chat",
      status: "running",
      exit_code: null,
      archived_at: null,
      created_at: "2026-06-08T18:00:00.000Z",
      updated_at: "2026-06-08T18:10:00.000Z",
      initiator: { kind: "familiar", label: "Cody", agentId: "cody" },
    },
  ],
  localConversations: [
    {
      sessionId: "invalid-root-running",
      familiarId: "nova",
      harness: "codex",
      runtime: "local:/repo",
      title: "Running chat",
      updatedAt: "2026-06-08T18:15:00.000Z",
      status: "completed",
      exitCode: 0,
      origin: "chat",
      // Matching local attention evidence that would resolve to an
      // overdue-human request if derived from the local row's own
      // ("completed") status instead of the daemon's "running" truth.
      attentionEvidence: {
        latestCompletedTurn: { role: "assistant", at: "2026-06-08T18:10:00.000Z" },
        latestUserTurnAt: null,
        request: {
          sessionId: "invalid-root-running",
          turnId: "running-assistant",
          requestedAt: "2026-06-08T18:05:00.000Z",
          reason: "input",
        },
      },
    },
  ],
  state,
  includeArchived: false,
  isValidDaemonProjectRoot: (root) => root === "/repo",
  projectRootForCwd: (cwd) => (cwd === "/repo" ? "/repo" : null),
});

assert.equal(
  invalidRootRunning.length,
  1,
  "an invalid-root active daemon session must merge into exactly one row, never dropped or duplicated",
);
assert.equal(invalidRootRunning[0]?.id, "invalid-root-running");
assert.equal(
  invalidRootRunning[0]?.status,
  "running",
  "an invalid-root active daemon session keeps the daemon's running status",
);
assert.deepEqual(
  invalidRootRunning[0]?.attention,
  NO_CHAT_ATTENTION,
  "a running invalid-root daemon session must suppress attention regardless of local transcript evidence",
);

// Regression (cave-zs85n Task 4 gap): waiting is a distinct active status,
// so this invalid-root recovery must suppress attention too.
const invalidRootWaiting = mergeSessionRows({
  daemonSessions: [
    {
      id: "invalid-root-waiting",
      project_root: "/invalid",
      harness: "codex",
      title: "Waiting chat",
      status: "waiting",
      exit_code: null,
      archived_at: null,
      created_at: "2026-06-08T18:00:00.000Z",
      updated_at: "2026-06-08T18:10:00.000Z",
      initiator: { kind: "familiar", label: "Cody", agentId: "cody" },
    },
  ],
  localConversations: [
    {
      sessionId: "invalid-root-waiting",
      familiarId: "nova",
      harness: "codex",
      runtime: "local:/repo",
      title: "Waiting chat",
      updatedAt: "2026-06-08T18:15:00.000Z",
      status: "completed",
      exitCode: 0,
      origin: "chat",
      // Local evidence would surface overdue-human if the daemon status leaked.
      attentionEvidence: {
        latestCompletedTurn: { role: "assistant", at: "2026-06-08T18:10:00.000Z" },
        latestUserTurnAt: null,
        request: {
          sessionId: "invalid-root-waiting",
          turnId: "waiting-assistant",
          requestedAt: "2026-06-08T18:05:00.000Z",
          reason: "input",
        },
      },
    },
  ],
  state,
  includeArchived: false,
  isValidDaemonProjectRoot: (root) => root === "/repo",
  projectRootForCwd: (cwd) => (cwd === "/repo" ? "/repo" : null),
});

assert.equal(
  invalidRootWaiting.length,
  1,
  "an invalid-root waiting daemon session must merge into exactly one row, never dropped or duplicated",
);
assert.equal(invalidRootWaiting[0]?.id, "invalid-root-waiting");
assert.equal(
  invalidRootWaiting[0]?.status,
  "waiting",
  "an invalid-root waiting daemon session keeps the daemon's waiting status",
);
assert.deepEqual(
  invalidRootWaiting[0]?.attention,
  NO_CHAT_ATTENTION,
  "a waiting invalid-root daemon session must suppress attention regardless of local transcript evidence",
);

const cwdFiltered = mergeSessionRows({
  daemonSessions: [
    {
      id: "daemon-valid",
      project_root: "/repo",
      harness: "codex",
      title: "Valid daemon chat",
      status: "completed",
      exit_code: 0,
      archived_at: null,
      created_at: "2026-06-08T18:00:00.000Z",
      updated_at: "2026-06-08T18:05:00.000Z",
    },
    {
      id: "daemon-missing-cwd",
      project_root: "/deleted/worktree",
      harness: "codex",
      title: "Stale daemon chat",
      status: "orphaned",
      exit_code: null,
      archived_at: null,
      created_at: "2026-06-08T18:10:00.000Z",
      updated_at: "2026-06-08T18:15:00.000Z",
    },
  ],
  localConversations: [localConversation],
  state,
  includeArchived: false,
  isValidDaemonProjectRoot: (root) => root === "/repo",
});

assert.deepEqual(
  cwdFiltered.map((s) => s.id),
  ["local-1", "daemon-valid"],
  "daemon sessions without a true project cwd should be filtered while local Cave chats remain visible",
);

assert.equal(
  mergeSessionRows({
    daemonSessions: [],
    localConversations: [localConversation],
    state: { ...state, sessionSacrificed: { "local-1": "2026-06-08T21:00:00.000Z" } },
    includeArchived: false,
  }).length,
  0,
  "sacrificed local chats should stay hidden",
);

const archivedState = {
  ...state,
  sessionArchived: { "local-1": "2026-06-08T21:00:00.000Z" },
};

assert.equal(
  localConversationSessionRows([localConversation], archivedState, false).length,
  0,
  "archived local chats should stay hidden from the active list",
);

assert.equal(
  localConversationSessionRows([localConversation], archivedState, true)[0].archived_at,
  "2026-06-08T21:00:00.000Z",
  "archived local chats should return when includeArchived is enabled",
);

const archiveOverrideState = {
  ...state,
  sessionKeep: { "local-1": "2026-06-08T22:00:00.000Z", "daemon-1": "2026-06-08T22:00:00.000Z" },
  sessionArchiveExtendedUntil: {
    "local-1": "2026-07-01T00:00:00.000Z",
    "daemon-1": "2026-07-15T00:00:00.000Z",
  },
};

assert.equal(
  localConversationSessionRows([localConversation], archiveOverrideState, false)[0].keep,
  true,
  "local conversation rows should carry the keep flag from Cave state",
);
assert.equal(
  localConversationSessionRows([localConversation], archiveOverrideState, false)[0].archive_extended_until,
  "2026-07-01T00:00:00.000Z",
  "local conversation rows should carry the extension deadline from Cave state",
);
assert.equal(
  mergeSessionRows({
    daemonSessions: [
      {
        id: "daemon-1",
        project_root: "/repo",
        harness: "codex",
        title: "Daemon chat",
        status: "completed",
        exit_code: 0,
        archived_at: null,
        created_at: "2026-06-08T19:00:00.000Z",
        updated_at: "2026-06-08T19:05:00.000Z",
      },
    ],
    localConversations: [],
    state: archiveOverrideState,
    includeArchived: false,
  })[0].keep,
  true,
  "daemon rows should carry the keep flag from Cave state",
);
assert.equal(
  mergeSessionRows({
    daemonSessions: [
      {
        id: "daemon-1",
        project_root: "/repo",
        harness: "codex",
        title: "Daemon chat",
        status: "completed",
        exit_code: 0,
        archived_at: null,
        created_at: "2026-06-08T19:00:00.000Z",
        updated_at: "2026-06-08T19:05:00.000Z",
      },
    ],
    localConversations: [],
    state: archiveOverrideState,
    includeArchived: false,
  })[0].archive_extended_until,
  "2026-07-15T00:00:00.000Z",
  "daemon rows should carry the extension deadline from Cave state",
);

// A daemon session whose `updated_at` was bumped by a mere resume/view should
// order by the matching local conversation's last-message time, not the later
// view time — so reopening an old chat doesn't float it to the top.
const viewedDaemon = {
  id: "chat-7",
  project_root: "/repo",
  harness: "codex",
  title: "Reopened chat",
  status: "completed",
  exit_code: 0,
  archived_at: null,
  created_at: "2026-06-01T10:00:00.000Z",
  updated_at: "2026-06-20T09:00:00.000Z", // bumped "now" by opening it
};
const chat7Local = {
  sessionId: "chat-7",
  familiarId: "charm",
  updatedAt: "2026-06-02T11:00:00.000Z", // real last message, days earlier
};
const recentDaemon = {
  ...viewedDaemon,
  id: "chat-9",
  title: "Genuinely recent chat",
  created_at: "2026-06-10T10:00:00.000Z",
  updated_at: "2026-06-10T12:00:00.000Z",
};
const chat9Local = {
  sessionId: "chat-9",
  familiarId: "cody",
  updatedAt: "2026-06-10T12:00:00.000Z",
};

const orderedByMessage = mergeSessionRows({
  daemonSessions: [viewedDaemon, recentDaemon],
  localConversations: [chat7Local, chat9Local],
  state: { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} },
  includeArchived: false,
});

assert.equal(
  orderedByMessage.find((s) => s.id === "chat-7")?.updated_at,
  "2026-06-02T11:00:00.000Z",
  "a daemon session with a local conversation should use the local last-message time, not the daemon's view-time bump",
);
assert.deepEqual(
  orderedByMessage.map((s) => s.id),
  ["chat-9", "chat-7"],
  "the genuinely-recent chat outranks the just-reopened older chat",
);

for (const activeStatus of ["running", "waiting"] as const) {
  const activeDaemon = {
    id: `chat-active-${activeStatus}`,
    project_root: "/repo",
    harness: "codex",
    title: `Active ${activeStatus} chat`,
    status: activeStatus,
    exit_code: null,
    archived_at: null,
    created_at: "2026-06-25T04:23:34.393Z",
    updated_at: "2026-06-25T04:26:13.470Z",
  };
  const newerCompletedLocal = {
    sessionId: `chat-active-${activeStatus}`,
    familiarId: "charm",
    harness: "codex",
    title: "Recovered locally",
    updatedAt: "2026-06-25T04:27:31.202Z",
    status: "completed",
    exitCode: 0,
    attentionEvidence: {
      latestCompletedTurn: { role: "assistant", at: "2026-06-25T04:25:00.000Z" },
      latestUserTurnAt: "2026-06-25T04:24:00.000Z",
      request: {
        sessionId: `chat-active-${activeStatus}`,
        turnId: `assistant-${activeStatus}`,
        requestedAt: "2026-06-25T04:25:00.000Z",
        reason: "approval",
      },
    },
  };

  const merged = mergeSessionRows({
    daemonSessions: [activeDaemon],
    localConversations: [newerCompletedLocal],
    state: { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} },
    includeArchived: false,
  });

  assert.equal(
    merged[0]?.status,
    activeStatus,
    `a newer local completion must not overwrite daemon ${activeStatus}`,
  );
  assert.equal(
    merged[0]?.exit_code,
    null,
    `a newer local completion must not fabricate a terminal exit code while daemon is ${activeStatus}`,
  );
  assert.equal(
    merged[0]?.updated_at,
    "2026-06-25T04:27:31.202Z",
    `daemon ${activeStatus} still orders by the local transcript's last message time`,
  );
  assert.deepEqual(
    merged[0]?.attention,
    NO_CHAT_ATTENTION,
    `daemon ${activeStatus} suppresses local stale attention evidence`,
  );
}

// A stale daemon row can outlive a Cave-local chat transcript for the same id.
// When the local transcript has newer message activity, it should own the row's
// terminal status so a successful chat is not stuck with an old failed badge.
const staleFailedDaemon = {
  id: "chat-stale-failed",
  project_root: "/repo",
  harness: "codex",
  title: "Runtime filesystem boundary:",
  status: "failed",
  exit_code: 1,
  archived_at: null,
  created_at: "2026-06-25T04:23:34.393Z",
  updated_at: "2026-06-25T04:26:13.470Z",
};
const newerCompletedLocal = {
  sessionId: "chat-stale-failed",
  familiarId: "charm",
  harness: "codex",
  title: "Howdy",
  updatedAt: "2026-06-25T04:27:31.202Z",
  status: "completed",
  exitCode: 0,
};

const recoveredStatus = mergeSessionRows({
  daemonSessions: [staleFailedDaemon],
  localConversations: [newerCompletedLocal],
  state: { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} },
  includeArchived: false,
});

assert.equal(
  recoveredStatus[0].status,
  "completed",
  "newer Cave-local transcript status should override stale daemon failure",
);
assert.equal(recoveredStatus[0].exit_code, 0, "newer Cave-local transcript exit code should win");

const harnessMatchedReplay = mergeSessionRows({
  daemonSessions: [
    {
      id: "hub-session-offline-1",
      project_root: "/repo",
      harness: "codex",
      title: "Replayed offline chat",
      status: "completed",
      exit_code: 0,
      archived_at: null,
      created_at: "2026-06-25T04:23:34.393Z",
      updated_at: "2026-06-25T04:29:00.000Z",
    },
  ],
  localConversations: [
    {
      sessionId: "offline-chat-1",
      harnessSessionId: "hub-session-offline-1",
      familiarId: "charm",
      harness: "codex",
      title: "Offline chat",
      updatedAt: "2026-06-25T04:27:31.202Z",
      attentionEvidence: {
        latestCompletedTurn: { role: "user", at: "2026-06-25T04:27:31.202Z" },
        latestUserTurnAt: "2026-06-25T04:27:31.202Z",
        attentionAfterOperationId: "run-offline-1",
        request: null,
      },
    },
  ],
  state: { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} },
  includeArchived: false,
});

assert.equal(
  harnessMatchedReplay[0]?.id,
  "offline-chat-1",
  "a replayed daemon session should merge back onto the original Cave conversation id",
);
assert.equal(
  harnessMatchedReplay[0]?.hasLocalConversation,
  true,
  "replayed daemon sessions matched by harnessSessionId keep the local transcript provenance",
);
assert.equal(
  harnessMatchedReplay[0]?.attentionAfterOperationId,
  "run-offline-1",
  "replayed daemon sessions preserve the original send operation id on the original conversation row",
);
assert.equal(
  harnessMatchedReplay[0]?.daemonSessionId,
  "hub-session-offline-1",
  "the canonical Cave conversation keeps the newest daemon trace session id separate from its stable chat id",
);

{
  const replayHistoryRows = mergeSessionRows({
    daemonSessions: [
      {
        id: "hub-session-offline-1",
        project_root: "/repo",
        harness: "codex",
        title: "Replay 1",
        status: "completed",
        exit_code: 0,
        archived_at: null,
        created_at: "2026-06-25T04:23:34.393Z",
        updated_at: "2026-06-25T04:29:00.000Z",
        conversation_id: "codex-thread-1",
      },
      {
        id: "hub-session-offline-2",
        project_root: "/repo",
        harness: "codex",
        title: "Replay 2",
        status: "completed",
        exit_code: 0,
        archived_at: null,
        created_at: "2026-06-25T04:30:00.000Z",
        updated_at: "2026-06-25T04:31:00.000Z",
        conversation_id: "codex-thread-1",
      },
    ],
    localConversations: [
      {
        sessionId: "offline-chat-2",
        harnessSessionId: "codex-thread-1",
        familiarId: "charm",
        harness: "codex",
        title: "Offline chat",
        updatedAt: "2026-06-25T04:30:30.000Z",
        replaySessions: [
          {
            sessionId: "hub-session-offline-1",
            conversationId: "codex-thread-1",
            createdAt: "2026-06-25T04:23:34.393Z",
            updatedAt: "2026-06-25T04:29:00.000Z",
          },
          {
            sessionId: "hub-session-offline-2",
            conversationId: "codex-thread-1",
            createdAt: "2026-06-25T04:30:00.000Z",
            updatedAt: "2026-06-25T04:31:00.000Z",
          },
        ],
      },
    ],
    state: { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} },
    includeArchived: false,
  });

  assert.deepEqual(
    replayHistoryRows.map((row) => row.id),
    ["offline-chat-2"],
    "native and replay daemon rows collapse to one stable Cave conversation row",
  );
  assert.equal(
    replayHistoryRows.find((row) => row.id === "offline-chat-2")?.daemonSessionId,
    "hub-session-offline-2",
    "the newest replay daemon row rides the canonical conversation as an explicit daemon trace id",
  );
}

{
  const caveId = "mapped-cave-duplicate";
  const harnessId = "mapped-harness-duplicate";
  const duplicateMappedRows = mergeSessionRows({
    daemonSessions: [
      {
        id: caveId,
        project_root: "/repo",
        harness: "codex",
        title: "Original Cave-id daemon row",
        status: "completed",
        exit_code: 0,
        archived_at: null,
        created_at: "2026-06-25T04:20:00.000Z",
        updated_at: "2026-06-25T04:21:00.000Z",
      },
      {
        id: harnessId,
        project_root: "/repo",
        harness: "codex",
        title: "Mapped current harness row",
        status: "running",
        exit_code: null,
        archived_at: null,
        created_at: "2026-06-25T04:20:00.000Z",
        updated_at: "2026-06-25T04:22:00.000Z",
      },
    ],
    localConversations: [{
      sessionId: caveId,
      harnessSessionId: harnessId,
      familiarId: "charm",
      harness: "codex",
      title: "Cave conversation",
      updatedAt: "2026-06-25T04:23:00.000Z",
    }],
    state: {
      sessionFamiliar: { [caveId]: "charm" },
      sessionTitles: { [caveId]: "Canonical Cave title" },
      sessionArchived: {},
      sessionSacrificed: {},
    },
    includeArchived: false,
  });

  assert.equal(duplicateMappedRows.length, 1, "original and mapped daemon ids collapse before output");
  assert.equal(duplicateMappedRows[0]?.id, caveId);
  assert.equal(
    duplicateMappedRows[0]?.status,
    "running",
    "the harness-id match is the authoritative daemon row when both ids are present",
  );
  assert.equal(duplicateMappedRows[0]?.title, "Canonical Cave title");
}

{
  const caveId = "mapped-cave-deterministic";
  const conversationId = "mapped-conversation-deterministic";
  const archivedAt = "2026-06-25T04:25:00.000Z";
  const olderDaemon = {
    id: "mapped-daemon-older",
    project_root: "/repo",
    harness: "claude",
    title: "Older daemon row",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-06-25T04:20:00.000Z",
    updated_at: "2026-06-25T04:22:00.000Z",
    conversation_id: conversationId,
  };
  const selectedTerminalDaemon = {
    ...olderDaemon,
    id: "mapped-daemon-terminal",
    title: "Selected terminal daemon row",
    status: "failed",
    exit_code: 1,
    created_at: "2026-06-25T04:21:00.000Z",
  };
  const localConversations = [{
    sessionId: caveId,
    harnessSessionId: conversationId,
    familiarId: "charm",
    harness: "claude",
    title: "Mapped Cave conversation",
    status: "completed",
    exitCode: 0,
    updatedAt: "2026-06-25T04:30:00.000Z",
    replaySessions: [{
      sessionId: "recorded-replay-run",
      conversationId,
      createdAt: "2026-06-25T04:19:00.000Z",
      updatedAt: "2026-06-25T04:22:00.000Z",
    }],
  }];
  const state = {
    sessionFamiliar: { [caveId]: "charm" },
    sessionTitles: { [caveId]: "Canonical mapped title" },
    sessionArchived: { [caveId]: archivedAt },
    sessionSacrificed: {},
  };
  const merge = (daemonSessions: DaemonSessionRow[]) => mergeSessionRows({
    daemonSessions,
    localConversations,
    state,
    includeArchived: true,
  });

  const forward = merge([olderDaemon, selectedTerminalDaemon]);
  const reverse = merge([selectedTerminalDaemon, olderDaemon]);
  assert.deepEqual(reverse, forward, "mapped daemon selection must not depend on input order");
  assert.equal(forward.length, 1, "all daemon aliases dedupe by mapped Cave id");
  assert.equal(forward[0]?.id, caveId);
  assert.equal(forward[0]?.daemonSessionId, "mapped-daemon-terminal");
  assert.equal(
    forward[0]?.status,
    "failed",
    "the deterministically selected daemon terminal status survives a newer local timestamp",
  );
  assert.equal(forward[0]?.exit_code, 1);
  assert.equal(forward[0]?.title, "Canonical mapped title");
  assert.equal(
    forward[0]?.archived_at,
    archivedAt,
    "archive and local overrides key off the mapped Cave id",
  );
}

{
  const caveId = "mapped-cave-archived";
  const harnessId = "mapped-harness-killed";
  const daemonSessions = [{
    id: harnessId,
    project_root: "/invalid",
    harness: "codex",
    title: "Killed mapped run",
    status: "killed",
    exit_code: 137,
    archived_at: null,
    created_at: "2026-06-25T04:20:00.000Z",
    updated_at: "2026-06-25T04:22:00.000Z",
  }];
  const localConversations = [{
    sessionId: caveId,
    harnessSessionId: harnessId,
    familiarId: "charm",
    harness: "codex",
    runtime: "local:/repo",
    title: "Archived Cave conversation",
    status: "completed",
    exitCode: 0,
    updatedAt: "2026-06-25T04:23:00.000Z",
    attentionEvidence: {
      latestCompletedTurn: { role: "assistant", at: "2026-06-25T04:22:00.000Z" },
      latestUserTurnAt: "2026-06-25T04:21:00.000Z",
      request: {
        sessionId: caveId,
        turnId: "assistant-attention",
        requestedAt: "2026-06-25T04:22:00.000Z",
        reason: "approval",
      },
    },
  }];
  const archivedAt = "2026-06-25T04:24:00.000Z";
  const mappedState = {
    sessionFamiliar: {},
    sessionTitles: {},
    sessionArchived: { [caveId]: archivedAt },
    sessionSacrificed: {},
  };
  const merge = (includeArchived: boolean) => mergeSessionRows({
    daemonSessions,
    localConversations,
    state: mappedState,
    includeArchived,
    isValidDaemonProjectRoot: (root) => root === "/repo",
    projectRootForCwd: (cwd) => (cwd === "/repo" ? "/repo" : null),
  });

  assert.equal(
    merge(false).length,
    0,
    "canonical Cave archive state keeps an invalid-root mapped kill out of the active list",
  );
  const archivedRows = merge(true);
  assert.equal(archivedRows.length, 1);
  assert.equal(archivedRows[0]?.id, caveId);
  assert.equal(archivedRows[0]?.archived_at, archivedAt);
  assert.deepEqual(
    archivedRows[0]?.attention,
    NO_CHAT_ATTENTION,
    "a killed mapped row cannot resurrect attention for its archived Cave conversation",
  );
}

// Analytics-spawned discussions carry regular chat provenance through to the session row.
const analyticsRows = localConversationSessionRows(
  [{ ...localConversation, sessionId: "analytics-9", origin: "chat" }],
  { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} },
  false,
);
assert.equal(analyticsRows[0].origin, "chat", "analytics discussion origin maps to regular chat");

// Provenance: a daemon session with no Cave conversation and only the
// inferred-"chat" default is a generated run (journal narrative, flow,
// automation, CLI) — flagged so chat lists can hide it. A conversation-backed
// row keeps the conversation's recorded origin and is never flagged.
{
  const bareState = { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} };
  const daemonRun = (id, title) => ({
    id,
    project_root: "/repo",
    harness: "codex",
    title,
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-06-08T18:00:00.000Z",
    updated_at: "2026-06-08T18:05:00.000Z",
  });
  const rows = mergeSessionRows({
    daemonSessions: [
      daemonRun("spawned-run", "Write a short narrative of my day"),
      daemonRun("cron-run", "[cron] nightly sweep"),
      daemonRun("canvas-run", "Build a pricing page"),
    ],
    localConversations: [
      {
        sessionId: "canvas-run",
        familiarId: "nova",
        harness: "codex",
        title: "Build a pricing page",
        updatedAt: "2026-06-08T18:06:00.000Z",
        origin: "canvas",
      },
    ],
    state: bareState,
    includeArchived: false,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get("spawned-run")?.generated, true, "daemon-only inferred-chat run is flagged generated");
  assert.equal(byId.get("cron-run")?.origin, "cron", "explicit provenance patterns still infer their origin");
  assert.equal(byId.get("cron-run")?.generated, undefined, "non-default inferred origins carry no generated flag");
  assert.equal(byId.get("canvas-run")?.origin, "canvas", "a conversation's recorded origin beats title inference");
  assert.equal(byId.get("canvas-run")?.generated, undefined, "conversation-backed rows are real chats, never flagged");
}

// Work-branch passthrough (cave-9q24): the branch a conversation recorded at
// its last turn must surface on the merged row as `workBranch` — it is the
// only per-session PR-attribution signal. Daemon rows without a conversation
// carry none.
{
  const bareState = { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} };
  const rows = mergeSessionRows({
    daemonSessions: [
      {
        id: "branched",
        project_root: "/repo",
        harness: "codex",
        title: "Fix the flaky spec",
        status: "completed",
        exit_code: 0,
        archived_at: null,
        created_at: "2026-06-08T18:00:00.000Z",
        updated_at: "2026-06-08T18:05:00.000Z",
      },
    ],
    localConversations: [
      {
        sessionId: "branched",
        familiarId: "nova",
        harness: "codex",
        title: "Fix the flaky spec",
        updatedAt: "2026-06-08T18:06:00.000Z",
        origin: "chat",
        branch: "feat/fix-flaky-spec",
        prUrl: "https://github.com/OpenCoven/coven-cave/pull/3249",
      },
      {
        sessionId: "local-branched",
        familiarId: "nova",
        harness: "codex",
        title: "Local only",
        updatedAt: "2026-06-08T18:07:00.000Z",
        origin: "chat",
        branch: "feat/local-work",
        prUrl: "https://github.com/OpenCoven/coven-cave/pull/3344",
      },
    ],
    state: bareState,
    includeArchived: false,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get("branched")?.workBranch, "feat/fix-flaky-spec", "conversation branch surfaces on the merged daemon row");
  assert.equal(byId.get("local-branched")?.workBranch, "feat/local-work", "local-only rows carry their recorded branch too");
  // Transcript-reported PR URL passthrough (cave-u9wl): both merge paths.
  assert.equal(byId.get("branched")?.chatPrUrl, "https://github.com/OpenCoven/coven-cave/pull/3249", "conversation prUrl surfaces on the merged daemon row");
  assert.equal(byId.get("local-branched")?.chatPrUrl, "https://github.com/OpenCoven/coven-cave/pull/3344", "local-only rows carry their reported PR URL too");
}

// Project backfill (cave-9nj1): sidebar/rail project groups key on
// project_root, and UI chats exist only as local conversations — so a row's
// project_root must be backfilled from the conversation's recorded runtime
// cwd ("local:<cwd>") when that cwd maps to a registered project. Chats in a
// familiar workspace / unregistered dir (and ssh runtimes) stay "" so they
// keep landing in the "No project" bucket.
{
  const bareState = { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} };
  const projectRootForCwd = (cwd) => (cwd === "/Users/example/repo" ? "/Users/example/repo" : null);
  const conv = (sessionId, runtime) => ({
    sessionId,
    familiarId: "nova",
    harness: "codex",
    title: "Chat",
    updatedAt: "2026-06-08T20:05:00.000Z",
    ...(runtime ? { runtime } : {}),
  });
  const rows = localConversationSessionRows(
    [
      conv("in-project", "local:/Users/example/repo"),
      conv("workspace", "local:/Users/example/.coven/workspaces/familiars/nova"),
      conv("remote", "ssh:host:/srv/repo"),
      conv("no-runtime"),
    ],
    bareState,
    false,
    projectRootForCwd,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get("in-project")?.project_root, "/Users/example/repo", "registered-project cwd backfills project_root");
  assert.equal(byId.get("workspace")?.project_root, "", "unregistered cwd (familiar workspace) stays No-project");
  assert.equal(byId.get("remote")?.project_root, "", "ssh runtimes have no local project root");
  assert.equal(byId.get("no-runtime")?.project_root, "", "conversations without a runtime stay No-project");

  const mergedBackfill = mergeSessionRows({
    daemonSessions: [],
    localConversations: [conv("in-project", "local:/Users/example/repo")],
    state: bareState,
    includeArchived: false,
    projectRootForCwd,
  });
  assert.equal(
    mergedBackfill[0]?.project_root,
    "/Users/example/repo",
    "mergeSessionRows threads the resolver through to local-only rows",
  );

  const runtimeTransitions = [
    {
      id: "runtime-local-to-ssh",
      daemonRuntime: "local:/Users/example/repo",
      localRuntime: "ssh:build:/srv/repo",
    },
    {
      id: "runtime-ssh-to-local",
      daemonRuntime: "ssh:build:/srv/repo",
      localRuntime: "local:/Users/example/repo",
    },
  ];
  for (const transition of runtimeTransitions) {
    const [row] = mergeSessionRows({
      daemonSessions: [
        {
          id: transition.id,
          project_root: "/Users/example/repo",
          harness: "hermes",
          runtime: transition.daemonRuntime,
          title: "Runtime transition",
          status: "completed",
          exit_code: 0,
          archived_at: null,
          created_at: "2026-07-31T12:00:00.000Z",
          updated_at: "2026-07-31T12:00:00.000Z",
        },
      ],
      localConversations: [
        {
          sessionId: transition.id,
          familiarId: "sage",
          harness: "hermes",
          runtime: transition.localRuntime,
          title: "Runtime transition",
          status: "completed",
          exitCode: 0,
          updatedAt: "2026-07-31T12:01:00.000Z",
        },
      ],
      state: bareState,
      includeArchived: false,
    });
    assert.equal(row?.familiarId, "sage");
    assert.equal(row?.harness, "hermes");
    assert.equal(
      row?.runtime,
      transition.localRuntime,
      `${transition.id}: merged rows retain the conversation-authoritative runtime`,
    );
  }
}

// ── First-turn stubs in the merge (cave-0g2x) ────────────────────────────────
// A stub conversation (pending first reply ⇒ summary has NO status) must
// (a) list as a local-only row so brand-new chats appear immediately, and
// (b) never override a live daemon row's "running" status/exit_code even
// when the local summary is newer.
{
  const bareState = {
    sessionFamiliar: {},
    sessionTitles: {},
    sessionArchived: {},
    sessionSacrificed: {},
  };
  const stubConv = {
    sessionId: "stub-new-chat",
    familiarId: "nova",
    harness: "claude",
    title: "Fix the flaky test",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    // No status/exitCode: conversationTerminalStatus returns null while the
    // first assistant reply is pending.
  };

  const localOnly = mergeSessionRows({
    daemonSessions: [],
    localConversations: [stubConv],
    state: bareState,
    includeArchived: false,
  });
  assert.equal(localOnly.length, 1, "a stub-only chat lists immediately");
  assert.equal(localOnly[0]?.id, "stub-new-chat");
  assert.equal(localOnly[0]?.title, "Fix the flaky test");
  assert.equal(localOnly[0]?.status, "completed", "statusless local-only rows fall back safely");
  assert.equal(
    filterVisibleChatSessions(localOnly, null).length,
    1,
    "the stub row survives the chat-rail visibility filter",
  );

  const withDaemon = mergeSessionRows({
    daemonSessions: [
      {
        id: "stub-new-chat",
        project_root: "/repo",
        harness: "claude",
        title: "Fix the flaky test",
        status: "running",
        exit_code: null,
        archived_at: null,
        created_at: "2026-07-21T00:00:00.000Z",
        // Daemon row is OLDER than the local stub write.
        updated_at: "2026-07-20T23:59:00.000Z",
      },
    ],
    localConversations: [stubConv],
    state: bareState,
    includeArchived: false,
  });
  assert.equal(withDaemon.length, 1);
  assert.equal(
    withDaemon[0]?.status,
    "running",
    "a newer statusless stub must not flip a live daemon status",
  );
  assert.equal(
    withDaemon[0]?.exit_code,
    null,
    "a newer statusless stub must not fabricate an exit code",
  );
  assert.equal(
    withDaemon[0]?.updated_at,
    "2026-07-21T00:00:00.000Z",
    "message-authoritative local timestamp still wins for ordering",
  );
}

console.log("session-list-merge.test.ts: ok");
