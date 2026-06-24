import assert from "node:assert/strict";

import type { SessionRow } from "../types.ts";
import { projectStats } from "./project-stats.ts";

const row = (over: Partial<SessionRow>): SessionRow => ({
  id: "x", project_root: "/p", harness: "codex", title: "t", status: "idle",
  exit_code: null, archived_at: null, created_at: "", updated_at: "", ...over,
});

assert.deepEqual(projectStats([]), { total: 0, running: 0, tasks: 0, failed: 0 });

const chats = [
  row({ status: "running" }),
  row({ status: "running", origin: "board", title: "Task: a" }), // running AND task
  row({ status: "failed", title: "Task: b" }),                   // failed AND task
  row({ status: "error" }),
  row({ status: "done", title: "plain chat" }),
];

assert.deepEqual(projectStats(chats), { total: 5, running: 2, tasks: 2, failed: 2 });

console.log("project-stats.test.ts: ok");
