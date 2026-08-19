import type { SavedLink } from "./link-organizer.ts";
import type { ResearchMission } from "./research-missions.ts";

export const MAX_CLIENT_RECOMMENDATION_MISSIONS = 12;
export const MAX_CLIENT_RECOMMENDATION_SAVED_LINKS = 12;

const MAX_REVISION_TEXT_CHARS = 512;

export type ResearchRecommendationClientContext = {
  familiarId: string;
  missions: Array<{
    id: string;
    status: string;
    updatedAt: string;
    titleRevision: string;
    intentRevision: string;
    evidenceRevision: string;
  }>;
  links: Array<{
    id: string;
    addedAt: string;
    revision: string;
  }>;
};

function compactHash(value: string): string {
  let hash = 0x811c9dc5;
  const bounded = value.slice(0, MAX_REVISION_TEXT_CHARS);
  for (let index = 0; index < bounded.length; index += 1) {
    hash ^= bounded.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function textRevision(value: string | undefined): string {
  const text = value ?? "";
  return `${text.length}:${compactHash(text)}`;
}

function missionEvidenceRevision(mission: ResearchMission): string {
  const sources = mission.sources
    .map((source) => ({
      id: textRevision(source.id),
      title: textRevision(source.title),
      sourceType: textRevision(source.sourceType),
      status: textRevision(source.status),
      publisher: textRevision(source.publisher),
      publishedAt: textRevision(source.publishedAt),
      claim: textRevision(source.claim),
      note: textRevision(source.note),
      confidence: source.confidence ?? null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const artifacts = mission.artifacts
    .map((artifact) => ({
      key: textRevision(artifact.key),
      kind: textRevision(artifact.kind),
      title: textRevision(artifact.title),
      knowledgeId: textRevision(artifact.knowledgeId),
      iteration: artifact.iteration,
      state: textRevision(artifact.state),
      rejectionReason: textRevision(artifact.rejectionReason),
      updatedAt: textRevision(artifact.updatedAt),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  return textRevision(JSON.stringify({ sources, artifacts }));
}

export function buildResearchRecommendationContext(
  familiarId: string,
  missions: readonly ResearchMission[],
  links: readonly SavedLink[],
): ResearchRecommendationClientContext {
  return {
    familiarId,
    missions: missions
      .filter((mission) => mission.status !== "archived")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, MAX_CLIENT_RECOMMENDATION_MISSIONS)
      .map((mission) => ({
        id: mission.id,
        status: mission.status,
        updatedAt: mission.updatedAt,
        titleRevision: textRevision(mission.title),
        intentRevision: textRevision(mission.intent),
        evidenceRevision: missionEvidenceRevision(mission),
      })),
    links: [...links]
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, MAX_CLIENT_RECOMMENDATION_SAVED_LINKS)
      .map((link) => ({
        id: link.id,
        addedAt: link.addedAt,
        revision: textRevision(`${link.title}\0${link.category}\0${link.source}`),
      })),
  };
}

export function researchRecommendationContextKey(context: ResearchRecommendationClientContext): string {
  return JSON.stringify(context);
}
