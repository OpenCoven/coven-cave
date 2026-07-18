import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, unlink } from "node:fs/promises";
import { basename, dirname } from "node:path";
import path from "node:path";
import { covenHome } from "../coven-paths.ts";

export type SpeechEngineKind = "stt" | "tts";

export type SpeechModelRegistryEntry = {
  id: string;
  name: string;
  engine: "whisper" | "piper" | "kokoro";
  kind: SpeechEngineKind;
  url: string;
  sha256: string;
  sizeBytes: number;
  license: string;
  fileName: string;
};

export type SpeechModelReadiness = SpeechModelRegistryEntry & {
  ready: boolean;
  verified: boolean;
  diskSizeBytes: number;
  path: string;
  missingReason?: "missing" | "size_mismatch" | "checksum_mismatch" | "unreadable";
};

export type SpeechEnginesReadiness = {
  ok: true;
  root: string;
  diskSizeBytes: number;
  management: {
    surface: "settings";
    downloadEndpoint: "/api/voice/engines/downloads";
    pollEndpoint: "/api/voice/engines/downloads/[jobId]";
    removeEndpoint: "/api/voice/engines/models";
  };
  stt: SpeechModelReadiness[];
  tts: SpeechModelReadiness[];
};

export type SpeechModelDownloadJob = {
  id: string;
  modelId: string;
  status: "running" | "done" | "failed";
  receivedBytes: number;
  totalBytes: number;
  startedAt: string;
  updatedAt: string;
  ready?: boolean;
  error?: string;
};

export const SPEECH_MODEL_REGISTRY: readonly SpeechModelRegistryEntry[] = [
  {
    id: "whisper-tiny-en",
    name: "Whisper tiny.en (GGML)",
    engine: "whisper",
    kind: "stt",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    sha256: "0d686a2a6a22b02da2ef3101d4c86e68461363a623c58f27f81b1b2d36b42317",
    sizeBytes: 77_704_715,
    license: "MIT (OpenAI Whisper model weights)",
    fileName: "ggml-tiny.en.bin",
  },
  {
    id: "whisper-base-en",
    name: "Whisper base.en (GGML)",
    engine: "whisper",
    kind: "stt",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    sha256: "ff7d10f8526045d48149699b43aeaa014e4b337239bc5a35251116fc179aabcf",
    sizeBytes: 147_964_211,
    license: "MIT (OpenAI Whisper model weights)",
    fileName: "ggml-base.en.bin",
  },
  {
    id: "piper-amy-medium-en-us",
    name: "Piper Amy medium en_US",
    engine: "piper",
    kind: "tts",
    url: "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx",
    sha256: "2b0a534800d3208ad2735ea1feda9d3b36947554f24816bf0e922bf8c09a9255",
    sizeBytes: 63_201_294,
    license: "CC0-1.0",
    fileName: "en_US-amy-medium.onnx",
  },
] as const;

const jobs = new Map<string, SpeechModelDownloadJob>();

export function speechModelsRoot(): string {
  return path.join(covenHome(), "voice-models");
}

export function isPathInsideRoot(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(root + path.sep);
}

export function speechModelById(modelId: string): SpeechModelRegistryEntry | null {
  return SPEECH_MODEL_REGISTRY.find((model) => model.id === modelId) ?? null;
}

export function speechModelPath(model: SpeechModelRegistryEntry, root = speechModelsRoot()): string {
  if (basename(model.fileName) !== model.fileName || dirname(model.fileName) !== ".") {
    throw new Error("invalid_registry_filename");
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, model.kind, model.engine, model.id, model.fileName);
  if (!isPathInsideRoot(resolved, resolvedRoot)) throw new Error("model path not allowed");
  return resolved;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function speechModelReadiness(
  model: SpeechModelRegistryEntry,
  root = speechModelsRoot(),
): Promise<SpeechModelReadiness> {
  const modelPath = speechModelPath(model, root);
  let diskSizeBytes = 0;
  try {
    const info = await stat(modelPath);
    diskSizeBytes = info.size;
    if (!info.isFile()) {
      return { ...model, ready: false, verified: false, diskSizeBytes, path: modelPath, missingReason: "unreadable" };
    }
    if (info.size !== model.sizeBytes) {
      return { ...model, ready: false, verified: false, diskSizeBytes, path: modelPath, missingReason: "size_mismatch" };
    }
    const digest = await sha256File(modelPath);
    const verified = digest === model.sha256;
    return {
      ...model,
      ready: verified,
      verified,
      diskSizeBytes,
      path: modelPath,
      ...(verified ? {} : { missingReason: "checksum_mismatch" as const }),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...model, ready: false, verified: false, diskSizeBytes: 0, path: modelPath, missingReason: "missing" };
    }
    return { ...model, ready: false, verified: false, diskSizeBytes, path: modelPath, missingReason: "unreadable" };
  }
}

export async function speechEnginesReadiness(root = speechModelsRoot()): Promise<SpeechEnginesReadiness> {
  const models = await Promise.all(SPEECH_MODEL_REGISTRY.map((model) => speechModelReadiness(model, root)));
  const diskSizeBytes = models.reduce((sum, model) => sum + model.diskSizeBytes, 0);
  return {
    ok: true,
    root: path.resolve(root),
    diskSizeBytes,
    management: {
      surface: "settings",
      downloadEndpoint: "/api/voice/engines/downloads",
      pollEndpoint: "/api/voice/engines/downloads/[jobId]",
      removeEndpoint: "/api/voice/engines/models",
    },
    stt: models.filter((model) => model.kind === "stt"),
    tts: models.filter((model) => model.kind === "tts"),
  };
}

function cloneJob(job: SpeechModelDownloadJob): SpeechModelDownloadJob {
  return { ...job };
}

function putJob(job: SpeechModelDownloadJob): SpeechModelDownloadJob {
  const MAX_JOBS = 200;
  job.updatedAt = new Date().toISOString();
  jobs.set(job.id, job);
  while (jobs.size > MAX_JOBS) {
    const oldest = jobs.keys().next().value as string | undefined;
    if (!oldest) break;
    jobs.delete(oldest);
  }
  return job;
}

export function listSpeechModelDownloadJobs(): SpeechModelDownloadJob[] {
  return [...jobs.values()].map(cloneJob);
}

export function getSpeechModelDownloadJob(jobId: string): SpeechModelDownloadJob | null {
  const job = jobs.get(jobId);
  return job ? cloneJob(job) : null;
}

export function findRunningSpeechModelDownload(modelId: string): SpeechModelDownloadJob | null {
  for (const job of jobs.values()) {
    if (job.modelId === modelId && job.status === "running") return cloneJob(job);
  }
  return null;
}

async function writeResponseToFile(
  res: Response,
  filePath: string,
  job: SpeechModelDownloadJob,
): Promise<string> {
  const hash = createHash("sha256");
  const handle = await open(filePath, "w", 0o600);
  try {
    if (!res.body) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (job.totalBytes > 0 && bytes.byteLength > job.totalBytes) throw new Error("size_mismatch");
      hash.update(bytes);
      await handle.writeFile(bytes);
      job.receivedBytes = bytes.byteLength;
      putJob(job);
      return hash.digest("hex");
    }
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      const { bytesWritten } = await handle.write(value);
      if (bytesWritten !== value.byteLength) throw new Error("partial_write");
      job.receivedBytes += bytesWritten;
      if (job.totalBytes > 0 && job.receivedBytes > job.totalBytes) {
        await reader.cancel();
        throw new Error("size_mismatch");
      }
      putJob(job);
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

export async function runSpeechModelDownload(
  model: SpeechModelRegistryEntry,
  job: SpeechModelDownloadJob,
  fetchImpl: typeof fetch = fetch,
  root = speechModelsRoot(),
): Promise<void> {
  const dest = speechModelPath(model, root);
  const dir = path.dirname(dest);
  const temp = path.join(dir, `.${model.fileName}.${job.id}.download`);
  try {
    await mkdir(dir, { recursive: true });
    await unlink(temp).catch(() => undefined);
    const res = await fetchImpl(model.url, { signal: AbortSignal.timeout(30 * 60_000) });
    if (!res.ok) throw new Error(`download_http_${res.status}`);
    const headerSize = Number(res.headers.get("content-length"));
    if (Number.isFinite(headerSize) && headerSize > 0) {
      if (headerSize !== model.sizeBytes) throw new Error("size_mismatch");
      job.totalBytes = headerSize;
      putJob(job);
    }
    const digest = await writeResponseToFile(res, temp, job);
    const info = await stat(temp);
    if (info.size !== model.sizeBytes) throw new Error("size_mismatch");
    if (digest !== model.sha256) throw new Error("checksum_mismatch");
    await rename(temp, dest);
    putJob({ ...job, status: "done", receivedBytes: info.size, totalBytes: model.sizeBytes, ready: true });
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    putJob({
      ...job,
      status: "failed",
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function startSpeechModelDownload(
  modelId: string,
  fetchImpl: typeof fetch = fetch,
  root = speechModelsRoot(),
): Promise<{ job: SpeechModelDownloadJob; started: boolean; alreadyReady?: boolean } | { error: "unknown_model" }> {
  const model = speechModelById(modelId);
  if (!model) return { error: "unknown_model" };
  const ready = await speechModelReadiness(model, root);
  if (ready.ready) {
    const now = new Date().toISOString();
    const job = putJob({
      id: `ready-${model.id}`,
      modelId: model.id,
      status: "done",
      receivedBytes: ready.diskSizeBytes,
      totalBytes: model.sizeBytes,
      startedAt: now,
      updatedAt: now,
      ready: true,
    });
    return { job: cloneJob(job), started: false, alreadyReady: true };
  }
  const running = findRunningSpeechModelDownload(model.id);
  if (running) return { job: running, started: false };
  const now = new Date().toISOString();
  const job = putJob({
    id: `${model.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    modelId: model.id,
    status: "running",
    receivedBytes: 0,
    totalBytes: model.sizeBytes,
    startedAt: now,
    updatedAt: now,
  });
  void runSpeechModelDownload(model, job, fetchImpl, root);
  return { job: cloneJob(job), started: true };
}

export async function removeSpeechModel(modelId: string, root = speechModelsRoot()): Promise<"removed" | "missing" | "unknown_model"> {
  const model = speechModelById(modelId);
  if (!model) return "unknown_model";
  const modelPath = speechModelPath(model, root);
  const modelDir = path.dirname(modelPath);
  try {
    await rm(modelDir, { recursive: true, force: false });
    return "removed";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}
