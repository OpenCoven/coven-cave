import { NextResponse } from "next/server";

import { resolveGitHubToken } from "@/lib/github-token";
import {
  parseGithubRepoInput,
  sanitizeGithubObjectSha,
} from "@/lib/research-github-repo";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  fetchGithubRepoFile,
  type GithubRepoFileResult,
} from "@/lib/server/research-github-repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Dependencies = {
  fetchFile?: typeof fetchGithubRepoFile;
  resolveToken?: () => string | null;
};

export function createGithubRepoFileRouteHandlers(dependencies: Dependencies = {}) {
  const fetchFile = dependencies.fetchFile ?? fetchGithubRepoFile;
  const resolveToken = dependencies.resolveToken ?? resolveGitHubToken;

  return {
    async GET(req: Request) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) return forbidden;

      const url = new URL(req.url);
      const parsed = parseGithubRepoInput(url.searchParams.get("repo"));
      const sha = sanitizeGithubObjectSha(url.searchParams.get("sha"));
      if (!parsed || !sha) {
        return NextResponse.json(
          { ok: false, error: "A valid repository and exact Git blob SHA are required." },
          { status: 400 },
        );
      }

      const result: GithubRepoFileResult = await fetchFile({
        ...parsed,
        sha,
        token: resolveToken(),
      });
      if (!result.ok) {
        const { error } = result;
        const status =
          error.kind === "not-found" ? 404
            : error.kind === "denied" ? 403
              : error.kind === "too-large" ? 413
                : error.kind === "binary" ? 415
                  : 502;
        const message =
          error.kind === "timeout"
            ? "GitHub took too long to answer. Try again."
            : error.kind === "network"
              ? "Couldn't reach GitHub."
              : error.message;
        return NextResponse.json({ ok: false, error: message }, { status });
      }
      return NextResponse.json({ ok: true, ...result.file });
    },
  };
}

const handlers = createGithubRepoFileRouteHandlers();
export const GET = handlers.GET;
