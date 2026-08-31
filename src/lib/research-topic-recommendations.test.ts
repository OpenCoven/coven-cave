import assert from "node:assert/strict";
import test from "node:test";

import type { SavedLink } from "./link-organizer.ts";
import { researchRecommendationDisplayText } from "./research-recommendation-display.ts";
import type { ResearchMission } from "./research-missions.ts";
import {
  recommendResearchTopics,
  researchEvidenceRefIdFor,
  resolveResearchEvidenceRefId,
  type ResearchTopicRecommendationContext,
} from "./research-topic-recommendations.ts";
import type { KnowledgeEntry } from "./server/knowledge-vault.ts";
import type { SavedXSource } from "./server/x-sources.ts";
import type { SessionRow } from "./types.ts";

function mission(
  id: string,
  title: string,
  options: { intent?: string; sources?: ResearchMission["sources"] } = {},
): ResearchMission {
  return {
    id,
    familiarId: "researcher",
    title,
    intent: options.intent ?? `Decide whether ${title} advances the project outcome.`,
    status: "running",
    updatedAt: "2026-08-19T10:00:00.000Z",
    sources: options.sources ?? [],
  } as unknown as ResearchMission;
}

function savedLink(id: string, title: string, url = `https://example.test/${id}`): SavedLink {
  return {
    id,
    title,
    url,
    category: "article",
    addedAt: "2026-08-19T10:00:00.000Z",
    source: "desk",
  };
}

function xSource(id: string, postId: string, note = "Compare the implementation tradeoffs."): SavedXSource {
  return {
    id,
    familiarId: "researcher",
    postId,
    canonicalUrl: `https://x.com/example/status/${postId}`,
    originalUrl: `https://x.com/example/status/${postId}`,
    note,
    tags: ["research"],
    addedAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
    attachedMissionIds: [],
    availability: "available",
  };
}

function vaultEntry(id: string, title: string, body: string): KnowledgeEntry {
  return {
    id,
    title,
    tags: ["research"],
    scope: "global",
    enabled: true,
    body,
  };
}

function session(id: string, title: string): SessionRow {
  return {
    id,
    title,
    project_root: "/tmp/coven",
    harness: "copilot",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-08-19T09:00:00.000Z",
    updated_at: "2026-08-19T10:00:00.000Z",
    attention: { state: "none", since: null, reason: null },
  };
}

function context(
  overrides: Partial<ResearchTopicRecommendationContext> = {},
): ResearchTopicRecommendationContext {
  return {
    familiarId: "researcher",
    missions: [],
    savedLinks: [],
    xSources: [],
    vaultEntries: [],
    sessions: [],
    reducedContext: false,
    ...overrides,
  };
}

test("cleans presentation-only Markdown without removing meaningful punctuation", () => {
  assert.equal(
    researchRecommendationDisplayText("  ## **Designing agent systems**  "),
    "Designing agent systems",
  );
  assert.equal(
    researchRecommendationDisplayText("Compare **RAG** with __long context__ and `memory`"),
    "Compare RAG with long context and memory",
  );
  assert.equal(
    researchRecommendationDisplayText("C# throughput is 2 * 3"),
    "C# throughput is 2 * 3",
  );
});

test("proposes a new topic from collective Coven session history", () => {
  const result = recommendResearchTopics(context({
    sessions: [session("session-1", "Evaluate durable agent memory architectures")],
  }));

  assert.equal(result.recommendations[0]?.payload.recommendationKind, "start-mission");
  assert.equal(result.recommendations[0]?.payload.topic, "Evaluate durable agent memory architectures");
  assert.deepEqual(result.recommendations[0]?.evidenceRefs.map((ref) => ref.id), ["session:session-1"]);
  assert.equal(result.context.sessions, 1);
});

test("returns no fallback topics without resolved Research Desk or Vault evidence", () => {
  const result = recommendResearchTopics(context());

  assert.deepEqual(result.recommendations, []);
});

test("ranks a decision-value evidence gap ahead of generic source coverage", () => {
  const result = recommendResearchTopics(context({
    missions: [mission("decision-mission", "Choose a vector database")],
    savedLinks: [savedLink("generic-link", "Vector database overview")],
  }));

  assert.equal(result.recommendations[0]?.payload.recommendationKind, "investigate-evidence-gap");
  assert.deepEqual(result.recommendations[0]?.evidenceRefs.map((ref) => ref.id), ["mission:decision-mission"]);
  assert.match(result.recommendations[0]?.rankReasons.join(" ") ?? "", /decision|evidence gap/i);
  assert.equal(result.recommendations[1]?.evidenceRefs[0]?.id, "saved-link:generic-link");
});

test("maps original ordinary saved-link and X Article IDs into reversible typed evidence references", () => {
  const digitLeadingLinkId = "01234567-89ab-4cde-8fab-0123456789ab";
  const digitLeadingXSourceId = "12345678-89ab-4cde-8fab-0123456789ab";
  const result = recommendResearchTopics(context({
    savedLinks: [savedLink(digitLeadingLinkId, "Benchmark vector retrieval")],
    xSources: [xSource(digitLeadingXSourceId, "1844444444444444444")],
  }));

  const evidence = result.recommendations.flatMap((recommendation) => recommendation.evidenceRefs);
  assert.deepEqual(
    evidence.map((ref) => ({ id: ref.id, kind: ref.kind })),
    [
      { id: `saved-link:${digitLeadingLinkId}`, kind: "saved-link" },
      { id: `saved-link:${digitLeadingXSourceId}`, kind: "saved-link" },
    ],
  );
  assert.equal(result.recommendations[0]?.payload.sourceId, digitLeadingLinkId);
  assert.equal(result.recommendations[1]?.payload.sourceId, digitLeadingXSourceId);
  assert.equal(
    resolveResearchEvidenceRefId(researchEvidenceRefIdFor("saved-link", digitLeadingLinkId)!),
    digitLeadingLinkId,
  );
  assert.match(evidence[1]?.label ?? "", /^X Article 1844444444444444444$/);
});

test("keeps same-named Vault entries in separate collections as distinct evidence", () => {
  const result = recommendResearchTopics(context({
    vaultEntries: [
      { ...vaultEntry("guidance", "Engineering guidance", "Use bounded evidence."), collection: "engineering" },
      { ...vaultEntry("guidance", "Research guidance", "Use primary sources."), collection: "research" },
    ],
  }));

  assert.deepEqual(
    result.recommendations.map((recommendation) => recommendation.evidenceRefs[0]?.id),
    ["vault:engineering/guidance", "vault:research/guidance"],
  );
});

test("turns duplicate active missions into one refine proposal instead of a duplicate start", () => {
  const result = recommendResearchTopics(context({
    missions: [
      { ...mission("mission-a", "Compare vector database latency", { intent: "Choose the vector database." }), status: "paused" } as ResearchMission,
      mission("mission-b", "Compare vector database latency", { intent: "Verify a latency claim before rollout." }),
    ],
  }));

  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0]?.payload.recommendationKind, "refine-mission");
  assert.equal(result.recommendations[0]?.payload.targetMissionId, "mission-a");
  assert.deepEqual(
    result.recommendations[0]?.evidenceRefs.map((ref) => ref.id),
    ["mission:mission-a", "mission:mission-b"],
  );
});

test("keeps an exact completed mission match as a review proposal instead of starting a duplicate", () => {
  const completed = {
    ...mission("completed-mission", "Compare vector database latency"),
    status: "completed",
  } as ResearchMission;
  const result = recommendResearchTopics(context({
    missions: [completed],
    savedLinks: [savedLink("latency-source", "Compare vector database latency")],
  }));

  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0]?.payload.recommendationKind, "review-mission");
  assert.equal(result.recommendations[0]?.payload.targetMissionId, "completed-mission");
});

test("emits refine only when permitted and otherwise keeps exact active matches reviewable", () => {
  const statuses: ResearchMission["status"][] = [
    "queued",
    "planning",
    "running",
    "checkpoint",
    "paused",
    "completed",
    "failed",
    "cancelled",
    "archived",
  ];

  for (const status of statuses) {
    const topic = `Compare status ${status}`;
    const result = recommendResearchTopics(context({
      missions: [{ ...mission(`mission-${status}`, topic), status } as ResearchMission],
      savedLinks: [savedLink(`source-${status}`, topic)],
    }));
    const fromSavedLink = result.recommendations.find((recommendation) =>
      recommendation.evidenceRefs.some((ref) => ref.id === `saved-link:source-${status}`),
    );

    assert.equal(
      fromSavedLink?.payload.recommendationKind,
      status === "checkpoint" || status === "paused"
        ? "refine-mission"
        : status === "archived"
          ? "start-mission"
          : "review-mission",
      status,
    );
  }
});

test("keeps duplicate non-refinable missions reviewable instead of silently skipping them", () => {
  const result = recommendResearchTopics(context({
    missions: [
      { ...mission("running-a", "Compare database latency"), status: "running" } as ResearchMission,
      { ...mission("completed-b", "Compare database latency"), status: "completed" } as ResearchMission,
    ],
  }));

  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0]?.payload.recommendationKind, "review-mission");
  assert.equal(result.recommendations[0]?.payload.targetMissionId, "completed-b");
  assert.deepEqual(
    result.recommendations[0]?.evidenceRefs.map((ref) => ref.id),
    ["mission:completed-b", "mission:running-a"],
  );
});

test("treats a mission with only rejected ledger sources as an unresolved evidence gap", () => {
  const result = recommendResearchTopics(context({
    missions: [mission("rejected-sources", "Choose a vector database", {
      sources: [{ status: "rejected" }] as unknown as ResearchMission["sources"],
    })],
  }));

  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0]?.payload.recommendationKind, "investigate-evidence-gap");
  assert.equal(result.recommendations[0]?.payload.targetMissionId, "rejected-sources");
});

test("marks otherwise grounded recommendations as reduced-context when Vault retrieval failed", () => {
  const result = recommendResearchTopics(context({
    reducedContext: true,
    savedLinks: [savedLink("saved-link-42", "Benchmark vector retrieval")],
  }));

  assert.equal(result.reducedContext, true);
  assert.equal(result.recommendations.length, 1);
  assert.match(result.recommendations[0]?.rankReasons.join(" ") ?? "", /reduced context|Vault/i);
});

test("excludes secret-shaped evidence before it can enter recommendation output", () => {
  const authorizationSecret = ["Bearer", "secret-value-12345678"].join(" ");
  const result = recommendResearchTopics(context({
    missions: [mission("unsafe-mission", authorizationSecret)],
    savedLinks: [savedLink("unsafe-link", "Private link", "https://example.test/report?token=secret-value")],
    xSources: [xSource("unsafe-x", "1844444444444444444", "API_KEY=secret-value")],
    vaultEntries: [vaultEntry("unsafe-vault", "Vault", "client_secret=secret-value")],
  }));

  assert.deepEqual(result.recommendations, []);
  assert.doesNotMatch(JSON.stringify(result), /Bearer|API_KEY|client_secret|secret-value/);
});

test("keeps evidence-grounded ranking and its context fingerprint deterministic", () => {
  const first = context({
    missions: [mission("mission-b", "Compare retrieval quality"), mission("mission-a", "Choose retrieval quality")],
    savedLinks: [savedLink("link-b", "Retrieval benchmark"), savedLink("link-a", "Retrieval evaluation")],
    xSources: [xSource("x-b", "1844444444444444444"), xSource("x-a", "1844444444444444445")],
    vaultEntries: [vaultEntry("vault-b", "Retrieval playbook", "Evaluate retrieval quality."), vaultEntry("vault-a", "Evaluation rubric", "Choose a retrieval benchmark.")],
  });
  const second = context({
    ...first,
    missions: [...first.missions].reverse(),
    savedLinks: [...first.savedLinks].reverse(),
    xSources: [...first.xSources].reverse(),
    vaultEntries: [...first.vaultEntries].reverse(),
  });

  const firstResult = recommendResearchTopics(first);
  const secondResult = recommendResearchTopics(second);

  assert.deepEqual(secondResult, firstResult);
  assert.ok(firstResult.recommendations.every(
    (recommendation) => recommendation.contextFingerprint === firstResult.contextFingerprint,
  ));
  assert.ok(firstResult.recommendations.every((recommendation) => recommendation.evidenceRefs.length > 0));
});

test("compacts the maximum bounded snapshot before fingerprinting it", () => {
  const tags = Array.from({ length: 25 }, (_, index) => `tag-${index}`);
  const first = context({
    missions: Array.from({ length: 12 }, (_, index) => mission(`mission-${index}`, `Choose database ${index}`)),
    savedLinks: Array.from({ length: 12 }, (_, index) => savedLink(`link-${index}`, `Database source ${index}`)),
    xSources: Array.from({ length: 12 }, (_, index) => xSource(`source-${index}`, `18444444444444444${index}`, `Database note ${index}`)),
    vaultEntries: Array.from({ length: 8 }, (_, index) => ({
      ...vaultEntry(`vault-${index}`, `Database Vault ${index}`, `Database evidence ${index}`),
      tags,
    })),
  });
  const second = {
    ...first,
    missions: [...first.missions].reverse(),
    savedLinks: [...first.savedLinks].reverse(),
    xSources: [...first.xSources].reverse(),
    vaultEntries: [...first.vaultEntries].reverse(),
  };

  assert.doesNotThrow(() => recommendResearchTopics(first));
  assert.deepEqual(recommendResearchTopics(second), recommendResearchTopics(first));
});

test("selects late relevant Vault context and excludes zero-match Vault entries", () => {
  const result = recommendResearchTopics(context({
    savedLinks: [savedLink("database-source", "Database migration benchmark")],
    vaultEntries: [
      ...Array.from({ length: 8 }, (_, index) =>
        vaultEntry(`a-unrelated-${index}`, `Unrelated topic ${index}`, "Completely unrelated material."),
      ),
      vaultEntry("z-relevant", "Database migration guide", "Database migration evidence and validation."),
    ],
  }));

  assert.deepEqual(
    result.recommendations
      .flatMap((recommendation) => recommendation.evidenceRefs)
      .filter((ref) => ref.kind === "vault")
      .map((ref) => ref.id),
    ["vault:z-relevant"],
  );
});

console.log("research-topic-recommendations.test.ts passed");
