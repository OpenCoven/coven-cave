# Chat: proposal-review receipt card

Issue #5520. A chat turn can carry a reviewer's verdict on a proposed action
as **evidence**. The card shows what the reviewer answered and how confident
it was; it grants nothing. There are no approve or deny controls, and it
changes no authority or approval flow. A model's self-reported confidence is
not an application-verifiable admission condition (`AGENTS.md`).

## Marker

Self-closing, attribute values quote-atomic, same conventions as every other
`coven:` marker (`docs/chat-github-integration.md` §1):

```
<coven:proposal-review tool="propose_patch" target="src/x.ts" verdict="proposal_only" reviewer="jev-1.13.0" q="addresses_task:yes:0.93|evidence_supports:yes:0.91|unrelated_changes:no:0.96|needs_clarification:yes:0.88" reason="needs clarification" />
```

| Attribute | Required | Meaning |
| --- | --- | --- |
| `tool` | yes | The proposed tool or action. |
| `target` | no | What it would act on. |
| `verdict` | no | `permit`, `proposal_only`, `reject`, or `unavailable`. Anything else renders as `unavailable`. |
| `reviewer` | no | Reviewer identity, e.g. `jev-1.13.0`. |
| `q` | yes | 1–6 `id:answer:confidence` triples separated by `\|`. Confidence is a number in `[0, 1]` or omitted. A triple that is malformed is skipped; a marker with no valid triple is dropped. |
| `reason` | no | One line of reasoning. |

Streaming rules match `skill-blocks.ts` and `auto-status-blocks.ts`: a marker
inside a code fence stays literal example text, a partial marker at the tail
hides until the stream completes it, and a malformed marker is dropped rather
than shown raw.

## Pieces

- `src/lib/proposal-review-blocks.ts` — `sliceProposalReviewBlocks()` splits a
  turn into prose and review pieces (`markdownCodeRanges` from
  `github-blocks.ts` for fences; attribute contents masked first so a backtick
  in an attribute cannot hide a later card).
- `src/components/proposal-review-card.tsx` — `ProposalReviewCard`, modeled on
  `auto-status-card.tsx`. Verdict is a semantic-state tint **and** text
  (colour is never the only signal); confidence is text (`93% confidence`),
  not a meter that would imply calibration. Fixed line: "Review verdicts are
  evidence, not permission."
- `splitSegmentsForProposalReviews` in `src/components/chat-view.tsx` runs
  outermost in the `splitSegmentsFor*` chain, so earlier splitters see the
  prose they always did.
- The directive in `src/lib/coven-marker-directive.ts` teaches the marker and
  states that a permit verdict is not permission to act.

## Tests

`src/lib/proposal-review-blocks.test.ts`, `src/components/proposal-review-card.test.tsx`,
`src/components/proposal-review-card-wiring.test.ts`, the lockstep block in
`src/lib/coven-marker-directive.test.ts`, and the daemon-less Playwright spec
`tests/chat-proposal-review-card.spec.ts`.

## Data source

Marker-fed only. No daemon event feed exists yet; a daemon-fed variant is a
separate issue. Upstream contract: OpenCoven/coven `ProposalReview` seam and
TypeSafeAI/typesafe-playground#41.
