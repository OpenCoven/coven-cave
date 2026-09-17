import { NextResponse } from "next/server";

import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  resolveGitHubToken,
  resolveGitHubTokenForRead,
} from "@/lib/github-token";
import {
  parseGithubRepoInput,
  sanitizeGithubRef,
} from "@/lib/research-github-repo";
import {
  fetchGithubRepoView,
  type GithubRepoViewResult,
} from "@/lib/server/research-github-repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GithubRepoRouteDependencies = {
  fetchView?: typeof fetchGithubRepoView;
  resolveToken?: () => string | null;
};

/**
 * GET /api/research/github-repo?repo=<owner/name or github.com URL>&ref=<branch>
 *
 * Loopback-only (like every `/api/research` route), and the only outbound
 * traffic it performs is the server's own `api.github.com` fetch resolved
 * through `resolveGitHubToken`. The viewer component only calls this route on
 * an explicit user action, which is the remote-content consent surface for the
 * Research Desk (see research-github-repo-viewer.tsx).
 */
export function createGithubRepoRouteHandlers(dependencies: GithubRepoRouteDependencies = {}) {
  const fetchView = dependencies.fetchView ?? fetchGithubRepoView;
  const resolveToken = dependencies.resolveToken ?? resolveGitHubToken;

  return {
    async GET(req: Request) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) return forbidden;

      const url = new URL(req.url);
      const parsed = parseGithubRepoInput(url.searchParams.get("repo"));
      if (!parsed) {
        return NextResponse.json(
          { ok: false, error: "Enter a GitHub repository as owner/name or a github.com URL." },
          { status: 400 },
        );
      }

      const refParam = url.searchParams.get("ref");
      const ref = sanitizeGithubRef(refParam);
      if (refParam !== null && ref === null) {
        return NextResponse.json(
          { ok: false, error: "That branch name can't be used." },
          { status: 400 },
        );
      }

      const result: GithubRepoViewResult = await fetchView({
        owner: parsed.owner,
        repo: parsed.repo,
        ...(ref ? { ref } : {}),
        token: resolveGitHubTokenForRead(resolveToken),
      });

      if (!result.ok) {
        const error = result.error;
        const status =
          error.kind === "not-found" ? 404
            : error.kind === "denied" ? 403
              : error.kind === "upstream" ? 502
                : 502;
        const message =
          error.kind === "timeout"
            ? "GitHub took too long to answer. Try again."
            : error.kind === "network"
              ? "Couldn't reach GitHub."
              : error.message;
        return NextResponse.json({ ok: false, error: message }, { status });
      }

      return NextResponse.json({ ok: true, ...result.view });
    },
  };
}

const handlers = createGithubRepoRouteHandlers();
export const GET = handlers.GET;
