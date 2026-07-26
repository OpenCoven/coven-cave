import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
await writeFile(path.join(sourceHome, "coven.sqlite3"), "db should not travel");
await writeFile(path.join(sourceHome, "workspaces", "repo", "code.ts"), "workspace should not travel");

const {
  buildBackupArchive,
  decryptBackupArchive,
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

const decrypted = await decryptBackupArchive(archive, passphrase);
assert.equal(decrypted.manifest.totals.files, decrypted.files.length, "round-trip decrypt returns every manifest file");

const restoreHome = path.join(root, "restore", ".coven");
process.env.COVEN_HOME = restoreHome;
await restoreBackupArchive(archive, passphrase);
assert.equal(await readFile(path.join(restoreHome, "cave", "conversations", "chat-1.json"), "utf8"), JSON.stringify({ sessionId: "chat-1", text: "private chat" }));
assert.equal((await readFile(path.join(restoreHome, "cave", "local-vault.key"), "utf8")).trim(), Buffer.alloc(32, 7).toString("base64"));

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

await rm(root, { recursive: true, force: true });
console.log("backup-archive.test.ts: ok");
