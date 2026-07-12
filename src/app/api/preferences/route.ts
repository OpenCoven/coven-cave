import { NextResponse } from "next/server";

import {
  PreferencesValidationError,
  validatePreferencesPatch,
} from "@/lib/preferences-schema";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { loadPreferences, patchPreferences } from "@/lib/server/preferences-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The closed schema permits three 256-entry custom-theme groups. Keep the
// transport bound above that valid worst case while still rejecting unbounded
// request bodies before JSON parsing.
const MAX_PREFERENCES_PATCH_BYTES = 1024 * 1024;

function response(preferences: Awaited<ReturnType<typeof loadPreferences>>) {
  return NextResponse.json(
    { ok: true, preferences },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  try {
    return response(await loadPreferences());
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to load preferences" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<unknown>(req, MAX_PREFERENCES_PATCH_BYTES);
  if (!parsed.ok) return parsed.response;

  try {
    const patch = validatePreferencesPatch(parsed.body);
    return response(await patchPreferences(patch));
  } catch (error) {
    if (error instanceof PreferencesValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to save preferences" },
      { status: 500 },
    );
  }
}
