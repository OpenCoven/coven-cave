import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import path from "node:path";
import { covenHome } from "../coven-paths.ts";

export type SpeechEngineKind = "stt" | "tts";

export type SpeechModelCompanionAsset = {
  url: string;
  sha256: string;
  sizeBytes: number;
  fileName: string;
};

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
  /** Additional verified artifacts required beside the weights (Piper's
   *  voice config; Kokoro's speaker embeddings and token table). Order is
   *  part of the contract — consumers address companions by fileName. */
  companions?: readonly SpeechModelCompanionAsset[];
  /** Kokoro packs many speakers into one voices file; this selects the
   *  reviewed default speaker for the entry's voiceName. */
  kokoroSpeakerId?: number;
};

export type SpeechModelReadiness = SpeechModelRegistryEntry & {
  ready: boolean;
  verified: boolean;
  diskSizeBytes: number;
  path: string;
  /** Absolute paths for each registry companion, in registry order. */
  companionPaths?: string[];
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
  status: "running" | "done" | "failed" | "cancelled";
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
    url: "https://huggingface.co/rhasspy/piper-voices/resolve/0d907f158acc877ddeebcbf827659ee13bea8bcd/en/en_US/amy/medium/en_US-amy-medium.onnx",
    sha256: "b3a6e47b57b8c7fbe6a0ce2518161a50f59a9cdd8a50835c02cb02bdd6206c18",
    sizeBytes: 63_201_294,
    license: "CC0-1.0",
    fileName: "en_US-amy-medium.onnx",
    // Piper requires the voice config beside the ONNX weights. Treat both as
    // one verified model so /api/voice/engines never advertises an unusable
    // voice as ready.
    companions: [{
      url: "https://huggingface.co/rhasspy/piper-voices/resolve/0d907f158acc877ddeebcbf827659ee13bea8bcd/en/en_US/amy/medium/en_US-amy-medium.onnx.json",
      sha256: "95a23eb4d42909d38df73bb9ac7f45f597dbfcde2d1bf9526fdeaf5466977d77",
      sizeBytes: 4_882,
      fileName: "en_US-amy-medium.onnx.json",
    }],
  },
  // Signature voice roster (cave-vony): only license-vetted voices ship here.
  // Rejected during vetting: ryan/hfc_male/hfc_female (CC BY-NC-SA datasets),
  // lessac (custom Blizzard license).
  {
    id: "piper-alba-medium-en-gb",
    name: "Piper Alba medium en_GB",
    engine: "piper",
    kind: "tts",
    url: "https://huggingface.co/rhasspy/piper-voices/resolve/0d907f158acc877ddeebcbf827659ee13bea8bcd/en/en_GB/alba/medium/en_GB-alba-medium.onnx",
    sha256: "401369c4a81d09fdd86c32c5c864440811dbdcc66466cde2d64f7133a66ad03b",
    sizeBytes: 63_201_294,
    license: "CC-BY-4.0",
    fileName: "en_GB-alba-medium.onnx",
    companions: [{
      url: "https://huggingface.co/rhasspy/piper-voices/resolve/0d907f158acc877ddeebcbf827659ee13bea8bcd/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json",
      sha256: "aa965a2f02ecced632c2694e1fc72bbff6d65f265fab567ca945918c73dd89f4",
      sizeBytes: 4_888,
      fileName: "en_GB-alba-medium.onnx.json",
    }],
  },
  {
    id: "piper-joe-medium-en-us",
    name: "Piper Joe medium en_US",
    engine: "piper",
    kind: "tts",
    url: "https://huggingface.co/rhasspy/piper-voices/resolve/0d907f158acc877ddeebcbf827659ee13bea8bcd/en/en_US/joe/medium/en_US-joe-medium.onnx",
    sha256: "58afce0321b8d9c46d7cdf9c16500cc55a793b4220212dba6b70fb788b3baf06",
    sizeBytes: 63_201_294,
    license: "CC0-1.0",
    fileName: "en_US-joe-medium.onnx",
    companions: [{
      url: "https://huggingface.co/rhasspy/piper-voices/resolve/0d907f158acc877ddeebcbf827659ee13bea8bcd/en/en_US/joe/medium/en_US-joe-medium.onnx.json",
      sha256: "3d6d5410b3795cb1950595247ef8f06190719e6fdbfa3a2356d8ec368e1aad33",
      sizeBytes: 4_794,
      fileName: "en_US-joe-medium.onnx.json",
    }],
  },
  {
    id: "piper-kristin-medium-en-us",
    name: "Piper Kristin medium en_US",
    engine: "piper",
    kind: "tts",
    url: "https://huggingface.co/rhasspy/piper-voices/resolve/0d907f158acc877ddeebcbf827659ee13bea8bcd/en/en_US/kristin/medium/en_US-kristin-medium.onnx",
    sha256: "5849957f929cbf720c258f8458692d6103fff2f0e3d3b19c8259474bb06a18d4",
    sizeBytes: 63_531_379,
    license: "Public domain (LibriVox dataset)",
    fileName: "en_US-kristin-medium.onnx",
    companions: [{
      url: "https://huggingface.co/rhasspy/piper-voices/resolve/0d907f158acc877ddeebcbf827659ee13bea8bcd/en/en_US/kristin/medium/en_US-kristin-medium.onnx.json",
      sha256: "5681426d4aead22195de70531eeeeddb46493cfaffc5764b2ea3db73428b651c",
      sizeBytes: 4_968,
      fileName: "en_US-kristin-medium.onnx.json",
    }],
  },
  // Kokoro (cave-tr09i): one reviewed model bundle serves many speakers via
  // the voices file. The runner additionally needs espeak-ng-data, which
  // ships with the sherpa-onnx runtime beside its executable (like Piper's),
  // not through this flat-file downloader.
  {
    id: "kokoro-en-v0-19",
    name: "Kokoro English v0.19",
    engine: "kokoro",
    kind: "tts",
    url: "https://huggingface.co/csukuangfj/kokoro-en-v0_19/resolve/92805c485745946a0d945562d3aba19e7cbb2104/model.onnx",
    sha256: "10ff414106a038ce7e9e0126c6461e4dc8a86efaa89dc91d2009d69fe635e339",
    sizeBytes: 345_555_491,
    license: "Apache-2.0",
    fileName: "model.onnx",
    // Speaker 0 ("af", the reviewed default blend) keeps this entry a single
    // selectable voiceName; the roster of named speakers is follow-up work.
    kokoroSpeakerId: 0,
    companions: [
      {
        url: "https://huggingface.co/csukuangfj/kokoro-en-v0_19/resolve/92805c485745946a0d945562d3aba19e7cbb2104/voices.bin",
        sha256: "a372c67b056ef0b695c375d39b99630d23fb07ad4c8d87aa32a19a62fca523ad",
        sizeBytes: 5_755_904,
        fileName: "voices.bin",
      },
      {
        url: "https://huggingface.co/csukuangfj/kokoro-en-v0_19/resolve/92805c485745946a0d945562d3aba19e7cbb2104/tokens.txt",
        sha256: "4f31c71282d14af4e926cd12462078fe9d20d00c589e63fe2750a8f56d6d7f7b",
        sizeBytes: 1_078,
        fileName: "tokens.txt",
      },
    ],
  },
] as const;

const jobs = new Map<string, SpeechModelDownloadJob>();
const cancelledDownloadJobs = new Set<string>();
const downloadAbortControllers = new Map<string, AbortController>();
// A removal can race the asynchronous readiness probe that precedes job
// registration. Incrementing this generation lets the starter observe that
// removal and avoid creating an untracked download which could republish.
const modelRemovalGenerations = new Map<string, number>();
// Removal is also a publication barrier. A replacement must not start until
// every cancelled writer has released its staging directory and can no longer
// delete a just-published replacement during cancellation cleanup.
const downloadTasks = new Map<string, Promise<void>>();
const modelRemovals = new Map<string, Promise<"removed" | "missing">>();
// A model directory must not be removed between its final integrity check and
// Piper opening the ONNX/config pair. Keep the lease for the entire runner so
// removal cannot turn a verified ready voice into a mid-request failure.
const modelUseTasks = new Map<string, Set<Promise<void>>>();

function modelRemovalGeneration(modelId: string): number {
  return modelRemovalGenerations.get(modelId) ?? 0;
}

/**
 * Run work that consumes a registered model while preventing removal from
 * unlinking it. A use that arrives during removal waits for that removal, then
 * lets its caller re-check readiness instead of touching a stale directory.
 */
export async function withSpeechModelUse<T>(
  modelId: string,
  work: () => Promise<T>,
): Promise<T> {
  const removal = modelRemovals.get(modelId);
  if (removal) {
    await removal;
    return withSpeechModelUse(modelId, work);
  }

  let release!: () => void;
  const use = new Promise<void>((resolve) => { release = resolve; });
  const uses = modelUseTasks.get(modelId) ?? new Set<Promise<void>>();
  uses.add(use);
  modelUseTasks.set(modelId, uses);

  // `removeSpeechModel` can only start synchronously between the first check
  // and adding this lease. If it did, release and retry after it has removed
  // the old directory so the caller performs a fresh integrity check.
  const startedRemoval = modelRemovals.get(modelId);
  if (startedRemoval) {
    uses.delete(use);
    if (uses.size === 0) modelUseTasks.delete(modelId);
    release();
    await startedRemoval;
    return withSpeechModelUse(modelId, work);
  }

  try {
    return await work();
  } finally {
    uses.delete(use);
    if (uses.size === 0) modelUseTasks.delete(modelId);
    release();
  }
}

export function speechModelsRoot(): string {
  return path.join(/* turbopackIgnore: true */ covenHome(), "voice-models");
}

export function isPathInsideRoot(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(root + path.sep);
}

export function speechModelById(modelId: string): SpeechModelRegistryEntry | null {
  return SPEECH_MODEL_REGISTRY.find((model) => model.id === modelId) ?? null;
}

/**
 * Named Kokoro v0.19 speakers (cave-xopgb). The speaker-id order is fixed by
 * sherpa-onnx's voices.bin generation script
 * (scripts/kokoro/v0.19/generate_voices_bin.py in k2-fsa/sherpa-onnx):
 * concatenation order IS the sid. Speaker 0 ("af", the reviewed Bella+Sarah
 * default blend) is the base registry entry's own voice, so it is not listed
 * here. Name prefixes upstream: a=American, b=British; f/m=female/male. All
 * speakers ship inside the one downloaded voices.bin — a derived voice never
 * triggers its own download.
 */
export const KOKORO_NAMED_SPEAKERS = [
  { suffix: "bella", label: "Bella (US female)", speakerId: 1 },
  { suffix: "nicole", label: "Nicole (US female)", speakerId: 2 },
  { suffix: "sarah", label: "Sarah (US female)", speakerId: 3 },
  { suffix: "sky", label: "Sky (US female)", speakerId: 4 },
  { suffix: "adam", label: "Adam (US male)", speakerId: 5 },
  { suffix: "michael", label: "Michael (US male)", speakerId: 6 },
  { suffix: "emma", label: "Emma (UK female)", speakerId: 7 },
  { suffix: "isabella", label: "Isabella (UK female)", speakerId: 8 },
  { suffix: "george", label: "George (UK male)", speakerId: 9 },
  { suffix: "lewis", label: "Lewis (UK male)", speakerId: 10 },
] as const;

export type ResolvedLocalTtsVoice = {
  model: SpeechModelRegistryEntry;
  /** null for non-Kokoro engines; the sherpa-onnx --sid otherwise. */
  kokoroSpeakerId: number | null;
  displayName: string;
};

/**
 * Resolve a selectable voiceName to its registry model: either a model id
 * directly, or a derived Kokoro speaker id (`<base-id>-<speaker>`) that
 * shares the base entry's downloaded bundle with a different --sid.
 */
export function resolveLocalTtsVoice(voiceName: string): ResolvedLocalTtsVoice | null {
  const direct = speechModelById(voiceName);
  if (direct) {
    return {
      model: direct,
      kokoroSpeakerId: direct.engine === "kokoro" ? direct.kokoroSpeakerId ?? 0 : null,
      displayName: direct.name,
    };
  }
  for (const base of SPEECH_MODEL_REGISTRY) {
    if (base.engine !== "kokoro" || base.kind !== "tts") continue;
    if (!voiceName.startsWith(`${base.id}-`)) continue;
    const suffix = voiceName.slice(base.id.length + 1);
    const speaker = KOKORO_NAMED_SPEAKERS.find((named) => named.suffix === suffix);
    if (!speaker) return null;
    return {
      model: base,
      kokoroSpeakerId: speaker.speakerId,
      displayName: `Kokoro ${speaker.label}`,
    };
  }
  return null;
}

export type SelectableLocalTtsVoice = {
  id: string;
  name: string;
  engine: "piper" | "kokoro";
  ready: boolean;
  verified: boolean;
};

/**
 * The selection catalog: every voiceName a familiar can pick. Derived Kokoro
 * speakers inherit the base entry's readiness — they are selectable exactly
 * when the one shared bundle is downloaded and verified. Management surfaces
 * keep using the plain model list; this catalog is for pickers.
 */
export function selectableLocalTtsVoices(
  tts: readonly SpeechModelReadiness[],
): SelectableLocalTtsVoice[] {
  const voices: SelectableLocalTtsVoice[] = [];
  for (const model of tts) {
    if (model.engine === "whisper") continue;
    voices.push({
      id: model.id,
      name: model.name,
      engine: model.engine,
      ready: model.ready,
      verified: model.verified,
    });
    if (model.engine === "kokoro" && model.kokoroSpeakerId !== undefined) {
      for (const speaker of KOKORO_NAMED_SPEAKERS) {
        voices.push({
          id: `${model.id}-${speaker.suffix}`,
          name: `Kokoro ${speaker.label}`,
          engine: model.engine,
          ready: model.ready,
          verified: model.verified,
        });
      }
    }
  }
  return voices;
}

export function speechModelPath(model: SpeechModelRegistryEntry, root = speechModelsRoot()): string {
  return speechModelAssetPath(model, model.fileName, root);
}

export function speechModelCompanionPaths(
  model: SpeechModelRegistryEntry,
  root = speechModelsRoot(),
): string[] {
  return (model.companions ?? []).map((companion) =>
    speechModelAssetPath(model, companion.fileName, root),
  );
}

function speechModelAssetPath(
  model: SpeechModelRegistryEntry,
  fileName: string,
  root: string,
): string {
  if (basename(fileName) !== fileName || dirname(fileName) !== ".") {
    throw new Error("invalid_registry_filename");
  }
  const resolvedRoot = path.resolve(/* turbopackIgnore: true */ root);
  const resolved = path.resolve(
    /* turbopackIgnore: true */ resolvedRoot,
    model.kind,
    model.engine,
    model.id,
    fileName,
  );
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
  const companionPaths = speechModelCompanionPaths(model, root);
  const assets = [
    { path: modelPath, sizeBytes: model.sizeBytes, sha256: model.sha256 },
    ...(model.companions ?? []).map((companion, index) => ({
      path: companionPaths[index],
      sizeBytes: companion.sizeBytes,
      sha256: companion.sha256,
    })),
  ];
  let diskSizeBytes = 0;
  for (const asset of assets) {
    try {
      const info = await stat(/* turbopackIgnore: true */ asset.path);
      diskSizeBytes += info.size;
      if (!info.isFile()) {
        return {
          ...model,
          ready: false,
          verified: false,
          diskSizeBytes,
          path: modelPath,
          ...(companionPaths.length ? { companionPaths } : {}),
          missingReason: "unreadable",
        };
      }
      if (info.size !== asset.sizeBytes) {
        return {
          ...model,
          ready: false,
          verified: false,
          diskSizeBytes,
          path: modelPath,
          ...(companionPaths.length ? { companionPaths } : {}),
          missingReason: "size_mismatch",
        };
      }
      if (await sha256File(asset.path) !== asset.sha256) {
        return {
          ...model,
          ready: false,
          verified: false,
          diskSizeBytes,
          path: modelPath,
          ...(companionPaths.length ? { companionPaths } : {}),
          missingReason: "checksum_mismatch",
        };
      }
    } catch (error) {
      return {
        ...model,
        ready: false,
        verified: false,
        diskSizeBytes,
        path: modelPath,
        ...(companionPaths.length ? { companionPaths } : {}),
        missingReason:
          (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable",
      };
    }
  }
  return {
    ...model,
    ready: true,
    verified: true,
    diskSizeBytes,
    path: modelPath,
    ...(companionPaths.length ? { companionPaths } : {}),
  };
}

export async function speechEnginesReadiness(root = speechModelsRoot()): Promise<SpeechEnginesReadiness> {
  const models = await Promise.all(SPEECH_MODEL_REGISTRY.map((model) => speechModelReadiness(model, root)));
  const diskSizeBytes = models.reduce((sum, model) => sum + model.diskSizeBytes, 0);
  return {
    ok: true,
    root: path.resolve(/* turbopackIgnore: true */ root),
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

function cancelSpeechModelDownloads(modelId: string): boolean {
  let cancelled = false;
  for (const job of jobs.values()) {
    if (job.modelId !== modelId || (job.status !== "running" && job.ready !== true)) continue;
    cancelledDownloadJobs.add(job.id);
    downloadAbortControllers.get(job.id)?.abort();
    putJob({ ...job, status: "cancelled", ready: false });
    cancelled = true;
  }
  return cancelled;
}

async function writeResponseToFile(
  res: Response,
  filePath: string,
  job: SpeechModelDownloadJob,
  signal?: AbortSignal,
): Promise<string> {
  const hash = createHash("sha256");
  const handle = await open(/* turbopackIgnore: true */ filePath, "w", 0o600);
  let cancelReader: (() => void) | undefined;
  try {
    if (!res.body) {
      if (cancelledDownloadJobs.has(job.id) || signal?.aborted) {
        throw new Error("download_cancelled");
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (job.totalBytes > 0 && bytes.byteLength > job.totalBytes) throw new Error("size_mismatch");
      hash.update(bytes);
      await handle.writeFile(bytes);
      job.receivedBytes += bytes.byteLength;
      putJob(job);
      return hash.digest("hex");
    }
    const reader = res.body.getReader();
    // Fetch implementations normally propagate AbortSignal to an in-flight
    // body read, but cancel the reader as well. This makes model removal
    // release a stalled streamed response even when the transport has already
    // produced headers and its reader does not observe the request signal.
    cancelReader = () => { void reader.cancel().catch(() => undefined); };
    if (signal?.aborted) cancelReader();
    else signal?.addEventListener("abort", cancelReader, { once: true });
    for (;;) {
      if (cancelledDownloadJobs.has(job.id) || signal?.aborted) {
        await reader.cancel();
        throw new Error("download_cancelled");
      }
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
    if (cancelReader) signal?.removeEventListener("abort", cancelReader);
    await handle.close();
  }
}

export async function publishVerifiedModelDirectory(
  stagingDir: string,
  modelDir: string,
  job: SpeechModelDownloadJob,
  dependencies: { renameImpl?: typeof rename } = {},
): Promise<void> {
  const renameImpl = dependencies.renameImpl ?? rename;
  const backupDir = path.join(
    /* turbopackIgnore: true */ path.dirname(modelDir),
    `.${path.basename(modelDir)}.${job.id}.previous`,
  );
  let movedPrevious = false;
  let published = false;
  await rm(/* turbopackIgnore: true */ backupDir, { recursive: true, force: true });
  try {
    try {
      await stat(/* turbopackIgnore: true */ modelDir);
      await renameImpl(/* turbopackIgnore: true */ modelDir, backupDir);
      movedPrevious = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (cancelledDownloadJobs.has(job.id)) throw new Error("download_cancelled");
    await renameImpl(/* turbopackIgnore: true */ stagingDir, modelDir);
    published = true;
    if (cancelledDownloadJobs.has(job.id)) throw new Error("download_cancelled");
    await rm(/* turbopackIgnore: true */ backupDir, { recursive: true, force: true });
  } catch (error) {
    if (cancelledDownloadJobs.has(job.id)) {
      if (published) {
        await rm(/* turbopackIgnore: true */ modelDir, { recursive: true, force: true });
      }
      await rm(/* turbopackIgnore: true */ backupDir, { recursive: true, force: true });
    } else if (movedPrevious) {
      await rm(/* turbopackIgnore: true */ modelDir, { recursive: true, force: true });
      await renameImpl(/* turbopackIgnore: true */ backupDir, modelDir);
    }
    throw error;
  }
}

export async function runSpeechModelDownload(
  model: SpeechModelRegistryEntry,
  job: SpeechModelDownloadJob,
  fetchImpl: typeof fetch = fetch,
  root = speechModelsRoot(),
  dependencies: { onPublished?: () => void | Promise<void> } = {},
): Promise<void> {
  putJob(job);
  const abortController = new AbortController();
  downloadAbortControllers.set(job.id, abortController);
  const dest = speechModelPath(model, root);
  const dir = path.dirname(dest);
  const stagingDir = path.join(
    /* turbopackIgnore: true */ path.dirname(dir),
    `.${model.id}.${job.id}.download`,
  );
  const totalBytes = model.sizeBytes + (model.companions ?? []).reduce((sum, companion) => sum + companion.sizeBytes, 0);
  const assets = [
    {
      url: model.url,
      sha256: model.sha256,
      sizeBytes: model.sizeBytes,
      fileName: model.fileName,
    },
    ...(model.companions ?? []),
  ];
  try {
    if (cancelledDownloadJobs.has(job.id)) throw new Error("download_cancelled");
    await mkdir(/* turbopackIgnore: true */ path.dirname(dir), { recursive: true });
    await rm(/* turbopackIgnore: true */ stagingDir, { recursive: true, force: true });
    await mkdir(/* turbopackIgnore: true */ stagingDir, { recursive: true });
    job.totalBytes = totalBytes;
    putJob(job);
    for (const asset of assets) {
      if (cancelledDownloadJobs.has(job.id)) throw new Error("download_cancelled");
      const temp = path.join(/* turbopackIgnore: true */ stagingDir, asset.fileName);
      const timeout = setTimeout(() => abortController.abort(), 30 * 60_000);
      try {
        const res = await fetchImpl(asset.url, { signal: abortController.signal });
        if (!res.ok) throw new Error(`download_http_${res.status}`);
        const headerSize = Number(res.headers.get("content-length"));
        if (
          Number.isFinite(headerSize) &&
          headerSize > 0 &&
          headerSize !== asset.sizeBytes
        ) {
          throw new Error("size_mismatch");
        }
        const digest = await writeResponseToFile(
          res,
          temp,
          job,
          abortController.signal,
        );
        const info = await stat(/* turbopackIgnore: true */ temp);
        if (info.size !== asset.sizeBytes) throw new Error("size_mismatch");
        if (digest !== asset.sha256) throw new Error("checksum_mismatch");
      } finally {
        clearTimeout(timeout);
      }
    }
    // Publish the complete directory only after every required asset verifies.
    // The ONNX weights are never visible without the Piper config beside them.
    if (cancelledDownloadJobs.has(job.id)) throw new Error("download_cancelled");
    await publishVerifiedModelDirectory(stagingDir, dir, job);
    await dependencies.onPublished?.();
    // There is no await between this final cancellation check and putJob, so a
    // concurrent removal cannot overwrite its cancelled state with ready:true.
    if (cancelledDownloadJobs.has(job.id)) throw new Error("download_cancelled");
    putJob({
      ...job,
      status: "done",
      receivedBytes: totalBytes,
      totalBytes,
      ready: true,
    });
  } catch (error) {
    await rm(/* turbopackIgnore: true */ stagingDir, { recursive: true, force: true });
    putJob({
      ...job,
      status: cancelledDownloadJobs.has(job.id) ? "cancelled" : "failed",
      ready: false,
      ...(cancelledDownloadJobs.has(job.id)
        ? {}
        : { error: error instanceof Error ? error.message : String(error) }),
    });
  } finally {
    cancelledDownloadJobs.delete(job.id);
    downloadAbortControllers.delete(job.id);
  }
}

export async function startSpeechModelDownload(
  modelId: string,
  fetchImpl: typeof fetch = fetch,
  root = speechModelsRoot(),
): Promise<{ job: SpeechModelDownloadJob; started: boolean; alreadyReady?: boolean; cancelled?: boolean } | { error: "unknown_model" }> {
  const model = speechModelById(modelId);
  if (!model) return { error: "unknown_model" };
  const removal = modelRemovals.get(model.id);
  if (removal) {
    await removal;
    return startSpeechModelDownload(modelId, fetchImpl, root);
  }
  const removalGeneration = modelRemovalGeneration(model.id);
  const ready = await speechModelReadiness(model, root);
  if (
    modelRemovalGeneration(model.id) !== removalGeneration ||
    modelRemovals.has(model.id)
  ) {
    const now = new Date().toISOString();
    const job = putJob({
      id: `cancelled-${model.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      modelId: model.id,
      status: "cancelled",
      receivedBytes: 0,
      totalBytes: model.sizeBytes + (model.companions ?? []).reduce((sum, companion) => sum + companion.sizeBytes, 0),
      startedAt: now,
      updatedAt: now,
      ready: false,
    });
    return { job: cloneJob(job), started: false, cancelled: true };
  }
  if (ready.ready) {
    const now = new Date().toISOString();
    const job = putJob({
      id: `ready-${model.id}`,
      modelId: model.id,
      status: "done",
      receivedBytes: ready.diskSizeBytes,
      totalBytes: model.sizeBytes + (model.companions ?? []).reduce((sum, companion) => sum + companion.sizeBytes, 0),
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
    totalBytes: model.sizeBytes + (model.companions ?? []).reduce((sum, companion) => sum + companion.sizeBytes, 0),
    startedAt: now,
    updatedAt: now,
  });
  const task = runSpeechModelDownload(model, job, fetchImpl, root);
  downloadTasks.set(job.id, task);
  void task.then(
    () => { downloadTasks.delete(job.id); },
    () => { downloadTasks.delete(job.id); },
  );
  return { job: cloneJob(job), started: true };
}

export async function removeSpeechModel(modelId: string, root = speechModelsRoot()): Promise<"removed" | "missing" | "unknown_model"> {
  const model = speechModelById(modelId);
  if (!model) return "unknown_model";
  const existing = modelRemovals.get(model.id);
  if (existing) return existing;
  modelRemovalGenerations.set(model.id, modelRemovalGeneration(model.id) + 1);
  let task: Promise<"removed" | "missing">;
  task = (async () => {
    const cancelled = cancelSpeechModelDownloads(model.id);
    const activeTasks = [...downloadTasks.entries()]
      .filter(([jobId]) => jobs.get(jobId)?.modelId === model.id)
      .map(([, running]) => running);
    const activeUses = [...(modelUseTasks.get(model.id) ?? [])];
    await Promise.allSettled([...activeTasks, ...activeUses]);
    const modelPath = speechModelPath(model, root);
    const modelDir = path.dirname(modelPath);
    try {
      await rm(/* turbopackIgnore: true */ modelDir, { recursive: true, force: false });
      return "removed";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return cancelled ? "removed" : "missing";
      }
      throw error;
    }
  })();
  modelRemovals.set(model.id, task);
  try {
    return await task;
  } finally {
    if (modelRemovals.get(model.id) === task) modelRemovals.delete(model.id);
  }
}
