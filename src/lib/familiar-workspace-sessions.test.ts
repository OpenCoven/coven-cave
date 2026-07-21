import { describe, expect, it } from "vitest";

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
    expect(isFamiliarWorkspaceRoot(`${WS_ROOT}/nova`, WS_ROOT)).toBe(true);
  });

  it("matches nested subdirs (notes/, memory/)", () => {
    expect(isFamiliarWorkspaceRoot(`${WS_ROOT}/sage/notes`, WS_ROOT)).toBe(true);
  });

  it("tolerates trailing slashes on either side", () => {
    expect(isFamiliarWorkspaceRoot(`${WS_ROOT}/cody/`, `${WS_ROOT}/`)).toBe(true);
  });

  it("does NOT match real project roots", () => {
    expect(
      isFamiliarWorkspaceRoot("/Users/buns/Documents/GitHub/OpenCoven/coven-cave", WS_ROOT),
    ).toBe(false);
  });

  it("does NOT match a sibling path that only shares a string prefix", () => {
    // `${WS_ROOT}-archive` must not be treated as inside `${WS_ROOT}`.
    expect(isFamiliarWorkspaceRoot(`${WS_ROOT}-archive/x`, WS_ROOT)).toBe(false);
  });

  it("treats empty/rootless project as not-a-familiar-workspace", () => {
    expect(isFamiliarWorkspaceRoot("", WS_ROOT)).toBe(false);
    expect(isFamiliarWorkspaceRoot(null, WS_ROOT)).toBe(false);
    expect(isFamiliarWorkspaceRoot(undefined, WS_ROOT)).toBe(false);
  });

  it("matches declared (relocated) workspace roots too", () => {
    const declared = ["/opt/coven/nova-ws"];
    expect(isFamiliarWorkspaceRoot("/opt/coven/nova-ws", WS_ROOT, declared)).toBe(true);
    expect(isFamiliarWorkspaceRoot("/opt/coven/nova-ws/notes", WS_ROOT, declared)).toBe(true);
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
    expect(kept.map((s) => s.id)).toEqual(["real-project", "rootless"]);
  });

  it("is a no-op when nothing is a familiar workspace", () => {
    const sessions = [row("a", "/repo/a"), row("b", "")];
    expect(collapseFamiliarWorkspaceSessions(sessions, WS_ROOT)).toHaveLength(2);
  });
});
