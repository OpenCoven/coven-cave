import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const view = readFileSync(path.join(root, "src/components/github-view.tsx"), "utf8");
const listCss = readFileSync(path.join(root, "src/styles/board/github-list.css"), "utf8");
const detailCss = readFileSync(path.join(root, "src/styles/board/github-detail.css"), "utf8");

// cave-cadp4. Clicking Start in the "what to do next" drawer opened a panel
// that rendered as an unreadable clipped sliver. The panel was fine; its
// POSITIONING CONTEXT was not — `.gh-action-popover` was absolutely positioned
// and opened downward out of `.gh-next-body`, a short scroll container.
//
// These are source-text guards rather than a rendered check on purpose: the
// Code Desk is role-gated behind a familiar with the coding room, so it cannot
// be driven headlessly here. What can be pinned is the structural property that
// made the bug possible, so it cannot come back by someone re-adding
// positioning or hand-rolling another panel.
describe("Code Desk action popovers stay portalled (cave-cadp4)", () => {
  it("keeps the drawer body a scroll container — the reason portalling matters", () => {
    // If this stops being true the guard below is merely tidy rather than
    // load-bearing, and whoever changes it should know that.
    const body = /\.gh-next-body\s*\{[^}]*\}/.exec(detailCss)?.[0] ?? "";
    assert.match(body, /overflow-y\s*:\s*auto/, ".gh-next-body still scrolls");
  });

  it("never positions the action popover itself", () => {
    const rule = /\.gh-action-popover\s*\{[^}]*\}/.exec(listCss)?.[0] ?? "";
    assert.ok(rule.length > 0, ".gh-action-popover rule exists");
    assert.doesNotMatch(
      rule,
      /position\s*:\s*absolute/,
      "position belongs to the shared Popover, which portals out of the clipping ancestor",
    );
    assert.doesNotMatch(rule, /\btop\s*:/, "no anchor offset — Popover computes placement");
  });

  it("renders every action panel through the shared Popover", () => {
    // Four panels: Start's card picker and wide popover, Task's popover, and
    // Merge's familiar picker. Counting them stops a fifth being hand-rolled
    // back into an absolute div.
    const panels = view.match(/className="gh-action-popover[^"]*"/g) ?? [];
    const containers = panels.filter((c) => !/-(title|list|item|item-title|item-familiar)/.test(c));
    assert.equal(containers.length, 4, "four action panels");
    for (const cls of containers) {
      const at = view.indexOf(cls);
      const before = view.slice(Math.max(0, at - 400), at);
      assert.match(
        before,
        /<Popover\b/,
        `panel ${cls} is a Popover child, not a positioned div`,
      );
    }
  });

  it("never lets a Popover child position ITSELF (cave-7dktt)", () => {
    // The clipping fix alone was not enough, and this guard is the reason to
    // say so. GitHubActionPopover renders its root `absolute right-0 top-full`,
    // which is out of flow — so the Popover wrapper measured ZERO height, its
    // auto-flip saw room below that did not exist, and the dialog ran off the
    // bottom of the viewport (measured: dialog bottom 1004 in a 900px view).
    //
    // A panel that is unclipped but off-screen is no better than a clipped one,
    // and the assertions above all passed while that was true — they check
    // clipping, which stayed fixed. So check placement ownership too.
    const actionPopover = readFileSync(
      path.join(root, "src/components/github-action-popover.tsx"),
      "utf8",
    );
    assert.match(
      actionPopover,
      /positioned\s*=\s*true/,
      "GitHubActionPopover takes a `positioned` prop, defaulting to its standalone behaviour",
    );
    assert.match(
      actionPopover,
      /positioned \? "absolute right-0 top-full/,
      "and drops its own absolute placement when it is false",
    );
    // Every use inside a Popover must hand placement over.
    const uses = view.split("<GitHubActionPopover").slice(1);
    assert.equal(uses.length, 2, "two GitHubActionPopover call sites");
    for (const use of uses) {
      assert.match(
        use.slice(0, 200),
        /positioned=\{false\}/,
        "a GitHubActionPopover inside a Popover must not position itself",
      );
    }
  });

  it("leaves dismissal to the Popover rather than re-adding document listeners", () => {
    // Two hand-rolled outside-click/Escape effects were removed with the
    // migration; Popover owns dismissal for all four panels now.
    assert.doesNotMatch(
      view,
      /Close the (multi-card|familiar) picker on outside click/,
      "no hand-rolled picker dismissal remains",
    );
  });
});
