import type { Familiar } from "@/lib/types";

export type QuickChatTarget = {
  familiarId: string | null;
  prompt: string;
  mention: string | null;
  error: string | null;
};

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function aliasesFor(familiar: Familiar): string[] {
  return [
    familiar.id,
    familiar.name ?? "",
    familiar.display_name,
  ]
    .filter(Boolean)
    .flatMap((name) => {
      const normalized = slug(name);
      return normalized ? [normalized, normalized.replace(/-/g, "")] : [];
    });
}

export function resolveQuickChatTarget(
  input: string,
  familiars: Familiar[],
  fallbackFamiliarId?: string | null,
): QuickChatTarget {
  const trimmed = input.trim();
  const mentionMatch = trimmed.match(/^@([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s+|$)/);
  const mention = mentionMatch?.[1] ?? null;
  const prompt = mentionMatch ? trimmed.slice(mentionMatch[0].length).trim() : trimmed;

  if (mention) {
    const wanted = slug(mention);
    const familiar = familiars.find((candidate) => aliasesFor(candidate).includes(wanted));
    if (!familiar) {
      return {
        familiarId: null,
        prompt,
        mention,
        error: `Unknown familiar @${mention}`,
      };
    }
    return {
      familiarId: familiar.id,
      prompt,
      mention,
      error: prompt ? null : "Enter a prompt for the familiar.",
    };
  }

  const fallback =
    (fallbackFamiliarId && familiars.find((familiar) => familiar.id === fallbackFamiliarId)) ??
    familiars[0] ??
    null;

  if (!fallback) {
    return {
      familiarId: null,
      prompt,
      mention: null,
      error: "No familiars are available.",
    };
  }

  return {
    familiarId: fallback.id,
    prompt,
    mention: null,
    error: prompt ? null : "Enter a prompt for the familiar.",
  };
}
