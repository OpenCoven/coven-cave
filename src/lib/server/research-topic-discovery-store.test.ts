import assert from "node:assert/strict";
import { chmod, link, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  topicProposalVisibleTotal,
  type TopicDiscoveryJobV1,
  type TopicProposalV1,
} from "../research-protocol/topic-discovery.ts";
import {
  createTopicDiscoveryStore,
  TopicDiscoveryStoreError,
} from "./research-topic-discovery-store.ts";

function tempRoot(prefix: string): string {
  return path.join(tmpdir(), `${prefix}-${process.pid}-${Math.random().toString(36).slice(2)}`);
}

const JOB_ID = "topicjob_00000000000000000000000000000001";
const PROPOSAL_ID = "proposal_00000000000000000000000000000001";
const DIGEST = "a".repeat(64);

function validJob(overrides: Partial<TopicDiscoveryJobV1> = {}): TopicDiscoveryJobV1 {
  return {
    schema: "opencoven.topic-discovery-job/v1",
    id: JOB_ID,
    contextPackId: "ctx_abc",
    contextPackDigest: DIGEST,
    familiarId: "charm",
    status: "queued",
    requestedAt: "2026-08-28T10:00:00.000Z",
    proposalIds: [],
    ...overrides,
  };
}

function validProposal(overrides: Partial<TopicProposalV1> = {}): TopicProposalV1 {
  const scores = {
    groundability: 2,
    decisionValue: 2,
    unresolvedness: 2,
    recurrence: 2,
    novelty: 2,
    timeliness: 2,
    familiarFit: 2,
    feasibility: 2,
    humanResonance: 2,
    riskPenalty: 0,
    visibleTotal: 0,
  };
  scores.visibleTotal = topicProposalVisibleTotal(scores);
  return {
    schema: "opencoven.topic-proposal/v1",
    id: PROPOSAL_ID,
    discoveryJobId: JOB_ID,
    contextPackId: "ctx_abc",
    title: "A topic",
    question: "A question?",
    whyNow: "now",
    evidence: [
      { resourceId: "resource_abc", selector: { type: "whole-resource" }, excerpt: "x", excerptDigest: DIGEST },
    ],
    counterevidence: [],
    scores,
    suggested: { mode: "brief", deliverable: "a report", sourceTarget: 3, wallClockMinutes: 30 },
    uncertainty: "low",
    relatedMissionIds: [],
    createdAt: "2026-08-28T10:00:00.000Z",
    ...overrides,
  };
}

test("createJob publishes and rejects an invalid job id via the parser", async () => {
  const store = createTopicDiscoveryStore({ root: tempRoot("tds-id") });
  const created = await store.createJob(validJob());
  assert.equal(created.created, true);
  assert.equal((await store.getJob(JOB_ID))?.id, JOB_ID);

  for (const bad of ["topicjob_../escape", "topicjob_..", "topicjob_a b", "topicjob_", "notjob_x"]) {
    await assert.rejects(
      () => store.createJob(validJob({ id: bad })),
      (err: unknown) => err instanceof TopicDiscoveryStoreError && err.code === "invalid-job",
      `expected rejection for ${JSON.stringify(bad)}`,
    );
  }
});

test("id-only APIs reject path-escape and unsafe ids", async () => {
  const store = createTopicDiscoveryStore({ root: tempRoot("tds-id2") });
  for (const bad of ["topicjob_../escape", "topicjob_..", "topicjob_a b", "", "../topicjob_x"]) {
    await assert.rejects(
      () => store.getJob(bad),
      (err: unknown) => err instanceof TopicDiscoveryStoreError && err.code === "invalid-id",
      `expected getJob rejection for ${JSON.stringify(bad)}`,
    );
    await assert.rejects(
      () => store.updateJob(bad, "queued", (job) => job),
      (err: unknown) => err instanceof TopicDiscoveryStoreError && err.code === "invalid-id",
      `expected updateJob rejection for ${JSON.stringify(bad)}`,
    );
  }
});

test("createJob is a no-clobber publication", async () => {
  const store = createTopicDiscoveryStore({ root: tempRoot("tds-noclobber") });
  await store.createJob(validJob());
  const replay = await store.createJob(validJob());
  assert.equal(replay.created, false);
  await assert.rejects(
    () => store.createJob(validJob({ familiarId: "different" })),
    (err: unknown) => err instanceof TopicDiscoveryStoreError && err.code === "immutable-conflict",
  );
});

test("getJob refuses a symlinked job file", async () => {
  const root = tempRoot("tds-symlink");
  const store = createTopicDiscoveryStore({ root });
  await store.createJob(validJob());
  const jobsDir = path.join(root, "topic-jobs");
  const target = path.join(root, "outside.json");
  await writeFile(target, "{}", { mode: 0o600 });
  await unlink(path.join(jobsDir, `${JOB_ID}.json`));
  await symlink(target, path.join(jobsDir, `${JOB_ID}.json`));
  await assert.rejects(
    () => store.getJob(JOB_ID),
    (err: unknown) =>
      err instanceof TopicDiscoveryStoreError &&
      (err.code === "symlink" || err.code === "unsafe-path"),
  );
});

test("getJob refuses a foreign-mode (group/other writable) file", async () => {
  const root = tempRoot("tds-mode");
  const store = createTopicDiscoveryStore({ root });
  await store.createJob(validJob());
  const target = path.join(root, "topic-jobs", `${JOB_ID}.json`);
  await chmod(target, 0o666);
  await assert.rejects(
    () => store.getJob(JOB_ID),
    (err: unknown) => err instanceof TopicDiscoveryStoreError && err.code === "unsafe-path",
  );
});

test("getJob refuses a hard-linked job file", async () => {
  const root = tempRoot("tds-hardlink");
  const store = createTopicDiscoveryStore({ root });
  await store.createJob(validJob());
  const target = path.join(root, "topic-jobs", `${JOB_ID}.json`);
  const alias = path.join(root, "alias.json");
  await link(target, alias);
  await assert.rejects(
    () => store.getJob(JOB_ID),
    (err: unknown) => err instanceof TopicDiscoveryStoreError && err.code === "unsafe-path",
  );
});

test("updateJob applies a compare-and-set transition", async () => {
  const store = createTopicDiscoveryStore({ root: tempRoot("tds-cas") });
  await store.createJob(validJob());
  const result = await store.updateJob(JOB_ID, "queued", (job) => ({
    ...job,
    status: "running",
    startedAt: "2026-08-28T10:01:00.000Z",
  }));
  assert.equal(result.updated, true);
  assert.equal(result.job.status, "running");
  assert.equal((await store.getJob(JOB_ID))?.status, "running");

  // A stale expectedStatus refuses the transition.
  const stale = await store.updateJob(JOB_ID, "queued", (job) => ({ ...job, status: "completed" }));
  assert.equal(stale.updated, false);
  assert.equal(stale.job.status, "running");
});

test("proposals persist before the job is marked completed", async () => {
  const store = createTopicDiscoveryStore({ root: tempRoot("tds-order") });
  await store.createJob(validJob({ status: "running", startedAt: "2026-08-28T10:01:00.000Z" }));
  await store.putProposal(validProposal());
  // The proposal is durable before the completed transition.
  assert.equal((await store.getProposal(PROPOSAL_ID))?.id, PROPOSAL_ID);
  await store.updateJob(JOB_ID, "running", (j) => ({
    ...j,
    status: "completed",
    finishedAt: "2026-08-28T10:02:00.000Z",
    proposalIds: [PROPOSAL_ID, "proposal_b", "proposal_c"],
  }));
  const list = await store.listProposals(JOB_ID);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, PROPOSAL_ID);
  assert.equal((await store.getJob(JOB_ID))?.status, "completed");
});

test("listJobs is deterministic (requestedAt desc then id asc)", async () => {
  const store = createTopicDiscoveryStore({ root: tempRoot("tds-order2") });
  await store.createJob(validJob({ id: "topicjob_aaa", requestedAt: "2026-08-28T10:00:00.000Z" }));
  await store.createJob(validJob({ id: "topicjob_bbb", requestedAt: "2026-08-28T11:00:00.000Z" }));
  await store.createJob(validJob({ id: "topicjob_ccc", requestedAt: "2026-08-28T11:00:00.000Z" }));
  const ids = (await store.listJobs()).map((job) => job.id);
  assert.deepEqual(ids, ["topicjob_bbb", "topicjob_ccc", "topicjob_aaa"]);
});

test("the .state.json lease is never read as the job", async () => {
  const store = createTopicDiscoveryStore({ root: tempRoot("tds-lease") });
  await store.createJob(validJob());
  await store.putLease(JOB_ID, {
    version: 1,
    owner: "123@host",
    attempt: 1,
    leaseExpiresAt: "2026-08-28T11:00:00.000Z",
  });
  assert.deepEqual(await store.listJobIds(), [JOB_ID]);
  assert.equal((await store.getLease(JOB_ID))?.attempt, 1);
  await store.deleteLease(JOB_ID);
  assert.equal(await store.getLease(JOB_ID), null);
  assert.equal((await store.getJob(JOB_ID))?.id, JOB_ID);
});

test("a corrupt proposal file fails listProposals closed", async () => {
  const root = tempRoot("tds-corrupt");
  const store = createTopicDiscoveryStore({ root });
  // Create the layout through the store first so directories get mode 0700.
  await store.createJob(validJob());
  const proposalsDir = path.join(root, "topic-proposals");
  await writeFile(path.join(proposalsDir, `${PROPOSAL_ID}.json`), "not json", { mode: 0o600 });
  await assert.rejects(
    () => store.listProposals(),
    (err: unknown) => err instanceof TopicDiscoveryStoreError && err.code === "corrupt",
  );
});

console.log("research topic discovery store: ok");
