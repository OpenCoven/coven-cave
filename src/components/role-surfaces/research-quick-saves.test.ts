import assert from "node:assert/strict";
import test from "node:test";

import { draftTokens, matchReason, matchSavedLinks } from "./research-quick-saves";
import type { SavedLink } from "@/lib/link-organizer";

function link(patch: Partial<SavedLink> & Pick<SavedLink, "id" | "title">): SavedLink {
  return {
    url: `https://example.com/${patch.id}`,
    category: "article",
    addedAt: "2026-08-01T00:00:00.000Z",
    source: "chat",
    ...patch,
  };
}

test("draftTokens drops stopwords, short words and duplicates", () => {
  const tokens = draftTokens("Research and compare the rollback rollback strategies for agents");
  assert.deepEqual(tokens, ["rollback", "strategies", "agents"]);
});

test("draftTokens on an empty draft yields nothing to match", () => {
  assert.deepEqual(draftTokens(""), []);
  assert.deepEqual(draftTokens("the and for"), []);
});

test("matchReason quotes the word that matched, and is silent otherwise", () => {
  const entry = link({ id: "l1", title: "Checkpoint rollback guide" });
  assert.equal(matchReason(entry, ["rollback"]), "matches “rollback”");
  assert.equal(matchReason(entry, ["telemetry"]), null);
  assert.equal(matchReason(entry, []), null, "an empty draft suggests nothing");
});

test("matchReason also searches the URL", () => {
  const entry = link({ id: "l2", title: "Untitled", url: "https://github.com/acme/rollback-kit" });
  assert.equal(matchReason(entry, ["rollback"]), "matches “rollback”");
});

test("matchSavedLinks groups by category when the draft is empty", () => {
  const groups = matchSavedLinks(
    [
      link({ id: "a", title: "Repo", category: "github" }),
      link({ id: "b", title: "Paper", category: "paper" }),
      link({ id: "c", title: "Post", category: "article" }),
    ],
    "",
  );
  assert.equal(groups.some((group) => group.suggested), false);
  assert.deepEqual(groups.map((group) => group.links.length), [1, 1, 1]);
  // Category display order: github before paper before article.
  assert.deepEqual(groups.map((group) => group.id), [
    "category-github",
    "category-paper",
    "category-article",
  ]);
});

test("matchSavedLinks promotes matches into one suggested group, first", () => {
  const groups = matchSavedLinks(
    [
      link({ id: "a", title: "Rollback strategies for agents", category: "paper" }),
      link({ id: "b", title: "Unrelated cooking blog", category: "article" }),
    ],
    "Research rollback strategies",
  );
  assert.equal(groups[0].suggested, true);
  assert.equal(groups[0].links.length, 1);
  assert.equal(groups[0].links[0].link.id, "a");
  assert.equal(groups[0].links[0].why, "matches “rollback”");
});

test("a promoted link is not repeated in its category group", () => {
  const links = [
    link({ id: "a", title: "Rollback strategies", category: "paper" }),
    link({ id: "b", title: "Another paper", category: "paper" }),
  ];
  const groups = matchSavedLinks(links, "rollback");
  const seen = groups.flatMap((group) => group.links.map((entry) => entry.link.id));
  assert.deepEqual(seen.slice().sort(), ["a", "b"]);
  assert.equal(seen.length, new Set(seen).size, "each link appears exactly once");
});

test("counts across groups always sum to the input", () => {
  const links = Array.from({ length: 7 }, (_, index) =>
    link({ id: `l${index}`, title: `Rollback ${index}`, category: index % 2 ? "github" : "video" }),
  );
  for (const draft of ["", "rollback", "nothing matches here"]) {
    const total = matchSavedLinks(links, draft).reduce((sum, group) => sum + group.links.length, 0);
    assert.equal(total, links.length, `draft: ${draft || "(empty)"}`);
  }
});

test("no links means no groups at all", () => {
  assert.deepEqual(matchSavedLinks([], "rollback"), []);
});
