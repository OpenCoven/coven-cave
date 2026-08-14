/**
 * Operator profile — shared types + validation.
 *
 * Isomorphic on purpose: the /api/profile PATCH route and the Settings panel
 * validate with the same rules. Persistence lives in cave-config.ts (text) and
 * user-avatar-file.ts (image) — this module is pure.
 */

export type ProfileLink = { label: string; url: string };

export const MBTI_TYPES = [
  "INTJ", "INTP", "ENTJ", "ENTP",
  "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ",
  "ISTP", "ISFP", "ESTP", "ESFP",
] as const;

export type MbtiType = (typeof MBTI_TYPES)[number];

export type ProfilePersonalityAxes = {
  /** 0 = Extraversion, 100 = Introversion. */
  ei: number;
  /** 0 = Intuition, 100 = Sensing. */
  sn: number;
  /** 0 = Thinking, 100 = Feeling. */
  tf: number;
  /** 0 = Judging, 100 = Perceiving. */
  jp: number;
};

export type ProfilePersonality = {
  type: MbtiType;
  tuned: boolean;
  axes: ProfilePersonalityAxes;
};

export type UserProfile = {
  /** Legacy display-name field retained for existing cave-config files. */
  name?: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
  pronouns?: string;
  bio?: string;
  /** IANA timezone id. Unset = system. */
  timezone?: string;
  personality?: ProfilePersonality;
  links?: ProfileLink[];
};

export const PROFILE_LIMITS = {
  name: 64,
  firstName: 64,
  lastName: 64,
  nickname: 64,
  pronouns: 32,
  bio: 2000,
  linkLabel: 32,
  linkUrl: 512,
  links: 8,
} as const;

const PATCH_KEYS = new Set([
  "name",
  "firstName",
  "lastName",
  "nickname",
  "pronouns",
  "bio",
  "timezone",
  "personality",
  "links",
]);
const PERSONALITY_KEYS = new Set(["type", "tuned", "axes"]);
const PERSONALITY_AXIS_KEYS = ["ei", "sn", "tf", "jp"] as const;

/** Patch semantics: string fields — trimmed value sets, "" clears (null).
 *  `links` — array replaces, [] clears (null). Absent keys untouched. */
export type UserProfilePatch = {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  pronouns?: string | null;
  bio?: string | null;
  timezone?: string | null;
  personality?: ProfilePersonality | null;
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
  value: unknown,
  field: "name" | "firstName" | "lastName" | "nickname" | "pronouns" | "bio",
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: `${field} must be a string` };
  const trimmed = value.trim();
  if (trimmed.length > PROFILE_LIMITS[field]) {
    return { ok: false, error: `${field} is too long (max ${PROFILE_LIMITS[field]} characters)` };
  }
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

function normPersonality(
  value: unknown,
): { ok: true; value: ProfilePersonality | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "personality must be an object" };
  }
  const personality = value as Record<string, unknown>;
  for (const key of Object.keys(personality)) {
    if (!PERSONALITY_KEYS.has(key)) {
      return { ok: false, error: `unknown personality field: ${key}` };
    }
  }
  if (typeof personality.type !== "string") {
    return { ok: false, error: "personality type must be an MBTI type" };
  }
  const type = personality.type.trim().toUpperCase();
  if (!(MBTI_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `unknown personality type: ${type}` };
  }
  if (typeof personality.tuned !== "boolean") {
    return { ok: false, error: "personality tuned must be a boolean" };
  }
  if (
    typeof personality.axes !== "object"
    || personality.axes === null
    || Array.isArray(personality.axes)
  ) {
    return { ok: false, error: "personality axes must be an object" };
  }
  const rawAxes = personality.axes as Record<string, unknown>;
  const rawAxisKeys = Object.keys(rawAxes);
  if (
    rawAxisKeys.length !== PERSONALITY_AXIS_KEYS.length
    || rawAxisKeys.some((key) => !PERSONALITY_AXIS_KEYS.includes(key as typeof PERSONALITY_AXIS_KEYS[number]))
  ) {
    return { ok: false, error: "personality axes must contain ei, sn, tf, and jp" };
  }
  const axes = {} as ProfilePersonalityAxes;
  for (const key of PERSONALITY_AXIS_KEYS) {
    const axis = rawAxes[key];
    if (typeof axis !== "number" || !Number.isInteger(axis) || axis < 0 || axis > 100) {
      return { ok: false, error: `personality axis ${key} must be an integer from 0 to 100` };
    }
    axes[key] = axis;
  }
  return {
    ok: true,
    value: {
      type: type as MbtiType,
      tuned: personality.tuned,
      axes,
    },
  };
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
  for (const field of [
    "name",
    "firstName",
    "lastName",
    "nickname",
    "pronouns",
    "bio",
  ] as const) {
    if (field in obj) {
      const res = normText(obj[field], field);
      if (!res.ok) return res;
      patch[field] = res.value;
    }
  }
  if ("timezone" in obj) {
    if (obj.timezone === null) patch.timezone = null;
    else if (typeof obj.timezone !== "string") return { ok: false, error: "timezone must be a string" };
    else {
      const tz = obj.timezone.trim();
      if (tz === "") patch.timezone = null;
      else if (!isValidTimezone(tz)) return { ok: false, error: `unknown timezone: ${tz}` };
      else patch.timezone = tz;
    }
  }
  if ("personality" in obj) {
    const result = normPersonality(obj.personality);
    if (!result.ok) return result;
    patch.personality = result.value;
  }
  if ("links" in obj) {
    if (obj.links === null) {
      patch.links = null;
      return { ok: true, patch };
    }
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
  for (const key of [
    "name",
    "firstName",
    "lastName",
    "nickname",
    "pronouns",
    "bio",
    "timezone",
    "personality",
    "links",
  ] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === null) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

export function userFullName(profile: UserProfile | null | undefined): string {
  return [profile?.firstName, profile?.lastName]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

export function userDisplayName(profile: UserProfile | null | undefined): string {
  return profile?.nickname?.trim()
    || userFullName(profile)
    || profile?.name?.trim()
    || "You";
}
