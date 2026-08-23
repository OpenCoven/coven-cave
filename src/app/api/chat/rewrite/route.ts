// POST /api/chat/rewrite — the same answer in a different register.
//
// Backs the Rewrite control in the Expand reader (Reader.dc.html frame 3a).
// This is deliberately NOT a chat turn: it produces text for the reader to
// display, never a session in the transcript. Two consequences follow, and both
// are load-bearing:
//
//   • no `--archive`. enrich-steps archives because its runs are real work; a
//     reading aid must not file a session record every time someone presses a
//     toggle.
//   • the reply is never persisted. Refresh the reader and you are back to the
//     answer as written, which is the honest default: the rewrite is a lens,
//     not a revision of what the familiar said.
//
// Same trusted-harness gate as enrich-steps: an untrusted harness does not get
// handed the answer text.

import { bindingFor, loadConfig } from "@/lib/cave-config";
import { isTrustedChatHarness } from "@/lib/harness-adapters";
import { runCovenOneShot, resolveFamiliarWorkspace } from "@/lib/server/coven-oneshot";
import {
  REWRITE_MAX_CHARS,
  extractRewrite,
  isRewriteTone,
  isUsableRewrite,
  rewritePrompt,
} from "@/lib/reader-rewrite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAFE_ID = /^[a-z0-9_-]+$/i;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const text = typeof input.text === "string" ? input.text : "";
  const tone = input.tone;
  const familiarId = typeof input.familiarId === "string" ? input.familiarId : "";

  if (!isRewriteTone(tone)) {
    return Response.json({ ok: false, error: "unknown tone" }, { status: 400 });
  }
  if (!text.trim()) {
    return Response.json({ ok: false, error: "nothing to rewrite" }, { status: 400 });
  }
  if (text.length > REWRITE_MAX_CHARS) {
    // Refused rather than truncated: half an answer rewritten reads as a
    // complete one, and the reader has no way to tell it was cut.
    return Response.json({ ok: false, error: "answer too long to rewrite" }, { status: 413 });
  }
  if (!SAFE_ID.test(familiarId)) {
    return Response.json({ ok: false, error: "unknown familiar" }, { status: 400 });
  }

  const config = await loadConfig();
  const binding = bindingFor(config, familiarId);
  if (!binding?.harness || !isTrustedChatHarness(binding.harness)) {
    // 501, not 500: nothing is broken: this deployment simply cannot rewrite.
    // The reader reads this as "hide the control" rather than "show an error".
    return Response.json(
      { ok: false, error: "rewrite unavailable for this familiar" },
      { status: 501 },
    );
  }

  const workspace = await resolveFamiliarWorkspace(familiarId);
  const args = [
    "run",
    binding.harness,
    "--stream-json",
    // Answer text is untrusted model output. Keep prompt injection from turning
    // this text-only reader aid into a privileged agent run.
    "--permission",
    "read-only",
    "--title",
    "Reader rewrite",
    "--labels",
    "reader,rewrite",
    "--familiar",
    familiarId,
    "--",
    rewritePrompt(tone, text),
  ];

  const raw = await runCovenOneShot(args, req.signal, workspace, familiarId);
  if (req.signal.aborted) {
    return Response.json({ ok: false, error: "aborted" }, { status: 499 });
  }

  const rewritten = extractRewrite(raw);
  if (!isUsableRewrite(rewritten)) {
    return Response.json({ ok: false, error: "no rewrite produced" }, { status: 502 });
  }

  return Response.json({ ok: true, tone, text: rewritten });
}
