/**
 * Client-side helper: start an Omnigent run via /api/omnigent/sessions.
 * Used by chat / home / board when the host chip is an omnigent:… id.
 */

import { parseOmnigentHostOptionId } from "./ids.ts";

export type BrowserOmnigentRunInput = {
  prompt: string;
  runtimeHost?: string | null;
  familiarId?: string | null;
  title?: string;
  workspace?: string;
  agentId?: string;
  source?: string;
  boardCardId?: string;
  jobId?: string;
};

export type BrowserOmnigentRunResult =
  | { ok: true; sessionId: string; webUrl: string }
  | { ok: false; error: string };

export async function startOmnigentRunFromBrowser(
  input: BrowserOmnigentRunInput,
): Promise<BrowserOmnigentRunResult> {
  const hostId = parseOmnigentHostOptionId(input.runtimeHost) ?? undefined;
  try {
    const res = await fetch("/api/omnigent/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: input.prompt,
        title: input.title,
        familiar: input.familiarId || undefined,
        hostId,
        workspace: input.workspace,
        agentId: input.agentId,
        source: input.source ?? "cave-chat",
        boardCardId: input.boardCardId,
        jobId: input.jobId,
      }),
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      detail?: string;
      webUrl?: string;
      session?: { id?: string };
    } | null;
    if (!res.ok || !json?.ok) {
      return {
        ok: false,
        error: json?.detail || json?.error || `Omnigent run failed (http ${res.status})`,
      };
    }
    const sessionId = json.session?.id;
    const webUrl = json.webUrl;
    if (!sessionId || !webUrl) {
      return { ok: false, error: "Omnigent returned no session id" };
    }
    return { ok: true, sessionId, webUrl };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Omnigent run failed",
    };
  }
}
