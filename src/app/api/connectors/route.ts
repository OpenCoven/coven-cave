/**
 * GET /api/connectors — desktop connection status for the connectors a phone
 * can turn on per chat. Reads the same PAT status as /api/github/pat and
 * /api/asana/pat (src/lib/server/pat-status.ts) so "connected" has one
 * definition, plus the desktop's stored gh login for GitHub
 * (src/lib/server/gh-login-status.ts), and never returns a credential. Whether a
 * specific familiar received the credential is reported at send time, in
 * that turn's <connectors> block (src/lib/connectors.ts).
 */
import { NextResponse } from "next/server";
import { CONNECTOR_NAMES, type ConnectorId } from "@/lib/connectors";
import { hasGhStoredLogin } from "@/lib/server/gh-login-status";
import { readAsanaPatStatus, readGitHubPatStatus } from "@/lib/server/pat-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PatStatus = { hasPat?: unknown; login?: unknown };

const SETUP_HINTS: Record<ConnectorId, string> = {
  github: "Connect GitHub on your desktop: open GitHub in Coven Cave and choose Connect GitHub.",
  asana: "Connect Asana on your desktop: open the Queue or a Board task in Coven Cave and choose Connect Asana.",
};

function readStatus(read: () => PatStatus): PatStatus {
  try {
    return read();
  } catch {
    return {};
  }
}

function connectorEntry(id: ConnectorId, status: PatStatus) {
  const account = typeof status.login === "string" ? status.login.trim() : "";
  return {
    id,
    name: CONNECTOR_NAMES[id],
    connected: status.hasPat === true,
    account: account || null,
    setupHint: SETUP_HINTS[id],
  };
}

export async function GET() {
  const github = readStatus(readGitHubPatStatus);
  const asana = readStatus(readAsanaPatStatus);
  // Without a Cave PAT, the desktop's stored gh login also counts as
  // connected (#5845). Only `gh auth status` is asked; the account stays
  // null because the login name is not read from gh.
  const githubConnected =
    github.hasPat === true || (await hasGhStoredLogin(process.env));
  return NextResponse.json({
    ok: true,
    connectors: [
      connectorEntry("github", { ...github, hasPat: githubConnected }),
      connectorEntry("asana", asana),
    ],
  });
}
