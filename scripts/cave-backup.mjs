#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const usage = `Usage:
  COVEN_BACKUP_PASSPHRASE=... node scripts/cave-backup.mjs export [output.ccbackup] [--url http://127.0.0.1:3000]
  COVEN_BACKUP_PASSPHRASE=... node scripts/cave-backup.mjs restore <input.ccbackup> [--url http://127.0.0.1:3000]

The script calls the local Cave API. It never accepts passphrases on argv so they do not land in shell history.`;

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const command = process.argv[2];
const apiUrl = (argValue("--url") || process.env.COVEN_CAVE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const passphrase = process.env.COVEN_BACKUP_PASSPHRASE || "";
if (!passphrase) {
  console.error("COVEN_BACKUP_PASSPHRASE is required.\n" + usage);
  process.exit(2);
}

async function postJson(route, body) {
  const res = await fetch(`${apiUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${route} failed (${res.status}): ${text}`);
  }
  return res;
}

if (command === "export") {
  const output = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : `coven-cave-backup-${new Date().toISOString().slice(0, 10)}.ccbackup`;
  const res = await postJson("/api/backup/export", { passphrase });
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(path.resolve(output), bytes, { mode: 0o600 });
  console.log(`Wrote ${output} (${bytes.byteLength} bytes)`);
} else if (command === "restore") {
  const input = process.argv[3];
  if (!input || input.startsWith("--")) {
    console.error(usage);
    process.exit(2);
  }
  const archiveBase64 = (await readFile(path.resolve(input))).toString("base64");
  const res = await postJson("/api/backup/restore", { passphrase, archiveBase64 });
  const json = await res.json();
  console.log(`Restored ${json.restored?.length ?? 0} files from backup created ${json.manifest?.createdAt ?? "unknown"}`);
} else {
  console.error(usage);
  process.exit(2);
}
