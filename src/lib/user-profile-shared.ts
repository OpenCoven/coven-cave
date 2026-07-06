/**
 * Operator profile — shared types + validation.
 *
 * Isomorphic on purpose: the /api/profile PATCH route and the Settings panel
 * validate with the same rules. Persistence lives in cave-config.ts (text) and
 * user-avatar-file.ts (image) — this module is pure.
 */

export type ProfileLink = { label: string; url: string };

export type UserProfile = {
  name?: string;
  pronouns?: string;
  bio?: string;
  /** IANA timezone id. Unset = system. */
  timezone?: string;
  links?: ProfileLink[];
};

export const PROFILE_LIMITS = {
  name: 64,
  pronouns: 32,
  bio: 2000,
  linkLabel: 32,
  linkUrl: 512,
  links: 8,
} as const;

const PATCH_KEYS = new Set(["name", "pronouns", "bio", "timezone", "links"]);

/** Patch semantics: string fields — trimmed value sets, "" clears (null).
 *  `links` — array replaces, [] clears (null). Absent keys untouched. */
export type UserProfilePatch = {
  name?: string | null;
  pronouns?: string | null;
  bio?: string | null;
  timezone?: string | null;
  links?: ProfileLink[] | null;
};

export type NormalizeResult =
  | { ok: true; patch: UserProfilePatch }
  | { ok: false; error: string };

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function normText(
  value: unknown, field: "name" | "pronouns" | "bio",
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: `${field} must be a string` };
  const trimmed = value.trim();
  if (trimmed.length > PROFILE_LIMITS[field]) {
    return { ok: false, error: `${field} is too long (max ${PROFILE_LIMITS[field]} characters)` };
  }
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

export function normalizeUserProfilePatch(body: unknown): NormalizeResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const obj = body as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!PATCH_KEYS.has(key)) return { ok: false, error: `unknown field: ${key}` };
  }
  const patch: UserProfilePatch = {};
  for (const field of ["name", "pronouns", "bio"] as const) {
    if (field in obj) {
      const res = normText(obj[field], field);
      if (!res.ok) return res;
      patch[field] = res.value;
    }
  }
  if ("timezone" in obj) {
    if (typeof obj.timezone !== "string") return { ok: false, error: "timezone must be a string" };
    const tz = obj.timezone.trim();
    if (tz === "") patch.timezone = null;
    else if (!isValidTimezone(tz)) return { ok: false, error: `unknown timezone: ${tz}` };
    else patch.timezone = tz;
  }
  if ("links" in obj) {
    if (!Array.isArray(obj.links)) return { ok: false, error: "links must be an array" };
    if (obj.links.length > PROFILE_LIMITS.links) {
      return { ok: false, error: `too many links (max ${PROFILE_LIMITS.links})` };
    }
    const links: ProfileLink[] = [];
    for (const raw of obj.links) {
      const label = typeof (raw as ProfileLink)?.label === "string" ? (raw as ProfileLink).label.trim() : "";
      const url = typeof (raw as ProfileLink)?.url === "string" ? (raw as ProfileLink).url.trim() : "";
      if (!label || label.length > PROFILE_LIMITS.linkLabel) return { ok: false, error: "link label is required (max 32 characters)" };
      if (url.length > PROFILE_LIMITS.linkUrl || !isHttpUrl(url)) return { ok: false, error: `link URL must be http(s): ${label}` };
      links.push({ label, url });
    }
    patch.links = links.length === 0 ? null : links;
  }
  return { ok: true, patch };
}

/** Apply a normalized patch to a stored profile; returns undefined when empty. */
export function applyUserProfilePatch(
  current: UserProfile | undefined, patch: UserProfilePatch,
): UserProfile | undefined {
  const next: UserProfile = { ...(current ?? {}) };
  for (const key of ["name", "pronouns", "bio", "timezone", "links"] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === null) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

export function userDisplayName(profile: UserProfile | null | undefined): string {
  return profile?.name?.trim() || "You";
}
