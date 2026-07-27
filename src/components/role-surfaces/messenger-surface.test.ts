import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surface = readFileSync(new URL("./messenger-surface.tsx", import.meta.url), "utf8");

const section = (start: string, end: string) => {
  const from = surface.indexOf(start);
  const to = surface.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} section missing`);
  return surface.slice(from, to);
};

test("inbox loading, failure, and successful empty states stay distinct", () => {
  const inbox = section('<RailSection title="Inbox"', '<RailSection title="Awaiting approval"');
  assert.match(surface, /import[\s\S]*?\bSurfaceLoading\b[\s\S]*?from "\.\/surface-room"/);
  assert.match(surface, /import[\s\S]*?\bSurfaceError\b[\s\S]*?from "\.\/surface-room"/);
  assert.match(surface, /const fetchInbox = useCallback\(async \(\) =>/);
  assert.match(
    surface,
    /useLatestAsyncData<InboxItemWire\[\]>\(\{[\s\S]*?scopeKey: familiarId[\s\S]*?load: fetchInbox[\s\S]*?errorMessage: "Couldn't load the inbox\."/,
  );
  assert.doesNotMatch(
    surface,
    /catch\s*\{[\s\S]*?return \[\][\s\S]*?\}/,
    "an inbox failure must not masquerade as a successful empty inbox",
  );
  assert.match(
    inbox,
    /inboxError\s*\?\s*\([\s\S]*?<SurfaceError[\s\S]*?onRetry=\{loadInbox\}[\s\S]*?\)\s*:\s*inbox == null\s*\?\s*\([\s\S]*?<SurfaceLoading/,
  );
  assert.match(inbox, /inbox\.length === 0\s*\?\s*\([\s\S]*?<SurfaceEmpty/);
});

test("scheduled deliveries do not turn inbox loading or failure into an empty schedule", () => {
  const scheduled = section('<RailSection title="Scheduled"', '<RailSection title="Recent sends"');
  assert.match(
    scheduled,
    /inboxError\s*\?\s*\([\s\S]*?<SurfaceError[\s\S]*?onRetry=\{loadInbox\}[\s\S]*?\)\s*:\s*inbox == null\s*\?\s*\([\s\S]*?<SurfaceLoading/,
  );
  assert.match(scheduled, /scheduled\.length === 0\s*\?\s*\([\s\S]*?<SurfaceEmpty/);
  assert.match(scheduled, /<SurfaceError[\s\S]*?live=\{false\}/, "the scheduled duplicate is non-live");
  assert.match(
    scheduled,
    /<SurfaceLoading label="Loading scheduled messages…" live=\{false\}/,
    "the scheduled loading copy is also non-live",
  );
});
