export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  ScryLikenessError,
  stageLikeness,
  sweepStaleLikenesses,
} from "@/lib/server/scry-likeness";
import { runScry } from "@/lib/server/scry-harness";
import {
  buildScryInstruction,
  isScryCapableHarness,
  parseScryReading,
  SCRY_MAX_LIKENESS_BYTES,
} from "@/lib/scry";
import { AURA_PRESETS, STARTER_GLYPHS } from "@/components/familiar-summoning-model";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

/**
 * The glyphs and auras a reading may name.
 *
 * These are the exact choices the summoning rite already renders, so a scry can
 * only ever land on a sigil the person could have picked and an aura that is a
 * token expression rather than a colour the model invented.
 */
const GLYPH_CHOICES = [...STARTER_GLYPHS];
const AURA_CHOICES = AURA_PRESETS.map((preset) => preset.label);

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE_HEADERS });
}

async function readBoundedBody(req: Request): Promise<Uint8Array> {
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > SCRY_MAX_LIKENESS_BYTES) {
    throw new ScryLikenessError("the likeness is too large", 413);
  }
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > SCRY_MAX_LIKENESS_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ScryLikenessError("the likeness is too large", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/**
 * Scry a familiar out of a likeness.
 *
 * `POST /api/scry?harness=<id>` with the raw image bytes as the body. There is
 * **no `familiarId`** — that is the point of the endpoint. The rite runs before
 * any familiar exists, and a first-run Cave with an empty roster still has
 * harnesses.
 *
 * Local-only, like every other route that reads personal bytes off disk or
 * spawns a process: a scry both writes a file and starts a runtime, so it is
 * never reachable from a paired mobile client over the tailnet.
 */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const harness = new URL(req.url).searchParams.get("harness")?.trim() ?? "";
  if (!isScryCapableHarness(harness)) {
    return jsonError("choose a runtime that can read a likeness", 400);
  }

  const declaredMime = req.headers.get("content-type") ?? "";

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(req);
  } catch (error) {
    if (error instanceof ScryLikenessError) return jsonError(error.message, error.status);
    return jsonError("could not read the likeness", 400);
  }

  // Clear anything a crashed request left behind before adding to the dir.
  // Best-effort and bounded; never fails the scry it runs ahead of.
  await sweepStaleLikenesses();

  let staged;
  try {
    staged = await stageLikeness(bytes, declaredMime);
  } catch (error) {
    if (error instanceof ScryLikenessError) return jsonError(error.message, error.status);
    return jsonError("could not stage the likeness", 500);
  }

  try {
    const run = await runScry({
      harness,
      likenessPath: staged.path,
      instruction: buildScryInstruction({
        imagePath: staged.path,
        glyphChoices: GLYPH_CHOICES,
        auraChoices: AURA_CHOICES,
      }),
    });
    if (!run.ok) return jsonError(run.error, run.status);

    const reading = parseScryReading(run.output, {
      glyphChoices: GLYPH_CHOICES,
      auraChoices: AURA_CHOICES,
    });
    if (!reading) {
      return jsonError(
        "The runtime answered, but nothing readable came back. Try another likeness or fill the rite in by hand.",
        502,
      );
    }
    return NextResponse.json({ ok: true, harness, reading }, { headers: NO_STORE_HEADERS });
  } finally {
    // The likeness exists only for the length of one scry. The rite uploads
    // the original through the avatar route if the person goes on to summon.
    await staged.dispose();
  }
}
