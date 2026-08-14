# Tweet Thread Protocol v1

Use protocol version `opencoven.tweet-thread.v1`. Treat the checked-in JSON schemas as the machine contract and this document as the portable execution contract.

## Portable run layout

Create or reuse one directory per run:

```text
runs/<run-id>/
  brief.json
  evidence.json
  voice-profile.json
  candidates/<candidate-id>.json
  deterministic/<candidate-id>.json
  judge/<scorecard-id>.json
  manifest.json
  approval.json
```

Preserve failed or partial artifacts. Never replace a failed write with an apparently complete manifest. Record missing paths, errors, and uncertainty in the handoff.

## IDs and hashes

- Use stable lowercase IDs with the schema prefixes: `run-`, `brief-`, `candidate-`, `scorecard-`, and `approval-`.
- Keep `post-1`, `post-2`, and later post IDs ordered within a candidate.
- Compute `candidateSha256` from canonical candidate content excluding the hash field.
- Canonicalize JSON with UTF-8 encoding, sorted object keys, preserved array order, and no insignificant whitespace.
- Recompute the hash after every content change. Bind scorecards and approvals to the exact candidate SHA-256.

## Normalization

- Trim surrounding string whitespace where the schema permits normalization.
- Deduplicate constrained ID and phrase lists without changing their first-seen order.
- Preserve Unicode text; do not transliterate, locale-sort, or silently rewrite evidence.
- Use RFC 3339 UTC timestamps with milliseconds.
- Keep protocol versions explicit in every versioned artifact.

## Materialization sequence

1. Write and validate the brief, evidence, and voice profile.
2. Generate three strategy-declared candidates unless the brief specifies another bounded count.
3. Write candidates before evaluation.
4. Run deterministic validation and save results separately from judge scorecards.
5. Blind candidates for judging. Keep the private mapping outside judge context.
6. Save scorecards, rank eligible candidates, and perform bounded revisions.
7. Write the manifest with every candidate, scorecard, approval, failure, and partial state available at that point.
8. Write `approval.json` only from an exact human decision bound to the selected candidate hash.

## Deterministic validation and scoring

Validate schema conformance, canonical hash, required-claim coverage, X weighted length, media descriptions and alt text, banned phrases, provenance, chronology, and scorecard bindings. A deterministic failure makes a candidate ineligible; engagement cannot override it.

Evaluate the six rubric dimensions separately on `0..1`. Remove hard-gate failures, identify Pareto-dominated candidates, then rank the non-dominated set by the brief's normalized weighted mean. Break equal totals by factuality, provenance, accessibility, coherence, voice, then ordinal candidate ID.

## Blinding

Use opaque arm tokens and a committed private mapping when the harness supports the repository blinding primitives. Give judges only public trial data. Use a separate judge context or harness when available. Never knowingly reveal strategy, candidate ID, author, model, harness, file path, or ordering metadata that identifies an arm.

If full blinding is unavailable, record the limitation before judging. Do not describe an unblinded comparison as blinded.

## Optimization and stopping

Declare iteration, agent, time, and cost bounds before revision. Continue only for a repairable failure or a below-threshold candidate with meaningful expected gain. Stop on threshold met, no meaningful gain, budget exhaustion, or hard regression. Preserve every round rather than overwriting its evidence.

## Approval boundary

Approval is the terminal action in this package. Require an exact human decision naming the selected candidate SHA-256. Do not publish, schedule, authenticate to X, or create a publication receipt. A later publisher must independently verify the approval and protocol version.

## Compatibility

Artifacts are harness-neutral JSON and Markdown. Consumers may add files but must not change v1 field meaning, accepted IDs, normalization, hash input, hard gates, or approval semantics. Unknown extensions must remain namespaced and ignorable. Cite the run ID and protocol version whenever artifacts move between harnesses.
