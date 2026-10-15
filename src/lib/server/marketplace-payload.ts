import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "../coven-paths.ts";

export type MarketplacePayloadPin = { version: string; sha256: string; bytes: number; asset: string; directories?: string[] };
export type MarketplacePayloadIndex = {
  schemaVersion: 1;
  baseUrl: string;
  plugins: Record<string, MarketplacePayloadPin>;
};
type PayloadFile = { path: string; content: string; executable: boolean };
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SHA = /^[a-f0-9]{64}$/;

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parsePayload(bytes: Buffer, id: string, pin: MarketplacePayloadPin): PayloadFile[] {
  if (bytes.length !== pin.bytes || digest(bytes) !== pin.sha256) throw new Error("Marketplace payload integrity check failed: " + id);
  const payload = JSON.parse(bytes.toString("utf8"));
  if (payload.schemaVersion !== 1 || payload.name !== id || payload.version !== pin.version || !Array.isArray(payload.files) || payload.files.length > 10_000) {
    throw new Error("Invalid marketplace payload: " + id);
  }
  const names = new Set<string>();
  for (const file of payload.files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string" || typeof file.executable !== "boolean") throw new Error("Invalid payload file");
    const parts = file.path.split("/");
    if (parts.some((part: string) => !part || part === "." || part === ".." || /[\\:\x00-\x1f<>"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw new Error("Unsafe payload path");
    const normalized = file.path.toLowerCase();
    if (names.has(normalized)) throw new Error("Duplicate payload path");
    names.add(normalized);
    if (Buffer.from(file.content, "base64").toString("base64") !== file.content) throw new Error("Invalid payload encoding");
  }
  return payload.files;
}

async function download(url: string, expectedBytes: number, fetcher: typeof fetch): Promise<Buffer> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error("Marketplace payload download failed (" + response.status + ")");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > expectedBytes) throw new Error("Marketplace payload exceeds its pinned size");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

/** One download per requested plugin, with immutable pins and an offline cache. */
export function createMarketplacePayloadStore(options: {
  index: MarketplacePayloadIndex;
  cacheRoot: string;
  fetcher?: typeof fetch;
}) {
  const pending = new Map<string, Promise<string>>();
  async function materialize(id: string): Promise<string> {
    const pin = Object.hasOwn(options.index.plugins, id) ? options.index.plugins[id] : undefined;
    if (options.index.schemaVersion !== 1 || !ID.test(id) || !pin || !SHA.test(pin.sha256) || !Number.isSafeInteger(pin.bytes) || pin.bytes <= 0 || pin.bytes > MAX_PAYLOAD_BYTES || pin.asset !== id + "-" + pin.sha256 + ".json") throw new Error("Unknown or invalid marketplace payload: " + id);
    const base = new URL(options.index.baseUrl);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Invalid marketplace payload origin");
    const root = path.join(/* turbopackIgnore: true */ options.cacheRoot, pin.sha256);
    const archive = path.join(/* turbopackIgnore: true */ root, "payload.json");
    const destination = path.join(/* turbopackIgnore: true */ root, id);
    await mkdir(root, { recursive: true, mode: 0o700 });
    if ((await lstat(root)).isSymbolicLink()) throw new Error("Invalid payload cache root");
    let bytes: Buffer;
    try {
      bytes = await readFile(/* turbopackIgnore: true */ archive);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      bytes = await download(new URL(pin.asset, base.href.replace(/\/?$/, "/")).href, pin.bytes, options.fetcher ?? fetch);
    }
    const files = parsePayload(bytes, id, pin);
    // A partial or modified cache must never be accepted as a complete plugin.
    let present = false;
    try {
      const info = await lstat(destination);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid payload cache directory");
      present = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (present) {
      const expected = new Map(files.map(file => [file.path, file]));
      async function verify(directory: string, prefix = ""): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const relative = prefix + entry.name;
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) await verify(target, relative + "/");
          else {
            const file = expected.get(relative);
            if (!entry.isFile() || !file || !(await readFile(target)).equals(Buffer.from(file.content, "base64"))) throw new Error("Marketplace payload cache is modified: " + id);
            expected.delete(relative);
          }
        }
      }
      await verify(destination);
      if (expected.size) throw new Error("Marketplace payload cache is incomplete: " + id);
      return destination;
    }
    const temporary = await mkdtemp(path.join(root, ".install-"));
    try {
      for (const file of files) {
        const target = path.join(temporary, file.path);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, Buffer.from(file.content, "base64"), { mode: file.executable ? 0o700 : 0o600, flag: "wx" });
      }
      const archiveTemporary = path.join(root, path.basename(temporary) + ".json");
      try { await writeFile(archiveTemporary, bytes, { flag: "wx", mode: 0o600 }); await rename(archiveTemporary, archive); }
      finally { await rm(archiveTemporary, { force: true }); }
      try { await rename(temporary, destination); }
      catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        return materialize(id);
      }
      return destination;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  return {
    ensure(id: string): Promise<string> {
      const current = pending.get(id);
      if (current) return current;
      const operation = materialize(id).catch(error => { pending.delete(id); throw error; });
      pending.set(id, operation);
      return operation;
    },
  };
}

let indexPromise: Promise<MarketplacePayloadIndex> | undefined;
function payloadIndex(): Promise<MarketplacePayloadIndex> {
  indexPromise ??= readFile(path.join(process.cwd(), "marketplace", "payloads.json"), "utf8")
    .then(text => JSON.parse(text) as MarketplacePayloadIndex)
    .catch(error => { indexPromise = undefined; throw error; });
  return indexPromise;
}

export async function marketplacePluginHasDirectory(id: string, directory: "prompts" | "skill-templates"): Promise<boolean> {
  if (!ID.test(id)) return false;
  if (process.env.COVEN_MARKETPLACE_PLUGINS_DIR) {
    try { return (await lstat(path.join(process.env.COVEN_MARKETPLACE_PLUGINS_DIR, id, directory))).isDirectory(); }
    catch { return false; }
  }
  const index = await payloadIndex();
  return Object.hasOwn(index.plugins, id) && index.plugins[id].directories?.includes(directory) === true;
}

let store: Promise<ReturnType<typeof createMarketplacePayloadStore>> | undefined;
export async function ensureMarketplacePlugin(id: string): Promise<string> {
  if (!ID.test(id)) throw new Error("Invalid plugin id");
  const localRoot = process.env.COVEN_MARKETPLACE_PLUGINS_DIR;
  if (localRoot) return path.join(/* turbopackIgnore: true */ localRoot, id);
  // Recall is core runtime context and must work on the first offline launch.
  if (id === "coven-memory") return path.join(process.cwd(), "marketplace", "plugins", id);
  store ??= payloadIndex()
    .then(index => createMarketplacePayloadStore({
      index,
      cacheRoot: path.join(/* turbopackIgnore: true */ caveHome(), "marketplace", "payloads"),
    })).catch(error => { store = undefined; throw error; });
  return (await store).ensure(id);
}
