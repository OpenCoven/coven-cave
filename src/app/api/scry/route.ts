/**
 * POST /api/scry — read an image, suggest a familiar (cave-3rz.3).
 *
 * Takes an image, picks the first LOCAL vision-capable harness that
 * `/api/harnesses` reports as ready, spawns it directly through `coven run`,
 * and returns parsed suggestions for name / role / description / type.
 *
 * **No familiar is involved.** `familiarId` is only how `/api/chat/send`
 * resolves harness + model + workspace; a scry needs a harness, a model and an
 * image path. `coven doctor` reports harnesses ready against an empty familiar
 * roster, so there is nothing to bootstrap and no first-run degradation path.
 *
 * The spawn and image-delivery contract is COPIED from the chat send route
 * rather than reinvented:
 *   · `writeImageAttachmentsToTemp` writes owner-only temp files,
 *   · `buildPromptWithAttachments` renders them as paths the harness opens
 *     with its Read tool (images are never base64 message blocks here),
 *   · argv is `coven run <harness> --stream-json [--model] [--permission] --
 *     <prompt>`, flags before the `--` separator because `<PROMPT>...` is a
 *     variadic positional that would otherwise swallow them,
 *   · every flag past `--stream-json` is gated on the installed CLI
 *     advertising it.
 *
 * The run is read-only and unarchived: it is a hidden meta run, not a turn in
 * anyone's transcript.
 */

import { spawn } from "node:child_process";
import { NextResponse } from "next/server";

import { GET as harnessesGET } from "@/app/api/harnesses/route";
import {
  cleanupImageTempFiles,
  writeImageAttachmentsToTemp,
} from "@/app/api/chat/send/chat-send-attachments";
import {
  covenRunSupportsModel,
  covenRunSupportsPermission,
} from "@/app/api/chat/send/chat-send-capabilities";
import {
  buildPromptWithAttachments,
  MAX_ATTACHMENT_IMAGE_BYTES,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import { cleanModelId } from "@/lib/chat-model-state";
import { covenLaunchCommand } from "@/lib/coven-bin";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import {
  hermesApiCanAccessLocalFiles,
  hermesApiConfig,
} from "@/lib/hermes-responses-stream";
import {
  defaultModelForRuntime,
  modelForRuntimeLaunch,
  runtimeOwnsModelDefault,
} from "@/lib/runtime-models";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  parseScryReply,
  pickScryHarness,
  SCRY_INSTRUCTIONS,
  type ScryHarnessReport,
} from "@/lib/scry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A scry is one look at one picture. Well past the ~13s a local vision
 *  harness takes, short enough that a wedged CLI cannot hold the rite open. */
const SCRY_TIMEOUT_MS = 90_000;
const DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

type ScryRequestBody = {
  image?: {
    name?: unknown;
    mimeType?: unknown;
    dataUrl?: unknown;
  };
  /** Optional override; still validated against the local-vision filter. */
  harness?: unknown;
  model?: unknown;
};

function badRequest(code: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

/** Accept only an inline image payload we can hand to a local harness. */
function readImage(body: ScryRequestBody): ChatAttachment | null {
  const image = body.image;
  if (!image || typeof image !== "object") return null;
  const mimeType = typeof image.mimeType === "string" ? image.mimeType.trim() : "";
  const dataUrl = typeof image.dataUrl === "string" ? image.dataUrl : "";
  if (!mimeType.startsWith("image/") || !DATA_URL_RE.test(dataUrl)) return null;
  const name = typeof image.name === "string" && image.name.trim()
    ? image.name.trim().slice(0, 120)
    : "likeness";
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  // Cheap byte estimate so an oversize payload is refused with a clear code
  // instead of silently vanishing inside writeImageAttachmentsToTemp.
  const size = Math.floor((base64.length * 3) / 4);
  return { name, type: mimeType, mimeType, dataUrl, size };
}

/** The harness list exactly as the rite would see it, straight from the
 *  endpoint's own handler — one probe implementation, not two. */
async function listHarnessReports(): Promise<ScryHarnessReport[]> {
  const response = await harnessesGET();
  const payload = (await response.json()) as { harnesses?: ScryHarnessReport[] };
  return Array.isArray(payload.harnesses) ? payload.harnesses : [];
}

/** Run `coven run …` to completion and return everything it printed. */
function runCoven(args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let child: ReturnType<typeof spawn>;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(output);
    };
    const onAbort = () => {
      try {
        child?.kill("SIGTERM");
      } catch {
        /* the child is already gone */
      }
      finish();
    };
    const timer = setTimeout(onAbort, SCRY_TIMEOUT_MS);
    try {
      const { command, fixedArgs } = covenLaunchCommand();
      child = spawn(command, [...fixedArgs, ...args], {
        // No familiar means no familiar workspace: run where the app runs.
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        // Shared keys only — harnessSpawnEnv(null) is the same no-familiar
        // environment /api/harnesses probes availability with.
        env: harnessSpawnEnv(null),
        shell: false,
      });
    } catch {
      clearTimeout(timer);
      resolve("");
      return;
    }
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("close", finish);
    child.on("error", finish);
  });
}

export async function POST(req: Request) {
  // A scry spawns a local CLI with caller-supplied content. Same local-origin
  // policy the other process-spawning routes carry.
  const nonLocal = rejectNonLocalRequest(req);
  if (nonLocal) return nonLocal;

  let body: ScryRequestBody;
  try {
    body = (await req.json()) as ScryRequestBody;
  } catch {
    return badRequest("invalid_json", "invalid json body — send { image: { name, mimeType, dataUrl } }.");
  }

  const attachment = readImage(body);
  if (!attachment) {
    return badRequest(
      "invalid_image",
      "Send `image` as { name, mimeType, dataUrl } with a base64 image data URL.",
    );
  }
  if ((attachment.size ?? 0) > MAX_ATTACHMENT_IMAGE_BYTES) {
    return badRequest(
      "image_too_large",
      `That likeness is over the ${Math.round(MAX_ATTACHMENT_IMAGE_BYTES / 1024 / 1024)}MB limit.`,
      413,
    );
  }

  // Local-vision filter, mirroring the send route's `imagesSupported`: no SSH
  // runtime can occur without a familiar, OpenClaw is a bridge, and a Hermes
  // API endpoint off this machine cannot open a Cave temp path.
  const scryEnv = harnessSpawnEnv(null);
  const hermesApi = hermesApiConfig({
    HERMES_API_URL: scryEnv.HERMES_API_URL,
    HERMES_API_KEY: scryEnv.HERMES_API_KEY,
  });
  const hermesReachesLocalFiles = !hermesApi || hermesApiCanAccessLocalFiles(hermesApi);
  const reports = await listHarnessReports();
  const requestedHarness = typeof body.harness === "string"
    ? body.harness.trim().toLowerCase()
    : "";
  const candidates = requestedHarness
    ? reports.filter((report) => report.id?.toLowerCase() === requestedHarness)
    : reports;
  const harness = pickScryHarness(candidates, { hermesReachesLocalFiles });
  if (!harness) {
    return NextResponse.json(
      {
        ok: false,
        code: "no_local_vision_harness",
        error: requestedHarness
          ? `${requestedHarness} cannot read a local image. Scrying needs a local harness such as Codex or Claude Code.`
          : "No local harness is ready to look at an image. Scrying needs a local runtime (Codex, Claude Code) — remote bridges cannot open a file on this machine. Install or sign in to one, then try again.",
      },
      { status: 503 },
    );
  }

  // Model: an explicit request wins, then the live catalog default the harness
  // report carries, then Cave's default for that runtime — unless the runtime
  // owns its own default, in which case forwarding nothing is correct.
  const reportDefault = cleanModelId(
    (reports.find((report) => report.id?.toLowerCase() === harness.id) as
      { defaultModel?: unknown } | undefined)?.defaultModel,
  );
  const model = cleanModelId(body.model)
    ?? reportDefault
    ?? (runtimeOwnsModelDefault(harness.id) ? null : cleanModelId(defaultModelForRuntime(harness.id)));
  const launchModel = model ? modelForRuntimeLaunch(harness.id, model) : null;

  const imageFilePaths = await writeImageAttachmentsToTemp([attachment]);
  const imagePath = imageFilePaths.get(0);
  if (!imagePath) {
    return badRequest(
      "image_not_staged",
      "Could not stage that likeness for the harness to read. Try again.",
      500,
    );
  }

  try {
    const prompt = buildPromptWithAttachments(SCRY_INSTRUCTIONS, [attachment], {
      imagesSupported: true,
      imageFilePaths,
    });
    const args = ["run", harness.id, "--stream-json"];
    if (launchModel && (await covenRunSupportsModel())) args.push("--model", launchModel);
    // A scry only looks. Read-only maps to the harness's native sandbox flag.
    if (await covenRunSupportsPermission()) args.push("--permission", "read-only");
    args.push("--", prompt);

    const raw = await runCoven(args, req.signal);
    const suggestions = parseScryReply(raw);
    return NextResponse.json({
      ok: true,
      harness: harness.id,
      harnessLabel: harness.label,
      model: launchModel,
      suggestions,
    });
  } finally {
    cleanupImageTempFiles(imageFilePaths);
  }
}
