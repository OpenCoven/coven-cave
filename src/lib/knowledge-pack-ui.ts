import { isValidPackSlug, type KnowledgePackSeedRequest, type KnowledgePackSeedResult } from "./knowledge-pack-types.ts";

export type SubfolderValidation =
  | { ok: true; segments: string[] }
  | { ok: false; error: string };

export function validateSubfolderInput(input: string): SubfolderValidation {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, segments: [] };
  if (trimmed.includes("//")) return { ok: false, error: "Use single slashes between folder segments." };
  const segments = trimmed.split("/");
  if (segments.length > 3) return { ok: false, error: "Use at most 3 folder segments." };
  if (segments.some((segment) => !isValidPackSlug(segment))) {
    return { ok: false, error: "Use lowercase slug segments only: letters, numbers, and hyphens." };
  }
  return { ok: true, segments };
}

export function summarizeSeedResult(result: KnowledgePackSeedResult): string {
  const parts = [
    `${result.created.length} created`,
    `${result.skipped.length} skipped`,
  ];
  const collections = result.collections?.filter(Boolean) ?? [];
  return collections.length ? `${parts.join(", ")} · collections: ${collections.join(", ")}` : parts.join(", ");
}

export function buildSeedRequest(
  packId: string,
  target: "vault" | "project",
  projectRoot?: string,
  subfolder?: string,
): KnowledgePackSeedRequest {
  if (!isValidPackSlug(packId)) throw new Error("Pack id must be a lowercase slug");
  if (target === "vault") return { packId, target: "vault" };

  const root = projectRoot?.trim();
  if (!root) throw new Error("Project root is required");

  const validation = validateSubfolderInput(subfolder ?? "");
  if (!validation.ok) throw new Error(validation.error);
  const normalizedSubfolder = validation.segments.join("/");

  return {
    packId,
    target: "project",
    projectRoot: root,
    ...(normalizedSubfolder ? { subfolder: normalizedSubfolder } : {}),
  };
}
