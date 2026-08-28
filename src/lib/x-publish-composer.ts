/**
 * The composer's decision layer for publishing to X, kept out of the React
 * component so the rules that gate an outbound write are testable without a
 * DOM. `src/lib/server/x-publications.ts` owns the durable side of these same
 * rules; this is what the person in front of the room is shown.
 *
 * The one rule here that the server does NOT have: an unresolved attempt holds
 * the whole composer, not just its own record. Server-side, `publishXPublication`
 * refuses only the uncertain record — which is correct for it, because it is
 * answering about one record. But a person whose last attempt may or may not
 * have posted is exactly the person about to retype it and press publish, and
 * that second post is the duplicate the whole design is built to avoid. So the
 * composer holds until they say what happened. It is a hold, not a lock: one
 * click on "It posted" or "It did not post" clears it.
 */

/** The subset of the durable record the composer reads. */
export type XPublicationRecord = {
  id: string;
  text: string;
  status: "draft" | "uncertain" | "published" | "abandoned";
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
  postId?: string;
  canonicalUrl?: string;
  publishedAt?: string;
  resolutionNote?: string;
};

/**
 * X's default weighted limit. Advisory here, deliberately: the store refuses
 * to hard-code it because an entitlement can raise it, so this marks the text
 * rather than blocking it. The composer says "over the standard limit", not
 * "you cannot post this" — the server and X decide that.
 */
export const X_POST_WEIGHTED_LIMIT = 280;

/**
 * X counts most Latin text as one unit per code point and nearly everything
 * else as two, using four explicit weight-1 ranges. Counting `text.length`
 * instead would be wrong twice over: it splits an astral code point (an emoji)
 * into two units where X charges two for the whole character, and it charges
 * one for a CJK character X charges two for.
 */
const WEIGHT_ONE_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
];

export function weightedPostLength(text: string): number {
  let total = 0;
  // Normalized first, exactly as X does before it counts. An "é" typed as
  // `e` + U+0301 is two code points and would otherwise be charged two, while
  // X composes it to one and charges one — so an unnormalized count warns
  // about a limit the post is nowhere near.
  for (const character of text.normalize("NFC")) {
    const code = character.codePointAt(0) ?? 0;
    const light = WEIGHT_ONE_RANGES.some(([low, high]) => code >= low && code <= high);
    total += light ? 1 : 2;
  }
  return total;
}

/** Attempts whose outcome nobody has recorded. These block the composer. */
export function unresolvedPublications(
  publications: readonly XPublicationRecord[],
): XPublicationRecord[] {
  return publications.filter((publication) => publication.status === "uncertain");
}

/** What actually went out, newest first, for the room's sent list. */
export function publishedPublications(
  publications: readonly XPublicationRecord[],
): XPublicationRecord[] {
  return publications
    .filter((publication) => publication.status === "published")
    .sort((a, b) => (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt));
}

/**
 * Drafts that never went out, newest first, for the room's stranded-draft
 * list. A draft is a record the composer itself made — "Review this wording"
 * mints one on every confirmation — so a person who walked away without
 * publishing has no way to know it is there from the published list, and
 * nothing in the room can retire it. This is the list that makes both
 * possible; `resolve` with outcome "abandoned" does the retiring and takes
 * no network.
 */
export function draftPublications(
  publications: readonly XPublicationRecord[],
): XPublicationRecord[] {
  return publications
    .filter((publication) => publication.status === "draft")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The confirmation the server minted, bound to the exact text it was for. */
export type XComposerConfirmation = {
  publicationId: string;
  /**
   * The text the token was minted against. Held so an edit after confirming
   * is detectable here rather than only at the server's refusal: approval for
   * one wording must never carry to another, and the person should see that
   * their approval lapsed while they are still editing.
   */
  text: string;
  token: string;
  /**
   * The handle this post would go out as, read at the moment the wording was
   * confirmed. `null` means no account answered — either nothing is connected
   * or the read failed, and the confirmation view says so rather than showing
   * a blank where an identity belongs.
   *
   * Captured WITH the confirmation rather than polled beside it, because it is
   * part of what a person is being asked to approve: the same words posted as
   * a different account are a different act.
   */
  account?: string | null;
};

export type XComposerGate =
  /** An attempt may already have posted. Nothing else may go out until it is settled. */
  | { kind: "resolve-first"; unresolved: XPublicationRecord[] }
  /** Nothing to publish. */
  | { kind: "empty" }
  /** Text exists but this exact wording has not been approved. */
  | { kind: "confirm" }
  /** Approved, and the approval still matches what is on screen. */
  | { kind: "publish"; confirmation: XComposerConfirmation };

export function composerGate(input: {
  text: string;
  confirmation: XComposerConfirmation | null;
  publications: readonly XPublicationRecord[];
}): XComposerGate {
  // Checked before the text is even looked at, so the backlog cannot be
  // stepped past by clearing the box and starting again.
  const unresolved = unresolvedPublications(input.publications);
  if (unresolved.length > 0) return { kind: "resolve-first", unresolved };

  if (input.text.trim() === "") return { kind: "empty" };

  const { confirmation } = input;
  // Compared against the raw text, not a trimmed or normalized form: the
  // server mints its token over exactly these bytes, so anything looser here
  // would show "ready to publish" for a wording the server will refuse.
  if (!confirmation || confirmation.text !== input.text) return { kind: "confirm" };

  return { kind: "publish", confirmation };
}

/**
 * A stored instant as the rooms render one. Every other role surface shows a
 * timestamp through `toLocaleString`, and this is the last message that should
 * make someone parse an ISO string — they are being asked to go and look at
 * a clock-time on X. A value that will not parse is passed through rather than
 * rendered as "Invalid Date": the raw string is still evidence.
 */
function humanInstant(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/**
 * Why an unresolved attempt is being held, in one line the room can render.
 * Names the dispatch time because that is the only fact anyone has: what was
 * sent, and when — never whether it arrived.
 */
export function unresolvedSummary(publication: XPublicationRecord): string {
  const when = humanInstant(publication.dispatchedAt ?? publication.updatedAt);
  return `Sent at ${when} — X never confirmed it. It may or may not be posted.`;
}
