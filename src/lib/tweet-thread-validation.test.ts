import assert from "node:assert/strict";

import twitterText from "twitter-text";

import {
  TWEET_THREAD_PROTOCOL_VERSION,
  computeThreadCandidateSha256,
} from "./tweet-thread-protocol.ts";
import type {
  ThreadBrief,
  ThreadCandidate,
  ThreadCandidateCanonicalContent,
} from "./tweet-thread-protocol.ts";
import { validateThreadCandidate } from "./tweet-thread-validation.ts";

const { parseTweet } = twitterText;
const TIMESTAMP = "2026-08-14T12:00:00.000Z";

function brief(overrides: Partial<ThreadBrief["constraints"]> = {}): ThreadBrief {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    briefId: "brief-validation",
    topic: "Deterministic thread validation",
    audience: "Protocol implementers",
    objectiveWeights: {
      factuality: 1,
      provenance: 1,
      accessibility: 1,
      voice: 1,
      coherence: 1,
      engagement: 1,
    },
    constraints: {
      minPosts: 2,
      maxPosts: 4,
      requiredClaimIds: ["claim-required"],
      bannedPhrases: ["just vibing"],
      requireAltText: true,
      ...overrides,
    },
  };
}

function candidateContent(): ThreadCandidateCanonicalContent {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    candidateId: "candidate-validation",
    brief: brief(),
    voiceProfile: {
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      voiceProfileId: "voice-validation",
      displayName: "Validation voice",
      tone: "Direct and grounded",
      do: ["Cite claims"],
      dont: ["Overstate"],
    },
    evidence: [{
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      evidenceId: "evidence-required",
      claimId: "claim-required",
      summary: "The deterministic validator is the preflight gate.",
      sourceLabel: "Approved protocol",
      sourceUrl: "https://example.com/protocol",
      retrievedAt: TIMESTAMP,
    }],
    posts: [
      {
        postId: "post-1",
        text: "Deterministic preflight catches machine-provable failures.",
        claimIds: ["claim-required"],
      },
      {
        postId: "post-2",
        text: "X remains authoritative when the thread is published.",
        claimIds: [],
      },
    ],
    generatedAt: TIMESTAMP,
  };
}

function candidate(
  mutate?: (content: ThreadCandidateCanonicalContent) => void,
): ThreadCandidate {
  const content = structuredClone(candidateContent());
  mutate?.(content);
  return {
    ...content,
    candidateSha256: computeThreadCandidateSha256(content),
  };
}

function codes(result: ReturnType<typeof validateThreadCandidate>): string[] {
  return result.findings.map((finding) => finding.code);
}

{
  const unicodeAndUrl = `Launch 世界 🚀 ${"a".repeat(220)} https://example.com/a/very/long/path`;
  const input = candidate((content) => {
    content.posts[0]!.text = unicodeAndUrl;
  });
  const result = validateThreadCandidate(input);
  const measurement = result.measurements.find((entry) => entry.postId === "post-1");

  assert.equal(measurement?.weightedLength, parseTweet(unicodeAndUrl).weightedLength);
  assert.equal(measurement?.urlCount, 1);
  assert.equal(result.accepted, parseTweet(unicodeAndUrl).weightedLength <= 280);
}

{
  const overLimit = "界".repeat(141);
  assert.equal(parseTweet(overLimit).weightedLength, 282);
  const result = validateThreadCandidate(candidate((content) => {
    content.posts[1]!.text = overLimit;
  }));

  assert.equal(result.accepted, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "post-weighted-length"
    && finding.severity === "fail"
    && finding.postId === "post-2"
  ));
}

for (const postIds of [
  ["post-2", "post-1"],
  ["post-1", "post-1"],
  ["post-1", "post-3"],
]) {
  const result = validateThreadCandidate(candidate((content) => {
    content.posts[0]!.postId = postIds[0]!;
    content.posts[1]!.postId = postIds[1]!;
  }));
  assert.equal(result.accepted, false);
  assert.ok(codes(result).includes("post-id-sequence"), postIds.join(","));
}

for (const [minPosts, maxPosts] of [[3, 4], [1, 1]] as const) {
  const result = validateThreadCandidate(candidate((content) => {
    content.brief = brief({ minPosts, maxPosts });
  }));
  assert.equal(result.accepted, false);
  assert.ok(codes(result).includes("post-count-out-of-range"));
}

{
  const unresolved = validateThreadCandidate(candidate((content) => {
    content.posts[0]!.claimIds = [];
  }));
  assert.ok(unresolved.findings.some((finding) =>
    finding.code === "required-claim-unresolved"
    && finding.claimId === "claim-required"
  ));

  const absentEvidence = validateThreadCandidate(candidate((content) => {
    content.posts[1]!.claimIds = ["claim-without-evidence"];
  }));
  assert.ok(absentEvidence.findings.some((finding) =>
    finding.code === "claim-missing-evidence"
    && finding.claimId === "claim-without-evidence"
    && finding.postId === "post-2"
  ));
}

{
  const result = validateThreadCandidate(candidate((content) => {
    content.posts[1]!.text = "  ＪＵＳＴ　ＶＩＢＩＮＧ  ";
  }));
  assert.equal(result.accepted, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "banned-phrase" && finding.postId === "post-2"
  ));
}

{
  const result = validateThreadCandidate(candidate((content) => {
    content.posts[1]!.media = [{ description: "Launch chart" }];
  }));
  assert.equal(result.accepted, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "missing-alt-text" && finding.postId === "post-2"
  ));
}

{
  const result = validateThreadCandidate(candidate((content) => {
    content.posts[1]!.text = "Use 𝕲𝖔𝖙𝖍𝖎𝖈 letters for the heading.";
  }));
  assert.equal(result.accepted, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "styled-unicode-alphabet"
    && finding.severity === "fail"
    && finding.postId === "post-2"
  ));
}

{
  const result = validateThreadCandidate(candidate((content) => {
    content.posts[1]!.text = "The launch dates are only shown in the chart below.";
    content.posts[1]!.media = [{ description: "Launch date chart", altText: "Chart" }];
  }));
  assert.equal(result.accepted, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "image-dependent-text"
    && finding.severity === "fail"
    && finding.postId === "post-2"
  ));
}

{
  const result = validateThreadCandidate(candidate((content) => {
    content.posts[1]!.text = "See the image for the launch dates.";
  }));
  assert.equal(result.accepted, false);
  assert.ok(codes(result).includes("image-dependent-text"));
}

{
  const result = validateThreadCandidate(candidate((content) => {
    content.posts[1]!.text = "🚀🚀🚀🚀 #Launch #launch #Build #Ship https://one.example/a https://two.example/b";
  }));
  assert.equal(result.accepted, true);
  assert.ok(codes(result).includes("repeated-emoji"));
  assert.ok(codes(result).includes("hashtag-count"));
  assert.ok(codes(result).includes("hashtag-repetition"));
  assert.ok(codes(result).includes("link-density"));
  assert.ok(result.findings
    .filter((finding) => ["repeated-emoji", "hashtag-count", "hashtag-repetition", "link-density"].includes(finding.code))
    .every((finding) => finding.severity === "warn"));
}

{
  const result = validateThreadCandidate(candidate((content) => {
    content.posts[1]!.text = "https://only.example/link";
  }));
  assert.equal(result.accepted, true);
  assert.ok(codes(result).includes("link-density"));
}

{
  const invalid = candidate() as unknown as Record<string, unknown>;
  invalid.posts = [{ postId: "post-1", text: " ", claimIds: [] }];
  const result = validateThreadCandidate(invalid);
  assert.equal(result.accepted, false);
  assert.ok(codes(result).includes("protocol-invalid"));
}

{
  const input = candidate();
  const contradictoryBrief = structuredClone(input.brief);
  contradictoryBrief.constraints.maxPosts = 1;
  const result = validateThreadCandidate(input, contradictoryBrief);
  assert.equal(result.accepted, false);
  assert.ok(codes(result).includes("brief-mismatch"));
}

{
  const first = validateThreadCandidate(candidate((content) => {
    content.posts[1]!.text = "𝕲𝖔𝖙𝖍𝖎𝖈";
  }));
  const second = validateThreadCandidate(candidate((content) => {
    content.posts[1]!.text = "𝕲𝖔𝖙𝖍𝖎𝖈";
  }));
  assert.deepEqual(first.findings, second.findings);
  assert.ok(first.findings.every((finding) => /^finding-[a-z0-9-]+$/.test(finding.findingId)));
}

console.log("tweet thread validation tests passed");
