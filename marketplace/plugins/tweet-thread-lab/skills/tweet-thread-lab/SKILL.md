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
4. Materialize every candidate with its strategy, stable ID, canonical SHA-256, and generation context.
5. Run deterministic validation and scoring. Record all findings, including failures and uncertainty.
6. Blind candidate identity before judging. Use a separate judge context or harness when available; never knowingly identify a candidate to its judge.
7. Materialize one judge scorecard per judged candidate across all six rubric dimensions.
8. Rank eligible candidates by Pareto status, weighted score, and the protocol tie order.
9. Revise only within the declared iteration, time, agent, and cost bounds. Apply the stopping rules after each round.
10. Materialize the run manifest and approval artifact. Stop at exact human approval.

## Hard gates

- Require evidence for every required claim.
- Reject schema, length, accessibility, provenance, hash, or approval failures before engagement ranking.
- Never trade a deterministic hard gate for engagement.
- Keep partial writes, failed checks, missing evidence, and uncertainty visible.
- Require exact human approval bound to the selected candidate SHA-256 before any publisher may act.
- Do not publish, schedule, authenticate to X, or fabricate a publication receipt.

## Artifacts

- Write `brief.json`, `evidence.json`, `voice-profile.json`, candidate files, deterministic result files, judge scorecards, `manifest.json`, and `approval.json`.
- Cite the `runId`, `protocolVersion`, candidate ID, candidate SHA-256, and scorecard IDs in handoffs.
- Keep artifacts valid against the checked-in schemas and portable across harnesses.

## Verification

- Recompute candidate hashes after every revision.
- Re-run deterministic validation before ranking or approval.
- Confirm judge inputs are blinded and scorecards bind to candidate hashes.
- Confirm the manifest references every materialized artifact and exposes failures or partial state.
- Confirm approval records the exact selected hash and a human actor.
- End with approval status and next safe action; do not publish.
