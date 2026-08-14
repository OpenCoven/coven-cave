# Tweet Thread Protocol v1

Use protocol version `opencoven.tweet-thread.v1`. Treat the checked-in JSON schemas as the machine contract and this document as the portable execution contract.

## Portable run layout

Create or reuse one directory per run:

```text
runs/<run-id>/
  brief.json
  evidence.json
  voice-profile.json
  strategies.json
  execution-log.jsonl
  candidates/<candidate-id>.json
  deterministic/<candidate-id>.json
  validations/<validation-id>.json
  judge/<scorecard-id>.json
  manifest.json
  approval.json
```

Create both sidecars for every run. Preserve failed or partial artifacts. Never replace a failed write with an apparently complete manifest. Append missing paths, errors, uncertainty, and stopping decisions to `execution-log.jsonl`.

## Portable sidecars

`strategies.json` is a run-level map keyed by candidate ID. Each record binds the declared strategy to the exact materialized candidate SHA-256:

```json
{
  "protocolVersion": "opencoven.tweet-thread.v1",
  "runId": "run-example",
  "strategies": {
    "candidate-evidence-led": {
      "candidateSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "strategyId": "strategy-evidence-led",
      "name": "evidence-led",
      "round": 0,
      "extensions": {
        "com.example.harness/private": {
          "harnessId": "harness-example",
          "modelId": "model-example",
          "contextId": "context-example"
        }
      }
    }
  }
}
```

Candidate IDs are unique keys, SHA-256 values must match the candidate files, `round` is a non-negative integer, and a run has at most 128 strategy records. `protocolVersion`, `runId`, `candidateSha256`, `strategyId`, `name`, and `round` are portable fields. `extensions` is optional; extension keys must use an owned reverse-DNS or URI-style namespace. Harness, model, prompt, agent, and context identifiers belong only in a private namespace such as `com.example.harness/private`. Exclude the entire strategy sidecar and all private extensions from blinded public trial and judge inputs.

`execution-log.jsonl` is append-only. Each UTF-8 line is one compact JSON object:

```json
{"protocolVersion":"opencoven.tweet-thread.v1","runId":"run-example","eventId":"event-0001","sequence":1,"recordedAt":"2026-08-14T12:00:00.000Z","kind":"partial-materialization","message":"Candidate write stopped before rename.","candidateId":"candidate-evidence-led","path":"candidates/candidate-evidence-led.json","code":"WRITE_INCOMPLETE","decision":"stop"}
```

Required fields are `protocolVersion`, `runId`, `eventId`, positive monotonic `sequence`, millisecond UTC `recordedAt`, `kind`, and `message`. `kind` is one of `failure`, `partial-materialization`, `missing-path`, `uncertainty`, or `stopping-decision`. Optional portable fields are `candidateId`, `candidateSha256`, run-relative `path`, `code`, and `decision` (`continue` or `stop`). Optional extensions follow the same namespacing rule as `strategies.json`; secrets and private stack traces do not belong in the log. Limit each line to 16 KiB, `message` to 2,000 characters, and a run to 1,024 events. If the cap is reached, use the final admissible event for a `stopping-decision` and stop rather than dropping evidence.

## IDs and hashes

- Use stable lowercase IDs with the schema prefixes: `run-`, `brief-`, `candidate-`, `scorecard-`, and `approval-`.
- Keep `post-1`, `post-2`, and later post IDs ordered within a candidate.
- Compute `candidateSha256` from canonical candidate content excluding the hash field.
- Canonicalize with RFC 8785 JSON Canonicalization Scheme (JCS), encode the resulting text as UTF-8, then compute SHA-256. JCS preserves array order, sorts object properties by UTF-16 code units, applies ECMAScript number serialization, and emits no insignificant whitespace.
- Recompute the hash after every content change. Bind scorecards and approvals to the exact candidate SHA-256.

## Normalization

- Trim surrounding string whitespace where the schema permits normalization.
- Deduplicate constrained ID and phrase lists without changing their first-seen order.
- Preserve Unicode text; do not transliterate, locale-sort, or silently rewrite evidence.
- Use RFC 3339 UTC timestamps with milliseconds.
- Keep protocol versions explicit in every versioned artifact.

## Materialization sequence

1. Create an empty `execution-log.jsonl`, then write and validate the brief, evidence, and voice profile.
2. Generate three candidates from declared strategies unless the brief specifies another bounded count.
3. Give every candidate a stable ID, canonicalize and hash it, and write only fields accepted by `thread-candidate.schema.json`.
4. Write or update `strategies.json` so each successful candidate ID maps to its exact SHA-256 and declared strategy. Log failed generations or writes instead of inventing candidate fields.
5. From the plugin root run `node bin/tweet-thread-validate.mjs validate <candidate.json> [brief.json]`. Save its strict JSON stdout to `deterministic/<candidate-id>.json`. Exit `0` accepts, exit `1` rejects through deterministic hard gates, and exit `2` is a safe usage/read/parse/runtime contract error. Before any manifest or approval, convert the raw result into one strict `validation-` record containing `protocolVersion`, stable `validationId`, `candidateSha256`, caller-supplied `validatedAt`, `accepted`, `findings`, and `measurements`; save it under `validations/`. Append failures, partial materialization, missing paths, and uncertainty to the execution log.
6. Blind candidates for judging. Keep `strategies.json`, its private extensions, and the private arm mapping outside judge context.
7. Save scorecards, rank eligible candidates, perform bounded revisions, and append every stopping decision.
8. Write `manifest.json` with only the strict schema fields: `protocolVersion`, `manifestId`, `runId`, `createdAt`, `brief`, `voiceProfile`, `candidates`, `validations`, `scorecards`, `approvals`, `publishReceipts`, and `observations`. Use the candidate IDs, candidate SHA-256 values, validation IDs, scorecard IDs, approval IDs, receipt IDs, and observation IDs already supported by those artifacts; do not add strategy, generation-context, failure, partial-state, path, or sidecar fields.
9. Write `approval.json` only from an exact human decision bound to the selected candidate hash.

## Deterministic validation and scoring

Validate schema conformance, canonical hash, required-claim coverage, X weighted length, media descriptions and alt text, banned phrases, provenance, chronology, and scorecard bindings. A deterministic failure makes a candidate ineligible; engagement cannot override it. A validation record is internally consistent only when `accepted` is true exactly when it has no `fail` finding.

Evaluate the six rubric dimensions separately on `0..1`. Remove hard-gate failures, identify Pareto-dominated candidates, then rank the non-dominated set by the brief's normalized weighted mean. Break equal totals by factuality, provenance, accessibility, coherence, voice, then ordinal candidate ID.

## Blinding

Use opaque arm tokens and a committed private mapping when the harness supports the repository blinding primitives. Every candidate in one trial must carry deeply identical brief and voice-profile content. Give judges one committed non-identifying context containing topic, audience, objective weights, constraints, and voice tone/do/dont, plus public arm data. Omit brief and voice IDs, voice display name, candidate IDs and hashes, timestamps, strategy, author, model, harness, file path, and ordering metadata. Use a separate judge context or harness when available.

If full blinding is unavailable, record the limitation before judging. Do not describe an unblinded comparison as blinded.

## Optimization and stopping

Declare iteration, agent, time, and cost bounds before revision. Continue only for a repairable failure or a below-threshold candidate with meaningful expected gain. Stop on threshold met, no meaningful gain, budget exhaustion, or hard regression. Preserve every round rather than overwriting its evidence.

## Approval boundary

Approval is the terminal action in this package. Require an exact human decision naming the selected candidate SHA-256. Before approval, require exactly one current accepted validation record bound to that hash, no `fail` validation finding, and at least one bound scorecard with no `fail` finding. Validation and scoring must be at or after candidate generation; approval must be at or after both. Do not publish, schedule, authenticate to X, or create a publication receipt. A later publisher must independently verify the same gate evidence, approval, and protocol version.

## Compatibility

Artifacts are harness-neutral JSON, JSONL, and Markdown. Canonical candidates, validations, scorecards, and manifests remain closed schemas: consumers must not add strategy, generation-context, execution, failure, partial-state, or sidecar fields to them. Consumers may add files and may extend the two sidecars only under an owned key inside `extensions`; unknown namespaced extensions must remain ignorable. Sidecars bind back to canonical artifacts through existing run IDs, candidate IDs, and candidate SHA-256 values, not new manifest fields. Consumers must not change v1 field meaning, accepted IDs, normalization, JCS hash input, hard gates, or approval semantics. Cite the run ID and protocol version whenever artifacts move between harnesses.
