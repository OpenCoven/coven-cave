import { NextResponse } from "next/server";

import { rejectNonLocalRequest } from "@/lib/server/api-security";

import { arxivPdfUrl } from "./arxiv-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  const upstream = arxivPdfUrl(id);
  if (!upstream) {
    return NextResponse.json({ ok: false, error: "invalid paper id" }, { status: 400 });
  }

  const range = req.headers.get("range");
  let response: Response;
  try {
    response = await fetch(upstream, { headers: range ? { range } : {} });
  } catch {
    return NextResponse.json({ ok: false, error: "upstream unavailable" }, { status: 502 });
  }
  if (!response.ok && response.status !== 206) {
    return NextResponse.json({ ok: false, error: "paper not found" }, { status: 404 });
  }

  const headers = new Headers({ "content-type": "application/pdf" });
  for (const key of ["content-length", "content-range", "accept-ranges"]) {
    const value = response.headers.get(key);
    if (value) headers.set(key, value);
  }
  return new NextResponse(response.body, { status: response.status, headers });
}
