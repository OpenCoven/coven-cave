import { lstat } from "node:fs/promises";

type Stamp = { mtimeMs: number; ctimeMs: number; size: number };

/** Best-effort poll metadata: one unreadable/racing path must not hide other changes. */
export async function stampChangedFiles(
  files: { path: string; changeVersion?: string }[],
  resolvePath: (path: string) => string | null | Promise<string | null>,
  readStat: (path: string) => Promise<Stamp> = lstat,
): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
    while (next < files.length) {
      const file = files[next++];
      try {
        const absolutePath = await resolvePath(file.path);
        if (!absolutePath) continue;
        const stat = await readStat(absolutePath);
        file.changeVersion = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
      } catch (error) {
        file.changeVersion = (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable";
      }
    }
  }));
}
