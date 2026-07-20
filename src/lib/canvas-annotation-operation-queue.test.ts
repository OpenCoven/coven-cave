import assert from "node:assert/strict";

import {
  CanvasAnnotationOperationQueue,
  canvasAnnotationOperationsStorageKey,
  overlayCanvasArtifactSnapshot,
  overlayCanvasAnnotationOperations,
  readCanvasAnnotationOperations,
  writeCanvasAnnotationOperations,
  type CanvasAnnotationOperation,
} from "./canvas-annotation-operation-queue.ts";

const annotation = (
  id: string,
  note: string,
): Extract<CanvasAnnotationOperation, { annotation: unknown }> => ({
  id: "artifact-1",
  annotation: {
    id,
    target: { selector: `#${id}`, label: id, excerpt: `<div id="${id}" />` },
    note,
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: `2026-07-20T09:00:0${note.length}.000Z`,
  },
});
const remove = (id: string): CanvasAnnotationOperation => ({
  id: "artifact-1",
  removeAnnotationId: id,
});
const operationId = (operation: CanvasAnnotationOperation) => (
  "annotation" in operation ? operation.annotation.id : operation.removeAnnotationId
);

{
  const queue = new CanvasAnnotationOperationQueue();
  queue.enqueue(annotation("a", "first"));
  queue.enqueue(annotation("b", "other"));
  queue.enqueue(annotation("a", "latest"));

  assert.deepEqual(
    queue.pending().map((operation) => [
      operationId(operation),
      "annotation" in operation ? operation.annotation.note : "remove",
    ]),
    [["b", "other"], ["a", "latest"]],
    "a later unsent update supersedes the same annotation without reordering other annotations",
  );

  queue.enqueue(remove("a"));
  assert.deepEqual(
    queue.pending().map((operation) => [operationId(operation), "annotation" in operation ? "update" : "remove"]),
    [["b", "update"], ["a", "remove"]],
    "an unsent remove supersedes an earlier update for the same annotation",
  );
}

{
  const queue = new CanvasAnnotationOperationQueue();
  queue.enqueue(annotation("older", "old"));
  queue.enqueue(annotation("later", "new"));

  let rejectOlder!: (error: Error) => void;
  const firstAttempt = new Promise<void>((_resolve, reject) => {
    rejectOlder = reject;
  });
  const sent: string[] = [];
  const drain = queue.drain(async (operation) => {
    sent.push(operationId(operation));
    await firstAttempt;
  });

  await Promise.resolve();
  queue.enqueue(annotation("newest", "queued during failure"));
  rejectOlder(new Error("offline"));

  assert.equal(await drain, false, "a failed operation stops the drain");
  assert.equal(queue.blocked, true, "the queue remains blocked after failure");
  assert.deepEqual(sent, ["older"], "later operations do not run after an older failure");
  assert.deepEqual(
    queue.pending().map(operationId),
    ["older", "later", "newest"],
    "the failed operation and every later operation remain pending",
  );

  assert.equal(
    await queue.drain(async (operation) => {
      sent.push(operationId(operation));
    }),
    false,
    "ordinary drains cannot bypass the persistent failed operation",
  );
  assert.deepEqual(sent, ["older"], "a newer enqueue cannot implicitly retry or clear the failure");

  assert.equal(
    await queue.retry(async (operation) => {
      sent.push(operationId(operation));
    }),
    true,
    "retry resumes and drains successfully",
  );
  assert.deepEqual(
    sent,
    ["older", "older", "later", "newest"],
    "retry starts at the failed operation and preserves later operation order",
  );
  assert.equal(queue.blocked, false, "successful retry clears the blocked state");
  assert.deepEqual(queue.pending(), [], "successful retry drains the queue");
}

{
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  };
  const operations = [annotation("a", "first"), remove("b")];

  writeCanvasAnnotationOperations(storage, "artifact-1", operations);
  assert.equal(
    stored.get(canvasAnnotationOperationsStorageKey("artifact-1")),
    JSON.stringify({ version: 1, operations }),
    "pending operations use a versioned artifact-scoped record",
  );
  assert.deepEqual(
    readCanvasAnnotationOperations(storage, "artifact-1"),
    operations,
    "stored pending operations round-trip",
  );

  writeCanvasAnnotationOperations(storage, "artifact-1", []);
  assert.equal(
    stored.has(canvasAnnotationOperationsStorageKey("artifact-1")),
    false,
    "storage is cleared only for a confirmed empty queue",
  );
}

{
  const valid = annotation("valid", "  bounded note  ");
  const oversized = Array.from({ length: 105 }, (_, index) => annotation(`a-${index}`, `${index}`));
  const storage = {
    getItem: () => JSON.stringify({
      version: 1,
      operations: [
        null,
        { id: "other-artifact", removeAnnotationId: "wrong" },
        { id: "artifact-1", annotation: { ...valid.annotation, note: 42 } },
        ...oversized,
      ],
    }),
    setItem: () => { throw new Error("unavailable"); },
    removeItem: () => { throw new Error("unavailable"); },
  };

  const restored = readCanvasAnnotationOperations(storage, "artifact-1");
  assert.equal(restored.length, 100, "stored queues are capped at 100 valid operations");
  assert.deepEqual(restored[0], oversized[0], "invalid and cross-artifact records are discarded");
  assert.doesNotThrow(
    () => writeCanvasAnnotationOperations(storage, "artifact-1", restored),
    "unavailable storage is tolerated",
  );
  assert.deepEqual(
    readCanvasAnnotationOperations({ ...storage, getItem: () => "{broken" }, "artifact-1"),
    [],
    "corrupt storage is ignored",
  );
}

{
  const serverAnnotations = [
    annotation("a", "server").annotation,
    annotation("b", "server").annotation,
  ];
  const pending = [
    annotation("a", "local"),
    remove("b"),
    annotation("c", "later"),
  ];

  assert.deepEqual(
    overlayCanvasAnnotationOperations(serverAnnotations, pending).map((entry) => [entry.id, entry.note]),
    [["a", "local"], ["c", "later"]],
    "pending operations replay over the server snapshot in queue order",
  );
}

{
  const newerServerArtifact = {
    id: "artifact-1",
    title: "Current",
    prompt: "Current",
    code: "<main>new server code</main>",
    kind: "react" as const,
    annotations: [annotation("a", "server").annotation],
    createdAt: "2026-07-20T08:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
  };
  const synchronized = overlayCanvasArtifactSnapshot(
    newerServerArtifact,
    [annotation("a", "local pending")],
  );

  assert.equal(synchronized.code, "<main>new server code</main>", "PATCH synchronization keeps newer server code");
  assert.equal(synchronized.kind, "react", "PATCH synchronization keeps newer server kind");
  assert.equal(
    synchronized.updatedAt,
    "2026-07-20T10:00:00.000Z",
    "PATCH synchronization keeps the matching newer content revision",
  );
  assert.equal(synchronized.annotations?.[0]?.note, "local pending", "pending annotations overlay the newer snapshot");
}

{
  const snapshots: string[][] = [];
  const queue = new CanvasAnnotationOperationQueue(
    [annotation("stored", "pending")],
    (pending) => snapshots.push(pending.map(operationId)),
  );
  queue.enqueue(annotation("later", "pending"));
  assert.deepEqual(
    queue.pending().map(operationId),
    ["stored", "later"],
    "a viewer queue can initialize from navigation-durable pending operations",
  );
  assert.deepEqual(snapshots.at(-1), ["stored", "later"], "enqueue synchronously publishes persistence state");

  let release!: () => void;
  const active = new Promise<void>((resolve) => { release = resolve; });
  const drain = queue.drain(async () => active);
  await Promise.resolve();
  assert.deepEqual(
    queue.pendingAfterActive().map(operationId),
    ["later"],
    "a PATCH response overlays only operations that have not reached the server",
  );
  release();
  assert.equal(await drain, true);
  assert.deepEqual(snapshots.at(-1), [], "a confirmed drain publishes an empty queue for storage clearing");
}

console.log("canvas annotation operation queue: ok");
