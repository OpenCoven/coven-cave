import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CHECKPOINT_PATCH_FILE = "checkpoint.patch";
export const CHECKPOINT_METADATA_FILE = "metadata.scope.json";

const CHECKPOINT_NAME =
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-[a-f0-9]{12})?\.patch$/;
const NAMED_PUBLISH_DRAFT =
  /^\.publish-(.+\.patch)-([a-f0-9]{24})\.tmp$/;
const LEGACY_PUBLISH_DRAFT = /^\.publish-[a-f0-9]+\.tmp$/;
const DELETE_QUARANTINE =
  /^\.delete-(directory|legacy)-(.+\.patch)-([a-f0-9]{24})\.tmp$/;

type DirectoryIdentity = {
  dev: number;
  ino: number;
  mode: number;
  birthtimeMs: number;
  realPath: string;
};

export type CheckpointStore = {
  directory: string;
  identity: DirectoryIdentity;
};

const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  "EACCES",
  "EBADF",
  "EISDIR",
  "EINVAL",
  "ENOSYS",
  "ENOTSUP",
  "EPERM",
]);

function isUnsupportedDirectorySync(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code ?? "";
  return process.platform === "win32"
    ? UNSUPPORTED_DIRECTORY_SYNC_CODES.has(code)
    : code === "EINVAL" || code === "ENOSYS" || code === "ENOTSUP";
}

export function fsyncDirectoryIfSupported(directory: string): void {
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      /* turbopackIgnore: true */ directory,
      fs.constants.O_RDONLY,
    );
  } catch (error) {
    if (isUnsupportedDirectorySync(error)) return;
    throw error;
  }
  try {
    try {
      fs.fsyncSync(descriptor);
    } catch (error) {
      if (!isUnsupportedDirectorySync(error)) throw error;
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function directoryIdentity(directory: string): DirectoryIdentity {
  const stat = fs.lstatSync(/* turbopackIgnore: true */ directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("checkpoint store must be a real directory, not a symlink or junction");
  }
  const realPath = fs.realpathSync.native(
    /* turbopackIgnore: true */ directory,
  );
  const verified = fs.lstatSync(/* turbopackIgnore: true */ directory);
  if (
    verified.isSymbolicLink() ||
    !verified.isDirectory() ||
    verified.dev !== stat.dev ||
    verified.ino !== stat.ino ||
    verified.birthtimeMs !== stat.birthtimeMs
  ) {
    throw new Error("checkpoint store changed during identity verification");
  }
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    birthtimeMs: stat.birthtimeMs,
    realPath,
  };
}

function sameNativePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function ensureChildDirectory(parent: string, child: string): void {
  directoryIdentity(parent);
  let created = false;
  try {
    fs.mkdirSync(/* turbopackIgnore: true */ child, { mode: 0o700 });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  directoryIdentity(child);
  if (created) fsyncDirectoryIfSupported(parent);
}

export function openCheckpointStore(
  directory: string,
  options: { create?: boolean } = {},
): CheckpointStore | null {
  const resolved = path.resolve(/* turbopackIgnore: true */ directory);
  try {
    return { directory: resolved, identity: directoryIdentity(resolved) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!options.create) return null;
  }

  const container = path.dirname(resolved);
  const trustedParent = path.dirname(container);
  ensureChildDirectory(trustedParent, container);
  ensureChildDirectory(container, resolved);
  return { directory: resolved, identity: directoryIdentity(resolved) };
}

export function assertCheckpointStore(store: CheckpointStore): void {
  const current = directoryIdentity(store.directory);
  if (
    current.dev !== store.identity.dev ||
    current.ino !== store.identity.ino ||
    current.mode !== store.identity.mode ||
    current.birthtimeMs !== store.identity.birthtimeMs ||
    !sameNativePath(current.realPath, store.identity.realPath)
  ) {
    throw new Error("checkpoint store changed during operation");
  }
}

function directStoreChild(store: CheckpointStore, name: string): string {
  if (path.basename(name) !== name || name === "." || name === "..") {
    throw new Error("checkpoint artifact escaped checkpoint store");
  }
  const child = path.join(/* turbopackIgnore: true */ store.directory, name);
  if (path.dirname(child) !== store.directory) {
    throw new Error("checkpoint artifact escaped checkpoint store");
  }
  return child;
}

function assertDirectStoreChildPath(
  store: CheckpointStore,
  candidate: string,
): void {
  if (
    path.dirname(candidate) !== store.directory ||
    path.resolve(candidate) !== candidate
  ) {
    throw new Error("checkpoint artifact escaped checkpoint store");
  }
}

function writeDurableExclusiveFile(
  file: string,
  contents: string | Uint8Array,
): void {
  const descriptor = fs.openSync(
    /* turbopackIgnore: true */ file,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    fs.writeFileSync(descriptor, contents);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fileExists(file: string): boolean {
  try {
    fs.lstatSync(/* turbopackIgnore: true */ file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function checkpointCandidate(
  store: CheckpointStore,
  requestedName: string,
  allowCollisionSuffix: boolean,
): string {
  if (!CHECKPOINT_NAME.test(requestedName)) {
    throw new Error("invalid checkpoint publication name");
  }
  if (!allowCollisionSuffix) return directStoreChild(store, requestedName);
  const stem = requestedName.slice(0, -".patch".length).replace(/-[a-f0-9]{12}$/, "");
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const name =
      attempt === 0
        ? `${stem}.patch`
        : `${stem}-${randomBytes(6).toString("hex")}.patch`;
    const candidate = directStoreChild(store, name);
    if (!fileExists(candidate)) return candidate;
  }
  throw new Error("could not reserve a recovered checkpoint name");
}

export function publishCheckpointUnit(
  store: CheckpointStore,
  requestedName: string,
  patchContents: string,
  metadataContents: string,
  options: {
    publicationStage?: (
      stage:
        | "patch-file-synced"
        | "metadata-file-synced"
        | "draft-directory-synced"
        | "checkpoint-renamed"
        | "store-directory-synced",
    ) => void;
  } = {},
): string {
  assertCheckpointStore(store);
  if (!CHECKPOINT_NAME.test(requestedName)) {
    throw new Error("invalid checkpoint publication name");
  }
  const token = randomBytes(12).toString("hex");
  const draftName = `.publish-${requestedName}-${token}.tmp`;
  const draft = directStoreChild(store, draftName);
  fs.mkdirSync(/* turbopackIgnore: true */ draft, { mode: 0o700 });
  let published = false;
  try {
    writeDurableExclusiveFile(
      path.join(draft, CHECKPOINT_PATCH_FILE),
      patchContents,
    );
    options.publicationStage?.("patch-file-synced");
    writeDurableExclusiveFile(
      path.join(draft, CHECKPOINT_METADATA_FILE),
      metadataContents,
    );
    options.publicationStage?.("metadata-file-synced");
    fsyncDirectoryIfSupported(draft);
    options.publicationStage?.("draft-directory-synced");

    for (let attempt = 0; attempt < 32; attempt += 1) {
      const name =
        attempt === 0
          ? requestedName
          : requestedName.replace(
              /\.patch$/,
              `-${randomBytes(6).toString("hex")}.patch`,
            );
      const destination = directStoreChild(store, name);
      if (fileExists(destination)) continue;
      assertCheckpointStore(store);
      try {
        fs.renameSync(
          /* turbopackIgnore: true */ draft,
          /* turbopackIgnore: true */ destination,
        );
        published = true;
        options.publicationStage?.("checkpoint-renamed");
        assertCheckpointStore(store);
        fsyncDirectoryIfSupported(store.directory);
        options.publicationStage?.("store-directory-synced");
        return destination;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (
          code === "EEXIST" ||
          code === "ENOTEMPTY" ||
          ((code === "EACCES" || code === "EPERM") && fileExists(destination))
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("could not publish a unique checkpoint name");
  } finally {
    if (!published) {
      try {
        assertCheckpointStore(store);
        fs.rmSync(
          /* turbopackIgnore: true */ draft,
          { recursive: true, force: true },
        );
        fsyncDirectoryIfSupported(store.directory);
      } catch {
        // Preserve the draft if the pinned store changed or cleanup failed.
      }
    }
  }
}

export function checkpointDeleteQuarantinePath(
  store: CheckpointStore,
  checkpointName: string,
  format: "directory" | "legacy",
): string {
  if (!CHECKPOINT_NAME.test(checkpointName)) {
    throw new Error("invalid checkpoint quarantine name");
  }
  return directStoreChild(
    store,
    `.delete-${format}-${checkpointName}-${randomBytes(12).toString("hex")}.tmp`,
  );
}

type InstalledFile = {
  destination: string;
  source: string;
  destinationStat: fs.Stats;
};

function installRegularFileNoReplace(
  source: string,
  destination: string,
): InstalledFile | null {
  let sourceStat: fs.Stats;
  try {
    sourceStat = fs.lstatSync(/* turbopackIgnore: true */ source);
  } catch {
    return null;
  }
  if (!sourceStat.isFile() || sourceStat.nlink !== 1) return null;
  try {
    if (process.platform === "win32") {
      const sourceDescriptor = fs.openSync(
        /* turbopackIgnore: true */ source,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
      );
      let destinationDescriptor: number | null = null;
      let installed: InstalledFile | null = null;
      try {
        const openedSource = fs.fstatSync(sourceDescriptor);
        if (
          !openedSource.isFile() ||
          openedSource.dev !== sourceStat.dev ||
          openedSource.ino !== sourceStat.ino ||
          openedSource.size !== sourceStat.size ||
          openedSource.mtimeMs !== sourceStat.mtimeMs
        ) {
          return null;
        }
        destinationDescriptor = fs.openSync(
          /* turbopackIgnore: true */ destination,
          fs.constants.O_WRONLY |
            fs.constants.O_CREAT |
            fs.constants.O_EXCL |
            (fs.constants.O_NOFOLLOW ?? 0),
          0o600,
        );
        installed = {
          destination,
          source,
          destinationStat: fs.fstatSync(destinationDescriptor),
        };
        fs.writeFileSync(
          destinationDescriptor,
          fs.readFileSync(sourceDescriptor),
        );
        fs.fsyncSync(destinationDescriptor);
        const destinationStat = fs.fstatSync(destinationDescriptor);
        installed.destinationStat = destinationStat;
        return installed;
      } catch {
        if (installed) removeInstalledFile(installed);
        return null;
      } finally {
        if (destinationDescriptor !== null) {
          fs.closeSync(destinationDescriptor);
        }
        fs.closeSync(sourceDescriptor);
      }
    }

    fs.linkSync(
      /* turbopackIgnore: true */ source,
      /* turbopackIgnore: true */ destination,
    );
    const destinationStat = fs.lstatSync(
      /* turbopackIgnore: true */ destination,
    );
    if (
      !destinationStat.isFile() ||
      destinationStat.dev !== sourceStat.dev ||
      destinationStat.ino !== sourceStat.ino
    ) {
      return null;
    }
    return { destination, source, destinationStat };
  } catch {
    return null;
  }
}

function removeInstalledFile(installed: InstalledFile): void {
  try {
    const stat = fs.lstatSync(
      /* turbopackIgnore: true */ installed.destination,
    );
    const isInstalled =
      stat.isFile() &&
      stat.dev === installed.destinationStat.dev &&
      stat.ino === installed.destinationStat.ino &&
      stat.birthtimeMs === installed.destinationStat.birthtimeMs;
    if (isInstalled) {
      fs.unlinkSync(/* turbopackIgnore: true */ installed.destination);
    }
  } catch {
    // A replacement is never removed during rollback cleanup.
  }
}

export function restoreQuarantinedRegularFileNoReplace(
  quarantinedPath: string,
  originalPath: string,
): boolean {
  const installed = installRegularFileNoReplace(quarantinedPath, originalPath);
  if (!installed) return false;
  try {
    fsyncDirectoryIfSupported(path.dirname(originalPath));
  } catch {
    removeInstalledFile(installed);
    return false;
  }
  try {
    fs.unlinkSync(/* turbopackIgnore: true */ quarantinedPath);
    fsyncDirectoryIfSupported(path.dirname(quarantinedPath));
    return true;
  } catch {
    if (fileExists(quarantinedPath)) {
      removeInstalledFile(installed);
      return false;
    }
    return true;
  }
}

function completeDirectoryUnit(
  directory: string,
  validateMetadata: (raw: string) => boolean,
): boolean {
  try {
    const info = fs.lstatSync(/* turbopackIgnore: true */ directory);
    if (info.isSymbolicLink() || !info.isDirectory()) return false;
    const entries = fs.readdirSync(/* turbopackIgnore: true */ directory).sort();
    if (
      entries.length !== 2 ||
      entries[0] !== CHECKPOINT_PATCH_FILE ||
      entries[1] !== CHECKPOINT_METADATA_FILE
    ) {
      return false;
    }
    const patch = fs.lstatSync(
      /* turbopackIgnore: true */ path.join(directory, CHECKPOINT_PATCH_FILE),
    );
    const metadataPath = path.join(directory, CHECKPOINT_METADATA_FILE);
    const metadata = fs.lstatSync(/* turbopackIgnore: true */ metadataPath);
    return (
      patch.isFile() &&
      metadata.isFile() &&
      patch.nlink === 1 &&
      metadata.nlink === 1 &&
      validateMetadata(fs.readFileSync(metadataPath, "utf8"))
    );
  } catch {
    return false;
  }
}

export function restoreCheckpointDirectoryQuarantineNoReplace(
  store: CheckpointStore,
  quarantine: string,
  destination: string,
): boolean {
  assertCheckpointStore(store);
  assertDirectStoreChildPath(store, quarantine);
  assertDirectStoreChildPath(store, destination);
  try {
    fs.mkdirSync(/* turbopackIgnore: true */ destination, { mode: 0o700 });
  } catch {
    return false;
  }

  const installed: InstalledFile[] = [];
  let destinationDurable = false;
  try {
    for (const name of [CHECKPOINT_PATCH_FILE, CHECKPOINT_METADATA_FILE]) {
      const file = installRegularFileNoReplace(
        path.join(quarantine, name),
        path.join(destination, name),
      );
      if (!file) throw new Error("checkpoint quarantine restore failed");
      installed.push(file);
    }
    fsyncDirectoryIfSupported(destination);
    assertCheckpointStore(store);
    fsyncDirectoryIfSupported(store.directory);
    destinationDurable = true;
    for (const file of installed) {
      fs.unlinkSync(/* turbopackIgnore: true */ file.source);
    }
    fs.rmdirSync(/* turbopackIgnore: true */ quarantine);
    fsyncDirectoryIfSupported(store.directory);
    return true;
  } catch {
    if (destinationDurable) return true;
    for (const file of installed) removeInstalledFile(file);
    try {
      fs.rmdirSync(/* turbopackIgnore: true */ destination);
    } catch {
      // Preserve any incomplete destination and the complete quarantine.
    }
    return false;
  }
}

function completeLegacyQuarantine(
  directory: string,
  validateMetadata: (raw: string) => boolean,
): { metadata: boolean } | null {
  try {
    const info = fs.lstatSync(/* turbopackIgnore: true */ directory);
    const entries = fs.readdirSync(/* turbopackIgnore: true */ directory).sort();
    const patch = fs.lstatSync(
      /* turbopackIgnore: true */ path.join(directory, CHECKPOINT_PATCH_FILE),
    );
    if (
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      (entries.length !== 1 && entries.length !== 2) ||
      entries[0] !== CHECKPOINT_PATCH_FILE ||
      (entries.length === 2 && entries[1] !== CHECKPOINT_METADATA_FILE) ||
      !patch.isFile() ||
      patch.nlink !== 1
    ) {
      return null;
    }
    const metadataPath = path.join(directory, CHECKPOINT_METADATA_FILE);
    try {
      const metadata = fs.lstatSync(/* turbopackIgnore: true */ metadataPath);
      if (
        !metadata.isFile() ||
        metadata.nlink !== 1 ||
        !validateMetadata(fs.readFileSync(metadataPath, "utf8"))
      ) {
        return null;
      }
      return { metadata: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { metadata: false };
      }
      return null;
    }
  } catch {
    return null;
  }
}

function restoreLegacyQuarantine(
  store: CheckpointStore,
  quarantine: string,
  destination: string,
  hasMetadata: boolean,
): boolean {
  assertCheckpointStore(store);
  const installed: InstalledFile[] = [];
  let destinationDurable = false;
  try {
    const patch = installRegularFileNoReplace(
      path.join(quarantine, CHECKPOINT_PATCH_FILE),
      destination,
    );
    if (!patch) return false;
    installed.push(patch);
    if (hasMetadata) {
      const metadata = installRegularFileNoReplace(
        path.join(quarantine, CHECKPOINT_METADATA_FILE),
        `${destination}.scope.json`,
      );
      if (!metadata) throw new Error("checkpoint metadata restore failed");
      installed.push(metadata);
    }
    assertCheckpointStore(store);
    fsyncDirectoryIfSupported(store.directory);
    destinationDurable = true;
    for (const file of installed) {
      fs.unlinkSync(/* turbopackIgnore: true */ file.source);
    }
    fs.rmdirSync(/* turbopackIgnore: true */ quarantine);
    fsyncDirectoryIfSupported(store.directory);
    return true;
  } catch {
    if (destinationDurable) return true;
    for (const file of installed) removeInstalledFile(file);
    return false;
  }
}

function recoveredCheckpointName(stat: fs.Stats): string {
  return `${new Date(stat.mtimeMs).toISOString().replace(/[:.]/g, "-")}.patch`;
}

type RegularFileSnapshot = {
  contents: Buffer;
  identity: fs.Stats;
  pathname: string;
};

function sameRegularFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return (
    left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.birthtimeMs === right.birthtimeMs &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

function snapshotRegularFile(pathname: string): RegularFileSnapshot {
  const before = fs.lstatSync(/* turbopackIgnore: true */ pathname);
  if (!before.isFile() || before.nlink !== 1) {
    throw new Error("checkpoint recovery source must be one regular file");
  }
  const descriptor = fs.openSync(
    /* turbopackIgnore: true */ pathname,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fs.fstatSync(descriptor);
    if (!sameRegularFileIdentity(before, opened)) {
      throw new Error("checkpoint recovery source changed while opening");
    }
    const contents = fs.readFileSync(descriptor);
    const after = fs.lstatSync(/* turbopackIgnore: true */ pathname);
    if (!sameRegularFileIdentity(opened, after)) {
      throw new Error("checkpoint recovery source changed while reading");
    }
    return { contents, identity: opened, pathname };
  } finally {
    fs.closeSync(descriptor);
  }
}

function removeSnapshottedFile(snapshot: RegularFileSnapshot): boolean {
  try {
    const current = fs.lstatSync(
      /* turbopackIgnore: true */ snapshot.pathname,
    );
    if (!sameRegularFileIdentity(current, snapshot.identity)) return false;
    fs.unlinkSync(/* turbopackIgnore: true */ snapshot.pathname);
    return true;
  } catch {
    return false;
  }
}

export function recoverCheckpointStore(
  store: CheckpointStore,
  validateMetadata: (raw: string) => boolean,
): void {
  assertCheckpointStore(store);
  const names = fs.readdirSync(
    /* turbopackIgnore: true */ store.directory,
  );

  for (const name of names) {
    assertCheckpointStore(store);
    const quarantineMatch = DELETE_QUARANTINE.exec(name);
    if (!quarantineMatch) continue;
    const [, format, checkpointName] = quarantineMatch;
    if (!CHECKPOINT_NAME.test(checkpointName)) continue;
    const quarantine = directStoreChild(store, name);
    const destination = directStoreChild(store, checkpointName);
    if (format === "directory") {
      if (!completeDirectoryUnit(quarantine, validateMetadata)) continue;
      restoreCheckpointDirectoryQuarantineNoReplace(
        store,
        quarantine,
        destination,
      );
    } else {
      const complete = completeLegacyQuarantine(
        quarantine,
        validateMetadata,
      );
      if (!complete) continue;
      restoreLegacyQuarantine(
        store,
        quarantine,
        destination,
        complete.metadata,
      );
    }
  }

  assertCheckpointStore(store);
  for (const name of fs.readdirSync(store.directory)) {
    assertCheckpointStore(store);
    const named = NAMED_PUBLISH_DRAFT.exec(name);
    const legacy = LEGACY_PUBLISH_DRAFT.test(name);
    if (!named && !legacy) continue;
    const draft = directStoreChild(store, name);
    if (!completeDirectoryUnit(draft, validateMetadata)) {
      assertCheckpointStore(store);
      try {
        fs.rmSync(
          /* turbopackIgnore: true */ draft,
          { force: true, recursive: true },
        );
        fsyncDirectoryIfSupported(store.directory);
      } catch {
        // Leave an artifact that cannot be safely removed for manual recovery.
      }
      continue;
    }
    const draftStat = fs.lstatSync(/* turbopackIgnore: true */ draft);
    const requestedName =
      named && CHECKPOINT_NAME.test(named[1])
        ? named[1]
        : recoveredCheckpointName(draftStat);
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const destination = checkpointCandidate(
        store,
        requestedName,
        named === null || attempt > 0,
      );
      if (fileExists(destination)) continue;
      assertCheckpointStore(store);
      try {
        fs.renameSync(
          /* turbopackIgnore: true */ draft,
          /* turbopackIgnore: true */ destination,
        );
        assertCheckpointStore(store);
        fsyncDirectoryIfSupported(store.directory);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (
          code === "EEXIST" ||
          code === "ENOTEMPTY" ||
          ((code === "EACCES" || code === "EPERM") &&
            fileExists(destination))
        ) {
          continue;
        }
        // A complete draft remains available for the next locked recovery.
        break;
      }
    }
  }

  assertCheckpointStore(store);
  const remaining = fs.readdirSync(store.directory);
  const reservations = remaining.filter((name) => {
    if (!name.endsWith(".reserve")) return false;
    return CHECKPOINT_NAME.test(name.slice(0, -".reserve".length));
  });
  const legacyPatchTemps = remaining.filter((name) =>
    /^\.publish-([a-f0-9]+)\.patch\.tmp$/.test(name),
  );
  const legacyPairs = legacyPatchTemps.flatMap((patchTempName) => {
    assertCheckpointStore(store);
    const token = /^\.publish-([a-f0-9]+)\.patch\.tmp$/.exec(
      patchTempName,
    )![1];
    const metadataTempName = `.publish-${token}.scope.tmp`;
    if (!remaining.includes(metadataTempName)) return [];
    const patchTemp = directStoreChild(store, patchTempName);
    const metadataTemp = directStoreChild(store, metadataTempName);
    try {
      const patchInfo = fs.lstatSync(/* turbopackIgnore: true */ patchTemp);
      const metadataInfo = fs.lstatSync(
        /* turbopackIgnore: true */ metadataTemp,
      );
      if (
        !patchInfo.isFile() ||
        patchInfo.nlink !== 1 ||
        !metadataInfo.isFile() ||
        metadataInfo.nlink !== 1 ||
        !validateMetadata(fs.readFileSync(metadataTemp, "utf8"))
      ) {
        return [];
      }
      return [{ patchTemp, metadataTemp }];
    } catch {
      return [];
    }
  });

  if (reservations.length === 1 && legacyPairs.length === 1) {
    const targetName = reservations[0].slice(0, -".reserve".length);
    const target = directStoreChild(store, targetName);
    const reservation = directStoreChild(store, reservations[0]);
    try {
      const patchSource = snapshotRegularFile(legacyPairs[0].patchTemp);
      const metadataSource = snapshotRegularFile(legacyPairs[0].metadataTemp);
      let recovered = false;
      if (fileExists(target)) {
        if (completeDirectoryUnit(target, validateMetadata)) {
          const targetPatch = snapshotRegularFile(
            path.join(target, CHECKPOINT_PATCH_FILE),
          );
          const targetMetadata = snapshotRegularFile(
            path.join(target, CHECKPOINT_METADATA_FILE),
          );
          recovered =
            targetPatch.contents.equals(patchSource.contents) &&
            targetMetadata.contents.equals(metadataSource.contents);
        }
      } else {
        const recoveryDraft = directStoreChild(
          store,
          `.publish-${targetName}-${randomBytes(12).toString("hex")}.tmp`,
        );
        assertCheckpointStore(store);
        fs.mkdirSync(/* turbopackIgnore: true */ recoveryDraft, {
          mode: 0o700,
        });
        writeDurableExclusiveFile(
          path.join(recoveryDraft, CHECKPOINT_PATCH_FILE),
          patchSource.contents,
        );
        writeDurableExclusiveFile(
          path.join(recoveryDraft, CHECKPOINT_METADATA_FILE),
          metadataSource.contents,
        );
        fsyncDirectoryIfSupported(recoveryDraft);
        assertCheckpointStore(store);
        fs.renameSync(
          /* turbopackIgnore: true */ recoveryDraft,
          /* turbopackIgnore: true */ target,
        );
        fsyncDirectoryIfSupported(store.directory);
        recovered = true;
      }
      if (
        recovered &&
        removeSnapshottedFile(patchSource) &&
        removeSnapshottedFile(metadataSource)
      ) {
        fs.rmSync(/* turbopackIgnore: true */ reservation, { force: true });
        fsyncDirectoryIfSupported(store.directory);
      }
    } catch {
      // The source pair and reservation remain recoverable after interruption.
    }
  }

  for (const reservation of reservations) {
    const target = directStoreChild(
      store,
      reservation.slice(0, -".reserve".length),
    );
    const hasRecoverableLegacyPair =
      reservations.length === 1 &&
      legacyPairs.length === 1 &&
      !fileExists(target);
    if (hasRecoverableLegacyPair) continue;
    assertCheckpointStore(store);
    fs.rmSync(
      /* turbopackIgnore: true */ directStoreChild(store, reservation),
      { force: true },
    );
    fsyncDirectoryIfSupported(store.directory);
  }
}
