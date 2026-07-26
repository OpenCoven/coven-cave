# Response Confidence Events Design

## Goal

Add per-response familiar confidence diagnostics so Cave can track self-reported 1-100 confidence over time, correlate low confidence with factors like tool use, context, skills, permissions, memory, and evidence, and feed those rollups into Familiar Analytics and Eval Loops.

## Architecture

Response confidence is a sibling layer under the existing familiar self-report system. Thread self-reports remain the manual/end-of-thread summary. Response confidence events are append-only JSONL diagnostics stored per familiar and loaded into Familiar Analytics as a separate series.

The first implementation ships the data model, storage, listing API, analytics rollup, UI section, and eval-loop diagnostic summary. It does not yet make the chat runtime call the daemon after every assistant response; that collection hook should be added behind the existing auto-self-report setting once the storage and analytics surfaces are stable.

## Data Model

`ResponseConfidenceEvent` contains:

- identity fields: `id`, `familiarId`, `sessionId`, `responseId`, optional `turnId`, optional `threadTitle`
- timing fields: `responseAt`, `reportedAt`
- score fields: `overallConfidence` clamped to 1-100
- weighted factor map: `toolUse`, `context`, `skills`, `permissions`, `memory`, `instructionFit`, `evidence`
- each factor has `score`, `weight`, `reason`, and `signals`
- diagnostics: `diagnosticTags`, optional `calibrationNotes`, and `rubricVersion`

## Rollups

Analytics computes a `ResponseConfidenceRollup` from recent events:

- event count
- average confidence
- low-confidence count for scores below 60
- average weighted factor scores
- top diagnostic tags
- newest event

These rollups are diagnostic signals only. They do not replace tests, eval-loop outcomes, tool evidence, or human feedback.

## Storage And API

Storage stays append-only and redacted before write:

- thread reports: `<familiar workspace>/self-reports/YYYY-MM-DD.jsonl`
- response confidence events: `<familiar workspace>/self-reports/response-confidence/YYYY-MM-DD.jsonl`

New list route:

- `GET /api/familiars/:id/response-confidence?limit=100&before=<iso>`

The route validates familiar ids, supports pagination by `reportedAt`, and returns newest-first redacted events.

## UI

Familiar Analytics gets a "Response Confidence" section above Thread Signals. It shows average confidence, low-confidence turns, newest confidence, factor breakdowns, and repeated diagnostic tags.

Eval Loop gets a compact diagnostic strip when analytics data is available, so eval review can see whether recent response confidence is trending low without treating self-confidence as the source of truth.

## Testing

Tests cover:

- clamped factor and overall score normalization
- weighted rollup calculations and tag ranking
- append/list storage redaction and newest-first pagination
- analytics data fetch/model propagation
- source-level UI wiring for the new section and eval-loop confidence prop
- API contract registration for the new route
