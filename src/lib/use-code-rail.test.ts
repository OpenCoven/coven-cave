import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_RAIL_PIN_KEY, parsePinned, serializePinned } from "./use-code-rail.ts";
import { resolveCodeRail, type CodeRailState } from "./code-rail.ts";

// The hook commits the resolved state as `prev` on every render so `changeCount`
// is never stale. This asserts the sequence contract that relies on: a batch
// that clears and a new one that arrives must still re-reveal to Changes.
test("2→0→3 edit sequence re-reveals to Changes when prev tracks every tick", () => {
  let prev: CodeRailState | null = null;
  const step = (changeCount: number) =>
    (prev = resolveCodeRail(
      { hasRepo: true, changeCount, terminalActive: false, pinned: false, dismissed: false },
      prev,
    ));
  step(2); // edits appear
  step(0); // cleared — prev.changeCount must become 0
  const r = step(3); // fresh batch → re-reveal
  assert.equal(r.open, true);
  assert.equal(r.activeTab, "changes");
});

test("pin key is versioned", () => {
  assert.equal(CODE_RAIL_PIN_KEY, "cave:code-rail:pinned:v1");
});
test("parsePinned tolerates junk", () => {
  assert.equal(parsePinned("true"), true);
  assert.equal(parsePinned("false"), false);
  assert.equal(parsePinned(null), false);
  assert.equal(parsePinned("garbage"), false);
});
test("serializePinned round-trips", () => {
  assert.equal(parsePinned(serializePinned(true)), true);
  assert.equal(parsePinned(serializePinned(false)), false);
});

// Closed-by-default rail (cave-xsq.7): the hook seeds `dismissed` as TRUE so a
// repo-linked session opens with the conversation owning the pane; the rail
// opens on demand (pin / reopen / explicit focus target / a genuinely observed
// fresh edit batch). Source pin — the initial useState is the contract.
test("the rail rests closed: dismissed seeds true", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./use-code-rail.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /const \[dismissed, setDismissed\] = useState\(true\)/,
    "dismissed defaults to true — the rail is closed at rest (cave-xsq.7)",
  );
});
