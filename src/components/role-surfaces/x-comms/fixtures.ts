/**
 * The room's seed content.
 *
 * These are demo drafts, not a fetch. The X write path exists elsewhere
 * (`/api/x/publish`, driven by `XPublishPanel` inside Comms Operations) and
 * this room deliberately does not call it: approving here moves a local record
 * and schedules a slot no dispatcher reads. The room says so in its own copy
 * rather than implying a queue that drains.
 *
 * Everything is built relative to a `now` passed in, so the fixtures read as
 * live whenever the room opens — "55m ago", "posts in 8h 30m" — instead of
 * drifting into obvious staleness the way hard-coded instants would. Tests
 * pass a fixed `now` and get the same strings on every run.
 */

import {
  slotAt,
  type XArticleDraft,
  type XDraft,
  type XPostBody,
  type XPostDraft,
} from "@/lib/x-comms-model";

const MINUTE = 60_000;
const DAY_MINUTES = 1440;

const minutesAgo = (now: number, minutes: number) => now - minutes * MINUTE;

const body = (
  text: string,
  media: XPostBody["media"] = [],
  poll: XPostBody["poll"] = null,
): XPostBody => ({ text, media, poll });

export type XTrend = {
  topic: string;
  volume: string;
  delta: string;
  rising: boolean;
  summary: string;
  peak: string;
  leading: string;
  overlap: string;
};

/** Reference only. Nothing here is ever written into a draft's body. */
export const X_TRENDS: readonly XTrend[] = [
  {
    topic: "agent hand-offs",
    volume: "12.4K",
    delta: "18%",
    rising: true,
    summary:
      "Builders comparing written vs. spoken hand-offs between agents. Your thread draft sits squarely in it.",
    peak: "11 AM–2 PM PT",
    leading: "@simonw · @swyx · @hwchase17",
    overlap: "high · matches the thread draft",
  },
  {
    topic: "Anthropic",
    volume: "48K",
    delta: "6%",
    rising: true,
    summary:
      "Steady model-news volume. The quote draft rides this without needing a hashtag.",
    peak: "9–11 AM PT",
    leading: "@anthropicai · press",
    overlap: "medium · matches the quote draft",
  },
  {
    topic: "scheduler outage",
    volume: "3.1K",
    delta: "22%",
    rising: false,
    summary:
      "Cooling. Mostly your own incident thread being re-shared; no new reports.",
    peak: "yesterday 8 PM PT",
    leading: "@sarahdev · @opencoven",
    overlap: "resolved · the reply closes it",
  },
  {
    topic: "open-source agents",
    volume: "9.8K",
    delta: "3%",
    rising: true,
    summary:
      "Flat, evergreen. Good background for the poll; no timing pressure.",
    peak: "flat all day",
    leading: "@langchainai · @crewai",
    overlap: "low",
  },
];

export const X_ACCOUNT = {
  handle: "@opencoven",
  displayName: "OpenCoven",
  initial: "O",
} as const;

/** Where the room's own copy admits what it is. */
export const X_DEMO_NOTICE =
  "Demo content · approvals and slots are local to this room and nothing reaches X.";

export function seedDrafts(now: number): XDraft[] {
  const reply: XPostDraft = {
    id: "x1",
    kind: "post",
    type: "reply",
    target: "https://x.com/sarahdev/status/1834401192837472256",
    posts: [
      body(
        "Good catch — the scheduler ward was re-armed at 09:12 UTC. Write-up lands Thursday.",
      ),
    ],
    replyPermission: "everyone",
    tone: "neutral",
    status: "needs-approval",
    notes: "",
    createdAt: minutesAgo(now, 55),
    revisions: [
      {
        at: minutesAgo(now, 55),
        note: "Echo · tightened to one line, dropped apology",
        posts: [
          body(
            "Good catch — the scheduler ward was re-armed at 09:12 UTC. Write-up lands Thursday.",
          ),
        ],
      },
      {
        at: minutesAgo(now, 70),
        note: "Echo · first draft",
        posts: [
          body(
            "Sorry about that — good catch. The scheduler ward was re-armed at 09:12 UTC and we'll publish a write-up on Thursday.",
          ),
        ],
      },
    ],
  };

  const thread: XPostDraft = {
    id: "x2",
    kind: "post",
    type: "thread",
    target: "",
    posts: [
      body(
        "Three familiars, one brief, zero dropped hand-offs. The Circle of three mission is done.",
      ),
      body(
        "How it worked: each familiar owned a slice of the brief and a shared decision log. Hand-offs were written, not spoken.",
        [
          {
            kind: "image",
            alt: "Diagram of three familiars passing one brief",
            width: 1600,
            height: 900,
            origin: "upload",
          },
        ],
      ),
      body(
        "Where it broke: the scheduler ward fired late twice. Root cause found, fixed, re-armed.",
      ),
      body("Full write-up Thursday. Reply with what you'd want us to cover."),
    ],
    replyPermission: "everyone",
    tone: "neutral",
    status: "draft",
    notes: "",
    createdAt: minutesAgo(now, 18),
    revisions: [
      { at: minutesAgo(now, 18), note: "you · split post 2, added diagram" },
      { at: minutesAgo(now, 40), note: "Echo · 3-post version" },
    ],
  };

  const poll: XPostDraft = {
    id: "x3",
    kind: "post",
    type: "post",
    target: "",
    posts: [
      body("What should the next mission tackle?", [], {
        options: [
          "Long-running research",
          "Inbox triage",
          "Release notes",
          "Something else",
        ],
        duration: "3d",
      }),
    ],
    replyPermission: "everyone",
    tone: "playful",
    status: "approved",
    approvedBy: "you",
    approvedAt: minutesAgo(now, 170),
    scheduledAt: slotAt(now, 1, 18),
    notes: "",
    createdAt: minutesAgo(now, 190),
    revisions: [{ at: minutesAgo(now, 190), note: "Echo · first draft" }],
  };

  const quote: XPostDraft = {
    id: "x4",
    kind: "post",
    type: "quote",
    target: "https://x.com/anthropicai/status/1834311122233344455",
    posts: [
      body(
        "This is the model most of our familiars run on. The hand-off protocol works because the model reads the whole log.",
      ),
    ],
    replyPermission: "following",
    tone: "formal",
    status: "approved",
    approvedBy: "you",
    approvedAt: minutesAgo(now, 240),
    scheduledAt: slotAt(now, 0, 18),
    notes: "",
    createdAt: minutesAgo(now, 300),
    revisions: [{ at: minutesAgo(now, 300), note: "Echo · first draft" }],
  };

  const posted: XPostDraft = {
    id: "x5",
    kind: "post",
    type: "post",
    target: "",
    posts: [
      body(
        "Daily summaries are back on schedule. Two late fires last week, both traced to one ward. Fixed.",
      ),
    ],
    replyPermission: "everyone",
    tone: "neutral",
    status: "posted",
    approvedBy: "you",
    approvedAt: minutesAgo(now, 2 * DAY_MINUTES + 160),
    postedAt: minutesAgo(now, 2 * DAY_MINUTES + 130),
    permalink: "x.com/opencoven/status/1833998877665544332",
    metrics: {
      impressions: 12_400,
      engagementRate: 3.1,
      likes: 184,
      reposts: 41,
      replies: 23,
      bookmarks: 57,
      profileVisits: 96,
      linkClicks: 132,
    },
    notes: "",
    createdAt: minutesAgo(now, 2 * DAY_MINUTES + 200),
    revisions: [],
  };

  const dm: XPostDraft = {
    id: "x6",
    kind: "post",
    type: "dm",
    target: "@press_rae",
    posts: [
      body(
        "Thanks for reaching out — happy to talk next week. Tuesday or Thursday afternoon works on our side.",
      ),
    ],
    replyPermission: "everyone",
    tone: "formal",
    status: "draft",
    notes: "press · came in via the contact form",
    createdAt: minutesAgo(now, DAY_MINUTES),
    revisions: [{ at: minutesAgo(now, DAY_MINUTES), note: "Echo · first draft" }],
  };

  const article: XArticleDraft = {
    id: "a1",
    kind: "article",
    title: "How three familiars shipped one brief",
    body:
      "The Circle of three mission was a test of a simple idea: that three agents can share one brief without a human relaying between them. It held.\n\n" +
      "Each familiar owned a slice of the work and wrote its hand-offs into a shared decision log. Nothing was passed by voice or by inference. When the scheduler ward fired late — twice — the log made the failure obvious within minutes, and the fix was a one-line change to the ward's re-arm condition.\n\n" +
      "What we'd change: the brief itself should carry its own acceptance criteria. Twice a familiar finished a slice that nobody had defined as finished.\n\n" +
      "What we'd keep: the written hand-off. It's slower than talking and it's the only reason the post-mortem took an afternoon instead of a week.",
    inline: [],
    tone: "neutral",
    status: "draft",
    notes: "",
    createdAt: minutesAgo(now, 600),
    revisions: [{ at: minutesAgo(now, 600), note: "Echo · first draft" }],
  };

  return [reply, thread, poll, quote, posted, dm, article];
}
