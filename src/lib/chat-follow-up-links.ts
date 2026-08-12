import { extractLinks } from "./link-extractor.ts";
import { normalizeLinkUrl } from "./link-organizer.ts";
import type { AddNormalizedUrlOutcome } from "./board-card-ops.ts";

export type FollowUpLinkDestination =
  | { destination: "resources"; urls: string[] }
  | { destination: "task"; taskId: string; urls: string[] };

export type FollowUpLinkSaveResult =
  | {
      ok: true;
      message: string;
      added: number;
      duplicates: number;
      invalid: number;
    }
  | { ok: false; error: string };

type FetchImpl = typeof fetch;

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function resourcesOutcome(value: {
  added?: unknown;
  duplicates?: unknown;
  invalid?: unknown;
}): { added: number; duplicates: number; invalid: number } | null {
  if (
    !Array.isArray(value.added) ||
    !value.added.every(
      (entry) =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as { url?: unknown }).url === "string",
    ) ||
    !Array.isArray(value.duplicates) ||
    !value.duplicates.every((entry) => typeof entry === "string") ||
    !Array.isArray(value.invalid) ||
    !value.invalid.every((entry) => typeof entry === "string")
  ) {
    return null;
  }
  return {
    added: value.added.length,
    duplicates: value.duplicates.length,
    invalid: value.invalid.length,
  };
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function taskMessage(added: number, duplicates: number, invalid: number): string {
  const parts: string[] = [];
  if (added > 0) {
    parts.push(
      `${pluralize(added, "selected link", "selected links")} ${added === 1 ? "is" : "are"} now on the current task.`,
    );
  }
  if (duplicates > 0) {
    parts.push(
      `${pluralize(duplicates, "selected link", "selected links")} ${duplicates === 1 ? "was" : "were"} already there.`,
    );
  }
  if (invalid > 0) {
    parts.push(
      `${pluralize(invalid, "selected link", "selected links")} ${invalid === 1 ? "was" : "were"} invalid.`,
    );
  }
  return parts.join(" ") || "No new links were saved to the current task.";
}

function resourcesMessage(added: number, duplicates: number, invalid: number): string {
  const summary = [
    added > 0 ? `${added} saved` : null,
    duplicates > 0 ? `${duplicates} already saved` : null,
    invalid > 0 ? `${invalid} invalid` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `${summary || "No new links"} in Research Resources.`;
}

function requestError(
  response: Response | null,
  parsed: { error?: unknown } | null,
  fallback: string,
): FollowUpLinkSaveResult {
  if (typeof parsed?.error === "string" && parsed.error.trim()) {
    return { ok: false, error: parsed.error };
  }
  if (!response) return { ok: false, error: fallback };
  return { ok: false, error: `${fallback} (HTTP ${response.status})` };
}

async function readJson<T>(response: Response | null): Promise<T | null> {
  if (!response) return null;
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

function addNormalizedUrlOutcome(value: unknown): AddNormalizedUrlOutcome | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Record<keyof AddNormalizedUrlOutcome, unknown>>;
  if (
    !Array.isArray(candidate.added) ||
    !candidate.added.every((entry) => typeof entry === "string") ||
    !Array.isArray(candidate.duplicates) ||
    !candidate.duplicates.every((entry) => typeof entry === "string") ||
    !Array.isArray(candidate.invalid) ||
    !candidate.invalid.every((entry) => typeof entry === "string")
  ) {
    return null;
  }
  return {
    added: candidate.added,
    duplicates: candidate.duplicates,
    invalid: candidate.invalid,
  };
}

export function linksFromFollowUpSource(text: string): string[] {
  const byKey = new Map<string, string>();
  for (const value of extractLinks(text)) {
    if (!isValidHttpUrl(value)) continue;
    const key = normalizeLinkUrl(value);
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return [...byKey.values()];
}

export async function saveFollowUpLinks(
  request: FollowUpLinkDestination,
  fetchImpl: FetchImpl = fetch,
): Promise<FollowUpLinkSaveResult> {
  if (request.urls.length === 0) {
    return { ok: false, error: "Select at least one link." };
  }

  if (request.destination === "resources") {
    const response = await fetchImpl("/api/research/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls: request.urls, source: "chat" }),
    }).catch(() => null);
    const parsed = await readJson<{
      ok?: boolean;
      added?: unknown;
      duplicates?: unknown;
      invalid?: unknown;
      error?: unknown;
    }>(response);

    if (!response?.ok || !parsed?.ok) {
      return requestError(response, parsed, "Couldn't save links to Research Resources.");
    }

    const outcome = resourcesOutcome(parsed);
    if (!outcome) {
      return { ok: false, error: "Research Resources returned an invalid save result." };
    }
    const { added, duplicates, invalid } = outcome;
    return {
      ok: true,
      message: resourcesMessage(added, duplicates, invalid),
      added,
      duplicates,
      invalid,
    };
  }

  const patchResponse = await fetchImpl(`/api/board/${encodeURIComponent(request.taskId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ops: {
        linkOps: request.urls.map((value) => ({
          op: "addNormalizedUrl" as const,
          value,
        })),
      },
    }),
  }).catch(() => null);
  const patch = await readJson<{
    ok?: boolean;
    operationOutcome?: {
      addNormalizedUrl?: unknown;
    };
    error?: unknown;
  }>(patchResponse);

  if (!patchResponse?.ok || !patch?.ok) {
    return requestError(patchResponse, patch, "Couldn't attach links to the current task.");
  }

  const outcome = addNormalizedUrlOutcome(patch.operationOutcome?.addNormalizedUrl);
  if (!outcome) {
    return {
      ok: false,
      error: "The current task returned an invalid link-save outcome.",
    };
  }

  const added = outcome.added.length;
  const duplicates = outcome.duplicates.length;
  const invalid = outcome.invalid.length;

  return {
    ok: true,
    message: taskMessage(added, duplicates, invalid),
    added,
    duplicates,
    invalid,
  };
}
