import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surface = readFileSync(new URL("./messenger-surface.tsx", import.meta.url), "utf8");

test("inbox loading, failure, and successful empty states stay distinct", () => {
  assert.match(surface, /import[\s\S]*?\bSurfaceLoading\b[\s\S]*?from "\.\/surface-room"/);
  assert.match(surface, /import[\s\S]*?\bSurfaceError\b[\s\S]*?from "\.\/surface-room"/);
  assert.match(surface, /const \[inbox, setInbox\] = useState<InboxItemWire\[\] \| null>\(null\)/);
  assert.match(surface, /const \[inboxError, setInboxError\] = useState<string \| null>\(null\)/);
  assert.match(surface, /const loadInbox = useCallback\(async \(\) =>/);
  assert.doesNotMatch(
    surface,
    /catch\s*\{[\s\S]*?setInbox\(\[\]\)[\s\S]*?\}/,
    "an inbox failure must not masquerade as a successful empty inbox",
  );
  assert.match(
    surface,
    /inboxError\s*\?\s*\([\s\S]*?<SurfaceError[\s\S]*?onRetry=\{loadInbox\}[\s\S]*?\)\s*:\s*inbox == null\s*\?\s*\([\s\S]*?<SurfaceLoading/,
  );
  assert.match(surface, /inbox\.length === 0\s*\?\s*\([\s\S]*?<SurfaceEmpty/);
});
