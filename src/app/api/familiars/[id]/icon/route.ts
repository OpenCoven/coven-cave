import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";

export const dynamic = "force-dynamic";

type Body = { icon?: string | null };

/**
 * Proxy `PUT /api/v1/familiars/{id}/icon` on the daemon. The daemon owns the
 * canonical write to `~/.coven/familiars.toml`; this route just relays the
 * request from the browser-side override store.
 *
 * The body matches the daemon contract:
 *   `{ "icon": "ph:cat-fill" }` — insert/replace
 *   `{ "icon": "🐈" }`           — emoji literal works too
 *   `{ "icon": null }` / `{}`    — clear the field
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }
  const res = await callDaemon({
    method: "PUT",
    path: `/api/v1/familiars/${encodeURIComponent(id)}/icon`,
    body: { icon: body.icon ?? null },
  });
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: res.error ?? `daemon http ${res.status}`,
      },
      { status: res.status >= 400 ? res.status : 503 },
    );
  }
  return NextResponse.json({ ok: true, ...((res.data as object) ?? {}) });
}
