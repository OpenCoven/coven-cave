/**
 * The X Comms room's decision layer — everything the room decides that is not
 * a matter of markup, kept here so the rules are testable without a DOM.
 *
 * Two things this file deliberately does NOT own:
 *
 *  - **What 280 means.** `weightedPostLength` and `X_POST_WEIGHTED_LIMIT` come
 *    from `x-publish-composer.ts`, which already serves the Comms Operations
 *    room. A second definition here would drift, and the first symptom would
 *    be two surfaces disagreeing about whether the same draft fits.
 *  - **Posting.** Nothing in this room reaches X. Approval moves a local
 *    record between states and schedules a slot that no dispatcher reads. That
 *    is the honest shape for a room whose delivery half does not exist yet —
 *    the same stance `messenger-surface.tsx` takes about its own drafts — and
 *    the copy in the room says so rather than implying a queue that drains.
 *
 * `now` is threaded through every function that needs it instead of being read
 * from the clock. The room passes `Date.now()`; tests pass a fixed instant, so
 * a countdown or a slot label asserts the same way on every machine and at
 * every hour of the day.
 */

import { parseXPostUrl } from "@/lib/x-api";
import {
  weightedPostLength,
  X_POST_WEIGHTED_LIMIT,
} from "@/lib/x-publish-composer";

// ── Time, in the account's zone ──────────────────────────────────────────────

/** Slots are quoted in the account's posting timezone, not the operator's. */
export const X_COMMS_ZONE = "America/Los_Angeles";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * How far the zone's wall clock sits from UTC at a given instant. Computed
 * from `Intl` rather than a fixed -7, because a fixed offset silently moves
 * every slot by an hour for four months of the year — and "6:10 PM PT" is a
 * claim about follower activity, so being an hour out makes it wrong rather
 * than merely odd.
 */
function zoneOffsetMs(at: number, timeZone: string = X_COMMS_ZONE): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour") % 24,
    read("minute"),
    read("second"),
  );
  return asUtc - at;
}

/** The instant as a Date whose UTC fields read as the zone's wall clock. */
function zoneClock(at: number): Date {
  return new Date(at + zoneOffsetMs(at));
}

/**
 * The instant at which the zone's wall clock reads `hour:minute`, `dayOffset`
 * days from `now`. Resolved twice because the first guess uses the offset in
 * force today, which is the wrong one across a DST boundary.
 */
export function slotAt(
  now: number,
  dayOffset: number,
  hour: number,
  minute = 10,
): number {
  const wall = zoneClock(now);
  const target = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate() + dayOffset,
    hour,
    minute,
  );
  let instant = target - zoneOffsetMs(now);
  instant = target - zoneOffsetMs(instant);
  return instant;
}

/** Whole days between two instants, counted on the zone's calendar. */
export function dayDelta(now: number, at: number): number {
  return (
    Math.floor((at + zoneOffsetMs(at)) / DAY_MS) -
    Math.floor((now + zoneOffsetMs(now)) / DAY_MS)
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function dayLabel(now: number, at: number): string {
  const delta = dayDelta(now, at);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  const wall = zoneClock(at);
  if (Math.abs(delta) < 7) return WEEKDAYS[wall.getUTCDay()];
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(wall);
}

export function clockLabel(at: number): string {
  const wall = zoneClock(at);
  const hour = wall.getUTCHours();
  const minute = String(wall.getUTCMinutes()).padStart(2, "0");
  return `${((hour + 11) % 12) + 1}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

/** "Tomorrow 6:10 PM PT" — the one phrasing every slot is quoted in. */
export function slotLabel(now: number, at: number): string {
  return `${dayLabel(now, at)} ${clockLabel(at)} PT`;
}

/** Compact form for a list column: a time today, a day name otherwise. */
export function shortWhen(now: number, at: number): string {
  return dayDelta(now, at) === 0 ? clockLabel(at) : dayLabel(now, at);
}

export function relativeLabel(now: number, at: number): string {
  const minutes = Math.max(1, Math.round((now - at) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function countdownLabel(now: number, at: number): string {
  const remaining = at - now;
  if (remaining <= 0) return "slot passed";
  const hours = Math.floor(remaining / HOUR_MS);
  const minutes = Math.floor((remaining % HOUR_MS) / 60_000);
  if (hours >= 48) return `posts in ${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `posts in ${hours}h ${String(minutes).padStart(2, "0")}m`;
}

/** The posting window the room schedules into: the 6:10 PM slot, or tomorrow's. */
export function nextSlot(now: number): number {
  const today = slotAt(now, 0, 18);
  return today > now ? today : slotAt(now, 1, 18);
}

// ── Counting ────────────────────────────────────────────────────────────────

export { X_POST_WEIGHTED_LIMIT };

/** X's DM limit. Not in the composer lib because only this room sends DMs. */
export const X_DM_WEIGHTED_LIMIT = 10_000;

const URL_PATTERN = /https?:\/\/\S+/g;

/** X charges a flat 23 for any link, however long. */
const LINK_WEIGHT = 23;

/**
 * What the counter in the room shows. `weightedPostLength` already handles the
 * part that is easy to get wrong (an emoji is two units, not two code points);
 * this adds the one rule it deliberately leaves out, because the server counts
 * the text it is given and the link substitution happens on X's side.
 */
export function xWeightedLength(text: string): number {
  return weightedPostLength(text.replace(URL_PATTERN, "x".repeat(LINK_WEIGHT)));
}

export function countLinks(text: string): number {
  return text.match(URL_PATTERN)?.length ?? 0;
}

export function countHashtags(text: string): number {
  return text.match(/(^|\s)#\w+/g)?.length ?? 0;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// ── Records ─────────────────────────────────────────────────────────────────

export type XPostType = "post" | "thread" | "reply" | "quote" | "dm";

export type XDraftStatus =
  | "draft"
  | "needs-approval"
  | "approved"
  | "posted"
  | "revoked"
  | "failed";

export type XMediaKind = "image" | "gif" | "video";

export type XMediaOrigin = "upload" | "generated" | "png-to-gif";

export type XMedia = {
  kind: XMediaKind;
  alt: string;
  /** Alt text written from a generation prompt — true until someone edits it. */
  altAuto?: boolean;
  width?: number;
  height?: number;
  duration?: string;
  frames?: number;
  origin?: XMediaOrigin;
  prompt?: string;
};

export type XPoll = { options: string[]; duration: XPollDuration };

export type XPollDuration = "1d" | "3d" | "7d";

export type XPostBody = { text: string; media: XMedia[]; poll: XPoll | null };

export type XRevision = {
  at: number;
  note: string;
  /** Absent when the revision predates content capture — it cannot be restored. */
  posts?: XPostBody[];
};

export type XMetrics = {
  impressions: number;
  engagementRate: number;
  likes: number;
  reposts: number;
  replies: number;
  bookmarks: number;
  profileVisits: number;
  linkClicks: number;
};

type XDraftCommon = {
  id: string;
  /** Operator-given name. Absent means the title is derived from content. */
  name?: string;
  status: XDraftStatus;
  tone: XTone;
  notes: string;
  createdAt: number;
  revisions: XRevision[];
  approvedBy?: string;
  approvedAt?: number;
  scheduledAt?: number;
  /** The scheduled slot elapsed while the draft was still awaiting approval. */
  slotPassed?: boolean;
  postedAt?: number;
  permalink?: string;
  metrics?: XMetrics;
  revokedAt?: number;
  failedAt?: number;
  failReason?: string;
};

export type XPostDraft = XDraftCommon & {
  kind: "post";
  type: XPostType;
  /** A post URL for reply/quote, an @handle for dm, empty otherwise. */
  target: string;
  posts: XPostBody[];
  replyPermission: XReplyPermission;
};

export type XArticleDraft = XDraftCommon & {
  kind: "article";
  title: string;
  body: string;
  cover?: XMedia;
  inline: Array<XMedia & { n: number }>;
};

export type XDraft = XPostDraft | XArticleDraft;

export type XReplyPermission = "everyone" | "following" | "verified" | "mentioned";

export const X_REPLY_PERMISSIONS: readonly XReplyPermission[] = [
  "everyone",
  "following",
  "verified",
  "mentioned",
];

export type XTone = "neutral" | "warm" | "formal" | "urgent" | "playful";

export const X_TONES: ReadonlyArray<{ value: XTone; description: string }> = [
  { value: "neutral", description: "plain, declarative" },
  { value: "warm", description: "friendly, first-person" },
  { value: "formal", description: "measured, no contractions" },
  { value: "urgent", description: "short, action first" },
  { value: "playful", description: "light, one flourish" },
];

export const X_POLL_DURATIONS: ReadonlyArray<{
  value: XPollDuration;
  label: string;
}> = [
  { value: "1d", label: "1 day" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
];

// ── Post types ──────────────────────────────────────────────────────────────

export const X_POST_TYPES: Record<
  XPostType,
  { icon: string; note: string; placeholder: string }
> = {
  post: {
    icon: "ph:chat-teardrop",
    note: "one post · 280 chars",
    placeholder: "What's the one line people repeat?",
  },
  thread: {
    icon: "ph:list-bullets",
    note: "numbered posts · 280 each",
    placeholder: "Open with the hook…",
  },
  reply: {
    icon: "ph:arrow-bend-up-left",
    note: "replies inherit the parent's audience",
    placeholder: "Reply…",
  },
  quote: {
    icon: "ph:repeat",
    note: "your words above their post",
    placeholder: "Add your take…",
  },
  dm: {
    icon: "ph:paper-plane-tilt",
    note: "private · 10,000 chars",
    placeholder: "Message…",
  },
};

export const X_POST_TYPE_ORDER: readonly XPostType[] = [
  "post",
  "thread",
  "reply",
  "quote",
  "dm",
];

/**
 * A destination the publish path would also accept.
 *
 * Delegated to the shared parser rather than matched here: a local prefix
 * pattern let `…/status/123/trailing-junk` through the room gate and straight
 * into a write the server would refuse, which is the worst place to find out.
 * `parseXPostUrl` throws on anything it cannot canonicalise.
 */
function isXPostUrl(value: string): boolean {
  try {
    parseXPostUrl(value);
    return true;
  } catch {
    return false;
  }
}

/** Which types need a destination, and what counts as a valid one. */
export const X_TARGET_RULES: Partial<
  Record<
    XPostType,
    {
      label: string;
      icon: string;
      placeholder: string;
      format: string;
      isValid(value: string): boolean;
      whenInvalid: string;
    }
  >
> = {
  reply: {
    label: "replying to",
    icon: "ph:arrow-bend-up-left",
    placeholder: "https://x.com/handle/status/…",
    format: "post URL",
    isValid: isXPostUrl,
    whenInvalid: "Not a post URL — paste the https://x.com/…/status/… link.",
  },
  quote: {
    label: "quoting",
    icon: "ph:repeat",
    placeholder: "https://x.com/handle/status/…",
    format: "post URL",
    isValid: isXPostUrl,
    whenInvalid: "Not a post URL — paste the https://x.com/…/status/… link.",
  },
  dm: {
    label: "to",
    icon: "ph:at",
    placeholder: "@handle",
    format: "@handle",
    isValid: (value) => /^@\w{1,15}$/.test(value),
    whenInvalid: "Not a handle — use @handle (15 chars max).",
  },
};

// ── Status ──────────────────────────────────────────────────────────────────

export type XStatusDescriptor = {
  label: string;
  group: XGroupLabel;
  icon: string;
  /** Semantic token for the state's dot, border tint and header icon. */
  tone: string;
  /** Filled dots read as "settled"; ringed dots as "still moving". */
  filled: boolean;
  emptyHint: string;
  summary: string;
};

export type XGroupLabel = "Needs you" | "Drafts" | "Scheduled" | "Posted";

export const X_STATUS: Record<XDraftStatus, XStatusDescriptor> = {
  draft: {
    label: "draft",
    group: "Drafts",
    icon: "ph:pencil-simple",
    tone: "var(--x-state-draft)",
    filled: true,
    emptyHint: "Nothing in progress.",
    summary: "Request approval when it reads right.",
  },
  "needs-approval": {
    label: "awaiting approval",
    group: "Needs you",
    icon: "ph:user-circle",
    tone: "var(--x-state-awaiting)",
    filled: true,
    emptyHint: "Nothing awaiting approval.",
    summary: "Held locally until you approve or decline.",
  },
  approved: {
    label: "approved · scheduled",
    group: "Scheduled",
    icon: "ph:clock",
    tone: "var(--x-state-scheduled)",
    filled: false,
    emptyHint: "Nothing scheduled.",
    summary: "Holds until its slot. Revoke any time before.",
  },
  posted: {
    label: "posted",
    group: "Posted",
    icon: "ph:check",
    tone: "var(--x-state-posted)",
    filled: true,
    emptyHint: "Nothing posted.",
    summary: "Live on X. Metrics refresh hourly.",
  },
  revoked: {
    label: "revoked",
    group: "Drafts",
    icon: "ph:arrow-bend-up-left",
    tone: "var(--x-state-revoked)",
    filled: false,
    emptyHint: "",
    summary: "Pulled from the queue. Edit and request approval again.",
  },
  failed: {
    label: "post failed",
    group: "Needs you",
    icon: "ph:warning",
    tone: "var(--x-state-failed)",
    filled: true,
    emptyHint: "",
    summary: "X rejected the write at its slot. Nothing was posted.",
  },
};

/** Rail order. "Needs you" is first because it is the only group with a decision in it. */
export const X_GROUPS: ReadonlyArray<{
  label: XGroupLabel;
  statuses: readonly XDraftStatus[];
}> = [
  { label: "Needs you", statuses: ["needs-approval", "failed"] },
  { label: "Drafts", statuses: ["draft", "revoked"] },
  { label: "Scheduled", statuses: ["approved"] },
  { label: "Posted", statuses: ["posted"] },
];

// ── Naming ──────────────────────────────────────────────────────────────────

export function handleOf(draft: XDraft): string {
  if (draft.kind !== "post" || !draft.target) return "";
  if (draft.type === "dm") return draft.target;
  const match = draft.target.match(/(?:x|twitter)\.com\/(\w+)\//i);
  return match ? `@${match[1]}` : "";
}

function firstLine(draft: XPostDraft): string {
  return (draft.posts[0]?.text ?? "").split("\n")[0].trim();
}

/** The name a draft carries when nobody has given it one. */
export function derivedTitle(draft: XDraft): string {
  if (draft.kind === "article") return draft.title || "Untitled article";
  const handle = handleOf(draft) || "@…";
  if (draft.type === "reply") return `Reply to ${handle}`;
  if (draft.type === "quote") return `Quote of ${handle}`;
  if (draft.type === "dm") return `DM to ${handle}`;
  return firstLine(draft) || (draft.type === "thread" ? "Untitled thread" : "Untitled post");
}

export function titleOf(draft: XDraft): string {
  return draft.name?.trim() || derivedTitle(draft);
}

export function metaOf(draft: XDraft): string {
  if (draft.kind === "article") {
    const words = countWords(draft.body);
    return `article · ${words.toLocaleString()} words · ${Math.max(1, Math.round(words / 200))} min`;
  }
  if (draft.type === "thread") return `thread · ${draft.posts.length} posts`;
  if (draft.type === "post") return "post";
  return `${draft.type} → ${handleOf(draft) || "@…"}`;
}

// ── Rules ───────────────────────────────────────────────────────────────────

export type XConnectionState = "connected" | "disconnected" | "rate-limited";

/**
 * What an account state means for a draft the operator is about to approve.
 * Advice, never a refusal — see `approvalBlocker` for why disconnected does
 * not gate.
 */
export function connectionAdvice(connection: XConnectionState): string {
  if (connection === "disconnected") {
    return "X disconnected — approving holds it locally until the account reconnects";
  }
  if (connection === "rate-limited") {
    return "API budget spent — approved posts wait for the reset";
  }
  return "";
}

export type XRuleChip = {
  label: string;
  passing: boolean;
  /** Shown on hover: what the rule is, where it comes from, whether it blocks. */
  tip: string;
};

const RULE_SOURCE = "room rules · ward.toml 0.3.1";

function ruleChip(label: string, passing: boolean, explanation: string): XRuleChip {
  return {
    label,
    passing,
    tip: `${explanation}\nsource: ${RULE_SOURCE} · ${
      passing ? "passing" : "failing — blocks Request approval"
    }`,
  };
}

/** The posts a draft actually ships — everything past the first is thread-only. */
export function shippedPosts(draft: XDraft): XPostBody[] {
  if (draft.kind !== "post") return [];
  return draft.type === "thread" ? draft.posts : draft.posts.slice(0, 1);
}

export function limitFor(draft: XDraft): number {
  return draft.kind === "post" && draft.type === "dm"
    ? X_DM_WEIGHTED_LIMIT
    : X_POST_WEIGHTED_LIMIT;
}

/** The constraint footer: every rule, whether it passes, and why it exists. */
export function ruleChips(draft: XDraft): XRuleChip[] {
  if (draft.kind === "article") {
    const words = countWords(draft.body);
    const images = [draft.cover, ...draft.inline].filter(Boolean) as XMedia[];
    return [
      ruleChip(
        `${words.toLocaleString()} words`,
        words >= 50,
        "Articles need at least 50 words.",
      ),
      ruleChip("title", draft.title.trim().length > 0, "A title is required before approval."),
      ...(images.length
        ? [
            ruleChip(
              "alt text",
              images.every((image) => image.alt.trim().length > 0),
              "Cover and inline images need alt text before approval.",
            ),
          ]
        : []),
    ];
  }

  const posts = shippedPosts(draft);
  const limit = limitFor(draft);
  const overLimit = posts.some((post) => xWeightedLength(post.text) > limit);

  if (draft.type === "dm") {
    return [
      ruleChip("10,000 chars", !overLimit, "X's DM limit. Links count as 23."),
      ruleChip("private", true, "DMs skip the timeline. Still gated by approval."),
    ];
  }

  const allText = posts.map((post) => post.text).join("\n");
  const hasMedia = posts.some((post) => post.media.length > 0);
  return [
    ruleChip(
      "280 chars",
      !overLimit,
      "X's per-post limit. Links count as 23 regardless of length.",
    ),
    ruleChip(
      "no hashtags",
      countHashtags(allText) === 0,
      "Room rule: this account doesn't use hashtags. Echo won't add them; you can't approve with one in.",
    ),
    // Per POST, which is what the chip says. Counting the joined thread failed
    // a four-post thread carrying one link each — every post satisfying the
    // rule, the rule reported as broken.
    ruleChip(
      "1 link max",
      posts.every((post) => countLinks(post.text) <= 1),
      "Room rule: one link per post keeps the click path obvious.",
    ),
    ...(hasMedia
      ? [
          ruleChip(
            "alt text",
            posts.every((post) => post.media.every((item) => item.alt.trim().length > 0)),
            "Every attachment needs alt text before approval. Videos burn it in as captions.",
          ),
        ]
      : []),
  ];
}

/**
 * Why this draft cannot be approved, in the operator's words, or "" when it
 * can. One string rather than a list: the primary button needs a single reason
 * to show, and the rule chips above already say which rules are failing.
 *
 * The account's connection is deliberately NOT an input. Both non-connected
 * states are ones the room promises to survive by holding work locally, so
 * neither can refuse an approval; `connectionAdvice` says what they mean
 * instead.
 */
export function approvalBlocker(draft: XDraft | null): string {
  if (!draft) return "";
  // A disconnected account is deliberately NOT a blocker. The room's banner
  // promises "approvals still work; posts hold locally and go once the account
  // reconnects", and a gate that disabled Approve would make that a lie — the
  // queue could never be filled in the one state it exists to survive. The
  // frame this room is built from carried both the promise and the blocker;
  // the promise is the one worth keeping.

  if (draft.kind === "article") {
    if (!draft.title.trim()) return "add a title to continue";
    if (countWords(draft.body) < 50) return "articles need at least 50 words";
    const images = [draft.cover, ...draft.inline].filter(Boolean) as XMedia[];
    if (images.some((image) => !image.alt.trim())) return "every image needs alt text";
    // The editor already marks these "not in body" in amber; without this the
    // warning was decorative and the image would ship attached to nothing.
    if (draft.inline.some((image) => !draft.body.includes(`[img:${image.n}]`))) {
      return "an inline image isn't placed in the body";
    }
    return "";
  }

  const target = X_TARGET_RULES[draft.type];
  if (target && !draft.target) return `add the ${target.format} to continue`;
  if (target && !target.isValid(draft.target)) return "fix the destination to continue";

  const posts = shippedPosts(draft);
  const limit = limitFor(draft);
  if (posts.some((post) => xWeightedLength(post.text) > limit)) {
    return "a post is over the limit";
  }
  if (posts.every((post) => !post.text.trim())) return "write something first";

  if (draft.type !== "dm") {
    const allText = posts.map((post) => post.text).join("\n");
    if (countHashtags(allText) > 0) return "room rule · no hashtags";
    if (posts.some((post) => countLinks(post.text) > 1)) return "room rule · 1 link max";
  }

  if (posts.some((post) => post.media.some((item) => !item.alt.trim()))) {
    return "every attachment needs alt text";
  }
  if (
    posts.some(
      (post) => post.poll && post.poll.options.filter((option) => option.trim()).length < 2,
    )
  ) {
    return "polls need two filled options";
  }
  return "";
}

/** A draft is editable until it is out of the operator's hands. */
export function isEditable(draft: XDraft | null): boolean {
  return (
    !!draft && (draft.status === "draft" || draft.status === "needs-approval" || draft.status === "revoked")
  );
}

// ── Media rules ─────────────────────────────────────────────────────────────

export type XMediaPreset = {
  value: string;
  label: string;
  width: number;
  height: number;
  duration?: string;
};

export const X_MEDIA_PRESETS: Record<XMediaKind, readonly XMediaPreset[]> = {
  image: [
    { value: "16:9", label: "16:9 · 1600×900 · timeline", width: 1600, height: 900 },
    { value: "1:1", label: "1:1 · 1080×1080 · grid-safe", width: 1080, height: 1080 },
    { value: "4:5", label: "4:5 · 1080×1350 · tallest in feed", width: 1080, height: 1350 },
    { value: "3:1", label: "3:1 · 1500×500 · banner", width: 1500, height: 500 },
  ],
  gif: [
    { value: "g16:9", label: "16:9 · 480×270 · loops", width: 480, height: 270 },
    { value: "g1:1", label: "1:1 · 480×480 · loops", width: 480, height: 480 },
  ],
  video: [
    { value: "v16:9", label: "16:9 · 1280×720 · 15s", width: 1280, height: 720, duration: "15s" },
    { value: "v9:16", label: "9:16 · 1080×1920 · 15s", width: 1080, height: 1920, duration: "15s" },
    { value: "v1:1", label: "1:1 · 1080×1080 · 6s", width: 1080, height: 1080, duration: "6s" },
  ],
};

export const X_GENERATE_PLACEHOLDER: Record<XMediaKind, string> = {
  image: "Describe the image — subject, framing, mood. No text in the image.",
  gif: "Describe the loop — one motion, 2–4 seconds, reads without sound.",
  video:
    "Describe the clip — opening frame, motion, ending. Captions are burned in from your alt text.",
};

export const X_MAX_IMAGES_PER_POST = 4;
export const X_MAX_POLL_OPTIONS = 4;
export const X_MIN_POLL_OPTIONS = 2;
export const X_POLL_OPTION_LIMIT = 25;

/**
 * Alt text proposed from a generation prompt. Marked `altAuto` so the room can
 * say "auto · review" — generated alt text that nobody read is the failure
 * this whole rule exists to prevent, and silently accepting it would pass the
 * check while defeating it.
 */
export function altFromPrompt(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  const sentence = cleaned.split(/[.!?]/)[0].slice(0, 120);
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** What a post may still accept, given what it already carries. */
export function mediaAffordances(post: XPostBody): {
  canAddImage: boolean;
  canAddSingle: boolean;
  canAddPoll: boolean;
  imageCount: number;
  reason: string;
} {
  const imageCount = post.media.filter((item) => item.kind === "image").length;
  const hasVideoOrGif = post.media.some((item) => item.kind !== "image");
  const reason = post.poll
    ? "Polls can't carry media"
    : imageCount >= X_MAX_IMAGES_PER_POST
      ? "4 images max"
      : hasVideoOrGif
        ? "One video or GIF per post"
        : "";
  return {
    canAddImage: !post.poll && !hasVideoOrGif && imageCount < X_MAX_IMAGES_PER_POST,
    canAddSingle: !post.poll && post.media.length === 0,
    canAddPoll: !post.poll && post.media.length === 0,
    imageCount,
    reason,
  };
}

// ── API budget ──────────────────────────────────────────────────────────────

/** Posts in a 24h window. The room warns well before it matters. */
export const X_API_BUDGET = 1500;
export const X_API_WARN_AT = 0.8;

/** What the queue will spend when it drains — 1 per write, 2 per attachment. */
export function queuedApiCost(drafts: readonly XDraft[]): number {
  return drafts
    .filter((draft) => draft.status === "approved")
    .reduce((total, draft) => {
      if (draft.kind === "article") {
        const attachments = (draft.cover ? 1 : 0) + draft.inline.length;
        return total + 1 + attachments * 2;
      }
      return (
        total +
        draft.posts.length +
        draft.posts.reduce((sum, post) => sum + post.media.length * 2, 0)
      );
    }, 0);
}

// ── Follower activity ───────────────────────────────────────────────────────

/**
 * Share of daily follower activity by hour, in the account's zone. Drives the
 * timing card and the slot picker's heatmap; the 5–7 PM band the room
 * recommends is simply where this peaks.
 */
export const X_FOLLOWER_ACTIVITY: readonly number[] = [
  2, 1, 1, 1, 1, 2, 4, 6, 7, 8, 9, 9, 8, 7, 7, 8, 9, 12, 14, 13, 9, 6, 4, 3,
];

export const X_PEAK_BAND = { startHour: 17, endHour: 19 } as const;

export function isInPeakBand(hour: number): boolean {
  return hour >= X_PEAK_BAND.startHour && hour <= X_PEAK_BAND.endHour;
}

export function hourOf(at: number): number {
  return zoneClock(at).getUTCHours();
}

/** Weekend reach is lower; the heatmap dims Saturday and Sunday to match. */
export function dayActivityScale(now: number, dayOffset: number): number {
  const weekday = zoneClock(slotAt(now, dayOffset, 12)).getUTCDay();
  return weekday === 0 || weekday === 6 ? 0.55 : 1;
}

export const X_IMPRESSIONS_7D: readonly number[] = [3.2, 4.1, 3.8, 5.6, 7.9, 12.4, 9.1];

export function weekdayLabelsEndingToday(now: number, length: number): string[] {
  const today = zoneClock(now).getUTCDay();
  return Array.from(
    { length },
    (_, index) => WEEKDAYS[(today - (length - 1 - index) + 7 * length) % 7],
  );
}

export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`;
}
