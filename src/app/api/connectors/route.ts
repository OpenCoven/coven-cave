/**
 * GET /api/connectors — desktop connection status for the connectors a phone
 * can turn on per chat. Reuses the GitHub and Asana PAT status routes so
 * "connected" has one definition, and never returns a credential. Whether a
 * specific familiar received the credential is reported at send time, in
 * that turn's <connectors> block (src/lib/connectors.ts).
 */
import { NextResponse } from "next/server";
import { CONNECTOR_NAMES, type ConnectorId } from "@/lib/connectors";
import { GET as githubPatStatus } from "../github/pat/route";
import { GET as asanaPatStatus } from "../asana/pat/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PatStatus = { hasPat?: unknown; login?: unknown };

const SETUP_HINTS: Record<ConnectorId, string> = {
  github: "Connect GitHub on your desktop: open GitHub in Coven Cave and choose Connect GitHub.",
  asana: "Connect Asana on your desktop: open the Queue or a Board task in Coven Cave and choose Connect Asana.",
};

async function readStatus(handler: () => Promise<Response>): Promise<PatStatus> {
  try {
    return (await (await handler()).json()) as PatStatus;
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
  const [github, asana] = await Promise.all([
    readStatus(githubPatStatus),
    readStatus(asanaPatStatus),
  ]);
  return NextResponse.json({
    ok: true,
    connectors: [connectorEntry("github", github), connectorEntry("asana", asana)],
  });
}
