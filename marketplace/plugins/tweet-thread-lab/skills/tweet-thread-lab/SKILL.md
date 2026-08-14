---
name: tweet-thread-lab
description: Use when generating, optimizing, comparing, validating, or preparing an X/Twitter thread from a brief and evidence, or when another harness needs portable tweet-thread run artifacts. Do not use for generic one-off social posts.
---

# Tweet Thread Lab

## When to use

- Build or improve a multi-post X/Twitter thread from a brief, evidence, and voice constraints.
- Compare candidates through deterministic checks and independent judging.
- Produce portable artifacts another agent harness can inspect or continue.
- Do not use for a generic single social post.

## Inputs

- Accept a topic or `thread-brief` artifact, evidence, voice guidance, constraints, and optional run directory.
- Read `references/protocol.md`, `references/rubric.md`, and every schema in `references/schemas/`.
- Treat network access as optional evidence retrieval, never as permission to publish.

## Steps

1. Create or reuse one run directory following the protocol layout. Preserve prior artifacts.
2. Materialize the brief, evidence, voice profile, run ID, and protocol version before drafting.
3. Generate three candidates by default using declared strategies: `evidence-led`, `narrative-arc`, and `contrarian-comparison`.
4. Materialize every candidate with only the fields accepted by `thread-candidate.schema.json`: protocol version, candidate ID and SHA-256, brief, voice profile, evidence, posts, and generation timestamp.
5. Bind each materialized candidate ID and SHA-256 to its declared strategy in `strategies.json`. Keep harness, model, and context identifiers out of candidates and under private namespaced strategy extensions when needed.
6. Execute the checked-in deterministic schema, weighted-length, hash, and hard-gate modules before writing their results. When this skill runs inside `optimize-tweet-thread`, `cave.output` records those already-run results and does not execute code. Append failures, partial materialization, missing paths, uncertainty, and stopping decisions to `execution-log.jsonl`.
7. Blind candidate identity before judging. Use a separate judge context or harness when available; never knowingly identify a candidate to its judge.
8. Materialize one judge scorecard per judged candidate across all six rubric dimensions.
9. Rank eligible candidates by Pareto status, weighted score, and the protocol tie order.
10. Revise only within the declared iteration, time, agent, and cost bounds. Apply the stopping rules after each round and log the decision.
11. Materialize the strict run manifest using only its supported fields and collections. Materialize `approval.json` only for an exact human decision, then stop.

## Hard gates

- Require evidence for every required claim.
- Reject schema, length, accessibility, provenance, hash, or approval failures before engagement ranking.
- Never trade a deterministic hard gate for engagement.
- Keep partial writes, failed checks, missing evidence, and uncertainty visible.
- Require exact human approval bound to the selected candidate SHA-256 before any publisher may act.
- Do not publish, schedule, authenticate to X, or fabricate a publication receipt.

## Artifacts

- Write `brief.json`, `evidence.json`, `voice-profile.json`, `strategies.json`, `execution-log.jsonl`, candidate files, deterministic result files, judge scorecards, `manifest.json`, and, after a human decision, `approval.json`.
- Keep candidate strategy and generation context in `strategies.json`; keep execution failures and partial state in `execution-log.jsonl`.
- Keep `manifest.json` limited to `protocolVersion`, `manifestId`, `runId`, `createdAt`, `brief`, `voiceProfile`, `candidates`, `scorecards`, `approvals`, `publishReceipts`, and `observations`. Bind portable artifacts through their existing IDs and candidate hashes rather than adding fields.
- Cite the `runId`, `protocolVersion`, candidate ID, candidate SHA-256, and scorecard IDs in handoffs.
- Keep artifacts valid against the checked-in schemas and portable across harnesses.

## Verification

- Recompute candidate hashes after every revision.
- Re-run deterministic validation before ranking or approval.
- Confirm judge inputs are blinded and scorecards bind to candidate hashes.
- Validate candidates and the manifest against their strict schemas.
- Verify `strategies.json` separately: every record names one materialized candidate ID and exact SHA-256, and private strategy extensions were excluded from blinded public trials.
- Verify `execution-log.jsonl` separately: records are ordered, bounded, append-only, and cover every known failure, partial artifact, missing path, uncertainty, and stopping decision.
- Confirm approval records the exact selected hash and a human actor.
- End with approval status and next safe action; do not publish.
