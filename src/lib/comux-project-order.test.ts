// @ts-nocheck
import assert from "node:assert/strict";
import { orderProjects, toggleProjectPin, isProjectPinned } from "./comux-project-order.ts";

function proj(root, name = root) {
  return { name, root, sessionCount: 0, runningCount: 0, familiarCount: 0, latestSessionId: null, updatedAt: null };
}

// ── orderProjects: no order, no pins → identity ──
{
  const ps = [proj("/a"), proj("/b"), proj("/c")];
  const out = orderProjects(ps, [], []);
  assert.deepEqual(out.map((p) => p.root), ["/a", "/b", "/c"], "empty order + pins is a no-op");
}

// ── manual order reorders; unranked keep incoming order, appended after ──
{
  const ps = [proj("/a"), proj("/b"), proj("/c"), proj("/d")];
  const out = orderProjects(ps, ["/c", "/a"], []);
  assert.deepEqual(out.map((p) => p.root), ["/c", "/a", "/b", "/d"], "ranked first in order, then the rest in incoming order");
}

// ── pins float to top, preserving their relative (post-order) position ──
{
  const ps = [proj("/a"), proj("/b"), proj("/c"), proj("/d")];
  const out = orderProjects(ps, [], ["/c"]);
  assert.deepEqual(out.map((p) => p.root), ["/c", "/a", "/b", "/d"], "a single pin rises to the top");
}
{
  const ps = [proj("/a"), proj("/b"), proj("/c"), proj("/d")];
  // order says d,c,b,a; pins b and d → among ordered [d,c,b,a], pinned [d,b] float keeping that order
  const out = orderProjects(ps, ["/d", "/c", "/b", "/a"], ["/b", "/d"]);
  assert.deepEqual(out.map((p) => p.root), ["/d", "/b", "/c", "/a"], "pins float keeping their ordered relative position");
}

// ── pure: does not mutate the input array ──
{
  const ps = [proj("/a"), proj("/b")];
  const copy = ps.slice();
  orderProjects(ps, ["/b"], ["/b"]);
  assert.deepEqual(ps, copy, "input array is not mutated");
}

// ── toggleProjectPin / isProjectPinned ──
{
  let pins = [];
  assert.equal(isProjectPinned(pins, "/a"), false);
  pins = toggleProjectPin(pins, "/a");
  assert.deepEqual(pins, ["/a"], "pin adds");
  assert.equal(isProjectPinned(pins, "/a"), true);
  pins = toggleProjectPin(pins, "/b");
  assert.deepEqual(pins, ["/a", "/b"], "second pin appends");
  pins = toggleProjectPin(pins, "/a");
  assert.deepEqual(pins, ["/b"], "toggling an existing pin removes it");
}

console.log("comux-project-order.test.ts: order + pin ok");
