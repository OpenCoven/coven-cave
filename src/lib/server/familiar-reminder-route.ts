import { NextResponse } from "next/server";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { loadVisibleFamiliarRoster } from "@/lib/server/familiar-roster";

export const FAMILIAR_REMINDER_TITLE_MAX = 240;
export const FAMILIAR_REMINDER_BODY_MAX = 2_000;
export const FAMILIAR_REMINDER_SNOOZE_MAX_MINUTES = 7 * 24 * 60;

export function familiarReminderRefusal(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function requireFamiliar(familiarId: string): Promise<NextResponse | null> {
  if (!isValidFamiliarId(familiarId)) return familiarReminderRefusal("path not allowed", 403);
  const roster = await loadVisibleFamiliarRoster();
  if (!roster.ok) return familiarReminderRefusal("familiar unavailable", 503);
  return roster.roster.some((familiar) => familiar.id === familiarId)
    ? null
    : familiarReminderRefusal("familiar not found", 404);
}

export function parseFireAt(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function parseTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title.length > 0 && title.length <= FAMILIAR_REMINDER_TITLE_MAX ? title : null;
}

export function parseBody(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.length > FAMILIAR_REMINDER_BODY_MAX) return undefined;
  return value.trim() || null;
}
