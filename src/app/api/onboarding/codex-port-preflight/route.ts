import { NextResponse } from "next/server";
import {
  CODEX_OAUTH_PORT,
  preflightCodexOAuthPort,
} from "@/lib/server/codex-oauth-port";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/onboarding/codex-port-preflight
 *
 * Onboarding helper: probe Codex CLI's OAuth callback port (TCP 1455) and,
 * if a stale `codex` process is holding it, clear it so the next
 * `codex login` can bind. Returns a normalized outcome the onboarding UI
 * uses to either pop a success toast or surface lsof investigation steps.
 *
 * Conservative: only kills a holder whose argv/path clearly contains a
 * `codex` token. Anything else (or unidentified holders) is reported with
 * lsof instructions so the user can investigate.
 *
 * This route is unauthenticated by Cave convention (loopback-only Next.js
 * server, same as the rest of /api/onboarding/*). The only privileged
 * action it can take is SIGTERM/SIGKILL on a clearly-identified codex
 * process — the same thing the user could do with `kill <pid>` in their
 * own terminal. We accept that trade for the one-click ergonomics.
 */
export async function POST() {
  const outcome = await preflightCodexOAuthPort();

  switch (outcome.kind) {
    case "port-free":
      return NextResponse.json({
        ok: true,
        outcome: "port-free",
        port: CODEX_OAUTH_PORT,
        message: `Port ${CODEX_OAUTH_PORT} is already free. You can run \`codex login\` now.`,
      });
    case "cleared-stale-codex":
      return NextResponse.json({
        ok: true,
        outcome: "cleared-stale-codex",
        port: CODEX_OAUTH_PORT,
        killedPid: outcome.killedPid,
        descriptor: outcome.descriptor,
        message: `Cleared a stale codex process (pid ${outcome.killedPid}) that was holding port ${CODEX_OAUTH_PORT}. You can run \`codex login\` now.`,
      });
    case "held-by-other":
      return NextResponse.json(
        {
          ok: false,
          outcome: "held-by-other",
          port: CODEX_OAUTH_PORT,
          pid: outcome.pid,
          descriptor: outcome.descriptor,
          message: `Port ${CODEX_OAUTH_PORT} is held by pid ${outcome.pid} (\`${outcome.descriptor}\`), which does not look like a codex OAuth helper. Refusing to kill it — run \`lsof -i tcp:${CODEX_OAUTH_PORT}\` to investigate, then either stop that process or retry once it is gone.`,
        },
        { status: 409 },
      );
    case "held-unknown":
      return NextResponse.json(
        {
          ok: false,
          outcome: "held-unknown",
          port: CODEX_OAUTH_PORT,
          message: `Port ${CODEX_OAUTH_PORT} is held but we could not identify the process (lsof missing or ambiguous). Run \`lsof -i tcp:${CODEX_OAUTH_PORT}\` to investigate, then retry.`,
        },
        { status: 409 },
      );
  }
}
