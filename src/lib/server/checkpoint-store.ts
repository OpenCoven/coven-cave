import { createHash, randomBytes } from "node:crypto";
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
const RESTORE_DIRECTORY_STAGING =
  /^\.restore-directory-(.+\.patch)-([a-f0-9]{24})\.tmp$/;
const LEGACY_RESERVATION =
  /^\.legacy-reservation-([a-f0-9]{24})\.json$/;
const LEGACY_RECOVERY_STAGE =
  /^\.legacy-stage-([a-f0-9]{24})\.tmp$/;
const PURGE_DIRECTORY = /^\.purge-([a-f0-9]{24})\.tmp$/;
const DIRECTORY_RESERVATION_FILE = ".reservation.json";
const DIRECTORY_PATCH_STAGING = ".checkpoint.patch.tmp";
const DIRECTORY_METADATA_STAGING = ".metadata.scope.json.tmp";
const QUARANTINE_CONFLICT_FILE = ".conflict.json";

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

type DirectoryInstallationStage =
  | "destination-name-reserved"
  | "destination-reservation-synced"
  | "destination-patch-staged"
  | "destination-metadata-staged"
  | "destination-directory-synced"
  | "destination-patch-installed"
  | "destination-metadata-installed"
  | "publication-source-retired"
  | "publication-marker-removed";

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
        | DirectoryInstallationStage
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
  let preserveDraft = false;
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
      assertCheckpointStore(store);
      try {
        preserveDraft = true;
        const installed = installCheckpointDirectoryNoReplace(
          store,
          draft,
          destination,
          metadataIsJson,
          options.publicationStage,
        );
        if (!installed) continue;
        published = true;
        options.publicationStage?.("checkpoint-renamed");
        assertCheckpointStore(store);
        options.publicationStage?.("store-directory-synced");
        return destination;
      } catch (error) {
        throw error;
      }
    }
    throw new Error("could not publish a unique checkpoint name");
  } finally {
    if (!published && !preserveDraft) {
      try {
        assertCheckpointStore(store);
        if (removeGeneratedDirectoryIfSafe(draft, CHECKPOINT_UNIT_FILES)) {
          fsyncDirectoryIfSupported(store.directory);
        }
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

export function markCheckpointQuarantineConflict(
  store: CheckpointStore,
  quarantine: string,
  destination: string,
): boolean {
  assertCheckpointStore(store);
  assertDirectStoreChildPath(store, quarantine);
  assertDirectStoreChildPath(store, destination);
  const conflictPath = path.join(quarantine, QUARANTINE_CONFLICT_FILE);
  if (fileExists(conflictPath)) return true;
  const quarantined = snapshotGeneratedDirectoryEntries(
    quarantine,
    CHECKPOINT_UNIT_FILES,
  );
  if (
    !quarantined ||
    quarantined.files.length < 1 ||
    quarantined.files.length > 2 ||
    !quarantined.files.some(
      (file) => path.basename(file.pathname) === CHECKPOINT_PATCH_FILE,
    )
  ) {
    return false;
  }
  const proof = {
    version: 1,
    recoverable: false,
    reason: "replacement-authorization-or-content-mismatch",
    targetName: path.basename(destination),
    quarantined: Object.fromEntries(
      quarantined.files.map((file) => [
        path.basename(file.pathname),
        sha256(file.contents),
      ]),
    ),
    replacement: null as null | Record<string, string>,
  };
  try {
    const replacementDirectory = snapshotCompleteDirectoryUnit(
      destination,
      metadataIsJson,
    );
    if (replacementDirectory) {
      proof.replacement = {
        [CHECKPOINT_PATCH_FILE]: sha256(replacementDirectory.patch.contents),
        [CHECKPOINT_METADATA_FILE]: sha256(
          replacementDirectory.metadata.contents,
        ),
      };
    } else {
      const replacement = snapshotRegularFile(destination);
      proof.replacement = {
        [CHECKPOINT_PATCH_FILE]: sha256(replacement.contents),
      };
    }
  } catch {
    proof.replacement = null;
  }
  writeDurableExclusiveFile(
    conflictPath,
    `${JSON.stringify(proof)}\n`,
  );
  fsyncDirectoryIfSupported(quarantine);
  fsyncDirectoryIfSupported(store.directory);
  return true;
}

type InstalledFile = {
  destination: string;
  source: RegularFileSnapshot;
  destinationStat: fs.Stats;
};

function sameCreatedFile(left: fs.Stats, right: fs.Stats): boolean {
  return (
    left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.birthtimeMs === right.birthtimeMs
  );
}

function installRegularFileNoReplace(
  source: string,
  destination: string,
): InstalledFile | null {
  let sourceSnapshot: RegularFileSnapshot;
  try {
    sourceSnapshot = snapshotRegularFile(source);
  } catch {
    return null;
  }

  let destinationDescriptor: number | null = null;
  let installed: InstalledFile | null = null;
  let completed = false;
  try {
    destinationDescriptor = fs.openSync(
      /* turbopackIgnore: true */ destination,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW ?? 0),
      sourceSnapshot.identity.mode & 0o777,
    );
    installed = {
      destination,
      source: sourceSnapshot,
      destinationStat: fs.fstatSync(destinationDescriptor),
    };
    fs.writeFileSync(destinationDescriptor, sourceSnapshot.contents);
    fs.fsyncSync(destinationDescriptor);
    installed.destinationStat = fs.fstatSync(destinationDescriptor);
    const destinationPathStat = fs.lstatSync(
      /* turbopackIgnore: true */ destination,
    );
    if (
      !sameCreatedFile(destinationPathStat, installed.destinationStat) ||
      destinationPathStat.nlink !== 1 ||
      destinationPathStat.size !== sourceSnapshot.contents.length
    ) {
      throw new Error("installed checkpoint destination changed");
    }
    const sourceAfterCopy = fs.lstatSync(/* turbopackIgnore: true */ source);
    if (!sameRegularFileIdentity(sourceAfterCopy, sourceSnapshot.identity)) {
      throw new Error("checkpoint quarantine source changed during copy");
    }
    completed = true;
  } catch {
    completed = false;
  } finally {
    if (destinationDescriptor !== null) fs.closeSync(destinationDescriptor);
  }
  if (!completed) {
    if (installed) removeInstalledFile(installed);
    return null;
  }
  return installed;
}

function removeInstalledFile(installed: InstalledFile): void {
  try {
    const stat = fs.lstatSync(
      /* turbopackIgnore: true */ installed.destination,
    );
    const isInstalled = sameCreatedFile(stat, installed.destinationStat);
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
    if (!removeSnapshottedFile(installed.source)) {
      removeInstalledFile(installed);
      return false;
    }
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
  return snapshotCompleteDirectoryUnit(directory, validateMetadata) !== null;
}

type CompleteDirectorySnapshot = {
  directoryIdentity: fs.Stats;
  patch: RegularFileSnapshot;
  metadata: RegularFileSnapshot;
};

function sameDirectoryIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return (
    left.isDirectory() &&
    right.isDirectory() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.birthtimeMs === right.birthtimeMs
  );
}

function snapshotCompleteDirectoryUnit(
  directory: string,
  validateMetadata: (raw: string) => boolean,
): CompleteDirectorySnapshot | null {
  try {
    const info = fs.lstatSync(/* turbopackIgnore: true */ directory);
    if (info.isSymbolicLink() || !info.isDirectory()) return null;
    const entries = fs.readdirSync(/* turbopackIgnore: true */ directory).sort();
    if (
      entries.length !== 2 ||
      entries[0] !== CHECKPOINT_PATCH_FILE ||
      entries[1] !== CHECKPOINT_METADATA_FILE
    ) {
      return null;
    }
    const patch = snapshotRegularFile(
      path.join(directory, CHECKPOINT_PATCH_FILE),
    );
    const metadataPath = path.join(directory, CHECKPOINT_METADATA_FILE);
    const metadata = snapshotRegularFile(metadataPath);
    if (!validateMetadata(metadata.contents.toString("utf8"))) return null;
    const verifiedDirectory = fs.lstatSync(
      /* turbopackIgnore: true */ directory,
    );
    const verifiedEntries = fs.readdirSync(
      /* turbopackIgnore: true */ directory,
    ).sort();
    if (
      !sameDirectoryIdentity(info, verifiedDirectory) ||
      verifiedEntries.length !== 2 ||
      verifiedEntries[0] !== CHECKPOINT_PATCH_FILE ||
      verifiedEntries[1] !== CHECKPOINT_METADATA_FILE
    ) {
      return null;
    }
    return { directoryIdentity: info, patch, metadata };
  } catch {
    return null;
  }
}

type DirectoryReservation = {
  version: 1;
  token: string;
  targetName: string;
  sourceName: string;
  purgeName: string;
  patchSha256: string;
  metadataSha256: string;
};

function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

function parseDirectoryReservation(
  raw: string,
  expectedTargetName: string,
): DirectoryReservation | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DirectoryReservation>;
    if (
      parsed.version !== 1 ||
      typeof parsed.token !== "string" ||
      !/^[a-f0-9]{24}$/.test(parsed.token) ||
      parsed.targetName !== expectedTargetName ||
      typeof parsed.sourceName !== "string" ||
      path.basename(parsed.sourceName) !== parsed.sourceName ||
      typeof parsed.purgeName !== "string" ||
      parsed.purgeName !== `.purge-${parsed.token}.tmp` ||
      typeof parsed.patchSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.patchSha256) ||
      typeof parsed.metadataSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.metadataSha256)
    ) {
      return null;
    }
    return parsed as DirectoryReservation;
  } catch {
    return null;
  }
}

function completeReservedDestination(
  destination: string,
  reservation: DirectoryReservation,
  validateMetadata: (raw: string) => boolean,
): CompleteDirectorySnapshot | null {
  try {
    const entries = fs.readdirSync(
      /* turbopackIgnore: true */ destination,
    ).sort();
    if (
      entries.length !== 3 ||
      entries[0] !== DIRECTORY_RESERVATION_FILE ||
      entries[1] !== CHECKPOINT_PATCH_FILE ||
      entries[2] !== CHECKPOINT_METADATA_FILE
    ) {
      return null;
    }
    const patch = snapshotRegularFile(
      path.join(destination, CHECKPOINT_PATCH_FILE),
    );
    const metadata = snapshotRegularFile(
      path.join(destination, CHECKPOINT_METADATA_FILE),
    );
    if (
      sha256(patch.contents) !== reservation.patchSha256 ||
      sha256(metadata.contents) !== reservation.metadataSha256 ||
      !validateMetadata(metadata.contents.toString("utf8"))
    ) {
      return null;
    }
    const directoryIdentity = fs.lstatSync(
      /* turbopackIgnore: true */ destination,
    );
    if (!directoryIdentity.isDirectory() || directoryIdentity.isSymbolicLink()) {
      return null;
    }
    return { directoryIdentity, patch, metadata };
  } catch {
    return null;
  }
}

function installCheckpointDirectoryNoReplace(
  store: CheckpointStore,
  sourceDirectory: string,
  destination: string,
  validateMetadata: (raw: string) => boolean,
  installationStage?: (stage: DirectoryInstallationStage) => void,
): boolean {
  assertCheckpointStore(store);
  assertDirectStoreChildPath(store, sourceDirectory);
  assertDirectStoreChildPath(store, destination);
  const source = snapshotCompleteDirectoryUnit(
    sourceDirectory,
    validateMetadata,
  );
  if (!source) {
    throw new Error("checkpoint publication source is incomplete");
  }
  const token = randomBytes(12).toString("hex");
  const reservation: DirectoryReservation = {
    version: 1,
    token,
    targetName: path.basename(destination),
    sourceName: path.basename(sourceDirectory),
    purgeName: `.purge-${token}.tmp`,
    patchSha256: sha256(source.patch.contents),
    metadataSha256: sha256(source.metadata.contents),
  };
  try {
    fs.mkdirSync(/* turbopackIgnore: true */ destination, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  installationStage?.("destination-name-reserved");

  const reservationPath = path.join(
    destination,
    DIRECTORY_RESERVATION_FILE,
  );
  const patchDestination = path.join(destination, CHECKPOINT_PATCH_FILE);
  const metadataDestination = path.join(
    destination,
    CHECKPOINT_METADATA_FILE,
  );
  const purge = directStoreChild(store, reservation.purgeName);
  try {
    writeDurableExclusiveFile(
      reservationPath,
      `${JSON.stringify(reservation)}\n`,
    );
    installationStage?.("destination-reservation-synced");
    writeDurableExclusiveFile(patchDestination, source.patch.contents);
    installationStage?.("destination-patch-staged");
    installationStage?.("destination-patch-installed");
    writeDurableExclusiveFile(metadataDestination, source.metadata.contents);
    installationStage?.("destination-metadata-staged");
    installationStage?.("destination-metadata-installed");
    fsyncDirectoryIfSupported(destination);
    installationStage?.("destination-directory-synced");
    const verifiedSource = snapshotCompleteDirectoryUnit(
      sourceDirectory,
      validateMetadata,
    );
    if (
      !verifiedSource ||
      !sameDirectoryIdentity(
        source.directoryIdentity,
        verifiedSource.directoryIdentity,
      ) ||
      !completeDirectorySnapshotsEqual(source, verifiedSource) ||
      !completeReservedDestination(
        destination,
        reservation,
        validateMetadata,
      )
    ) {
      throw new Error("checkpoint publication changed during installation");
    }
    fs.renameSync(
      /* turbopackIgnore: true */ sourceDirectory,
      /* turbopackIgnore: true */ purge,
    );
    fsyncDirectoryIfSupported(store.directory);
    installationStage?.("publication-source-retired");
    const marker = snapshotRegularFile(reservationPath);
    if (
      parseDirectoryReservation(
        marker.contents.toString("utf8"),
        path.basename(destination),
      ) === null ||
      !removeSnapshottedFile(marker)
    ) {
      throw new Error("checkpoint publication marker changed");
    }
    installationStage?.("publication-marker-removed");
    fsyncDirectoryIfSupported(destination);
    fsyncDirectoryIfSupported(store.directory);
    if (removeGeneratedDirectoryIfSafe(purge, CHECKPOINT_UNIT_FILES)) {
      fsyncDirectoryIfSupported(store.directory);
    }
    return true;
  } catch (error) {
    // The complete source or the identity-marked destination remains for
    // locked recovery. Never unlink a partially installed public directory.
    throw error;
  }
}

function matchingRegularFile(
  pathname: string,
  expectedSha256: string,
): RegularFileSnapshot | null {
  try {
    const snapshot = snapshotRegularFile(pathname);
    return sha256(snapshot.contents) === expectedSha256 ? snapshot : null;
  } catch {
    return null;
  }
}

function recoverReservedCheckpointDirectory(
  store: CheckpointStore,
  destination: string,
  validateMetadata: (raw: string) => boolean,
): boolean {
  const reservationPath = path.join(
    destination,
    DIRECTORY_RESERVATION_FILE,
  );
  let marker: RegularFileSnapshot;
  let reservation: DirectoryReservation;
  try {
    marker = snapshotRegularFile(reservationPath);
    const parsed = parseDirectoryReservation(
      marker.contents.toString("utf8"),
      path.basename(destination),
    );
    if (!parsed) return false;
    reservation = parsed;
  } catch {
    return false;
  }
  const allowedEntries = new Set([
    DIRECTORY_RESERVATION_FILE,
    DIRECTORY_PATCH_STAGING,
    DIRECTORY_METADATA_STAGING,
    CHECKPOINT_PATCH_FILE,
    CHECKPOINT_METADATA_FILE,
  ]);
  const entries = fs.readdirSync(
    /* turbopackIgnore: true */ destination,
  );
  if (entries.some((entry) => !allowedEntries.has(entry))) return false;

  const sourcePath = directStoreChild(store, reservation.sourceName);
  const purgePath = directStoreChild(store, reservation.purgeName);
  const source =
    snapshotCompleteDirectoryUnit(sourcePath, validateMetadata) ??
    snapshotCompleteDirectoryUnit(purgePath, validateMetadata);
  if (
    source &&
    (sha256(source.patch.contents) !== reservation.patchSha256 ||
      sha256(source.metadata.contents) !== reservation.metadataSha256)
  ) {
    return false;
  }
  const patchPath = path.join(destination, CHECKPOINT_PATCH_FILE);
  const patchStaging = path.join(destination, DIRECTORY_PATCH_STAGING);
  const metadataPath = path.join(destination, CHECKPOINT_METADATA_FILE);
  const metadataStaging = path.join(
    destination,
    DIRECTORY_METADATA_STAGING,
  );
  const patchFinal = matchingRegularFile(
    patchPath,
    reservation.patchSha256,
  );
  const patchTemporary = matchingRegularFile(
    patchStaging,
    reservation.patchSha256,
  );
  const metadataFinal = matchingRegularFile(
    metadataPath,
    reservation.metadataSha256,
  );
  const metadataTemporary = matchingRegularFile(
    metadataStaging,
    reservation.metadataSha256,
  );
  if (
    (fileExists(patchPath) && !patchFinal) ||
    (fileExists(patchStaging) && !patchTemporary) ||
    (fileExists(metadataPath) && !metadataFinal) ||
    (fileExists(metadataStaging) && !metadataTemporary) ||
    (metadataFinal &&
      !validateMetadata(metadataFinal.contents.toString("utf8"))) ||
    (metadataTemporary &&
      !validateMetadata(metadataTemporary.contents.toString("utf8")))
  ) {
    return false;
  }
  if (patchFinal && patchTemporary && !removeSnapshottedFile(patchTemporary)) {
    return false;
  }
  if (
    metadataFinal &&
    metadataTemporary &&
    !removeSnapshottedFile(metadataTemporary)
  ) {
    return false;
  }
  if (!patchFinal) {
    const contents = patchTemporary?.contents ?? source?.patch.contents;
    if (!contents) return false;
    writeDurableExclusiveFile(patchPath, contents);
    if (patchTemporary && !removeSnapshottedFile(patchTemporary)) return false;
  }
  if (!metadataFinal) {
    const contents =
      metadataTemporary?.contents ?? source?.metadata.contents;
    if (!contents) return false;
    writeDurableExclusiveFile(metadataPath, contents);
    if (
      metadataTemporary &&
      !removeSnapshottedFile(metadataTemporary)
    ) {
      return false;
    }
  }
  fsyncDirectoryIfSupported(destination);
  if (
    !completeReservedDestination(
      destination,
      reservation,
      validateMetadata,
    )
  ) {
    return false;
  }

  if (fileExists(sourcePath)) {
    if (fileExists(purgePath)) return false;
    const verifiedSource = snapshotCompleteDirectoryUnit(
      sourcePath,
      validateMetadata,
    );
    if (
      !verifiedSource ||
      sha256(verifiedSource.patch.contents) !== reservation.patchSha256 ||
      sha256(verifiedSource.metadata.contents) !== reservation.metadataSha256
    ) {
      return false;
    }
    fs.renameSync(
      /* turbopackIgnore: true */ sourcePath,
      /* turbopackIgnore: true */ purgePath,
    );
    fsyncDirectoryIfSupported(store.directory);
  }
  marker = snapshotRegularFile(reservationPath);
  if (
    parseDirectoryReservation(
      marker.contents.toString("utf8"),
      path.basename(destination),
    ) === null ||
    !removeSnapshottedFile(marker)
  ) {
    return false;
  }
  fsyncDirectoryIfSupported(destination);
  fsyncDirectoryIfSupported(store.directory);
  if (
    fileExists(purgePath) &&
    removeGeneratedDirectoryIfSafe(purgePath, CHECKPOINT_UNIT_FILES)
  ) {
    fsyncDirectoryIfSupported(store.directory);
  }
  return true;
}

function purgeReferencedByReservedDestination(
  store: CheckpointStore,
  purgeName: string,
): boolean {
  for (const name of fs.readdirSync(store.directory)) {
    if (!CHECKPOINT_NAME.test(name)) continue;
    const destination = directStoreChild(store, name);
    try {
      const marker = snapshotRegularFile(
        path.join(destination, DIRECTORY_RESERVATION_FILE),
      );
      const reservation = parseDirectoryReservation(
        marker.contents.toString("utf8"),
        name,
      );
      if (reservation?.purgeName === purgeName) return true;
    } catch {
      // A non-directory checkpoint or a marker-free unit has no reservation.
    }
  }
  return false;
}

function snapshotGeneratedDirectoryEntries(
  directory: string,
  allowedNames: ReadonlySet<string>,
): { directoryIdentity: fs.Stats; files: RegularFileSnapshot[] } | null {
  try {
    const directoryStat = fs.lstatSync(
      /* turbopackIgnore: true */ directory,
    );
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      return null;
    }
    const names = fs.readdirSync(/* turbopackIgnore: true */ directory);
    if (names.some((name) => !allowedNames.has(name))) return null;
    const files = names.map((name) =>
      snapshotRegularFile(path.join(directory, name)),
    );
    const verifiedDirectory = fs.lstatSync(
      /* turbopackIgnore: true */ directory,
    );
    if (!sameDirectoryIdentity(directoryStat, verifiedDirectory)) return null;
    return { directoryIdentity: directoryStat, files };
  } catch {
    return null;
  }
}

function removeGeneratedDirectoryIfSafe(
  directory: string,
  allowedNames: ReadonlySet<string>,
): boolean {
  const generated = snapshotGeneratedDirectoryEntries(directory, allowedNames);
  if (!generated) return false;
  for (const file of generated.files) {
    if (!removeSnapshottedFile(file)) return false;
  }
  try {
    const current = fs.lstatSync(/* turbopackIgnore: true */ directory);
    if (!sameDirectoryIdentity(current, generated.directoryIdentity)) {
      return false;
    }
    fs.rmdirSync(/* turbopackIgnore: true */ directory);
    return true;
  } catch {
    return false;
  }
}

const CHECKPOINT_UNIT_FILES = new Set([
  CHECKPOINT_PATCH_FILE,
  CHECKPOINT_METADATA_FILE,
]);

export function retireCheckpointQuarantine(
  store: CheckpointStore,
  quarantine: string,
  hasMetadata: boolean,
): void {
  assertCheckpointStore(store);
  assertDirectStoreChildPath(store, quarantine);
  const generated = snapshotGeneratedDirectoryEntries(
    quarantine,
    CHECKPOINT_UNIT_FILES,
  );
  const expected = hasMetadata
    ? [CHECKPOINT_METADATA_FILE, CHECKPOINT_PATCH_FILE].sort()
    : [CHECKPOINT_PATCH_FILE];
  if (
    !generated ||
    generated.files.map((file) => path.basename(file.pathname)).sort().join("\0") !==
      expected.join("\0")
  ) {
    throw new Error("checkpoint quarantine changed before retirement");
  }
  const purge = directStoreChild(
    store,
    `.purge-${randomBytes(12).toString("hex")}.tmp`,
  );
  fs.renameSync(
    /* turbopackIgnore: true */ quarantine,
    /* turbopackIgnore: true */ purge,
  );
  fsyncDirectoryIfSupported(store.directory);
  const moved = snapshotGeneratedDirectoryEntries(
    purge,
    CHECKPOINT_UNIT_FILES,
  );
  if (
    !moved ||
    !sameDirectoryIdentity(
      moved.directoryIdentity,
      generated.directoryIdentity,
    ) ||
    moved.files.length !== generated.files.length ||
    moved.files.some((file) => {
      const prior = generated.files.find(
        (candidate) =>
          path.basename(candidate.pathname) === path.basename(file.pathname),
      );
      return !prior || !prior.contents.equals(file.contents);
    })
  ) {
    try {
      writeDurableExclusiveFile(
        path.join(purge, QUARANTINE_CONFLICT_FILE),
        `${JSON.stringify({
          version: 1,
          recoverable: false,
          reason: "quarantine-changed-during-retirement",
        })}\n`,
      );
      fsyncDirectoryIfSupported(purge);
      fsyncDirectoryIfSupported(store.directory);
    } catch {
      // Preserve the renamed bundle even when the proof marker cannot be added.
    }
    throw new Error("checkpoint quarantine changed during retirement");
  }
  if (removeGeneratedDirectoryIfSafe(purge, CHECKPOINT_UNIT_FILES)) {
    fsyncDirectoryIfSupported(store.directory);
  }
}

function completeDirectorySnapshotsEqual(
  left: CompleteDirectorySnapshot,
  right: CompleteDirectorySnapshot,
): boolean {
  return (
    left.patch.contents.equals(right.patch.contents) &&
    left.metadata.contents.equals(right.metadata.contents)
  );
}

function cleanupQuarantineMatchingDestination(
  store: CheckpointStore,
  quarantine: string,
  destination: CompleteDirectorySnapshot,
): boolean {
  const generated = snapshotGeneratedDirectoryEntries(
    quarantine,
    CHECKPOINT_UNIT_FILES,
  );
  if (
    !generated ||
    generated.files.length !== CHECKPOINT_UNIT_FILES.size ||
    generated.files.some(
      (file) => !CHECKPOINT_UNIT_FILES.has(path.basename(file.pathname)),
    )
  ) {
    return false;
  }
  for (const file of generated.files) {
    const expected = path.basename(file.pathname) === CHECKPOINT_PATCH_FILE
      ? destination.patch
      : destination.metadata;
    if (!file.contents.equals(expected.contents)) return false;
  }
  try {
    retireCheckpointQuarantine(store, quarantine, true);
    return true;
  } catch {
    return false;
  }
}

function metadataIsJson(raw: string): boolean {
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

export function restoreCheckpointDirectoryQuarantineNoReplace(
  store: CheckpointStore,
  quarantine: string,
  destination: string,
  validateMetadata: (raw: string) => boolean = metadataIsJson,
  options: {
    restorationStage?: (
      stage:
        | "staged-patch-synced"
        | "staged-metadata-synced"
        | "staging-directory-synced"
        | DirectoryInstallationStage
        | "destination-renamed"
        | "store-directory-synced",
    ) => void;
  } = {},
): boolean {
  assertCheckpointStore(store);
  assertDirectStoreChildPath(store, quarantine);
  assertDirectStoreChildPath(store, destination);
  const source = snapshotCompleteDirectoryUnit(quarantine, validateMetadata);
  if (!source) return false;
  if (fileExists(destination)) {
    const published = snapshotCompleteDirectoryUnit(
      destination,
      validateMetadata,
    );
    if (!published || !completeDirectorySnapshotsEqual(source, published)) {
      return false;
    }
    if (cleanupQuarantineMatchingDestination(store, quarantine, published)) {
      fsyncDirectoryIfSupported(store.directory);
    }
    return true;
  }
  const staging = directStoreChild(
    store,
    `.restore-directory-${path.basename(destination)}-` +
      `${randomBytes(12).toString("hex")}.tmp`,
  );
  try {
    fs.mkdirSync(/* turbopackIgnore: true */ staging, { mode: 0o700 });
  } catch {
    return false;
  }

  let published = false;
  try {
    writeDurableExclusiveFile(
      path.join(staging, CHECKPOINT_PATCH_FILE),
      source.patch.contents,
    );
    options.restorationStage?.("staged-patch-synced");
    writeDurableExclusiveFile(
      path.join(staging, CHECKPOINT_METADATA_FILE),
      source.metadata.contents,
    );
    options.restorationStage?.("staged-metadata-synced");
    fsyncDirectoryIfSupported(staging);
    options.restorationStage?.("staging-directory-synced");

    const verifiedSource = snapshotCompleteDirectoryUnit(
      quarantine,
      validateMetadata,
    );
    const verifiedStaging = snapshotCompleteDirectoryUnit(
      staging,
      validateMetadata,
    );
    if (
      !verifiedSource ||
      !verifiedStaging ||
      !sameDirectoryIdentity(
        source.directoryIdentity,
        verifiedSource.directoryIdentity,
      ) ||
      !completeDirectorySnapshotsEqual(source, verifiedSource) ||
      !completeDirectorySnapshotsEqual(source, verifiedStaging)
    ) {
      throw new Error("checkpoint quarantine changed during staging");
    }
    assertCheckpointStore(store);
    if (
      !installCheckpointDirectoryNoReplace(
        store,
        staging,
        destination,
        validateMetadata,
        options.restorationStage,
      )
    ) {
      return false;
    }
    published = true;
    options.restorationStage?.("destination-renamed");
    options.restorationStage?.("store-directory-synced");
    const publishedUnit = snapshotCompleteDirectoryUnit(
      destination,
      validateMetadata,
    );
    if (
      !publishedUnit ||
      !completeDirectorySnapshotsEqual(source, publishedUnit)
    ) {
      throw new Error("published checkpoint failed verification");
    }
    if (cleanupQuarantineMatchingDestination(store, quarantine, publishedUnit)) {
      fsyncDirectoryIfSupported(store.directory);
    }
    return true;
  } catch {
    return published;
  } finally {
    if (!published && fileExists(staging)) {
      removeGeneratedDirectoryIfSafe(staging, CHECKPOINT_UNIT_FILES);
    }
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
  validateMetadata: (raw: string) => boolean,
): boolean {
  assertCheckpointStore(store);
  if (hasMetadata) {
    return restoreCheckpointDirectoryQuarantineNoReplace(
      store,
      quarantine,
      destination,
      validateMetadata,
    );
  }
  const installed: InstalledFile[] = [];
  let destinationDurable = false;
  try {
    const patch = installRegularFileNoReplace(
      path.join(quarantine, CHECKPOINT_PATCH_FILE),
      destination,
    );
    if (!patch) return false;
    installed.push(patch);
    assertCheckpointStore(store);
    fsyncDirectoryIfSupported(store.directory);
    destinationDurable = true;
    retireCheckpointQuarantine(store, quarantine, false);
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

type LegacyReservation = {
  version: 1;
  token: string;
  targetName: string;
  patchTempName: string;
  metadataTempName: string;
  patchSha256: string;
  metadataSha256: string;
};

function parseLegacyReservation(
  name: string,
  raw: string,
): LegacyReservation | null {
  const match = LEGACY_RESERVATION.exec(name);
  if (!match) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LegacyReservation>;
    if (
      parsed.version !== 1 ||
      parsed.token !== match[1] ||
      !CHECKPOINT_NAME.test(parsed.targetName ?? "") ||
      parsed.patchTempName !== `.publish-${match[1]}.patch.tmp` ||
      parsed.metadataTempName !== `.publish-${match[1]}.scope.tmp` ||
      typeof parsed.patchSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.patchSha256) ||
      typeof parsed.metadataSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.metadataSha256)
    ) {
      return null;
    }
    return parsed as LegacyReservation;
  } catch {
    return null;
  }
}

function recoverAssociatedLegacyReservation(
  store: CheckpointStore,
  reservationName: string,
  validateMetadata: (raw: string) => boolean,
): void {
  const reservationPath = directStoreChild(store, reservationName);
  const reservationSnapshot = snapshotRegularFile(reservationPath);
  const reservation = parseLegacyReservation(
    reservationName,
    reservationSnapshot.contents.toString("utf8"),
  );
  if (!reservation) return;
  const target = directStoreChild(store, reservation.targetName);
  const patchTemp = directStoreChild(store, reservation.patchTempName);
  const metadataTemp = directStoreChild(
    store,
    reservation.metadataTempName,
  );
  const recoveryStage = directStoreChild(
    store,
    `.legacy-stage-${reservation.token}.tmp`,
  );
  if (!LEGACY_RECOVERY_STAGE.test(path.basename(recoveryStage))) return;
  const readOptionalSource = (
    pathname: string,
    expectedSha256: string,
  ): RegularFileSnapshot | null | "conflict" => {
    if (!fileExists(pathname)) return null;
    const snapshot = matchingRegularFile(pathname, expectedSha256);
    return snapshot ?? "conflict";
  };
  const patchSource = readOptionalSource(
    patchTemp,
    reservation.patchSha256,
  );
  const metadataSource = readOptionalSource(
    metadataTemp,
    reservation.metadataSha256,
  );
  if (
    patchSource === "conflict" ||
    metadataSource === "conflict" ||
    (metadataSource &&
      !validateMetadata(metadataSource.contents.toString("utf8")))
  ) {
    return;
  }
  let published = snapshotCompleteDirectoryUnit(target, validateMetadata);
  if (
    published &&
    (sha256(published.patch.contents) !== reservation.patchSha256 ||
      sha256(published.metadata.contents) !== reservation.metadataSha256)
  ) {
    return;
  }
  if (!published) {
    let stage = snapshotCompleteDirectoryUnit(
      recoveryStage,
      validateMetadata,
    );
    if (
      stage &&
      (sha256(stage.patch.contents) !== reservation.patchSha256 ||
        sha256(stage.metadata.contents) !== reservation.metadataSha256)
    ) {
      return;
    }
    if (!stage) {
      if (!patchSource || !metadataSource) return;
      try {
        if (!fileExists(recoveryStage)) {
          fs.mkdirSync(/* turbopackIgnore: true */ recoveryStage, {
            mode: 0o700,
          });
          fsyncDirectoryIfSupported(store.directory);
        }
        const partial = snapshotGeneratedDirectoryEntries(
          recoveryStage,
          CHECKPOINT_UNIT_FILES,
        );
        if (!partial) return;
        const stagedPatch = partial.files.find(
          (file) => path.basename(file.pathname) === CHECKPOINT_PATCH_FILE,
        );
        const stagedMetadata = partial.files.find(
          (file) => path.basename(file.pathname) === CHECKPOINT_METADATA_FILE,
        );
        if (
          (stagedPatch &&
            sha256(stagedPatch.contents) !== reservation.patchSha256) ||
          (stagedMetadata &&
            (sha256(stagedMetadata.contents) !== reservation.metadataSha256 ||
              !validateMetadata(stagedMetadata.contents.toString("utf8"))))
        ) {
          return;
        }
        if (!stagedPatch) {
          writeDurableExclusiveFile(
            path.join(recoveryStage, CHECKPOINT_PATCH_FILE),
            patchSource.contents,
          );
        }
        if (!stagedMetadata) {
          writeDurableExclusiveFile(
            path.join(recoveryStage, CHECKPOINT_METADATA_FILE),
            metadataSource.contents,
          );
        }
        fsyncDirectoryIfSupported(recoveryStage);
        fsyncDirectoryIfSupported(store.directory);
      } catch {
        return;
      }
      stage = snapshotCompleteDirectoryUnit(
        recoveryStage,
        validateMetadata,
      );
      if (!stage) return;
    }
    try {
      if (
        !installCheckpointDirectoryNoReplace(
          store,
          recoveryStage,
          target,
          validateMetadata,
        )
      ) {
        return;
      }
    } catch {
      return;
    }
    published = snapshotCompleteDirectoryUnit(target, validateMetadata);
    if (
      !published ||
      sha256(published.patch.contents) !== reservation.patchSha256 ||
      sha256(published.metadata.contents) !== reservation.metadataSha256
    ) {
      return;
    }
  }

  for (const source of [patchSource, metadataSource]) {
    if (source && !removeSnapshottedFile(source)) {
      return;
    }
  }
  if (fileExists(patchTemp) || fileExists(metadataTemp)) return;
  const currentReservation = snapshotRegularFile(reservationPath);
  if (
    !currentReservation.contents.equals(reservationSnapshot.contents) ||
    !removeSnapshottedFile(currentReservation)
  ) {
    return;
  }
  fsyncDirectoryIfSupported(store.directory);
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
    if (!CHECKPOINT_NAME.test(name)) continue;
    const destination = directStoreChild(store, name);
    let destinationInfo: fs.Stats;
    try {
      destinationInfo = fs.lstatSync(
        /* turbopackIgnore: true */ destination,
      );
    } catch {
      continue;
    }
    if (
      destinationInfo.isSymbolicLink() ||
      !destinationInfo.isDirectory()
    ) {
      continue;
    }
    if (
      !fileExists(path.join(destination, DIRECTORY_RESERVATION_FILE))
    ) {
      continue;
    }
    try {
      recoverReservedCheckpointDirectory(
        store,
        destination,
        validateMetadata,
      );
    } catch {
      // An identity-marked destination remains unavailable until the next
      // locked recovery can prove and complete it.
    }
  }

  for (const name of fs.readdirSync(store.directory)) {
    if (!PURGE_DIRECTORY.test(name)) continue;
    if (purgeReferencedByReservedDestination(store, name)) continue;
    const purge = directStoreChild(store, name);
    if (removeGeneratedDirectoryIfSafe(purge, CHECKPOINT_UNIT_FILES)) {
      fsyncDirectoryIfSupported(store.directory);
    }
  }

  for (const name of names) {
    if (!RESTORE_DIRECTORY_STAGING.test(name)) continue;
    assertCheckpointStore(store);
    const staging = directStoreChild(store, name);
    if (removeGeneratedDirectoryIfSafe(staging, CHECKPOINT_UNIT_FILES)) {
      fsyncDirectoryIfSupported(store.directory);
    }
  }

  for (const name of names) {
    assertCheckpointStore(store);
    const quarantineMatch = DELETE_QUARANTINE.exec(name);
    if (!quarantineMatch) continue;
    const [, format, checkpointName] = quarantineMatch;
    if (!CHECKPOINT_NAME.test(checkpointName)) continue;
    const quarantine = directStoreChild(store, name);
    const destination = directStoreChild(store, checkpointName);
    if (format === "directory") {
      const complete = snapshotCompleteDirectoryUnit(
        quarantine,
        validateMetadata,
      );
      if (!complete) {
        const published = snapshotCompleteDirectoryUnit(
          destination,
          validateMetadata,
        );
        if (
          published &&
          cleanupQuarantineMatchingDestination(store, quarantine, published)
        ) {
          fsyncDirectoryIfSupported(store.directory);
        }
        continue;
      }
      restoreCheckpointDirectoryQuarantineNoReplace(
        store,
        quarantine,
        destination,
        validateMetadata,
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
        validateMetadata,
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
        if (removeGeneratedDirectoryIfSafe(draft, CHECKPOINT_UNIT_FILES)) {
          fsyncDirectoryIfSupported(store.directory);
        }
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
      assertCheckpointStore(store);
      try {
        if (
          installCheckpointDirectoryNoReplace(
            store,
            draft,
            destination,
            validateMetadata,
          )
        ) {
          break;
        }
        continue;
      } catch (error) {
        // A complete draft remains available for the next locked recovery.
        break;
      }
    }
  }

  assertCheckpointStore(store);
  for (const reservation of fs.readdirSync(store.directory)) {
    if (!LEGACY_RESERVATION.test(reservation)) continue;
    try {
      recoverAssociatedLegacyReservation(
        store,
        reservation,
        validateMetadata,
      );
    } catch {
      // Ambiguous, incomplete, or interrupted reservations remain intact.
    }
  }
}
