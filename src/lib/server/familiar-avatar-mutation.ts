import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { isValidFamiliarId } from "./familiar-id.ts";

const AVATAR_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);

export type AvatarMutationResult = {
  fileName: string;
  revision: number;
};

async function assertRealDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const entry = await lstat(dir);
  if (entry.isSymbolicLink()) {
    throw new Error("Avatar directory cannot be a symbolic link.");
  }
  if (!entry.isDirectory()) {
    throw new Error("Avatar path is not a directory.");
  }
}

export async function writeCanonicalAvatar(
  dir: string,
  id: string,
  png: Uint8Array,
): Promise<AvatarMutationResult> {
  if (!isValidFamiliarId(id)) throw new Error("Invalid familiar id.");
  await assertRealDirectory(dir);

  const fileName = `${id}.png`;
  const destination = path.join(dir, fileName);
  try {
    const existing = await lstat(destination);
    if (existing.isSymbolicLink()) {
      throw new Error("Avatar file cannot be a symbolic link.");
    }
    if (!existing.isFile()) {
      throw new Error("Avatar path is not a regular file.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporary = path.join(dir, `.${fileName}.${process.pid}.${randomUUID()}.tmp`);
  const file = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(png);
    await file.sync();
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await file.close();

  try {
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }

  const written = await stat(destination);
  return { fileName, revision: Math.round(written.mtimeMs) };
}

export async function removeAvatarFiles(dir: string): Promise<{ removed: boolean }> {
  let directory;
  try {
    directory = await lstat(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { removed: false };
    throw error;
  }
  if (directory.isSymbolicLink()) {
    throw new Error("Avatar directory cannot be a symbolic link.");
  }
  if (!directory.isDirectory()) {
    throw new Error("Avatar path is not a directory.");
  }

  const entries = (await readdir(dir)).filter((name) =>
    AVATAR_EXTENSIONS.has(path.extname(name).toLowerCase()),
  );
  const removable: string[] = [];
  for (const name of entries) {
    const candidate = path.join(dir, name);
    const entry = await lstat(candidate);
    if (entry.isSymbolicLink()) {
      throw new Error("Avatar file cannot be a symbolic link.");
    }
    if (entry.isFile()) removable.push(candidate);
  }

  await Promise.all(removable.map((candidate) => unlink(candidate)));
  return { removed: removable.length > 0 };
}
