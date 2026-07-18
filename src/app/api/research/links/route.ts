import { NextResponse } from "next/server";

import { extractLinks } from "@/lib/link-extractor";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  listSavedLinks,
  MAX_LINKS_PER_SAVE,
  removeSavedLink,
  saveResearchLinks,
} from "@/lib/server/research-links";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  try {
    return NextResponse.json({ ok: true, links: await listSavedLinks() });
  } catch {
    return NextResponse.json(
      { ok: false, error: "failed to read the saved-links store" },
      { status: 500 },
    );
  }
}

type SaveBody = {
  /** Explicit URL list… */
  urls?: unknown;
  /** …or a raw pasted block; URLs are extracted from it. */
  text?: unknown;
  source?: unknown;
};

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<SaveBody>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const urls: string[] = [];
  if (Array.isArray(parsed.body.urls)) {
    for (const raw of parsed.body.urls) {
      if (typeof raw === "string" && raw.trim()) urls.push(raw.trim());
    }
  }
  if (typeof parsed.body.text === "string" && parsed.body.text.trim()) {
    urls.push(...extractLinks(parsed.body.text));
  }
  if (urls.length === 0) {
    return NextResponse.json(
      { ok: false, error: "no links found — pass urls[] or a text block containing http(s) links" },
      { status: 400 },
    );
  }
  if (urls.length > MAX_LINKS_PER_SAVE) {
    return NextResponse.json(
      { ok: false, error: `too many links in one save (max ${MAX_LINKS_PER_SAVE})` },
      { status: 400 },
    );
  }
  const source = parsed.body.source === "desk" ? "desk" : "chat";
  let result;
  try {
    result = await saveResearchLinks(urls, source);
  } catch {
    return NextResponse.json(
      { ok: false, error: "failed to write the saved-links store" },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    added: result.added,
    duplicates: result.duplicates,
    invalid: result.invalid,
  });
}

export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<{ id?: unknown }>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const id = typeof parsed.body.id === "string" ? parsed.body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }
  let removed: boolean;
  try {
    removed = await removeSavedLink(id);
  } catch {
    return NextResponse.json(
      { ok: false, error: "failed to write the saved-links store" },
      { status: 500 },
    );
  }
  if (!removed) {
    return NextResponse.json({ ok: false, error: "link not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
