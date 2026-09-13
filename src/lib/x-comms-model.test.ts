/**
 * The X Comms room's rules, tested without a DOM.
 *
 * The wiring half lives in `x-comms-surface.behavior.test.tsx`; what is pinned
 * here is what the room will and will not let a person approve, and the two
 * places it deliberately does NOT reimplement an existing rule.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import {
  altFromPrompt,
  approvalBlocker,
  clockLabel,
  countdownLabel,
  dayLabel,
  derivedTitle,
  formatCount,
  isEditable,
  mediaAffordances,
  nextSlot,
  queuedApiCost,
  ruleChips,
  shippedPosts,
  slotAt,
  titleOf,
  X_DM_WEIGHTED_LIMIT,
  X_POST_WEIGHTED_LIMIT,
  xWeightedLength,
  type XArticleDraft,
  type XPostBody,
  type XPostDraft,
} from "./x-comms-model.ts";

// A Sunday in PDT, 16:40 UTC = 9:40 AM PT.
const NOW = Date.parse("2026-09-13T16:40:00Z");

const body = (text: string, media: XPostBody["media"] = [], poll: XPostBody["poll"] = null): XPostBody => ({
  text,
  media,
  poll,
});

const post = (over: Partial<XPostDraft> = {}): XPostDraft => ({
  id: "t1",
  kind: "post",
  type: "post",
  target: "",
  posts: [body("A perfectly ordinary post.")],
  replyPermission: "everyone",
  tone: "neutral",
  status: "draft",
  notes: "",
  createdAt: NOW,
  revisions: [],
  ...over,
});

const article = (over: Partial<XArticleDraft> = {}): XArticleDraft => ({
  id: "a1",
  kind: "article",
  title: "A title",
  body: Array.from({ length: 60 }, (_, i) => `word${i}`).join(" "),
  inline: [],
  tone: "neutral",
  status: "draft",
  notes: "",
  createdAt: NOW,
  revisions: [],
  ...over,
});

// ── Counting ────────────────────────────────────────────────────────────────

test("the limit is the composer library's, not a second copy", () => {
  // Two surfaces disagreeing about whether the same draft fits is the exact
  // failure re-implementing xlen() here would produce.
  const source = readFileSync(new URL("./x-comms-model.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /from "@\/lib\/x-publish-composer"/,
    "the model imports the shared composer library",
  );
  assert.match(source, /weightedPostLength/, "counting goes through weightedPostLength");
  assert.equal(X_POST_WEIGHTED_LIMIT, 280);
});

test("a link counts as 23 however long it is", () => {
  const short = xWeightedLength("see https://x.com/a");
  const long = xWeightedLength(
    "see https://x.com/a/very/long/path/that/keeps/going/and/going/and/going",
  );
  assert.equal(short, long, "link length does not change the count");
  assert.equal(short, "see ".length + 23);
});

test("counting inherits the composer's weighting, so an emoji is 2 and not 2 code points", () => {
  // "🙂" is one code point outside the weight-1 ranges: X charges 2, and
  // `text.length` would say 2 for the wrong reason (a surrogate pair).
  assert.equal(xWeightedLength("🙂"), 2);
  // A CJK character is one JS char but still costs 2.
  assert.equal(xWeightedLength("字"), 2);
  assert.equal(xWeightedLength("ab"), 2);
});

test("a DM is measured against the DM limit, not 280", () => {
  const long = "x".repeat(500);
  assert.equal(approvalBlocker(post({ posts: [body(long)] }), "connected"), "a post is over the limit");
  assert.equal(
    approvalBlocker(post({ type: "dm", target: "@rae", posts: [body(long)] }), "connected"),
    "",
    "500 chars is nowhere near the DM limit",
  );
  assert.equal(X_DM_WEIGHTED_LIMIT, 10_000);
});

// ── Approval gate ───────────────────────────────────────────────────────────

test("an ordinary draft is approvable", () => {
  assert.equal(approvalBlocker(post(), "connected"), "");
});

test("a disconnected account blocks before any content rule is consulted", () => {
  // Order matters: the account-level reason is the actionable one, and a
  // content complaint underneath it would send someone editing for nothing.
  const broken = post({ posts: [body("#hashtag over the room rule")] });
  assert.match(approvalBlocker(broken, "disconnected"), /^X disconnected/);
});

test("the room's own rules block, with the rule named", () => {
  assert.equal(
    approvalBlocker(post({ posts: [body("ship it #launch")] }), "connected"),
    "room rule · no hashtags",
  );
  assert.equal(
    approvalBlocker(
      post({ posts: [body("https://a.example/one and https://b.example/two")] }),
      "connected",
    ),
    "room rule · 1 link max",
  );
});

test("a DM is exempt from the timeline-only room rules", () => {
  const dm = post({ type: "dm", target: "@rae", posts: [body("hi #there")] });
  assert.equal(approvalBlocker(dm, "connected"), "", "hashtags are a timeline rule");
});

test("a destination is required, and then required to be valid", () => {
  assert.equal(
    approvalBlocker(post({ type: "reply" }), "connected"),
    "add the post URL to continue",
  );
  assert.equal(
    approvalBlocker(post({ type: "reply", target: "sarahdev" }), "connected"),
    "fix the destination to continue",
  );
  assert.equal(
    approvalBlocker(
      post({ type: "reply", target: "https://x.com/sarahdev/status/1834401192837472256" }),
      "connected",
    ),
    "",
  );
});

test("an attachment without alt text blocks approval", () => {
  const withImage = post({
    posts: [body("look", [{ kind: "image", alt: "" }])],
  });
  assert.equal(approvalBlocker(withImage, "connected"), "every attachment needs alt text");

  const described = post({
    posts: [body("look", [{ kind: "image", alt: "A diagram" }])],
  });
  assert.equal(approvalBlocker(described, "connected"), "");
});

test("a poll needs two filled options, not two option slots", () => {
  const halfFilled = post({
    posts: [body("pick", [], { options: ["one", "   "], duration: "1d" })],
  });
  assert.equal(approvalBlocker(halfFilled, "connected"), "polls need two filled options");
});

test("an empty draft asks for words before it asks for anything else", () => {
  assert.equal(approvalBlocker(post({ posts: [body("   ")] }), "connected"), "write something first");
});

test("an article has its own gate", () => {
  assert.equal(approvalBlocker(article({ title: " " }), "connected"), "add a title to continue");
  assert.equal(
    approvalBlocker(article({ body: "too short" }), "connected"),
    "articles need at least 50 words",
  );
  assert.equal(
    approvalBlocker(
      article({ cover: { kind: "image", alt: "" } }),
      "connected",
    ),
    "every image needs alt text",
  );
  assert.equal(approvalBlocker(article(), "connected"), "");
});

test("only a thread ships its later posts", () => {
  const posts = [body("one"), body("two"), body("three")];
  assert.equal(shippedPosts(post({ posts })).length, 1, "a single post ships one");
  assert.equal(shippedPosts(post({ type: "thread", posts })).length, 3);
  // …and the gate only measures what ships, so an over-limit orphan does not block.
  assert.equal(
    approvalBlocker(post({ posts: [body("fine"), body("x".repeat(400))] }), "connected"),
    "",
  );
});

test("a posted draft is no longer editable", () => {
  assert.equal(isEditable(post({ status: "draft" })), true);
  assert.equal(isEditable(post({ status: "needs-approval" })), true);
  assert.equal(isEditable(post({ status: "revoked" })), true);
  assert.equal(isEditable(post({ status: "approved" })), false);
  assert.equal(isEditable(post({ status: "posted" })), false);
});

// ── Rule chips ──────────────────────────────────────────────────────────────

test("every rule chip names its source and whether it blocks", () => {
  for (const chip of ruleChips(post({ posts: [body("ship it #launch")] }))) {
    assert.match(chip.tip, /source: room rules · ward\.toml/, `${chip.label} names its source`);
    assert.match(
      chip.tip,
      chip.passing ? /passing$/ : /blocks Request approval$/,
      `${chip.label} says whether it blocks`,
    );
  }
});

test("the alt-text chip appears only once there is something to describe", () => {
  const labels = (draft: XPostDraft) => ruleChips(draft).map((chip) => chip.label);
  assert.ok(!labels(post()).includes("alt text"), "no attachments, no alt rule");
  assert.ok(
    labels(post({ posts: [body("x", [{ kind: "image", alt: "" }])] })).includes("alt text"),
  );
});

test("a failing chip is reported failing", () => {
  const chips = ruleChips(post({ posts: [body("ship it #launch")] }));
  const hashtags = chips.find((chip) => chip.label === "no hashtags");
  assert.ok(hashtags && !hashtags.passing, "the hashtag rule fails on a hashtag");
  const limit = chips.find((chip) => chip.label === "280 chars");
  assert.ok(limit?.passing, "a short post passes the length rule");
});

// ── Time ────────────────────────────────────────────────────────────────────

test("slots are quoted in the account's zone, across DST", () => {
  // September is PDT (UTC-7): 18:10 PT is 01:10 UTC the next day.
  const september = slotAt(Date.parse("2026-09-13T16:40:00Z"), 0, 18);
  assert.equal(new Date(september).toISOString(), "2026-09-14T01:10:00.000Z");
  // January is PST (UTC-8): the same wall clock is an hour later in UTC. A
  // fixed -7 offset would put this at 01:10 and be wrong for four months.
  const january = slotAt(Date.parse("2026-01-13T16:40:00Z"), 0, 18);
  assert.equal(new Date(january).toISOString(), "2026-01-14T02:10:00.000Z");
});

test("the next slot is today's if it is still ahead, tomorrow's otherwise", () => {
  const morning = Date.parse("2026-09-13T16:40:00Z"); // 9:40 AM PT
  assert.equal(nextSlot(morning), slotAt(morning, 0, 18), "the evening slot is still ahead");
  const night = Date.parse("2026-09-14T05:00:00Z"); // 10 PM PT, past the slot
  assert.equal(nextSlot(night), slotAt(night, 1, 18), "rolls to tomorrow");
});

test("days near now are named, and days further out are dated", () => {
  assert.equal(dayLabel(NOW, NOW), "Today");
  assert.equal(dayLabel(NOW, slotAt(NOW, 1, 12)), "Tomorrow");
  assert.equal(dayLabel(NOW, slotAt(NOW, -1, 12)), "Yesterday");
  assert.equal(dayLabel(NOW, slotAt(NOW, 3, 12)), "Wed");
  assert.match(dayLabel(NOW, slotAt(NOW, 20, 12)), /^[A-Z][a-z]{2} \d+$/);
});

test("the clock reads as a 12-hour wall clock in the account's zone", () => {
  assert.equal(clockLabel(slotAt(NOW, 0, 18, 10)), "6:10 PM");
  assert.equal(clockLabel(slotAt(NOW, 0, 0, 5)), "12:05 AM");
  assert.equal(clockLabel(slotAt(NOW, 0, 12, 0)), "12:00 PM");
});

test("a countdown says how long, and says plainly when the slot is gone", () => {
  assert.equal(countdownLabel(NOW, NOW + 2 * 3_600_000 + 5 * 60_000), "posts in 2h 05m");
  assert.equal(countdownLabel(NOW, NOW + 50 * 3_600_000), "posts in 2d 2h");
  assert.equal(countdownLabel(NOW, NOW - 1), "slot passed");
});

// ── Media ───────────────────────────────────────────────────────────────────

test("media and polls do not mix, in either order", () => {
  const withPoll = mediaAffordances(body("x", [], { options: ["a", "b"], duration: "1d" }));
  assert.equal(withPoll.canAddImage, false);
  assert.equal(withPoll.canAddSingle, false);
  assert.equal(withPoll.reason, "Polls can't carry media");

  const withImage = mediaAffordances(body("x", [{ kind: "image", alt: "a" }]));
  assert.equal(withImage.canAddPoll, false, "an attachment closes the poll door");
  assert.equal(withImage.canAddImage, true, "a second image is still fine");
});

test("four images is the ceiling, and a video takes the whole post", () => {
  const four = body(
    "x",
    Array.from({ length: 4 }, () => ({ kind: "image" as const, alt: "a" })),
  );
  assert.equal(mediaAffordances(four).canAddImage, false);
  assert.equal(mediaAffordances(four).reason, "4 images max");

  const video = body("x", [{ kind: "video", alt: "a" }]);
  assert.equal(mediaAffordances(video).canAddImage, false);
  assert.equal(mediaAffordances(video).reason, "One video or GIF per post");
});

test("alt text proposed from a prompt is a sentence, not the prompt", () => {
  assert.equal(
    altFromPrompt("a wide shot of three familiars. dramatic lighting"),
    "A wide shot of three familiars",
  );
  assert.equal(altFromPrompt("   "), "");
});

// ── Naming and counts ───────────────────────────────────────────────────────

test("a draft names itself from its content until someone names it", () => {
  assert.equal(derivedTitle(post({ posts: [body("First line\nsecond")] })), "First line");
  assert.equal(
    derivedTitle(post({ type: "reply", target: "https://x.com/sarahdev/status/1" })),
    "Reply to @sarahdev",
  );
  assert.equal(derivedTitle(post({ type: "thread", posts: [body("")] })), "Untitled thread");
  assert.equal(titleOf(post({ name: "  My draft  " })), "My draft");
  // A name cleared to whitespace falls back rather than leaving a blank row.
  assert.equal(
    titleOf(post({ name: "   ", posts: [body("Back to the content")] })),
    "Back to the content",
  );
});

test("the queued API cost counts writes and attachments, not drafts", () => {
  const drafts = [
    post({ id: "a", status: "approved", type: "thread", posts: [body("1"), body("2")] }),
    post({
      id: "b",
      status: "approved",
      posts: [body("x", [{ kind: "image", alt: "a" }])],
    }),
    post({ id: "c", status: "draft" }),
  ];
  // 2 thread posts + (1 post + 1 image × 2) = 2 + 3 = 5; the draft costs nothing.
  assert.equal(queuedApiCost(drafts), 5);
});

test("counts abbreviate the way the room displays them", () => {
  assert.equal(formatCount(184), "184");
  assert.equal(formatCount(1240), "1.2K");
  assert.equal(formatCount(12_400), "12K");
});

console.log("x-comms-model.test.ts OK");
