import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collapseFamiliarWorkspaceSessions,
  isFamiliarWorkspaceRoot,
} from "./familiar-workspace-sessions.ts";
import type { SessionRow } from "./types.ts";

const WS_ROOT = "/Users/buns/.coven/workspaces/familiars";

function row(id: string, projectRoot: string): SessionRow {
  return {
    id,
    project_root: projectRoot,
    harness: "chat",
    title: id,
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-07-21T00:00:00Z",
    updated_at: "2026-07-21T00:00:00Z",
    familiarId: null,
    origin: "chat",
  } as SessionRow;
}

describe("isFamiliarWorkspaceRoot", () => {
  it("matches the workspace root itself", () => {
    assert.equal(isFamiliarWorkspaceRoot(`${WS_ROOT}/nova`, WS_ROOT), true);
  });

  it("matches nested subdirs (notes/, memory/)", () => {
    assert.equal(isFamiliarWorkspaceRoot(`${WS_ROOT}/sage/notes`, WS_ROOT), true);
  });

  it("tolerates trailing slashes on either side", () => {
    assert.equal(isFamiliarWorkspaceRoot(`${WS_ROOT}/cody/`, `${WS_ROOT}/`), true);
  });

  it("does NOT match real project roots", () => {
    assert.equal(
      isFamiliarWorkspaceRoot("/Users/buns/Documents/GitHub/OpenCoven/coven-cave", WS_ROOT),
      false,
    );
  });

  it("does NOT match a sibling path that only shares a string prefix", () => {
    // `${WS_ROOT}-archive` must not be treated as inside `${WS_ROOT}`.
    assert.equal(isFamiliarWorkspaceRoot(`${WS_ROOT}-archive/x`, WS_ROOT), false);
  });

  it("treats empty/rootless project as not-a-familiar-workspace", () => {
    assert.equal(isFamiliarWorkspaceRoot("", WS_ROOT), false);
    assert.equal(isFamiliarWorkspaceRoot(null, WS_ROOT), false);
    assert.equal(isFamiliarWorkspaceRoot(undefined, WS_ROOT), false);
  });

  it("matches declared (relocated) workspace roots too", () => {
    const declared = ["/opt/coven/nova-ws"];
    assert.equal(isFamiliarWorkspaceRoot("/opt/coven/nova-ws", WS_ROOT, declared), true);
    assert.equal(isFamiliarWorkspaceRoot("/opt/coven/nova-ws/notes", WS_ROOT, declared), true);
  });
});

describe("collapseFamiliarWorkspaceSessions", () => {
  it("drops familiar-workspace sessions but keeps project + rootless ones", () => {
    const sessions = [
      row("journal-nova", `${WS_ROOT}/nova`),
      row("journal-sage", `${WS_ROOT}/sage/notes`),
      row("real-project", "/Users/buns/Documents/GitHub/OpenCoven/coven-cave"),
      row("rootless", ""),
    ];
    const kept = collapseFamiliarWorkspaceSessions(sessions, WS_ROOT);
    assert.deepEqual(
      kept.map((s) => s.id),
      ["real-project", "rootless"],
    );
  });

  it("is a no-op when nothing is a familiar workspace", () => {
    const sessions = [row("a", "/repo/a"), row("b", "")];
    assert.equal(collapseFamiliarWorkspaceSessions(sessions, WS_ROOT).length, 2);
  });
});
