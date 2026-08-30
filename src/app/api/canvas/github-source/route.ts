import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { MAX_ARTIFACT_CODE_CHARS, looksLikeReact } from "@/lib/canvas-artifacts";
import { isSupportedCanvasGitHubFile } from "@/lib/canvas-github-import";
import { parseGitHubFileUrl } from "@/lib/github-repo-link";
import { resolveGitHubToken } from "@/lib/github-token";
import { requireTrustedHumanCanvasMutation } from "@/lib/server/trusted-grant-mutation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FETCH_TIMEOUT_MS = 12_000;

export async function POST(req: Request) {
  const denied = await requireTrustedHumanCanvasMutation(req);
  if (denied) return denied;

  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const parsed = typeof body.url === "string" ? parseGitHubFileUrl(body.url) : null;
  if (!parsed) {
    return NextResponse.json(
      { ok: false, error: "Paste a GitHub file link such as github.com/owner/repo/blob/main/page.tsx." },
      { status: 400 },
    );
  }
  if (!isSupportedCanvasGitHubFile(parsed.filePath)) {
    return NextResponse.json(
      { ok: false, error: "Canvas can import HTML, HTM, JSX, or TSX files." },
      { status: 415 },
    );
  }

  const endpoint = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/contents/${parsed.filePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}?ref=${encodeURIComponent(parsed.ref)}`;
  const token = resolveGitHubToken();
  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "coven-cave",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      const message =
        response.status === 404
          ? "GitHub couldn't find that file or the repository is private."
          : response.status === 401 || response.status === 403
            ? "GitHub denied access. Check the configured token and repository permissions."
            : `GitHub couldn't load that file (${response.status}).`;
      return NextResponse.json({ ok: false, error: message }, { status: response.status });
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_ARTIFACT_CODE_CHARS) {
      return NextResponse.json({ ok: false, error: "That file is too large for a Canvas sketch." }, { status: 413 });
    }
    const code = await response.text();
    if (!code.trim()) {
      return NextResponse.json({ ok: false, error: "That GitHub file is empty." }, { status: 422 });
    }
    if (code.length > MAX_ARTIFACT_CODE_CHARS) {
      return NextResponse.json({ ok: false, error: "That file is too large for a Canvas sketch." }, { status: 413 });
    }
    return NextResponse.json({
      ok: true,
      code,
      kind: looksLikeReact(code) ? "react" : "html",
      title: parsed.filePath.split("/").at(-1)?.replace(/\.[^.]+$/, "") || "GitHub sketch",
      source: {
        kind: "github",
        url: parsed.sourceUrl,
        repoUrl: parsed.repoUrl,
        filePath: parsed.filePath,
        ref: parsed.ref,
        projectFileHash: createHash("sha256").update(code).digest("hex"),
      },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json(
      { ok: false, error: timedOut ? "GitHub took too long to answer. Try again." : "Couldn't reach GitHub." },
      { status: 502 },
    );
  }
}
