import assert from "node:assert/strict";
import { link, lstat, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), "artifacts", "backup-archive-test");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });

const sourceHome = path.join(root, "source", ".coven");
process.env.COVEN_HOME = sourceHome;
delete process.env.COVEN_CAVE_HOME;

await mkdir(path.join(sourceHome, "cave", "conversations"), { recursive: true });
await mkdir(path.join(sourceHome, "journal"), { recursive: true });
await mkdir(path.join(sourceHome, "workspaces", "repo"), { recursive: true });
await writeFile(path.join(sourceHome, "cave", "config.json"), JSON.stringify({ multiHost: { mode: "local" } }));
await writeFile(path.join(sourceHome, "cave", "conversations", "chat-1.json"), JSON.stringify({ sessionId: "chat-1", text: "private chat" }));
await writeFile(path.join(sourceHome, "journal", "entry.md"), "# Journal\n");
await writeFile(path.join(sourceHome, "cave", "local-vault.key"), `${Buffer.alloc(32, 7).toString("base64")}\n`);
await writeFile(path.join(sourceHome, "cave", "local-vault.enc.json"), JSON.stringify({ version: 1, secrets: { GH_TOKEN: { ciphertext: "encrypted-token" } } }));
await writeFile(path.join(sourceHome, "cave", ".env.local"), "SECRET_SHOULD_NOT_APPEAR=plaintext\n");
await mkdir(path.join(sourceHome, "cave", "research-resources", "manifests"), { recursive: true });
await mkdir(path.join(sourceHome, "cave", "research-resources", "jobs"), { recursive: true });
await mkdir(path.join(sourceHome, "cave", "research-resources", "index"), { recursive: true });
await writeFile(path.join(sourceHome, "cave", "research-resources", "manifests", "resource.json"), "authoritative private resource");
await writeFile(path.join(sourceHome, "cave", "research-resources", "jobs", "job.json"), "operational private job");
await writeFile(path.join(sourceHome, "cave", "research-resources", "index", "research-resources.sqlite"), "derivative plaintext");
await writeFile(path.join(sourceHome, "coven.sqlite3"), "db should not travel");
await writeFile(path.join(sourceHome, "workspaces", "repo", "code.ts"), "workspace should not travel");

const {
  buildBackupArchive,
  decryptBackupArchive,
  encryptBackupPlaintextForTest,
  restoreBackupArchive,
  validateArchivePlaintext,
} = await import("./backup-archive.ts");

const passphrase = "correct horse battery staple";
const { archive, manifest } = await buildBackupArchive(passphrase);
const archiveText = archive.toString("utf8");
assert.equal(archiveText.includes("SECRET_SHOULD_NOT_APPEAR"), false, "plaintext .env secret is encrypted inside the envelope");
assert.equal(archiveText.includes(Buffer.alloc(32, 7).toString("base64")), false, "vault key is not plaintext in the archive");
assert.ok(manifest.entries.some((entry) => entry.path === "local-vault.key" && entry.secret), "manifest marks the passphrase-wrapped vault key as secret");
assert.ok(manifest.entries.some((entry) => entry.path === "conversations/chat-1.json"), "manifest includes conversations");
assert.equal(manifest.entries.some((entry) => entry.path.includes("coven.sqlite3")), false, "daemon DB is excluded");
assert.equal(manifest.entries.some((entry) => entry.path.startsWith("workspaces/")), false, "workspaces are excluded");
assert.ok(manifest.entries.some((entry) => entry.path === "research-resources/manifests/resource.json"), "authoritative Research records are included");
assert.equal(manifest.entries.some((entry) => entry.path.startsWith("research-resources/jobs/")), false, "Research jobs are reconstructed");
assert.equal(manifest.entries.some((entry) => entry.path.startsWith("research-resources/index/")), false, "Research lexical plaintext is excluded");

const decrypted = await decryptBackupArchive(archive, passphrase);
assert.equal(decrypted.manifest.totals.files, decrypted.files.length, "round-trip decrypt returns every manifest file");

const malformedHome = path.join(root, "malformed-restore", ".coven");
await mkdir(path.join(malformedHome, "cave"), { recursive: true });
const malformedSentinel = path.join(malformedHome, "cave", "config.json");
await writeFile(malformedSentinel, "must remain unchanged");
const malformedArchive = await encryptBackupPlaintextForTest({
  ...decrypted,
  manifest: { ...decrypted.manifest, excluded: undefined as unknown as string[] },
}, passphrase);
process.env.COVEN_HOME = malformedHome;
await assert.rejects(
  () => restoreBackupArchive(malformedArchive, passphrase),
  /manifest exclusions are invalid/,
  "an authenticated malformed A8 manifest is rejected",
);
assert.equal(
  await readFile(malformedSentinel, "utf8"),
  "must remain unchanged",
  "full authenticated manifest validation completes before the first restore write",
);

if (process.platform !== "win32") {
  process.env.COVEN_HOME = sourceHome;
  const sourceManifest = path.join(sourceHome, "cave", "research-resources", "manifests", "resource.json");
  const outsideSource = path.join(root, "scan-read-swap.txt");
  await writeFile(outsideSource, "must never enter the archive");
  let swapped = false;
  await assert.rejects(
    () => buildBackupArchive(passphrase, {
      beforeSourceRead: async (file) => {
        if (file.rel !== "research-resources/manifests/resource.json") return;
        swapped = true;
        await rm(sourceManifest);
        await symlink(outsideSource, sourceManifest);
      },
    }),
    /ELOOP|changed before it could be read safely/,
    "a Research source swapped after enumeration is never followed",
  );
  assert.equal(swapped, true);
  await rm(sourceManifest);
  await writeFile(sourceManifest, "authoritative private resource");

  const manifestsDirectory = path.dirname(sourceManifest);
  const movedManifestsDirectory = path.join(root, "moved-research-manifests");
  let ancestorSwapped = false;
  await assert.rejects(
    () => buildBackupArchive(passphrase, {
      beforeSourceRead: async (file) => {
        if (ancestorSwapped || file.rel !== "research-resources/manifests/resource.json") return;
        await rename(manifestsDirectory, movedManifestsDirectory);
        await symlink(movedManifestsDirectory, manifestsDirectory);
        ancestorSwapped = true;
      },
    }),
    /Research backup directory identity changed/,
    "a Research ancestor swapped to a symlink after enumeration is never followed",
  );
  assert.equal(ancestorSwapped, true);
  await rm(manifestsDirectory);
  await rename(movedManifestsDirectory, manifestsDirectory);
}

const restoreHome = path.join(root, "restore", ".coven");
process.env.COVEN_HOME = restoreHome;
const staleRestoreAuthority = path.join(
  restoreHome,
  "cave",
  "research-resources",
  "manifests",
  "stale-directory",
  "stale.json",
);
await mkdir(path.dirname(staleRestoreAuthority), { recursive: true, mode: 0o700 });
await writeFile(staleRestoreAuthority, "stale restore authority", { mode: 0o600 });
let recoveryCalls = 0;
const durability: Array<{ operation: string; target: string }> = [];
await restoreBackupArchive(archive, passphrase, {
  researchDurabilityObserver: (operation, target) => {
    durability.push({ operation, target });
  },
  reconcileResearch: async (researchRoot) => {
    recoveryCalls += 1;
    assert.equal(
      await readFile(path.join(researchRoot, "manifests", "resource.json"), "utf8"),
      "authoritative private resource",
      "recovery starts only after authoritative files land",
    );
    return {
      projectionReconciled: true,
      tombstoneFencesRepaired: 0,
      jobsRecreated: 0,
      lexicalRebuilt: true,
      contextPacksValidated: 0,
      contextPacksInvalid: 0,
    };
  },
});
assert.equal(recoveryCalls, 1);
assert.equal(await readFile(path.join(restoreHome, "cave", "conversations", "chat-1.json"), "utf8"), JSON.stringify({ sessionId: "chat-1", text: "private chat" }));
assert.equal((await readFile(path.join(restoreHome, "cave", "local-vault.key"), "utf8")).trim(), Buffer.alloc(32, 7).toString("base64"));
const restoredResearchManifest = path.join(
  restoreHome,
  "cave",
  "research-resources",
  "manifests",
  "resource.json",
);
const renameIndex = durability.findIndex((entry) =>
  entry.operation === "renamed" && entry.target === restoredResearchManifest);
assert.ok(renameIndex >= 2, "the authoritative Research file was durably renamed");
assert.equal(durability[renameIndex - 2]?.operation, "file-written");
assert.equal(durability[renameIndex - 1]?.operation, "file-fsynced");
assert.deepEqual(durability[renameIndex + 1], {
  operation: "directory-fsynced",
  target: path.dirname(restoredResearchManifest),
});
const staleUnlink = durability.findIndex((entry) =>
  entry.operation === "unlinked" && entry.target === staleRestoreAuthority);
assert.ok(staleUnlink >= 0, "stale authoritative state is pruned");
assert.deepEqual(durability[staleUnlink + 1], {
  operation: "directory-fsynced",
  target: path.dirname(staleRestoreAuthority),
});
const staleDirectory = path.dirname(staleRestoreAuthority);
const staleDirectoryRemoval = durability.findIndex((entry) =>
  entry.operation === "directory-removed" && entry.target === staleDirectory);
assert.ok(staleDirectoryRemoval >= 0, "empty stale authority directories are removed");
assert.deepEqual(durability[staleDirectoryRemoval + 1], {
  operation: "directory-fsynced",
  target: path.dirname(staleDirectory),
});
const restoreMarker = path.join(
  restoreHome,
  "cave",
  "research-resources",
  "index",
  ".restore-in-progress",
);
const markerUnlink = durability.findIndex((entry) =>
  entry.operation === "unlinked" && entry.target === restoreMarker);
assert.ok(markerUnlink >= 0, "successful recovery durably removes its marker");
assert.deepEqual(durability[markerUnlink + 1], {
  operation: "directory-fsynced",
  target: path.dirname(restoreMarker),
});

if (process.platform !== "win32") {
  const unsafeHome = path.join(root, "unsafe-restore", ".coven");
  const outside = path.join(root, "outside-research");
  await mkdir(path.join(unsafeHome, "cave"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await symlink(outside, path.join(unsafeHome, "cave", "research-resources"));
  process.env.COVEN_HOME = unsafeHome;
  await assert.rejects(
    () => restoreBackupArchive(archive, passphrase, {
      reconcileResearch: async () => assert.fail("unsafe destination must fail before recovery"),
    }),
    /restore directory is unsafe|store root directory is a symlink/,
  );
  await assert.rejects(
    () => readFile(path.join(outside, "manifests", "resource.json")),
    /ENOENT/,
    "a symlinked Research root cannot redirect private archive bytes",
  );
}

await assert.rejects(
  () => decryptBackupArchive(Buffer.from(archive.subarray(0, archive.length - 12)), passphrase),
  /decrypted|ciphertext|header|version|payload/,
  "partial archives are rejected",
);

const corrupt = Buffer.from(archive);
corrupt[corrupt.length - 4] = corrupt[corrupt.length - 4] ^ 1;
await assert.rejects(
  () => decryptBackupArchive(corrupt, passphrase),
  /decrypted/,
  "corrupt archives are rejected by AES-GCM authentication",
);

assert.throws(
  () => validateArchivePlaintext({
    ...decrypted,
    files: [{ ...decrypted.files[0], path: "../escape" }],
  }),
  /path not allowed|path is invalid|manifest does not match payload/,
  "restore validation rejects traversal paths",
);

// Durable attachment references must still resolve after restoring history.
const attachmentHome = path.join(root, "attachment-source", ".coven");
const attachmentDirectory = path.join(attachmentHome, "cave", "chat-attachments");
const attachmentId = "11111111-1111-4111-8111-111111111111.png";
const attachmentBytes = Buffer.from([0, 255, 1, 13, 10, 128, 42, 0]);
const attachmentConversation = JSON.stringify({
  sessionId: "attachment-chat", familiarId: "fixture", harness: "claude",
  turns: [{ role: "user", attachments: [{ storedId: attachmentId, mimeType: "image/png" }] }],
});
await mkdir(attachmentDirectory, { recursive: true });
await mkdir(path.join(attachmentHome, "cave", "conversations"), { recursive: true });
await writeFile(path.join(attachmentDirectory, attachmentId), attachmentBytes);
await writeFile(path.join(attachmentHome, "cave", "conversations", "attachment-chat.json"), attachmentConversation);
process.env.COVEN_HOME = attachmentHome;
const attachmentBackup = await buildBackupArchive(passphrase);
assert.ok(attachmentBackup.manifest.entries.some((entry) => entry.root === "cave" && entry.path === `chat-attachments/${attachmentId}`), "a backed-up transcript's durable attachment bytes are included");
const attachmentPlaintext = await decryptBackupArchive(attachmentBackup.archive, passphrase);
assert.deepEqual(Buffer.from(attachmentPlaintext.files.find((file) => file.path === `chat-attachments/${attachmentId}`)!.data, "base64"), attachmentBytes);
const attachmentRestoreHome = path.join(root, "attachment-restore", ".coven");
process.env.COVEN_HOME = attachmentRestoreHome;
for (let repeat = 0; repeat < 2; repeat++) {
  await restoreBackupArchive(attachmentBackup.archive, passphrase);
  assert.deepEqual(await readFile(path.join(attachmentRestoreHome, "cave", "chat-attachments", attachmentId)), attachmentBytes);
  assert.equal(await readFile(path.join(attachmentRestoreHome, "cave", "conversations", "attachment-chat.json"), "utf8"), attachmentConversation);
}
if (process.platform !== "win32") {
  assert.equal((await lstat(path.join(attachmentRestoreHome, "cave", "chat-attachments"))).mode & 0o777, 0o700);
  assert.equal((await lstat(path.join(attachmentRestoreHome, "cave", "chat-attachments", attachmentId))).mode & 0o777, 0o600);
  process.env.COVEN_HOME = attachmentHome;
  const outsideAttachment = path.join(root, "outside-attachment.txt");
  const outsideBytes = "outside private bytes must stay outside";
  await writeFile(outsideAttachment, outsideBytes);
  const unsafeAttachment = path.join(attachmentDirectory, "22222222-2222-4222-8222-222222222222.txt");
  await symlink(outsideAttachment, unsafeAttachment);
  await assert.rejects(() => buildBackupArchive(passphrase), /Chat attachment backup entry is unsafe/, "attachment backup never follows a linked file");
  await rm(unsafeAttachment);
  await link(outsideAttachment, unsafeAttachment);
  await assert.rejects(() => buildBackupArchive(passphrase), /Chat attachment backup entry is unsafe/, "attachment backup never admits a hard-linked file");
  await rm(unsafeAttachment);
  const movedAttachments = path.join(root, "moved-attachment-store");
  await rename(attachmentDirectory, movedAttachments);
  await symlink(movedAttachments, attachmentDirectory);
  await assert.rejects(() => buildBackupArchive(passphrase), /Chat attachment backup path is unsafe/, "a linked attachment root is refused");
  await rm(attachmentDirectory);
  await rename(movedAttachments, attachmentDirectory);
  let attachmentSwapped = false;
  await assert.rejects(() => buildBackupArchive(passphrase, {
    beforeSourceRead: async (file) => {
      if (file.rel !== `chat-attachments/${attachmentId}`) return;
      attachmentSwapped = true;
      await rm(path.join(attachmentDirectory, attachmentId));
      await symlink(outsideAttachment, path.join(attachmentDirectory, attachmentId));
    },
  }), /ELOOP|Chat attachment backup entry changed/, "an attachment swapped after enumeration cannot leak outside bytes");
  assert.equal(attachmentSwapped, true);
  await rm(path.join(attachmentDirectory, attachmentId));
  await writeFile(path.join(attachmentDirectory, attachmentId), attachmentBytes);
  let ancestorSwapped = false;
  await assert.rejects(() => buildBackupArchive(passphrase, {
    beforeSourceRead: async (file) => {
      if (ancestorSwapped || file.rel !== `chat-attachments/${attachmentId}`) return;
      await rename(attachmentDirectory, movedAttachments);
      await symlink(movedAttachments, attachmentDirectory);
      ancestorSwapped = true;
    },
  }), /Chat attachment backup directory identity changed/, "an attachment ancestor swap is refused");
  assert.equal(ancestorSwapped, true);
  await rm(attachmentDirectory);
  await rename(movedAttachments, attachmentDirectory);
  const unsafeAttachmentRestore = path.join(root, "unsafe-attachment-restore", ".coven");
  const outsideAttachmentDirectory = path.join(root, "outside-attachment-directory");
  await mkdir(path.join(unsafeAttachmentRestore, "cave"), { recursive: true });
  await mkdir(outsideAttachmentDirectory);
  await symlink(outsideAttachmentDirectory, path.join(unsafeAttachmentRestore, "cave", "chat-attachments"));
  process.env.COVEN_HOME = unsafeAttachmentRestore;
  await assert.rejects(() => restoreBackupArchive(attachmentBackup.archive, passphrase), /Chat attachment backup restore directory is unsafe/, "a linked destination cannot redirect restored attachment bytes");
  await assert.rejects(() => readFile(path.join(outsideAttachmentDirectory, attachmentId)), /ENOENT/);
  assert.equal(await readFile(outsideAttachment, "utf8"), outsideBytes);
}

await rm(root, { recursive: true, force: true });
console.log("backup-archive.test.ts: ok");
