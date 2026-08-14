# Tweet Thread Rubric v1

Score each dimension separately from `0` to `1`. Give a concise rationale and evidence-linked findings. Do not average away a hard-gate failure.

A blinded judge must not receive candidate IDs, candidate SHA-256 values, strategy names, authorship, model identity, or private arm mappings. It records trial ID, committed public-trial SHA-256, arm token, scorecard ID/time, and the six dimensions. Candidate identity is attached only after the precommitted reveal threshold is met and the commitment is verified.

## Hard gates

A candidate is ineligible when any required schema, canonical hash, required-claim evidence, X weighted-length, banned-phrase, required alt-text, provenance, chronology, or scorecard-binding check fails. Deterministic gates outrank every judge score. Engagement never rescues an ineligible candidate.

## Dimensions

### Factuality

- `0`: Material claims are false, contradicted, or unsupported.
- `0.5`: Core claims are supported, but wording overstates evidence or leaves meaningful ambiguity.
- `1`: Every material claim matches cited evidence and expresses uncertainty precisely.

### Provenance

- `0`: Claims cannot be traced to stable evidence IDs or sources.
- `0.5`: Most claims are traceable, with incomplete attribution or weak source labeling.
- `1`: Required and material claims map cleanly to evidence IDs, labels, retrieval times, and source URLs when available.

### Accessibility

- `0`: Structure, language, media descriptions, or alt text block comprehension.
- `0.5`: The thread is understandable but has avoidable density, jargon, sequencing, or media-description friction.
- `1`: The thread is skimmable, plain enough for its audience, structurally clear, and supplies useful required alt text.

### Voice

- `0`: The candidate conflicts with the declared voice profile or impersonates unsupported authority.
- `0.5`: Tone is broadly compatible but generic or inconsistent.
- `1`: Diction, rhythm, stance, and restraint consistently match the supplied voice profile.

### Coherence

- `0`: Posts do not form a comprehensible argument or sequence.
- `0.5`: The main line is present but transitions, setup, payoff, or conclusion are uneven.
- `1`: Each post advances one clear arc with strong transitions, proportionate detail, and a satisfying close.

### Engagement

- `0`: The opening, pacing, and framing give the intended audience little reason to continue.
- `0.5`: The thread has a viable hook and useful content but uneven momentum or specificity.
- `1`: The thread earns attention through relevance, clarity, specificity, and credible tension without weakening any gate.

## Evidence requirements

While blinded, reference arm-visible post order, claim IDs, and evidence content without naming candidate identity. After verified reveal, the canonical scorecard binds the candidate SHA-256 and preserves the trial ID, public-trial SHA-256, and arm token. Distinguish observed text from interpretation. Mark missing evidence and uncertainty explicitly. Never infer factuality from writing quality, popularity, or judge confidence.

## Ranking

1. Remove hard-gate failures.
2. Mark a candidate Pareto-dominated when another eligible candidate is at least as strong in every dimension and stronger in one.
3. Rank the non-dominated set by the brief's weighted mean across all six dimensions.
4. Break equal weighted totals by factuality, provenance, accessibility, coherence, voice, then ordinal candidate ID.
5. Keep dominated and rejected candidates visible for audit.

Engagement is subordinate to deterministic gates and cannot receive an implicit veto-breaking bonus.

## Causal caution

Judge scores and later X metrics are observational signals, not proof that a strategy caused an outcome. Audience composition, timing, account history, distribution, media, and external events confound comparisons. Describe correlations as observations unless the run used a credible causal design.
