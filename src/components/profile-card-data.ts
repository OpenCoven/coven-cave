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
import { canonicalMemoryErrorHeadline } from "@/lib/canonical-memory";
import type { CanonicalMemorySummary } from "@/lib/canonical-memory";
import { loadCanonicalMemoryList } from "@/lib/canonical-memory-resources";
import type { UserProfile } from "@/lib/user-profile-shared";
import type { CanonicalMemoryAvailability } from "@/components/familiars-view-stats";
import type { Familiar, SessionRow } from "@/lib/types";

type FamiliarsResponse =
  | { ok: true; familiars: Familiar[] }
  | { ok: false; familiars?: Familiar[]; error?: string };

type SessionsResponse =
  | { ok: true; sessions: SessionRow[] }
  | { ok: false; sessions?: SessionRow[]; error?: string };

type ProfileResponse =
  | { ok: true; profile: UserProfile }
  | { ok: false; profile?: UserProfile; error?: string };

export type ProfileCardData = {
  kind: ProfileKind;
  familiarId?: string;
  familiars: Familiar[];
  sessions: SessionRow[];
  covenEntries: CanonicalMemorySummary[];
  memoryAvailability: CanonicalMemoryAvailability;
  /** Why canonical memory is missing, in the reader's own words — a NOTICE,
   *  not an error. See the note on `errors` below. */
  memoryNotice: string | null;
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
    loadCanonicalMemoryList(),
    kind === "human"
      ? fetchResource<ProfileResponse>("/api/profile", { ok: false })
      : Promise.resolve<ProfileResponse>({ ok: true, profile: {} }),
  ]);

  // Canonical memory is an ENRICHMENT, and every one of its failure codes is a
  // state the reader already has copy for — `local_access_required` most of
  // all, which is not a failure at all but the expected answer whenever Cave is
  // reached from anywhere other than its own host.
  //
  // It used to land in `errors`, and the cost was not cosmetic: the card aborts
  // a refresh whenever `errors` is non-empty and KEEPS THE STALE DATA. So off
  // the local host every refresh failed permanently, throwing away freshly
  // loaded familiars, sessions and profile because an optional read was gated —
  // reported as "Refresh failed: memory unavailable (local_access_required)".
  //
  // `errors` now means "the refresh genuinely failed". Memory availability
  // travels as a notice beside it.
  const memoryNotice = memoryJson.state === "error"
    ? canonicalMemoryErrorHeadline(memoryJson.error.code)
    : null;

  const errors = [
    responseError(familiarsJson, "familiars unavailable"),
    responseError(sessionsJson, "sessions unavailable"),
    kind === "human" ? responseError(profileJson, "profile unavailable") : null,
  ].filter((error): error is string => Boolean(error));

  return {
    kind,
    familiarId,
    familiars: familiarsJson.familiars ?? [],
    sessions: sessionsJson.sessions ?? [],
    covenEntries: memoryJson.state === "ready" ? memoryJson.entries : [],
    memoryAvailability:
      memoryJson.state === "ready" ? "ready" : "unavailable",
    memoryNotice,
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
  /** Canonical memory's state, when it is not readable. Rendered as a quiet
   *  note rather than an alert — it explains a "—" in the memories tile, it
   *  does not mean anything failed. */
  memoryNotice: string | null;
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
    data.kind === "familiar" && data.memoryAvailability === "ready"
      ? data.covenEntries.filter((entry) => entry.familiarId === data.familiarId).length
      : data.kind === "familiar"
        ? null
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
    memoryNotice: data.memoryNotice,
  };
}
