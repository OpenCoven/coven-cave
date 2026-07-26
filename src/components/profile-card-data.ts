/**
 * Profile card data — fetch + derive for the Kaito-style profile pages
 * (cave-ujbr). Same never-reject contract as familiar-analytics-data: a
 * failing endpoint degrades to an empty payload and an entry in `errors`, so
 * a daemon-less Cave still renders the card frame with zeroed activity.
 */

import {
  buildProfileCardModel,
  type ProfileCardModel,
  type ProfileKind,
} from "@/lib/profile-card";
import type { UserProfile } from "@/lib/user-profile-shared";
import type { CovenMemoryEntry } from "@/components/familiars-view-stats";
import type { Familiar, SessionRow } from "@/lib/types";

type FamiliarsResponse =
  | { ok: true; familiars: Familiar[] }
  | { ok: false; familiars?: Familiar[]; error?: string };

type SessionsResponse =
  | { ok: true; sessions: SessionRow[] }
  | { ok: false; sessions?: SessionRow[]; error?: string };

type CovenMemoryResponse =
  | { ok: true; entries: CovenMemoryEntry[] }
  | { ok: false; entries?: CovenMemoryEntry[]; error?: string };

type ProfileResponse =
  | { ok: true; profile: UserProfile }
  | { ok: false; profile?: UserProfile; error?: string };

export type ProfileCardData = {
  kind: ProfileKind;
  familiarId?: string;
  familiars: Familiar[];
  sessions: SessionRow[];
  covenEntries: CovenMemoryEntry[];
  userProfile: UserProfile | null;
  errors: string[];
};

type ApiEnvelope = { ok: boolean; error?: string };

async function fetchResource<T extends ApiEnvelope>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return { ...fallback, error: `HTTP ${res.status}` } as T;
    }
    return ((await res.json()) ?? { ...fallback, error: "empty response" }) as T;
  } catch (err) {
    return { ...fallback, error: err instanceof Error ? err.message : "request failed" } as T;
  }
}

function responseError(response: ApiEnvelope, fallback: string): string | null {
  return response.ok ? null : response.error ?? fallback;
}

export async function loadProfileCardData(
  kind: ProfileKind,
  familiarId?: string,
): Promise<ProfileCardData> {
  const [familiarsJson, sessionsJson, memoryJson, profileJson] = await Promise.all([
    fetchResource<FamiliarsResponse>("/api/familiars", { ok: false, familiars: [] }),
    fetchResource<SessionsResponse>("/api/sessions/list", { ok: false, sessions: [] }),
    fetchResource<CovenMemoryResponse>("/api/coven-memory", { ok: false, entries: [] }),
    kind === "human"
      ? fetchResource<ProfileResponse>("/api/profile", { ok: false })
      : Promise.resolve<ProfileResponse>({ ok: true, profile: {} }),
  ]);

  const errors = [
    responseError(familiarsJson, "familiars unavailable"),
    responseError(sessionsJson, "sessions unavailable"),
    responseError(memoryJson, "memory unavailable"),
    kind === "human" ? responseError(profileJson, "profile unavailable") : null,
  ].filter((error): error is string => Boolean(error));

  return {
    kind,
    familiarId,
    familiars: familiarsJson.familiars ?? [],
    sessions: sessionsJson.sessions ?? [],
    covenEntries: memoryJson.entries ?? [],
    userProfile: profileJson.ok ? profileJson.profile ?? {} : null,
    errors,
  };
}

export type ProfileCardViewModel = {
  kind: ProfileKind;
  /** Subject familiar; null for the human card or an unknown id. */
  familiar: Familiar | null;
  familiars: Familiar[];
  userProfile: UserProfile | null;
  model: ProfileCardModel;
  errors: string[];
};

export function buildProfileCardViewModel(
  data: ProfileCardData,
  now: number = Date.now(),
): ProfileCardViewModel {
  const familiar =
    data.kind === "familiar"
      ? data.familiars.find((item) => item.id === data.familiarId) ?? null
      : null;
  const memoryCount =
    data.kind === "familiar"
      ? data.covenEntries.filter((entry) => entry.familiar_id === data.familiarId).length
      : 0;

  return {
    kind: data.kind,
    familiar,
    familiars: data.familiars,
    userProfile: data.userProfile,
    model: buildProfileCardModel({
      kind: data.kind,
      familiarId: data.familiarId,
      sessions: data.sessions,
      familiarIds: data.familiars.map((item) => item.id),
      memoryCount,
      familiarCount: data.familiars.length,
      now,
    }),
    errors: data.errors,
  };
}
