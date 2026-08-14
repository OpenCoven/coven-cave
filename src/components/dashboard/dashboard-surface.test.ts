import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./dashboard-surface.tsx", import.meta.url), "utf8");

test("the embedded dashboard seeds and refreshes the shared bento surface", () => {
  assert.match(source, /buildDashboardModel/);
  assert.match(source, /fetch\("\/api\/inbox"/);
  assert.match(source, /<BentoDashboard model=\{model\} \/>/);
  assert.match(source, /workspace-dashboard-surface/);
});
