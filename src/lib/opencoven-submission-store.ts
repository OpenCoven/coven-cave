import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "@/lib/server/atomic-write.ts";
import { submissionsStorePath } from "@/lib/server/opencoven-submissions-retained.ts";
import {
  coerceSubmissionManifest,
  type OpenCovenSubmissionManifest,
} from "@/lib/opencoven-submissions";

const STORE_VERSION = 1;

type StoreFile = {
  version: number;
  submissions: OpenCovenSubmissionManifest[];
};

const storePath = submissionsStorePath;

// Publishes read, merge and write the whole file. Serialized so two concurrent
// publishes can't lose one another's entry.
let writeQueue: Promise<unknown> = Promise.resolve();

export async function loadOpenCovenSubmissions(): Promise<OpenCovenSubmissionManifest[]> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    const submissions = Array.isArray(parsed.submissions) ? parsed.submissions : [];
    return submissions
      .map(coerceSubmissionManifest)
      .filter((item): item is OpenCovenSubmissionManifest => item !== null);
  } catch {
    return [];
  }
}

export function saveOpenCovenSubmission(
  manifest: OpenCovenSubmissionManifest,
): Promise<OpenCovenSubmissionManifest[]> {
  const result = writeQueue.then(() => writeSubmission(manifest));
  writeQueue = result.catch(() => undefined);
  return result;
}

async function writeSubmission(
  manifest: OpenCovenSubmissionManifest,
): Promise<OpenCovenSubmissionManifest[]> {
  const current = await loadOpenCovenSubmissions();
  const submissionId =
    manifest.type === "runtime"
      ? manifest.runtime?.id ?? manifest.name
      : manifest.harness?.id ?? manifest.name;
  const next = [
    ...current.filter((item) => {
      const id = item.type === "runtime" ? item.runtime?.id ?? item.name : item.harness?.id ?? item.name;
      return item.type !== manifest.type || id !== submissionId || item.version !== manifest.version;
    }),
    manifest,
  ];
  const file: StoreFile = { version: STORE_VERSION, submissions: next };
  await mkdir(path.dirname(storePath()), { recursive: true });
  await writeJsonAtomic(storePath(), file);
  return next;
}
