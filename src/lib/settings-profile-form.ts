import {
  PROFILE_LIMITS,
  type MbtiType,
  type ProfileLink,
  type ProfilePersonality,
  type ProfilePersonalityAxes,
} from "./user-profile-shared.ts";

export function legacyProfileName(displayName: string): string | null {
  const name = displayName.trim();
  return name && name.length <= PROFILE_LIMITS.name ? name : null;
}

export const PROFILE_TYPE_NAMES: Record<MbtiType, string> = {
  INTJ: "The Architect",
  INTP: "The Logician",
  ENTJ: "The Commander",
  ENTP: "The Debater",
  INFJ: "The Advocate",
  INFP: "The Mediator",
  ENFJ: "The Protagonist",
  ENFP: "The Campaigner",
  ISTJ: "The Logistician",
  ISFJ: "The Defender",
  ESTJ: "The Executive",
  ESFJ: "The Consul",
  ISTP: "The Virtuoso",
  ISFP: "The Adventurer",
  ESTP: "The Entrepreneur",
  ESFP: "The Entertainer",
};

export const PROFILE_TYPE_GROUPS: Array<{ name: string; codes: MbtiType[] }> = [
  { name: "Analysts", codes: ["INTJ", "INTP", "ENTJ", "ENTP"] },
  { name: "Diplomats", codes: ["INFJ", "INFP", "ENFJ", "ENFP"] },
  { name: "Sentinels", codes: ["ISTJ", "ISFJ", "ESTJ", "ESFJ"] },
  { name: "Explorers", codes: ["ISTP", "ISFP", "ESTP", "ESFP"] },
];

export const PROFILE_PERSONALITY_AXES = [
  { key: "ei", a: "E", b: "I", aWord: "Extraversion", bWord: "Introversion" },
  { key: "sn", a: "N", b: "S", aWord: "Intuition", bWord: "Sensing" },
  { key: "tf", a: "T", b: "F", aWord: "Thinking", bWord: "Feeling" },
  { key: "jp", a: "J", b: "P", aWord: "Judging", bWord: "Perceiving" },
] as const;

const PROFILE_PERSONALITY_CLAUSES: Record<string, string> = {
  E: "think out loud",
  I: "keep openers brief",
  S: "lead with specifics",
  N: "lead with the pattern",
  T: "name tradeoffs bluntly",
  F: "keep the phrasing warm",
  J: "close with a decision",
  P: "close with options",
};

export function seedPersonalityAxes(code: string): ProfilePersonalityAxes {
  const axes = {} as ProfilePersonalityAxes;
  PROFILE_PERSONALITY_AXES.forEach((axis, index) => {
    const letter = code[index];
    axes[axis.key] = letter === axis.a ? 25 : letter === axis.b ? 75 : 50;
  });
  return axes;
}

export function mbtiCode(personality: ProfilePersonality | null | undefined): string {
  if (!personality) return "";
  if (!personality.tuned) return personality.type;
  return PROFILE_PERSONALITY_AXES
    .map((axis) => (personality.axes[axis.key] < 50 ? axis.a : axis.b))
    .join("");
}

export function mbtiAdaptation(code: string): string {
  if (code.length !== PROFILE_PERSONALITY_AXES.length) return "";
  const clauses = code.split("").map((letter) => PROFILE_PERSONALITY_CLAUSES[letter]).filter(Boolean);
  if (clauses.length !== PROFILE_PERSONALITY_AXES.length) return "";
  return `Familiars ${clauses.slice(0, -1).join(", ")}, and ${clauses.at(-1)}.`;
}

export function mbtiAxisSummary(personality: ProfilePersonality): string {
  const code = mbtiCode(personality);
  return PROFILE_PERSONALITY_AXES.map((axis, index) => {
    const value = personality.axes[axis.key];
    const letter = code[index] || (value < 50 ? axis.a : axis.b);
    const percent = letter === axis.a ? 100 - value : value;
    return `${letter} ${Math.round(percent)}%`;
  }).join(" · ");
}

export type ProfileLinkSite = "github" | "x" | "linkedin" | "bluesky" | "dribbble" | "custom";

export type ProfileLinkDraft = {
  id: string;
  site: ProfileLinkSite;
  user: string;
  label: string;
  url: string;
};

export const PROFILE_LINK_SITES: Array<{
  value: ProfileLinkSite;
  label: string;
  prefix: string;
  urlPrefix: string;
  placeholder: string;
  monogram: string;
}> = [
  { value: "github", label: "GitHub", prefix: "github.com/", urlPrefix: "https://github.com/", placeholder: "username", monogram: "GH" },
  { value: "x", label: "X", prefix: "x.com/", urlPrefix: "https://x.com/", placeholder: "handle", monogram: "X" },
  { value: "linkedin", label: "LinkedIn", prefix: "linkedin.com/in/", urlPrefix: "https://linkedin.com/in/", placeholder: "slug", monogram: "in" },
  { value: "bluesky", label: "Bluesky", prefix: "bsky.app/profile/", urlPrefix: "https://bsky.app/profile/", placeholder: "you.bsky.social", monogram: "BS" },
  { value: "dribbble", label: "Dribbble", prefix: "dribbble.com/", urlPrefix: "https://dribbble.com/", placeholder: "username", monogram: "DR" },
  { value: "custom", label: "Custom URL", prefix: "", urlPrefix: "", placeholder: "https://", monogram: "↗" },
];

export function profileLinkDraft(link: ProfileLink, id: string): ProfileLinkDraft {
  for (const site of PROFILE_LINK_SITES) {
    if (site.value === "custom" || !link.url.startsWith(site.urlPrefix)) continue;
    return {
      id,
      site: site.value,
      user: link.url.slice(site.urlPrefix.length),
      label: link.label === site.label ? "" : link.label,
      url: "",
    };
  }
  return { id, site: "custom", user: "", label: link.label, url: link.url };
}

export function profileLinkValue(draft: ProfileLinkDraft): ProfileLink | null {
  const site = PROFILE_LINK_SITES.find((candidate) => candidate.value === draft.site)
    ?? PROFILE_LINK_SITES.at(-1)!;
  if (draft.site === "custom") {
    const label = draft.label.trim();
    const url = draft.url.trim();
    return label && url ? { label, url } : null;
  }
  const user = draft.user.trim().replace(/^@/, "");
  return user
    ? { label: draft.label.trim() || site.label, url: `${site.urlPrefix}${user}` }
    : null;
}

export function compactProfileLinkDrafts(drafts: ProfileLinkDraft[]): ProfileLinkDraft[] {
  return drafts.filter((draft) => profileLinkValue(draft) !== null);
}

export function profileCompletion(input: {
  displayName: string;
  pronouns: string;
  avatar: boolean;
  bio: string;
  links: number;
}): { filled: number; total: 5; percent: number } {
  const filled = [
    Boolean(input.displayName.trim()),
    Boolean(input.pronouns.trim()),
    input.avatar,
    Boolean(input.bio.trim()),
    input.links > 0,
  ].filter(Boolean).length;
  return { filled, total: 5, percent: filled * 20 };
}

export function buildProfileBioPrompt(input: {
  familiarName: string;
  firstName: string;
  lastName: string;
  nickname: string;
  pronouns: string;
  timezone: string;
  personality: ProfilePersonality | null;
  links: ProfileLink[];
}): string {
  const fullName = [input.firstName, input.lastName].map((part) => part.trim()).filter(Boolean).join(" ");
  const code = mbtiCode(input.personality);
  const sites = input.links.map((link) => link.label).filter(Boolean).join(", ");
  return [
    `You are ${input.familiarName}, a familiar who has worked alongside this operator for months.`,
    "Write their profile bio in third person, 2 sentences, under 240 characters.",
    "Terse, warm, specific, sentence case, no emoji, no hashtags, no quotes around the output.",
    "Return only the bio text.",
    "",
    `Name: ${fullName || input.nickname.trim() || "unknown"}`,
    `Nickname: ${input.nickname.trim() || "unstated"}`,
    `Pronouns: ${input.pronouns.trim() || "unstated"}`,
    `Timezone: ${input.timezone}`,
    `MBTI: ${code || "unstated"}${code ? ` (${PROFILE_TYPE_NAMES[code as MbtiType]})` : ""}`,
    `Links: ${sites || "none"}`,
  ].join("\n");
}
