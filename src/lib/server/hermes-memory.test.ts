import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  isHermesMemoryUri,
  listHermesMemory,
  readHermesMemory,
} from "./hermes-memory.ts";

async function fixtureHome(): Promise<string> {
  const root = await mkdtemp(path.join(process.cwd(), ".tmp-hermes-memory-"));
  const hermes = path.join(root, ".hermes");
  await mkdir(hermes, { recursive: true });
  const database = new DatabaseSync(path.join(hermes, "state.db"));
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      display_name TEXT,
      title TEXT,
      cwd TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      timestamp REAL NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      compacted INTEGER NOT NULL DEFAULT 0
    );
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='id'
    );
    CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
    INSERT INTO sessions(id, source, display_name, title, cwd)
      VALUES ('session-1', 'cli', 'CLI session', 'Bridge design', '/project');
    INSERT INTO messages(session_id, role, content, timestamp, active, compacted)
      VALUES
        ('session-1', 'user', 'Remember the violet launch checklist', 1_700_000_000, 1, 0),
        ('session-1', 'assistant', 'The amber deployment note is archived', 1_700_000_100, 1, 0),
        ('session-1', 'assistant', 'This rewound memory must stay hidden', 1_700_000_200, 0, 0);
  `);
  database.close();
  return root;
}

function bridgeOptions(homeDir: string) {
  return {
    hermesHome: path.join(homeDir, ".hermes"),
    familiarId: "cody",
  };
}

test("lists recent active Hermes messages without modifying the database", async (t) => {
  const homeDir = await fixtureHome();
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const databasePath = path.join(homeDir, ".hermes", "state.db");
  const before = await stat(databasePath);
  const beforeBytes = await readFile(databasePath);

  const listing = await listHermesMemory(bridgeOptions(homeDir));

  const after = await stat(databasePath);
  const afterBytes = await readFile(databasePath);
  assert.equal(listing.status.available, true);
  assert.equal(listing.status.provider.id, "built-in");
  assert.deepEqual(
    listing.entries.map((entry) => entry.excerpt),
    [
      "The amber deployment note is archived",
      "Remember the violet launch checklist",
    ],
  );
  assert.ok(listing.entries.every((entry) => entry.readOnly));
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(afterBytes, beforeBytes);
});

test("uses the Hermes FTS table for bounded search", async (t) => {
  const homeDir = await fixtureHome();
  t.after(() => rm(homeDir, { recursive: true, force: true }));

  const listing = await listHermesMemory({
    ...bridgeOptions(homeDir),
    query: "violet launch",
    limit: 10,
  });

  assert.equal(listing.entries.length, 1);
  assert.match(listing.entries[0]?.excerpt ?? "", /violet launch/);

  const punctuationOnly = await listHermesMemory({
    ...bridgeOptions(homeDir),
    query: `"`,
  });
  assert.equal(punctuationOnly.status.available, true);
  assert.deepEqual(punctuationOnly.entries, []);
});

test("redacts sensitive values from listing excerpts", async (t) => {
  const homeDir = await fixtureHome();
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const database = new DatabaseSync(path.join(homeDir, ".hermes", "state.db"));
  database
    .prepare(`
      INSERT INTO messages(session_id, role, content, timestamp, active, compacted)
      VALUES (?, ?, ?, ?, 1, 0)
    `)
    .run(
      "session-1",
      "user",
      "Credential sk-123456789012345678901234 must remain private",
      1_700_000_300,
    );
  database.close();

  const listing = await listHermesMemory({
    ...bridgeOptions(homeDir),
    query: "credential",
  });

  assert.equal(listing.entries.length, 1);
  assert.doesNotMatch(listing.entries[0]?.excerpt ?? "", /sk-1234567890/);
  assert.match(listing.entries[0]?.excerpt ?? "", /\[REDACTED:/);
});

test("reads an active message through an opaque read-only URI", async (t) => {
  const homeDir = await fixtureHome();
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const uri = "hermes://familiar/cody/messages/1";

  assert.equal(isHermesMemoryUri(uri), true);
  assert.equal(isHermesMemoryUri("hermes://familiar/cody/messages/not-a-number"), false);
  const result = await readHermesMemory(uri, bridgeOptions(homeDir));

  assert.equal(result?.readOnly, true);
  assert.match(result?.content ?? "", /^# Bridge design · User/m);
  assert.match(result?.content ?? "", /Remember the violet launch checklist/);
  assert.match(result?.content ?? "", /Read-only from `~\/\.hermes\/state\.db`/);
  assert.equal(
    await readHermesMemory(
      "hermes://familiar/cody/messages/3",
      bridgeOptions(homeDir),
    ),
    null,
  );
});

test("detects external providers without loading or initializing provider code", async (t) => {
  const homeDir = await fixtureHome();
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  await writeFile(
    path.join(homeDir, ".hermes", "config.yaml"),
    "memory:\n  provider: honcho\n",
  );

  const listing = await listHermesMemory(bridgeOptions(homeDir));

  assert.deepEqual(listing.status.provider, {
    id: "honcho",
    tier: "external",
    readState: "credential-required",
  });
  assert.equal(listing.entries.length, 2);
});

test("reports an absent Hermes database as an unavailable optional source", async (t) => {
  const homeDir = await mkdtemp(path.join(process.cwd(), ".tmp-hermes-memory-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));

  const listing = await listHermesMemory(bridgeOptions(homeDir));

  assert.deepEqual(listing.entries, []);
  assert.equal(listing.status.available, false);
  assert.equal(listing.status.error, "database-unavailable");
});
