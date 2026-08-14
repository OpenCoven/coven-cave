import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import twitterText from "twitter-text";
import { Value } from "typebox/value";

import {
  DeterministicFindingSchema,
  TweetThreadProtocolValidationError,
  assertValidThreadCandidate,
  compareOrdinalStrings,
  containsBannedPhrase,
} from "./tweet-thread-protocol.ts";
import type {
  DeterministicFinding,
  ThreadBrief,
  ThreadCandidate,
  ThreadPostMeasurement,
  ThreadValidationResult,
} from "./tweet-thread-protocol.ts";

export type {
  ThreadPostMeasurement,
  ThreadValidationResult,
} from "./tweet-thread-protocol.ts";

const { extractUrls, parseTweet } = twitterText;

const X_POST_WEIGHTED_LENGTH_LIMIT = 280;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const STYLED_UNICODE_ALPHABET_RE = /[\u{1D400}-\u{1D7FF}\uFF21-\uFF3A\uFF41-\uFF5A]/u;
const REPEATED_EMOJI_RE = /(\p{Extended_Pictographic})(?:\uFE0E|\uFE0F)?(?:\1(?:\uFE0E|\uFE0F)?){3,}/gu;
const IMAGE_DEPENDENT_RE = /\b(?:(?:only\s+)?(?:shown|visible|available|provided)\s+in|see)\s+(?:the\s+)?(?:image|chart|screenshot|graphic|diagram)\b/u;
const GENERIC_ALT_TEXT = new Set(["image", "chart", "screenshot", "graphic", "photo", "diagram"]);
const FINDING_MESSAGE_MAX_LENGTH = 2_000;
const FINDING_MESSAGE_TRUNCATION_MARKER = "… [truncated]";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function findingId(parts: readonly string[]): string {
  const hash = createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 16);
  return `finding-${hash}`;
}

function postReference(candidate: UnknownRecord, issue: string): string | undefined {
  const match = issue.match(/\.posts\[(\d+)\]/u);
  if (!match || !Array.isArray(candidate.posts)) return undefined;
  const post = candidate.posts[Number(match[1])];
  return isRecord(post) && typeof post.postId === "string" ? post.postId : undefined;
}

function claimReference(issue: string): string | undefined {
  return issue.match(/claim "([^"]+)"/u)?.[1];
}

function boundFindingMessage(message: string): string {
  const characters = Array.from(message);
  if (characters.length <= FINDING_MESSAGE_MAX_LENGTH) return message;
  const markerLength = Array.from(FINDING_MESSAGE_TRUNCATION_MARKER).length;
  return characters
    .slice(0, FINDING_MESSAGE_MAX_LENGTH - markerLength)
    .join("")
    .concat(FINDING_MESSAGE_TRUNCATION_MARKER);
}

export function createDeterministicFinding(
  code: string,
  severity: DeterministicFinding["severity"],
  message: string,
  references: { postId?: string; claimId?: string } = {},
  identityParts: readonly string[] = [
    code,
    severity,
    references.postId ?? "",
    references.claimId ?? "",
    message,
  ],
): DeterministicFinding {
  let finding: DeterministicFinding = {
    findingId: findingId(identityParts),
    code,
    severity,
    message: boundFindingMessage(message),
  };
  if (references.postId) {
    const withPostId = { ...finding, postId: references.postId };
    if (Value.Check(DeterministicFindingSchema, withPostId)) {
      finding = withPostId;
    }
  }
  if (references.claimId) {
    const withClaimId = { ...finding, claimId: references.claimId };
    if (Value.Check(DeterministicFindingSchema, withClaimId)) {
      finding = withClaimId;
    }
  }
  if (!Value.Check(DeterministicFindingSchema, finding)) {
    throw new TypeError(`Validator constructed an invalid hard failure for code "${code}".`);
  }
  return finding;
}

function addFinding(
  findings: Map<string, DeterministicFinding>,
  code: string,
  severity: DeterministicFinding["severity"],
  message: string,
  references: { postId?: string; claimId?: string } = {},
): void {
  const finding = createDeterministicFinding(code, severity, message, references);
  findings.set(finding.findingId, finding);
}

function collectProtocolFindings(
  candidate: unknown,
  findings: Map<string, DeterministicFinding>,
): candidate is ThreadCandidate {
  try {
    assertValidThreadCandidate(candidate);
    return true;
  } catch (error) {
    const issues = error instanceof TweetThreadProtocolValidationError
      ? error.issues
      : ["ThreadCandidate validation failed unexpectedly."];
    const record = isRecord(candidate) ? candidate : {};
    for (const issue of issues) {
      addFinding(findings, "protocol-invalid", "fail", issue, {
        postId: postReference(record, issue),
        claimId: claimReference(issue),
      });
    }
    return false;
  }
}

function countRepeatedEmojiRuns(text: string): number {
  return Array.from(text.matchAll(REPEATED_EMOJI_RE)).length;
}

function hasTextEquivalent(altText: unknown): boolean {
  if (typeof altText !== "string") return false;
  const normalized = normalizeText(altText);
  return normalized.length >= 12 && !GENERIC_ALT_TEXT.has(normalized);
}

export function validateThreadCandidate(
  candidate: unknown,
  brief?: ThreadBrief,
): ThreadValidationResult {
  const findings = new Map<string, DeterministicFinding>();
  collectProtocolFindings(candidate, findings);

  const record = isRecord(candidate) ? candidate : {};
  const candidateBrief = isRecord(record.brief) ? record.brief : null;
  if (brief && (!candidateBrief || !isDeepStrictEqual(candidateBrief, brief))) {
    addFinding(
      findings,
      "brief-mismatch",
      "fail",
      "The supplied brief must exactly match the brief embedded in the candidate.",
    );
  }

  const constraints = candidateBrief && isRecord(candidateBrief.constraints)
    ? candidateBrief.constraints
    : null;
  const posts = Array.isArray(record.posts) ? record.posts : [];
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  const evidenceClaimIds = new Set(
    evidence.flatMap((item) =>
      isRecord(item) && typeof item.claimId === "string" ? [item.claimId] : []
    ),
  );
  const postedClaimIds = new Set<string>();
  const measurements: ThreadPostMeasurement[] = [];

  if (
    constraints
    && typeof constraints.minPosts === "number"
    && typeof constraints.maxPosts === "number"
    && (posts.length < constraints.minPosts || posts.length > constraints.maxPosts)
  ) {
    addFinding(
      findings,
      "post-count-out-of-range",
      "fail",
      `Candidate has ${posts.length} posts; the brief requires ${constraints.minPosts}..${constraints.maxPosts}.`,
    );
  }

  for (const [index, postValue] of posts.entries()) {
    if (!isRecord(postValue)) continue;
    const expectedPostId = `post-${index + 1}`;
    const postId = typeof postValue.postId === "string" ? postValue.postId : expectedPostId;
    if (postId !== expectedPostId) {
      addFinding(
        findings,
        "post-id-sequence",
        "fail",
        `Post at index ${index} must use postId "${expectedPostId}", not "${postId}".`,
        { postId },
      );
    }

    if (Array.isArray(postValue.claimIds)) {
      for (const claimId of postValue.claimIds) {
        if (typeof claimId !== "string") continue;
        postedClaimIds.add(claimId);
        if (!evidenceClaimIds.has(claimId)) {
          addFinding(
            findings,
            "claim-missing-evidence",
            "fail",
            `Claim "${claimId}" is used by ${postId} but has no evidence ledger entry.`,
            { postId, claimId },
          );
        }
      }
    }

    if (typeof postValue.text !== "string") continue;
    const text = postValue.text;
    const parsedTweet = parseTweet(text);
    const weightedLength = parsedTweet.weightedLength;
    const urls = extractUrls(text);
    const hashtags = text.match(HASHTAG_RE) ?? [];
    const normalizedHashtags = hashtags.map((tag) => normalizeText(tag));
    const repeatedHashtagCount = normalizedHashtags.length - new Set(normalizedHashtags).size;
    const repeatedEmojiRuns = countRepeatedEmojiRuns(text);
    const tokenCount = Math.max(normalizeText(text).split(" ").filter(Boolean).length, 1);
    const linkDensity = urls.length / tokenCount;
    measurements.push({
      postId,
      weightedLength,
      urlCount: urls.length,
      hashtagCount: hashtags.length,
      repeatedHashtagCount,
      repeatedEmojiRuns,
      linkDensity,
    });

    if (weightedLength > X_POST_WEIGHTED_LENGTH_LIMIT) {
      addFinding(
        findings,
        "post-weighted-length",
        "fail",
        `${postId} has official X weighted length ${weightedLength}; the preflight limit is ${X_POST_WEIGHTED_LENGTH_LIMIT}.`,
        { postId },
      );
    }
    if (!parsedTweet.valid && weightedLength <= X_POST_WEIGHTED_LENGTH_LIMIT) {
      addFinding(
        findings,
        "post-twitter-text-invalid",
        "fail",
        `${postId} is not valid according to official twitter-text parsing.`,
        { postId },
      );
    }

    if (constraints && Array.isArray(constraints.bannedPhrases)) {
      for (const phrase of constraints.bannedPhrases) {
        if (typeof phrase !== "string") continue;
        if (containsBannedPhrase(text, phrase)) {
          addFinding(
            findings,
            "banned-phrase",
            "fail",
            `${postId} contains banned phrase "${phrase.trim()}".`,
            { postId },
          );
        }
      }
    }

    if (STYLED_UNICODE_ALPHABET_RE.test(text)) {
      addFinding(
        findings,
        "styled-unicode-alphabet",
        "fail",
        `${postId} contains styled Unicode alphabet characters that are not reliably accessible.`,
        { postId },
      );
    }

    const media = Array.isArray(postValue.media) ? postValue.media : [];
    if (constraints?.requireAltText === true) {
      for (const mediaValue of media) {
        if (!isRecord(mediaValue)) continue;
        if (typeof mediaValue.altText !== "string" || mediaValue.altText.trim().length === 0) {
          addFinding(
            findings,
            "missing-alt-text",
            "fail",
            `${postId} includes media without required alt text.`,
            { postId },
          );
        }
      }
      if (
        IMAGE_DEPENDENT_RE.test(normalizeText(text))
        && (
          media.length === 0
          || media.some((item) => !isRecord(item) || !hasTextEquivalent(item.altText))
        )
      ) {
        addFinding(
          findings,
          "image-dependent-text",
          "fail",
          `${postId} makes the message depend on an image without a meaningful text equivalent.`,
          { postId },
        );
      }
    }

    if (repeatedEmojiRuns > 0) {
      addFinding(
        findings,
        "repeated-emoji",
        "warn",
        `${postId} contains ${repeatedEmojiRuns} run(s) of four or more repeated emoji.`,
        { postId },
      );
    }
    if (hashtags.length > 3) {
      addFinding(
        findings,
        "hashtag-count",
        "warn",
        `${postId} contains ${hashtags.length} hashtags; more than three may reduce readability.`,
        { postId },
      );
    }
    if (repeatedHashtagCount > 0) {
      addFinding(
        findings,
        "hashtag-repetition",
        "warn",
        `${postId} repeats ${repeatedHashtagCount} hashtag(s) after normalization.`,
        { postId },
      );
    }
    if (urls.length >= 2 || linkDensity >= 0.25) {
      addFinding(
        findings,
        "link-density",
        "warn",
        `${postId} contains ${urls.length} links across ${tokenCount} text tokens.`,
        { postId },
      );
    }
  }

  if (constraints && Array.isArray(constraints.requiredClaimIds)) {
    for (const claimId of constraints.requiredClaimIds) {
      if (typeof claimId !== "string") continue;
      if (!evidenceClaimIds.has(claimId)) {
        addFinding(
          findings,
          "claim-missing-evidence",
          "fail",
          `Required claim "${claimId}" has no evidence ledger entry.`,
          { claimId },
        );
      }
      if (!postedClaimIds.has(claimId)) {
        addFinding(
          findings,
          "required-claim-unresolved",
          "fail",
          `Required claim "${claimId}" does not appear in any post.`,
          { claimId },
        );
      }
    }
  }

  const orderedFindings = [...findings.values()].sort((left, right) =>
    compareOrdinalStrings(left.findingId, right.findingId)
  );
  return {
    candidateSha256: typeof record.candidateSha256 === "string" ? record.candidateSha256 : null,
    accepted: !orderedFindings.some((finding) => finding.severity === "fail"),
    findings: orderedFindings,
    measurements,
  };
}
