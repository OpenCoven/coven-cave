import { NextResponse } from "next/server";

import { rejectNonLocalRequest } from "@/lib/server/api-security";

import { arxivPdfUrl } from "./arxiv-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The final URL of the chain, which is the request URL when nothing redirected. */
function isArxivResponse(response: Response): boolean {
  let host: string;
  try {
    host = new URL(response.url).host;
  } catch {
    return false;
  }
  return host === "arxiv.org" || host.endsWith(".arxiv.org");
}

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
    // `accept-encoding: identity` keeps the upstream length describing exactly
    // the bytes we forward. fetch decompresses a gzipped body transparently
    // but leaves the COMPRESSED content-length on the response, so copying
    // that header across would hand pdf.js a truncated document. Asking for no
    // encoding is preferred over dropping content-length, because pdf.js reads
    // it — with accept-ranges — to fetch page ranges instead of the whole file.
    response = await fetch(upstream, {
      headers: { "accept-encoding": "identity", ...(range ? { range } : {}) },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "upstream unavailable" }, { status: 502 });
  }
  // arxivPdfUrl composes the REQUEST url safely, but nothing constrained where
  // a redirect chain ends up, and the body is streamed back as
  // application/pdf. Refuse a response that left arXiv rather than proxying it.
  if (!isArxivResponse(response)) {
    return NextResponse.json({ ok: false, error: "upstream redirected away" }, { status: 502 });
  }
  // Only a real 404 is "this paper does not exist". Collapsing every non-2xx
  // into one made a rate-limit or an arXiv outage indistinguishable from a
  // missing paper, and the viewer's error mapping reads this status: it would
  // have told the reader the paper "isn't available" -- which reads as
  // permanent -- when retrying seconds later would have worked.
  if (response.status === 404) {
    return NextResponse.json({ ok: false, error: "paper not found" }, { status: 404 });
  }
  if (!response.ok) {
    return NextResponse.json({ ok: false, error: "upstream unavailable" }, { status: 502 });
  }

  const headers = new Headers({ "content-type": "application/pdf" });
  for (const key of ["content-length", "content-range", "accept-ranges"]) {
    const value = response.headers.get(key);
    if (value) headers.set(key, value);
  }
  return new NextResponse(response.body, { status: response.status, headers });
}
