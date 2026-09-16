import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./dashboard-surface.tsx", import.meta.url), "utf8");

test("the embedded dashboard delegates reads to the shared bento surface", () => {
  assert.doesNotMatch(source, /fetch\(|useEffect|buildDashboardModel/);
  assert.match(source, /<BentoDashboard \/>/);
  assert.match(source, /workspace-dashboard-surface/);
});
