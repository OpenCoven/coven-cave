import assert from "node:assert/strict";

import {
  buildCanvasCommentsRequest,
  buildCanvasCommentsPrompt,
  removeCanvasAnnotationDraft,
  replaceCanvasAnnotationNote,
  upsertCanvasAnnotationDraft,
} from "./canvas-comments.ts";
import { sanitizeCanvasComponentTarget, type CanvasAnnotation } from "./canvas-artifacts.ts";

const now = "2026-07-20T09:00:00.000Z";
const target = {
  selector: "main > button",
  label: "Primary action",
  excerpt: "<button>Save changes</button>",
};

assert.equal(
  buildCanvasCommentsPrompt([
    {
      id: "blank",
      target,
      note: "   ",
      createdAt: now,
      updatedAt: now,
    },
  ]),
  "",
  "blank annotation notes do not create a generation prompt",
);

const prompt = buildCanvasCommentsPrompt([
  {
    id: "first",
    target,
    note: " Make this action more prominent. ",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "ignored",
    target: { selector: "footer", label: "Footer", excerpt: "<footer />" },
    note: "\n\t",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "second",
    target: {
      selector: "main > p",
      label: "Supporting copy",
      excerpt: "x".repeat(1_200),
    },
    note: "Shorten this copy.",
    createdAt: now,
    updatedAt: now,
  },
]);
assert.match(prompt, /2 component comments/, "prompt states the usable comment count");
assert.match(prompt, /Primary action/, "prompt includes each target label");
assert.match(prompt, /main > button/, "prompt includes each target selector");
assert.match(prompt, /<button>Save changes<\/button>/, "prompt includes a target excerpt");
assert.match(prompt, /Make this action more prominent\./, "prompt includes the requested note");
assert.match(prompt, /Shorten this copy\./, "prompt includes every usable note");
assert.ok(prompt.includes("x".repeat(1_000)), "prompt preserves excerpts up to the persisted bound");
assert.ok(!prompt.includes("x".repeat(1_001)), "prompt excerpts are bounded");
assert.match(prompt, /full revised artifact/i, "prompt requests the full revised artifact");
assert.match(prompt, /preserv(?:e|ing) unrelated behavior/i, "prompt preserves unrelated behavior");

const request = buildCanvasCommentsRequest([
  {
    id: "first",
    target,
    note: " Make this action more prominent. ",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "blank",
    target,
    note: " ",
    createdAt: now,
    updatedAt: "2026-07-20T09:01:00.000Z",
  },
  {
    id: "invalid-target",
    target: { selector: "", label: "Invalid", excerpt: "" },
    note: "Do not apply",
    createdAt: now,
    updatedAt: "2026-07-20T09:02:00.000Z",
  },
]);
assert.match(request.prompt, /Make this action more prominent\./, "request carries the generated prompt");
assert.deepEqual(
  request.resolvedAnnotations,
  [{ id: "first", updatedAt: now }],
  "resolution tokens capture exactly the annotations included in generation",
);
assert.match(
  buildCanvasCommentsPrompt([{
    id: "one",
    target,
    note: "Adjust spacing",
    createdAt: now,
    updatedAt: now,
  }]),
  /1 component comment\b/,
  "singular prompts still state the count clearly",
);
const trimmedPrompt = buildCanvasCommentsPrompt([{
  id: "trimmed",
  target: {
    selector: "  main > article  ",
    label: "  Feature card  ",
    excerpt: "  <article />  ",
  },
  note: "  Tighten this layout.  ",
  createdAt: now,
  updatedAt: now,
}]);
assert.match(
  trimmedPrompt,
  /Target: Feature card\nSelector: main > article\nExcerpt: <article \/>\nRequested change: Tighten this layout\./,
  "prompt trims target context and notes",
);

const created = upsertCanvasAnnotationDraft([], target, { id: "draft-1", now });
assert.deepEqual(created, [{
  id: "draft-1",
  target,
  note: "",
  createdAt: now,
  updatedAt: now,
}], "selecting a new target creates one empty annotation draft");

const reused = upsertCanvasAnnotationDraft(created, { ...target, label: "Updated label" }, {
  id: "unused",
  now: "2026-07-20T09:01:00.000Z",
});
assert.equal(reused.length, 1, "selecting the same selector does not duplicate its draft");
assert.equal(reused[0].id, "draft-1", "same-selector selection reuses the existing identity");
assert.equal(reused[0].target.label, "Updated label", "reused drafts refresh bounded target context");

const withNote = replaceCanvasAnnotationNote(
  reused,
  "draft-1",
  "Increase contrast",
  "2026-07-20T09:02:00.000Z",
);
assert.equal(withNote[0].note, "Increase contrast", "draft notes can be replaced");
assert.equal(withNote[0].updatedAt, "2026-07-20T09:02:00.000Z", "note edits update the timestamp");
assert.equal(
  replaceCanvasAnnotationNote(reused, "draft-1", "n".repeat(4_100), now)[0].note.length,
  4_000,
  "draft note edits stay within the persisted annotation bound",
);
assert.deepEqual(removeCanvasAnnotationDraft(withNote, "draft-1"), [], "drafts can be removed");

assert.deepEqual(
  sanitizeCanvasComponentTarget({
    selector: ` ${"s".repeat(600)} `,
    label: ` ${"l".repeat(300)} `,
    excerpt: ` ${"e".repeat(1_100)} `,
  }),
  {
    selector: "s".repeat(500),
    label: "l".repeat(200),
    excerpt: "e".repeat(1_000),
  },
  "selected targets use the persisted Canvas bounds",
);
assert.equal(
  sanitizeCanvasComponentTarget({ selector: " ", label: "x", excerpt: "x" }),
  null,
  "blank selectors are rejected",
);

const boundedPrompt = buildCanvasCommentsPrompt(Array.from({ length: 101 }, (_, index) => ({
  id: `bounded-${index}`,
  target: index === 100
    ? { selector: "#beyond-cap", label: "Beyond cap", excerpt: "BEYOND_CAP_EXCERPT" }
    : {
        selector: ` ${"s".repeat(500)}${index === 0 ? "SELECTOR_OVERFLOW" : `-${index}`} `,
        label: ` ${"l".repeat(200)}${index === 0 ? "LABEL_OVERFLOW" : `-${index}`} `,
        excerpt: ` ${"e".repeat(1_000)}${index === 0 ? "EXCERPT_OVERFLOW" : `-${index}`} `,
      },
  note: index === 100
    ? "BEYOND_CAP_NOTE"
    : index === 1
    ? " ".repeat(4_100)
    : ` ${"n".repeat(4_000)}${index === 0 ? "NOTE_OVERFLOW" : `-${index}`} `,
  createdAt: now,
  updatedAt: now,
})));
assert.match(boundedPrompt, /99 component comments/, "blank notes are ignored within the first 100 annotations");
assert.ok(boundedPrompt.includes("s".repeat(500)), "prompt keeps selectors up to the persisted bound");
assert.ok(boundedPrompt.includes("l".repeat(200)), "prompt keeps labels up to the persisted bound");
assert.ok(boundedPrompt.includes("e".repeat(1_000)), "prompt keeps excerpts up to the persisted bound");
assert.ok(boundedPrompt.includes("n".repeat(4_000)), "prompt keeps notes up to the persisted bound");
assert.ok(!boundedPrompt.includes("SELECTOR_OVERFLOW"), "prompt excludes selector data beyond the persisted bound");
assert.ok(!boundedPrompt.includes("LABEL_OVERFLOW"), "prompt excludes label data beyond the persisted bound");
assert.ok(!boundedPrompt.includes("EXCERPT_OVERFLOW"), "prompt excludes excerpt data beyond the persisted bound");
assert.ok(!boundedPrompt.includes("NOTE_OVERFLOW"), "prompt excludes note data beyond the persisted bound");
assert.ok(!boundedPrompt.includes("BEYOND_CAP"), "prompt excludes annotations beyond the persisted count bound");

const trimmedDraft = upsertCanvasAnnotationDraft([], {
  selector: ` ${"s".repeat(500)}SELECTOR_OVERFLOW `,
  label: ` ${"l".repeat(200)}LABEL_OVERFLOW `,
  excerpt: ` ${"e".repeat(1_000)}EXCERPT_OVERFLOW `,
}, { id: "bounded-draft", now });
assert.deepEqual(trimmedDraft[0].target, {
  selector: "s".repeat(500),
  label: "l".repeat(200),
  excerpt: "e".repeat(1_000),
}, "new drafts trim and bound target context like the persisted model");

const fullDrafts: CanvasAnnotation[] = Array.from({ length: 100 }, (_, index) => ({
  id: `draft-${index}`,
  target: {
    selector: `#target-${index}`,
    label: `Target ${index}`,
    excerpt: `<div>${index}</div>`,
  },
  note: "",
  createdAt: now,
  updatedAt: now,
}));
const capped = upsertCanvasAnnotationDraft(
  fullDrafts,
  { selector: "#new-target", label: "New", excerpt: "<div />" },
  { id: "overflow", now },
);
assert.equal(capped.length, 100, "selecting a new target never grows drafts beyond the persisted limit");
assert.ok(!capped.some((annotation) => annotation.id === "overflow"), "over-cap drafts are not inserted");
assert.strictEqual(
  capped,
  fullDrafts,
  "rejecting a new target at the annotation cap preserves identity so callers skip persistence",
);

const reusedAtCap = upsertCanvasAnnotationDraft(
  fullDrafts,
  { selector: " #target-99 ", label: " Refreshed ", excerpt: " <button /> " },
  { id: "unused-at-cap", now: "2026-07-20T09:03:00.000Z" },
);
assert.equal(reusedAtCap.length, 100, "reusing a selector at cap preserves the draft count");
assert.equal(reusedAtCap[99].id, "draft-99", "an existing selector is reused even when drafts are at cap");
assert.deepEqual(reusedAtCap[99].target, {
  selector: "#target-99",
  label: "Refreshed",
  excerpt: "<button />",
}, "reused drafts receive trimmed and bounded target context");

const unchanged: CanvasAnnotation[] = [{
  id: "other",
  target: { selector: "#other", label: "Other", excerpt: "<div />" },
  note: "Keep me",
  createdAt: now,
  updatedAt: now,
}];
assert.strictEqual(
  replaceCanvasAnnotationNote(unchanged, "missing", "no-op", now),
  unchanged,
  "editing an unknown draft preserves the original array",
);

console.log("canvas comments helpers: ok");
