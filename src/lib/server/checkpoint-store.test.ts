import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";

import {
  CHECKPOINT_METADATA_FILE,
  CHECKPOINT_PATCH_FILE,
  checkpointDeleteQuarantinePath,
  openCheckpointStore,
  publishCheckpointUnit,
  recoverCheckpointStore,
  retireCheckpointQuarantine,
  restoreCheckpointDirectoryQuarantineNoReplace,
  restoreQuarantinedRegularFileNoReplace,
} from "./checkpoint-store.ts";

const temporary = await mkdtemp(
  path.join(process.cwd(), ".checkpoint-store-test-"),
);
const validMetadata = JSON.stringify({
  version: 1,
  kind: "project-scope",
  projectRoot: temporary,
  projectPathspec: ".",
});

after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

function metadataIsValid(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; kind?: unknown };
    return parsed.version === 1 && parsed.kind === "project-scope";
  } catch {
    return false;
  }
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function writeLegacyReservation(
  storePath: string,
  targetName: string,
  token: string,
  patchContents: string,
  metadataContents: string,
): Promise<{
  reservation: string;
  patchTemp: string;
  metadataTemp: string;
}> {
  const patchTempName = `.publish-${token}.patch.tmp`;
  const metadataTempName = `.publish-${token}.scope.tmp`;
  const reservation = path.join(
    storePath,
    `.legacy-reservation-${token}.json`,
  );
  await writeFile(
    reservation,
    JSON.stringify({
      version: 1,
      token,
      targetName,
      patchTempName,
      metadataTempName,
      patchSha256: sha256(patchContents),
      metadataSha256: sha256(metadataContents),
    }),
  );
  return {
    reservation,
    patchTemp: path.join(storePath, patchTempName),
    metadataTemp: path.join(storePath, metadataTempName),
  };
}

test("creating the first store fsyncs each new hierarchy parent", async () => {
  const gitDirectory = path.join(temporary, "first-store", ".git");
  const storePath = path.join(gitDirectory, "coven-cave", "checkpoints");
  await mkdir(gitDirectory, { recursive: true });
  const originalOpenSync = fs.openSync;
  const originalCloseSync = fs.closeSync;
  const originalFsyncSync = fs.fsyncSync;
  const descriptors = new Map<number, string>();
  const synced: string[] = [];
  fs.openSync = ((file, flags, ...args) => {
    const descriptor = originalOpenSync(file, flags, ...args);
    descriptors.set(descriptor, String(file));
    return descriptor;
  }) as typeof fs.openSync;
  fs.fsyncSync = ((descriptor) => {
    const file = descriptors.get(descriptor);
    if (file) synced.push(file);
    return originalFsyncSync(descriptor);
  }) as typeof fs.fsyncSync;
  fs.closeSync = ((descriptor) => {
    descriptors.delete(descriptor);
    return originalCloseSync(descriptor);
  }) as typeof fs.closeSync;
  try {
    openCheckpointStore(storePath, { create: true });
  } finally {
    fs.openSync = originalOpenSync;
    fs.fsyncSync = originalFsyncSync;
    fs.closeSync = originalCloseSync;
  }
  assert.ok(synced.includes(gitDirectory), "creating coven-cave syncs .git");
  assert.ok(
    synced.includes(path.join(gitDirectory, "coven-cave")),
    "creating checkpoints syncs coven-cave",
  );
});

test("a symlink or Windows junction cannot be used as the checkpoint store", async () => {
  const caseRoot = path.join(temporary, "linked-store");
  const target = path.join(caseRoot, "outside");
  const storePath = path.join(caseRoot, "checkpoints");
  await mkdir(target, { recursive: true });
  await symlink(target, storePath, process.platform === "win32" ? "junction" : "dir");
  assert.throws(
    () => openCheckpointStore(storePath),
    /checkpoint store must be a real directory/,
  );
});

test("recovery republishes complete drafts and restores complete quarantines", async () => {
  const storePath = path.join(temporary, "recovery", ".git", "coven-cave", "checkpoints");
  await mkdir(path.join(temporary, "recovery", ".git"), { recursive: true });
  const store = openCheckpointStore(storePath, { create: true })!;
  const checkpointName = "2026-08-05T20-00-00-000Z.patch";
  const published = publishCheckpointUnit(
    store,
    checkpointName,
    "complete patch\n",
    validMetadata,
  );
  const quarantine = checkpointDeleteQuarantinePath(
    store,
    checkpointName,
    "directory",
  );
  await rename(published, quarantine);
  recoverCheckpointStore(store, metadataIsValid);
  assert.equal(
    await readFile(path.join(published, "checkpoint.patch"), "utf8"),
    "complete patch\n",
  );
  await assert.rejects(() => access(quarantine));

  const completeDraft = path.join(storePath, ".publish-deadbeef.tmp");
  await mkdir(completeDraft);
  await Promise.all([
    writeFile(path.join(completeDraft, "checkpoint.patch"), "draft patch\n"),
    writeFile(path.join(completeDraft, "metadata.scope.json"), validMetadata),
  ]);
  recoverCheckpointStore(store, metadataIsValid);
  await assert.rejects(() => access(completeDraft));
  const recovered = (await readdir(storePath)).filter(
    (name) => name.endsWith(".patch") && name !== checkpointName,
  );
  assert.equal(recovered.length, 1);
  assert.equal(
    await readFile(path.join(storePath, recovered[0], "checkpoint.patch"), "utf8"),
    "draft patch\n",
  );
});

test("recovery collision-retries a complete named publication draft", async () => {
  const storePath = path.join(temporary, "draft-collision", ".git", "coven-cave", "checkpoints");
  await mkdir(path.join(temporary, "draft-collision", ".git"), { recursive: true });
  const store = openCheckpointStore(storePath, { create: true })!;
  const checkpointName = "2026-08-05T20-00-00-010Z.patch";
  publishCheckpointUnit(store, checkpointName, "existing patch\n", validMetadata);
  const draft = path.join(
    storePath,
    `.publish-${checkpointName}-${"a".repeat(24)}.tmp`,
  );
  await mkdir(draft);
  await Promise.all([
    writeFile(path.join(draft, "checkpoint.patch"), "recovered patch\n"),
    writeFile(path.join(draft, "metadata.scope.json"), validMetadata),
  ]);

  recoverCheckpointStore(store, metadataIsValid);

  await assert.rejects(() => access(draft));
  const checkpoints = (await readdir(storePath)).filter((name) =>
    name.endsWith(".patch"),
  );
  assert.equal(checkpoints.length, 2);
  const recovered = checkpoints.find((name) => name !== checkpointName)!;
  assert.equal(
    await readFile(path.join(storePath, recovered, "checkpoint.patch"), "utf8"),
    "recovered patch\n",
  );
});

test("incomplete and unverified quarantines remain available for retry", async () => {
  const storePath = path.join(temporary, "incomplete", ".git", "coven-cave", "checkpoints");
  await mkdir(path.join(temporary, "incomplete", ".git"), { recursive: true });
  const store = openCheckpointStore(storePath, { create: true })!;
  const incomplete = checkpointDeleteQuarantinePath(
    store,
    "2026-08-05T20-00-00-001Z.patch",
    "directory",
  );
  await mkdir(incomplete);
  await writeFile(path.join(incomplete, "checkpoint.patch"), "only half\n");
  const legacyUnknown = path.join(storePath, ".delete-deadbeef.tmp");
  await mkdir(legacyUnknown);
  await Promise.all([
    writeFile(path.join(legacyUnknown, "checkpoint.patch"), "legacy patch\n"),
    writeFile(path.join(legacyUnknown, "metadata.scope.json"), validMetadata),
  ]);
  const unverified = checkpointDeleteQuarantinePath(
    store,
    "2026-08-05T20-00-00-013Z.patch",
    "directory",
  );
  await mkdir(unverified);
  await Promise.all([
    writeFile(path.join(unverified, "checkpoint.patch"), "unverified\n"),
    writeFile(path.join(unverified, "metadata.scope.json"), validMetadata),
    writeFile(path.join(unverified, "unexpected-entry"), "must not publish\n"),
  ]);

  recoverCheckpointStore(store, metadataIsValid);
  assert.equal((await lstat(incomplete)).isDirectory(), true);
  assert.equal((await lstat(legacyUnknown)).isDirectory(), true);
  assert.equal((await lstat(unverified)).isDirectory(), true);
  await assert.rejects(() =>
    access(path.join(storePath, "2026-08-05T20-00-00-013Z.patch")),
  );
});

test("ambiguous legacy reservations and source pairs remain quarantined", async () => {
  const storePath = path.join(temporary, "legacy-publish", ".git", "coven-cave", "checkpoints");
  await mkdir(path.join(temporary, "legacy-publish", ".git"), { recursive: true });
  const store = openCheckpointStore(storePath, { create: true })!;
  const targetName = "2026-08-05T20-00-00-002Z.patch";
  const patchTemp = path.join(storePath, ".publish-deadbeef.patch.tmp");
  const metadataTemp = path.join(storePath, ".publish-deadbeef.scope.tmp");
  const reservation = path.join(storePath, `${targetName}.reserve`);
  await Promise.all([
    writeFile(patchTemp, "legacy durable patch\n"),
    writeFile(metadataTemp, validMetadata),
    writeFile(reservation, "legacy reservation\n"),
  ]);

  recoverCheckpointStore(store, metadataIsValid);
  await assert.rejects(() => access(path.join(storePath, targetName)));
  assert.equal(await readFile(patchTemp, "utf8"), "legacy durable patch\n");
  assert.equal(await readFile(metadataTemp, "utf8"), validMetadata);
  assert.equal(await readFile(reservation, "utf8"), "legacy reservation\n");
});

for (const state of [
  "reservation-only",
  "both-temps",
  "patch-only",
  "metadata-only",
  "target-and-both-temps",
  "target-and-patch-temp",
  "target-and-metadata-temp",
  "target-only",
] as const) {
  test(`associated legacy reservation recovery handles ${state}`, async () => {
    const storePath = path.join(
      temporary,
      `associated-legacy-${state}`,
      ".git",
      "coven-cave",
      "checkpoints",
    );
    await mkdir(
      path.join(temporary, `associated-legacy-${state}`, ".git"),
      { recursive: true },
    );
    const store = openCheckpointStore(storePath, { create: true })!;
    const token = "1".repeat(23) +
      String(
        [
          "reservation-only",
          "both-temps",
          "patch-only",
          "metadata-only",
          "target-and-both-temps",
          "target-and-patch-temp",
          "target-and-metadata-temp",
          "target-only",
        ].indexOf(state),
      );
    const targetName =
      `2026-08-05T20-00-01-00${String(
        [
          "reservation-only",
          "both-temps",
          "patch-only",
          "metadata-only",
          "target-and-both-temps",
          "target-and-patch-temp",
          "target-and-metadata-temp",
          "target-only",
        ].indexOf(state),
      )}Z.patch`;
    const patchContents = `${state} patch\n`;
    const reservation = await writeLegacyReservation(
      storePath,
      targetName,
      token,
      patchContents,
      validMetadata,
    );
    const targetExists = state.startsWith("target-");
    if (targetExists) {
      publishCheckpointUnit(
        store,
        targetName,
        patchContents,
        validMetadata,
      );
    }
    if (
      state === "both-temps" ||
      state === "patch-only" ||
      state === "target-and-both-temps" ||
      state === "target-and-patch-temp"
    ) {
      await writeFile(reservation.patchTemp, patchContents);
    }
    if (
      state === "both-temps" ||
      state === "metadata-only" ||
      state === "target-and-both-temps" ||
      state === "target-and-metadata-temp"
    ) {
      await writeFile(reservation.metadataTemp, validMetadata);
    }

    recoverCheckpointStore(store, metadataIsValid);

    const recoverableWithoutTarget =
      state === "reservation-only" ||
      state === "patch-only" ||
      state === "metadata-only";
    if (recoverableWithoutTarget) {
      await access(reservation.reservation);
      await assert.rejects(() => access(path.join(storePath, targetName)));
    } else {
      assert.equal(
        await readFile(
          path.join(storePath, targetName, "checkpoint.patch"),
          "utf8",
        ),
        patchContents,
      );
      await Promise.all([
        assert.rejects(() => access(reservation.reservation)),
        assert.rejects(() => access(reservation.patchTemp)),
        assert.rejects(() => access(reservation.metadataTemp)),
      ]);
    }
  });
}

for (const [index, state] of [
  "empty",
  "patch-only",
  "metadata-only",
  "complete",
].entries()) {
  test(`associated legacy recovery resumes a ${state} recovery stage`, async () => {
    const storePath = path.join(
      temporary,
      `associated-legacy-stage-${state}`,
      ".git",
      "coven-cave",
      "checkpoints",
    );
    await mkdir(
      path.join(temporary, `associated-legacy-stage-${state}`, ".git"),
      { recursive: true },
    );
    const store = openCheckpointStore(storePath, { create: true })!;
    const token = `${index + 2}`.repeat(24);
    const targetName = `2026-08-05T20-00-02-00${index}Z.patch`;
    const patchContents = `${state} staged patch\n`;
    const reservation = await writeLegacyReservation(
      storePath,
      targetName,
      token,
      patchContents,
      validMetadata,
    );
    await Promise.all([
      writeFile(reservation.patchTemp, patchContents),
      writeFile(reservation.metadataTemp, validMetadata),
    ]);
    const recoveryStage = path.join(
      storePath,
      `.legacy-stage-${token}.tmp`,
    );
    await mkdir(recoveryStage);
    if (state === "patch-only" || state === "complete") {
      await writeFile(
        path.join(recoveryStage, "checkpoint.patch"),
        patchContents,
      );
    }
    if (state === "metadata-only" || state === "complete") {
      await writeFile(
        path.join(recoveryStage, "metadata.scope.json"),
        validMetadata,
      );
    }

    recoverCheckpointStore(store, metadataIsValid);

    assert.equal(
      await readFile(
        path.join(storePath, targetName, "checkpoint.patch"),
        "utf8",
      ),
      patchContents,
    );
    await Promise.all([
      assert.rejects(() => access(reservation.reservation)),
      assert.rejects(() => access(reservation.patchTemp)),
      assert.rejects(() => access(reservation.metadataTemp)),
      assert.rejects(() => access(recoveryStage)),
    ]);
  });
}

test("multiple associated legacy reservations recover independently", async () => {
  const storePath = path.join(
    temporary,
    "associated-legacy-multiple",
    ".git",
    "coven-cave",
    "checkpoints",
  );
  await mkdir(path.join(temporary, "associated-legacy-multiple", ".git"), {
    recursive: true,
  });
  const store = openCheckpointStore(storePath, { create: true })!;
  for (const [index, token] of [
    ["020", "2".repeat(24)],
    ["021", "3".repeat(24)],
  ] as const) {
    const targetName = `2026-08-05T20-00-00-${index}Z.patch`;
    const patchContents = `${token} patch\n`;
    const reservation = await writeLegacyReservation(
      storePath,
      targetName,
      token,
      patchContents,
      validMetadata,
    );
    await Promise.all([
      writeFile(reservation.patchTemp, patchContents),
      writeFile(reservation.metadataTemp, validMetadata),
    ]);
  }

  recoverCheckpointStore(store, metadataIsValid);

  for (const [index, token] of [
    ["020", "2".repeat(24)],
    ["021", "3".repeat(24)],
  ] as const) {
    assert.equal(
      await readFile(
        path.join(
          storePath,
          `2026-08-05T20-00-00-${index}Z.patch`,
          "checkpoint.patch",
        ),
        "utf8",
      ),
      `${token} patch\n`,
    );
  }
});

test("conflicting associated reservations preserve the later source pair", async () => {
  const storePath = path.join(
    temporary,
    "associated-legacy-conflict",
    ".git",
    "coven-cave",
    "checkpoints",
  );
  await mkdir(path.join(temporary, "associated-legacy-conflict", ".git"), {
    recursive: true,
  });
  const store = openCheckpointStore(storePath, { create: true })!;
  const targetName = "2026-08-05T20-00-00-022Z.patch";
  const first = await writeLegacyReservation(
    storePath,
    targetName,
    "4".repeat(24),
    "first associated patch\n",
    validMetadata,
  );
  const conflicting = await writeLegacyReservation(
    storePath,
    targetName,
    "5".repeat(24),
    "conflicting associated patch\n",
    validMetadata,
  );
  await Promise.all([
    writeFile(first.patchTemp, "first associated patch\n"),
    writeFile(first.metadataTemp, validMetadata),
    writeFile(conflicting.patchTemp, "conflicting associated patch\n"),
    writeFile(conflicting.metadataTemp, validMetadata),
  ]);

  recoverCheckpointStore(store, metadataIsValid);

  assert.equal(
    await readFile(
      path.join(storePath, targetName, CHECKPOINT_PATCH_FILE),
      "utf8",
    ),
    "first associated patch\n",
  );
  await Promise.all([
    access(conflicting.reservation),
    access(conflicting.patchTemp),
    access(conflicting.metadataTemp),
  ]);
});

test("legacy target collisions retain the reservation and both source files", async () => {
  const storePath = path.join(
    temporary,
    "legacy-target-collision",
    ".git",
    "coven-cave",
    "checkpoints",
  );
  await mkdir(path.join(temporary, "legacy-target-collision", ".git"), {
    recursive: true,
  });
  const store = openCheckpointStore(storePath, { create: true })!;
  const targetName = "2026-08-05T20-00-00-014Z.patch";
  const target = publishCheckpointUnit(
    store,
    targetName,
    "existing target\n",
    validMetadata,
  );
  const patchTemp = path.join(storePath, ".publish-c0111de.patch.tmp");
  const metadataTemp = path.join(storePath, ".publish-c0111de.scope.tmp");
  const reservation = path.join(storePath, `${targetName}.reserve`);
  await Promise.all([
    writeFile(patchTemp, "recoverable legacy patch\n"),
    writeFile(metadataTemp, validMetadata),
    writeFile(reservation, "legacy target reservation\n"),
  ]);

  recoverCheckpointStore(store, metadataIsValid);

  assert.equal(
    await readFile(path.join(target, "checkpoint.patch"), "utf8"),
    "existing target\n",
  );
  assert.equal(await readFile(patchTemp, "utf8"), "recoverable legacy patch\n");
  assert.equal(await readFile(metadataTemp, "utf8"), validMetadata);
  assert.equal(
    await readFile(reservation, "utf8"),
    "legacy target reservation\n",
  );
});

test("legacy recovery preserves source artifacts when staging is interrupted", async () => {
  const storePath = path.join(temporary, "legacy-staging-failure", ".git", "coven-cave", "checkpoints");
  await mkdir(path.join(temporary, "legacy-staging-failure", ".git"), {
    recursive: true,
  });
  const store = openCheckpointStore(storePath, { create: true })!;
  const targetName = "2026-08-05T20-00-00-011Z.patch";
  const patchTemp = path.join(storePath, ".publish-cafebabe.patch.tmp");
  const metadataTemp = path.join(storePath, ".publish-cafebabe.scope.tmp");
  const reservation = path.join(storePath, `${targetName}.reserve`);
  await Promise.all([
    writeFile(patchTemp, "legacy staged patch\n"),
    writeFile(metadataTemp, validMetadata),
    writeFile(reservation, "legacy reservation\n"),
  ]);
  const originalOpenSync = fs.openSync;
  fs.openSync = ((file, flags, ...args) => {
    if (
      String(file).endsWith(`${path.sep}metadata.scope.json`) &&
      String(file).includes(`${path.sep}.publish-${targetName}-`)
    ) {
      throw new Error("injected staging interruption");
    }
    return originalOpenSync(file, flags, ...args);
  }) as typeof fs.openSync;
  try {
    recoverCheckpointStore(store, metadataIsValid);
  } finally {
    fs.openSync = originalOpenSync;
  }

  assert.equal(await readFile(patchTemp, "utf8"), "legacy staged patch\n");
  assert.equal(await readFile(metadataTemp, "utf8"), validMetadata);
  assert.equal(await readFile(reservation, "utf8"), "legacy reservation\n");
});

test("a pinned store identity rejects replacement before publication", async () => {
  const caseRoot = path.join(temporary, "store-replacement");
  const storePath = path.join(caseRoot, ".git", "coven-cave", "checkpoints");
  await mkdir(path.join(caseRoot, ".git"), { recursive: true });
  const store = openCheckpointStore(storePath, { create: true })!;
  const displaced = `${storePath}.displaced`;
  await rename(storePath, displaced);
  await mkdir(storePath);

  assert.throws(
    () =>
      publishCheckpointUnit(
        store,
        "2026-08-05T20-00-00-003Z.patch",
        "must not publish\n",
        validMetadata,
      ),
    /checkpoint store changed during operation/,
  );
  assert.deepEqual(await readdir(storePath), []);
});

test("rollback cannot overwrite a replacement created at the no-replace boundary", async () => {
  const caseRoot = path.join(temporary, "rollback-race");
  const source = path.join(caseRoot, "quarantined.patch");
  const destination = path.join(caseRoot, "checkpoint.patch");
  await mkdir(caseRoot, { recursive: true });
  await writeFile(source, "verified checkpoint\n");
  const original = fs.openSync;
  let injected = false;
  fs.openSync = ((file, flags, ...args) => {
    const destinationOpen =
      String(file) === destination &&
      typeof flags === "number" &&
      (flags & fs.constants.O_EXCL) !== 0;
    if (!injected && destinationOpen) {
      injected = true;
      fs.writeFileSync(destination, "concurrent replacement\n", { flag: "wx" });
    }
    return original(file, flags, ...args);
  }) as typeof fs.openSync;
  try {
    assert.equal(
      restoreQuarantinedRegularFileNoReplace(source, destination),
      false,
    );
  } finally {
    fs.openSync = original;
  }
  assert.equal(await readFile(destination, "utf8"), "concurrent replacement\n");
  assert.equal(await readFile(source, "utf8"), "verified checkpoint\n");
});

test("directory publication preserves an empty destination inserted at the reservation boundary", async () => {
  const storePath = path.join(
    temporary,
    "directory-publication-boundary",
    ".git",
    "coven-cave",
    "checkpoints",
  );
  await mkdir(
    path.join(temporary, "directory-publication-boundary", ".git"),
    { recursive: true },
  );
  const store = openCheckpointStore(storePath, { create: true })!;
  const checkpointName = "2026-08-05T20-00-00-030Z.patch";
  const destination = path.join(storePath, checkpointName);
  const originalMkdirSync = fs.mkdirSync;
  const originalRenameSync = fs.renameSync;
  let injected = false;
  const injectDestination = () => {
    if (injected) return;
    injected = true;
    originalMkdirSync(destination);
  };
  fs.mkdirSync = ((file, options) => {
    if (String(file) === destination) injectDestination();
    return originalMkdirSync(file, options);
  }) as typeof fs.mkdirSync;
  fs.renameSync = ((source, target) => {
    if (String(target) === destination) injectDestination();
    return originalRenameSync(source, target);
  }) as typeof fs.renameSync;
  let published: string;
  try {
    published = publishCheckpointUnit(
      store,
      checkpointName,
      "published after collision\n",
      validMetadata,
    );
  } finally {
    fs.mkdirSync = originalMkdirSync;
    fs.renameSync = originalRenameSync;
  }

  assert.equal(injected, true);
  assert.notEqual(published, destination);
  assert.deepEqual(await readdir(destination), []);
  assert.equal(
    await readFile(path.join(published, "checkpoint.patch"), "utf8"),
    "published after collision\n",
  );
});

test("directory publication exposes only a complete checkpoint unit", async () => {
  const storePath = path.join(
    temporary,
    "directory-publication-visibility",
    ".git",
    "coven-cave",
    "checkpoints",
  );
  await mkdir(
    path.join(temporary, "directory-publication-visibility", ".git"),
    { recursive: true },
  );
  const store = openCheckpointStore(storePath, { create: true })!;
  const checkpointName = "2026-08-05T20-00-00-033Z.patch";
  const destination = path.join(storePath, checkpointName);
  const prepublicationStages: string[] = [];
  publishCheckpointUnit(
    store,
    checkpointName,
    "visible only when complete\n",
    validMetadata,
    {
      publicationStage: (stage) => {
        if (!stage.startsWith("destination-")) return;
        const entries = fs.existsSync(destination)
          ? fs.readdirSync(destination).sort()
          : [];
        assert.notDeepEqual(
          entries,
          [CHECKPOINT_PATCH_FILE, CHECKPOINT_METADATA_FILE].sort(),
          `${stage} is not reader-visible as a complete unit`,
        );
        prepublicationStages.push(stage);
      },
    },
  );

  assert.equal(prepublicationStages.length, 7);
  assert.deepEqual(
    await readdir(destination).then((entries) => entries.sort()),
    [CHECKPOINT_PATCH_FILE, CHECKPOINT_METADATA_FILE].sort(),
  );
});

test("the real host rollback path restores without replacement semantics", async () => {
  const caseRoot = path.join(temporary, `host-${process.platform}`);
  const source = path.join(caseRoot, "quarantined.patch");
  const destination = path.join(caseRoot, "checkpoint.patch");
  await mkdir(caseRoot, { recursive: true });
  await writeFile(source, "host checkpoint\n");
  assert.equal(
    restoreQuarantinedRegularFileNoReplace(source, destination),
    true,
  );
  assert.equal(await readFile(destination, "utf8"), "host checkpoint\n");
  await assert.rejects(() => access(source));

  const secondSource = path.join(caseRoot, "second.patch");
  await writeFile(secondSource, "must remain\n");
  assert.equal(
    restoreQuarantinedRegularFileNoReplace(secondSource, destination),
    false,
  );
  assert.equal(await readFile(destination, "utf8"), "host checkpoint\n");
  assert.equal(await readFile(secondSource, "utf8"), "must remain\n");
});

test("directory rollback keeps a durable replacement when quarantine cleanup fails", async () => {
  const storePath = path.join(temporary, "rollback-cleanup", ".git", "coven-cave", "checkpoints");
  await mkdir(path.join(temporary, "rollback-cleanup", ".git"), { recursive: true });
  const store = openCheckpointStore(storePath, { create: true })!;
  const checkpointName = "2026-08-05T20-00-00-012Z.patch";
  const quarantine = checkpointDeleteQuarantinePath(
    store,
    checkpointName,
    "directory",
  );
  const destination = path.join(storePath, checkpointName);
  await mkdir(quarantine);
  await Promise.all([
    writeFile(path.join(quarantine, "checkpoint.patch"), "durable rollback\n"),
    writeFile(path.join(quarantine, "metadata.scope.json"), validMetadata),
  ]);
  const metadataSource = path.join(quarantine, "metadata.scope.json");
  const originalUnlinkSync = fs.unlinkSync;
  fs.unlinkSync = ((file) => {
    if (String(file) === metadataSource) {
      throw new Error("injected quarantine cleanup interruption");
    }
    return originalUnlinkSync(file);
  }) as typeof fs.unlinkSync;
  try {
    assert.equal(
      restoreCheckpointDirectoryQuarantineNoReplace(
        store,
        quarantine,
        destination,
      ),
      true,
    );
  } finally {
    fs.unlinkSync = originalUnlinkSync;
  }

  assert.equal(
    await readFile(path.join(destination, "checkpoint.patch"), "utf8"),
    "durable rollback\n",
  );
  assert.equal(
    await readFile(path.join(destination, "metadata.scope.json"), "utf8"),
    validMetadata,
  );
});

test("checkpoint bundle retirement renames atomically before verified cleanup", async () => {
  const storePath = path.join(
    temporary,
    "atomic-bundle-retirement",
    ".git",
    "coven-cave",
    "checkpoints",
  );
  await mkdir(path.join(temporary, "atomic-bundle-retirement", ".git"), {
    recursive: true,
  });
  const store = openCheckpointStore(storePath, { create: true })!;
  const checkpointName = "2026-08-05T20-00-00-032Z.patch";
  const published = publishCheckpointUnit(
    store,
    checkpointName,
    "retire atomically\n",
    validMetadata,
  );
  const quarantine = checkpointDeleteQuarantinePath(
    store,
    checkpointName,
    "directory",
  );
  await rename(published, quarantine);
  const originalUnlinkSync = fs.unlinkSync;
  let cleanupInterrupted = false;
  fs.unlinkSync = ((file) => {
    if (
      !cleanupInterrupted &&
      String(file).includes(`${path.sep}.purge-`)
    ) {
      cleanupInterrupted = true;
      assert.equal(fs.existsSync(quarantine), false);
      throw new Error("injected purge cleanup interruption");
    }
    return originalUnlinkSync(file);
  }) as typeof fs.unlinkSync;
  try {
    retireCheckpointQuarantine(store, quarantine, true);
  } finally {
    fs.unlinkSync = originalUnlinkSync;
  }

  assert.equal(cleanupInterrupted, true);
  await assert.rejects(() => access(quarantine));
  assert.equal(
    (await readdir(storePath)).some((name) => name.startsWith(".purge-")),
    true,
  );
  recoverCheckpointStore(store, metadataIsValid);
  assert.equal(
    (await readdir(storePath)).some((name) => name.startsWith(".purge-")),
    false,
  );
});

test("directory restoration collision preserves destination and quarantine", async () => {
  const storePath = path.join(
    temporary,
    "directory-restore-collision",
    ".git",
    "coven-cave",
    "checkpoints",
  );
  await mkdir(path.join(temporary, "directory-restore-collision", ".git"), {
    recursive: true,
  });

  const store = openCheckpointStore(storePath, { create: true })!;
  const checkpointName = "2026-08-05T20-00-00-015Z.patch";
  const quarantine = checkpointDeleteQuarantinePath(
    store,
    checkpointName,
    "directory",
  );
  const destination = path.join(storePath, checkpointName);
  await Promise.all([
    mkdir(quarantine),
    mkdir(destination),
  ]);
  await Promise.all([
    writeFile(path.join(quarantine, "checkpoint.patch"), "quarantined\n"),
    writeFile(path.join(quarantine, "metadata.scope.json"), validMetadata),
    writeFile(path.join(destination, "checkpoint.patch"), "replacement\n"),
    writeFile(path.join(destination, "metadata.scope.json"), validMetadata),
  ]);

  assert.equal(
    restoreCheckpointDirectoryQuarantineNoReplace(
      store,
      quarantine,
      destination,
      metadataIsValid,
    ),
    false,
  );
  assert.equal(
    await readFile(path.join(destination, "checkpoint.patch"), "utf8"),
    "replacement\n",
  );
  assert.equal(
    await readFile(path.join(quarantine, "checkpoint.patch"), "utf8"),
    "quarantined\n",
  );
});

test("directory restoration quarantines an injected destination collision from later recovery", async () => {
  const storePath = path.join(
    temporary,
    "directory-restore-boundary",
    ".git",
    "coven-cave",
    "checkpoints",
  );
  await mkdir(path.join(temporary, "directory-restore-boundary", ".git"), {
    recursive: true,
  });
  const store = openCheckpointStore(storePath, { create: true })!;
  const checkpointName = "2026-08-05T20-00-00-031Z.patch";
  const published = publishCheckpointUnit(
    store,
    checkpointName,
    "quarantined at boundary\n",
    validMetadata,
  );
  const quarantine = checkpointDeleteQuarantinePath(
    store,
    checkpointName,
    "directory",
  );
  await rename(published, quarantine);
  const destination = path.join(storePath, checkpointName);
  const originalMkdirSync = fs.mkdirSync;
  const originalRenameSync = fs.renameSync;
  let injected = false;
  const injectDestination = () => {
    if (injected) return;
    injected = true;
    originalMkdirSync(destination);
  };
  fs.mkdirSync = ((file, options) => {
    if (String(file) === destination) injectDestination();
    return originalMkdirSync(file, options);
  }) as typeof fs.mkdirSync;
  fs.renameSync = ((source, target) => {
    if (String(target) === destination) injectDestination();
    return originalRenameSync(source, target);
  }) as typeof fs.renameSync;
  let restored: boolean;
  try {
    restored = restoreCheckpointDirectoryQuarantineNoReplace(
      store,
      quarantine,
      destination,
      metadataIsValid,
    );
  } finally {
    fs.mkdirSync = originalMkdirSync;
    fs.renameSync = originalRenameSync;
  }

  assert.equal(injected, true);
  assert.equal(restored, false);
  assert.deepEqual(await readdir(destination), []);
  assert.equal(
    await readFile(path.join(quarantine, "checkpoint.patch"), "utf8"),
    "quarantined at boundary\n",
  );
  const conflict = JSON.parse(
    await readFile(path.join(quarantine, ".conflict.json"), "utf8"),
  ) as {
    recoverable: boolean;
    targetName: string;
  };
  assert.equal(conflict.recoverable, false);
  assert.equal(conflict.targetName, checkpointName);

  recoverCheckpointStore(store, metadataIsValid);

  assert.deepEqual(await readdir(destination), []);
  assert.equal(
    await readFile(path.join(quarantine, "checkpoint.patch"), "utf8"),
    "quarantined at boundary\n",
  );
  assert.equal(
    JSON.parse(
      await readFile(path.join(quarantine, ".conflict.json"), "utf8"),
    ).recoverable,
    false,
  );
});

test("restoration copies without creating hard links", async () => {
  const caseRoot = path.join(temporary, "unsupported-link");
  const source = path.join(caseRoot, "quarantined.patch");
  const destination = path.join(caseRoot, "checkpoint.patch");
  await mkdir(caseRoot, { recursive: true });
  await writeFile(source, "preserve me\n");
  const originalLinkSync = fs.linkSync;
  fs.linkSync = (() => {
    const error = new Error("hard links unsupported") as NodeJS.ErrnoException;
    error.code = "ENOTSUP";
    throw error;
  }) as typeof fs.linkSync;
  try {
    assert.equal(
      restoreQuarantinedRegularFileNoReplace(source, destination),
      true,
    );
  } finally {
    fs.linkSync = originalLinkSync;
  }
  await assert.rejects(() => access(source));
  assert.equal(await readFile(destination, "utf8"), "preserve me\n");
});

test("POSIX identity failure removes only the destination created by this attempt", async (context) => {
  if (process.platform === "win32") {
    context.skip("the POSIX identity boundary is exercised on Unix matrix hosts");
    return;
  }
  const caseRoot = path.join(temporary, "posix-identity-failure");
  const source = path.join(caseRoot, "quarantined.patch");
  const destination = path.join(caseRoot, "checkpoint.patch");
  await mkdir(caseRoot, { recursive: true });
  await writeFile(source, "verified source\n");
  const mutableFs = fs as unknown as {
    lstatSync: (file: fs.PathLike) => fs.Stats;
  };
  const originalLstatSync = mutableFs.lstatSync;
  let injected = false;
  mutableFs.lstatSync = (file) => {
    const actual = originalLstatSync(file);
    if (!injected && String(file) === destination) {
      injected = true;
      return new Proxy(actual, {
        get(target, property, receiver) {
          if (property === "ino") return target.ino + 1;
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }
    return actual;
  };
  try {
    assert.equal(
      restoreQuarantinedRegularFileNoReplace(source, destination),
      false,
    );
  } finally {
    mutableFs.lstatSync = originalLstatSync;
  }
  assert.equal(await readFile(source, "utf8"), "verified source\n");
  await assert.rejects(() => access(destination));
});

test("POSIX identity failure never deletes a replacement", async (context) => {
  if (process.platform === "win32") {
    context.skip("the POSIX identity boundary is exercised on Unix matrix hosts");
    return;
  }
  const caseRoot = path.join(temporary, "posix-identity-replacement");
  const source = path.join(caseRoot, "quarantined.patch");
  const destination = path.join(caseRoot, "checkpoint.patch");
  await mkdir(caseRoot, { recursive: true });
  await writeFile(source, "verified source\n");
  const mutableFs = fs as unknown as {
    lstatSync: (file: fs.PathLike) => fs.Stats;
  };
  const originalLstatSync = mutableFs.lstatSync;
  let injected = false;
  mutableFs.lstatSync = (file) => {
    if (!injected && String(file) === destination) {
      injected = true;
      fs.unlinkSync(destination);
      fs.writeFileSync(destination, "concurrent replacement\n", { flag: "wx" });
    }
    return originalLstatSync(file);
  };
  try {
    assert.equal(
      restoreQuarantinedRegularFileNoReplace(source, destination),
      false,
    );
  } finally {
    mutableFs.lstatSync = originalLstatSync;
  }
  assert.equal(await readFile(source, "utf8"), "verified source\n");
  assert.equal(await readFile(destination, "utf8"), "concurrent replacement\n");
});

test("recovery never recursively removes unknown draft entries", async () => {
  const storePath = path.join(
    temporary,
    "unknown-draft-entries",
    ".git",
    "coven-cave",
    "checkpoints",
  );
  await mkdir(path.join(temporary, "unknown-draft-entries", ".git"), {
    recursive: true,
  });
  const store = openCheckpointStore(storePath, { create: true })!;
  const draft = path.join(storePath, ".publish-unknown.tmp");
  const extraDirectory = path.join(draft, "unexpected-directory");
  const extraSymlink = path.join(draft, "unexpected-link");
  await mkdir(extraDirectory, { recursive: true });
  await writeFile(path.join(draft, "checkpoint.patch"), "known fragment\n");
  await symlink(
    path.join(storePath, "outside"),
    extraSymlink,
    process.platform === "win32" ? "junction" : "dir",
  );

  recoverCheckpointStore(store, metadataIsValid);

  assert.equal((await lstat(extraDirectory)).isDirectory(), true);
  assert.equal((await lstat(extraSymlink)).isSymbolicLink(), true);
  assert.equal(
    await readFile(path.join(draft, "checkpoint.patch"), "utf8"),
    "known fragment\n",
  );
});
