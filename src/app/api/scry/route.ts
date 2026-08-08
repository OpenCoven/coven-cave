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
 *
 * **It streams.** A scry costs 12–18 s, and one static line for that long reads
 * as a hang. The response is `text/event-stream` carrying the events in
 * `src/lib/scry-stream.ts`, shaped like the chat route's SSE so there is one
 * wire convention here rather than two. Every stage is emitted at the moment
 * the endpoint reaches it — there is no timer in this file, and nothing is
 * announced before it has happened. Assistant text is forwarded verbatim as
 * the harness produces it.
 *
 * Request-shape failures (bad JSON, no image, oversize image) still answer with
 * a plain JSON error and a real status code, because those are known before a
 * stream is worth opening. Everything after that — including "no local vision
 * harness", which is only knowable after a 3.4 s probe — arrives as an in-band
 * `error` event.
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
import { harnessReportsWithCache } from "@/lib/server/harness-report-cache";
import {
  parseScryReply,
  pickScryHarness,
  SCRY_INSTRUCTIONS,
  type ScryHarnessReport,
} from "@/lib/scry";
import {
  readScryHarnessFrame,
  scrySse,
  type ScryStreamEvent,
} from "@/lib/scry-stream";

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
async function probeHarnessReports(): Promise<ScryHarnessReport[]> {
  const response = await harnessesGET();
  const payload = (await response.json()) as { harnesses?: ScryHarnessReport[] };
  return Array.isArray(payload.harnesses) ? payload.harnesses : [];
}

/**
 * The harness list, from the shared cache when a recent probe left one there.
 *
 * A cold probe is ~3.4s of a scry's wall clock (measured: 3.43 / 3.49 / 3.57s),
 * and `/api/harnesses` writes through on every ordinary UI call — so a rite
 * that prefetched the list on mount finds this warm and the user never waits
 * for it. See `src/lib/server/harness-report-cache.ts`.
 */
function listHarnessReports(): Promise<{ reports: ScryHarnessReport[]; cached: boolean }> {
  return harnessReportsWithCache<ScryHarnessReport>(probeHarnessReports);
}

/**
 * Run `coven run …`, handing every complete stdout LINE to `onLine` as it
 * arrives, and resolving with everything printed once the child exits.
 *
 * Line assembly happens here because a pipe chunk boundary lands wherever the
 * OS put it — a JSONL frame is routinely split across two `data` events, and
 * parsing a half-frame would drop the stage it carries. stderr is collected but
 * never treated as a frame source: `parseScryReply` still wants it as a last
 * resort for a harness that ignores `--stream-json`.
 */
function runCoven(
  args: string[],
  signal: AbortSignal,
  onLine: (line: string) => void,
): Promise<string> {
  return new Promise((resolve) => {
    let output = "";
    let pending = "";
    let settled = false;
    let child: ReturnType<typeof spawn>;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (pending.trim()) {
        // A final line with no trailing newline is still a frame.
        try {
          onLine(pending);
        } catch {
          /* a consumer failure must not strand the child's output */
        }
      }
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
        windowsHide: true,
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
      const text = chunk.toString("utf8");
      output += text;
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onLine(line);
        } catch {
          /* one unreadable frame never ends the run */
        }
      }
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

  const requestedHarness = typeof body.harness === "string"
    ? body.harness.trim().toLowerCase()
    : "";

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      let closed = false;
      const push = (event: ScryStreamEvent) => {
        if (closed || req.signal.aborted) return;
        try {
          controller.enqueue(scrySse(event));
        } catch {
          // The client went away mid-scry. Stop enqueuing; the child is torn
          // down by the abort listener inside runCoven.
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by a cancelled request */
        }
      };

      // Local-vision filter, mirroring the send route's `imagesSupported`: no
      // SSH runtime can occur without a familiar, OpenClaw is a bridge, and a
      // Hermes API endpoint off this machine cannot open a Cave temp path.
      const scryEnv = harnessSpawnEnv(null);
      const hermesApi = hermesApiConfig({
        HERMES_API_URL: scryEnv.HERMES_API_URL,
        HERMES_API_KEY: scryEnv.HERMES_API_KEY,
      });
      const hermesReachesLocalFiles = !hermesApi || hermesApiCanAccessLocalFiles(hermesApi);

      // Everything past here is wrapped: an unhandled rejection inside a
      // stream's `start` leaves the client hanging on an open body with no
      // terminal event, and the rite would sit on "scrying" forever.
      try {
        push({ kind: "stage", stage: "picking" });
        const { reports } = await listHarnessReports();
        const candidates = requestedHarness
          ? reports.filter((report) => report.id?.toLowerCase() === requestedHarness)
          : reports;
        const harness = pickScryHarness(candidates, { hermesReachesLocalFiles });
        if (!harness) {
          push({
            kind: "error",
            code: "no_local_vision_harness",
            error: requestedHarness
              ? `${requestedHarness} cannot read a local image. Scrying needs a local harness such as Codex or Claude Code.`
              : "No local harness is ready to look at an image. Scrying needs a local runtime (Codex, Claude Code) — remote bridges cannot open a file on this machine. Install or sign in to one, then try again.",
          });
          close();
          return;
        }
        push({ kind: "stage", stage: "harness", detail: harness.label });

        // Model: an explicit request wins, then the live catalog default the
        // harness report carries, then Cave's default for that runtime — unless
        // the runtime owns its own default, in which case forwarding nothing is
        // correct.
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
          push({
            kind: "error",
            code: "image_not_staged",
            error: "Could not stage that likeness for the harness to read. Try again.",
          });
          cleanupImageTempFiles(imageFilePaths);
          close();
          return;
        }
        push({ kind: "stage", stage: "staged" });

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

          // Stages below are raised BY the harness's own frames, so each one is
          // evidence rather than an estimate. `looking` is only claimed once the
          // child has echoed the prompt that carries the image path; `speaking`
          // only once it has actually said something.
          let sawPrompt = false;
          let sawText = false;
          const raw = await runCoven(args, req.signal, (line) => {
            const frame = readScryHarnessFrame(line);
            if (!frame) return;
            if (frame.kind === "prompt" && !sawPrompt) {
              sawPrompt = true;
              push({ kind: "stage", stage: "looking", detail: harness.label });
              return;
            }
            if (frame.kind === "assistant") {
              if (!sawText) {
                sawText = true;
                push({ kind: "stage", stage: "speaking", detail: harness.label });
              }
              if (frame.text) push({ kind: "text", text: frame.text });
            }
          });

          const suggestions = parseScryReply(raw);
          push({ kind: "stage", stage: "done" });
          push({
            kind: "done",
            harness: harness.id,
            harnessLabel: harness.label,
            model: launchModel,
            suggestions,
          });
        } finally {
          cleanupImageTempFiles(imageFilePaths);
          close();
        }
      } catch (error) {
        console.warn("scry stream failed", error);
        push({
          kind: "error",
          code: "scry_failed",
          error: "The scry did not come back.",
        });
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
