import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";
import { writeJsonAtomic } from "@/lib/server/atomic-write.ts";
import {
  coerceSubmissionManifest,
  type OpenCovenSubmissionManifest,
} from "@/lib/opencoven-submissions";

const STORE_VERSION = 1;

type StoreFile = {
  version: number;
  submissions: OpenCovenSubmissionManifest[];
};

function storePath(): string {
  return path.join(covenHome(), "opencoven-submissions.json");
}

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

export async function saveOpenCovenSubmission(
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
