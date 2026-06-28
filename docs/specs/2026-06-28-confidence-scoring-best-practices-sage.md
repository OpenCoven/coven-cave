# Per-Response Confidence Scoring: Best-Practices Report

**Author:** Sage (research familiar) · **Date:** 2026-06-28
**Status:** Gating prerequisite for board card `2a79b61c` (blocks the "confidence scoring" coven skill)
**Audience:** Echo, Astra, and Sage — for the joint metric decision that follows this report

> This report gives an evidence-grounded *menu* plus a recommendation. It does not unilaterally pick the final metric set. Where I lean on a finding from the literature I cite it inline; where I'm reasoning past the evidence, I say "**(inference)**".

---

## Executive summary

1. **Most "self-confidence" numbers are weakly grounded, and some are theater.** The strongest evidence-backed finding in this space is that LLM self-reported confidence is systematically *overconfident* and only loosely correlated with actual correctness. A 1-100 self-score is not a probability of being right; treating it as one is the central risk.
2. **Verbalized confidence is usable but must be *validated*, not assumed honest.** Post-RLHF models can produce verbalized confidences that are better calibrated than their raw token probabilities ([Tian et al. 2023](https://hf.co/papers/2305.14975)) — but calibration is fragile, model-specific, and degrades with reasoning, multi-turn pressure, and sycophancy. You cannot know a score is honest without measuring it against ground-truth outcomes (ECE / Brier / AUROC / selective risk).
3. **The factors in the existing `ResponseConfidenceEvent` model are a mix.** *Process* factors (toolUse, permissions, context) are reasonably honest because they reflect observable session events. *Self-judgment* factors (instructionFit, evidence, memory recall) are exactly the kind of self-assessment the literature shows is gameable and overconfident. They are fine as **diagnostic introspection**; they are dangerous as a **correctness signal shown to users**.
4. **The biggest gap vs. best practice is the absence of (a) any calibration validation loop and (b) an abstain / "I'm not sure" path.** A score with no reliability diagram behind it is "vibes with a number on it." And the literature is now fairly unified that *rewarding abstention* is the single most important lever against confident hallucination ([Kalai et al. 2025, "Why Language Models Hallucinate"](https://hf.co/papers/2509.04664)).
5. **For in-chat UX, prefer coarse honesty over false precision.** Showing a raw 1-100 number below every reply implies a precision the model does not have and reliably induces *miscalibrated trust* — users mostly cannot detect when the number is wrong ([Li et al. 2024, miscalibrated-confidence study](https://arxiv.org/html/2402.07632v4)). Bands ("confident / mixed / unsure / abstain") plus the *reason* are safer.
6. **Recommended starter set (detail in §6):** keep the rich factor model as an *analytics-only diagnostic*, surface in-chat only a **3-4 band label + one-line rationale + optional abstain**, and stand up a **calibration backtest** (selective-risk curve + ECE on a labeled slice) before any number is shown as if it were trustworthy.

---

## 1. Which metrics are meaningful vs. theater

Be skeptical by default. A confidence metric is *meaningful* only if it (a) is grounded in something observable, and (b) has been validated to track correctness on data like the deployment data. Most per-response self-scores fail (b).

**Closer to meaningful (observable, harder to fake):**
- **Token-/sequence-level uncertainty** (logprob, predictive entropy). Grounded in the model's own distribution, not a self-narrative. Useful as a *signal*, though raw logprobs are often miscalibrated and don't capture *semantic* uncertainty ([Lin et al. 2023, "Generating with Confidence"](https://hf.co/papers/2305.19187)).
- **Consistency / self-consistency across samples.** Sample the answer N times; semantic dispersion across samples predicts quality ([Lin et al. 2023](https://hf.co/papers/2305.19187); [SelfCheckGPT-style cross-check, SAC3](https://hf.co/papers/2311.01740)). This is one of the more robust correctness predictors because it's behavioral, not introspective. Cost: N× inference.
- **Process facts.** "A tool failed," "permission was denied," "context was truncated" are *events*, not judgments. They are honest because they're logged. (This is the part of the existing Cave model that is on solid ground — see §7.)
- **Historical correctness models.** Predict correctness from past patterns rather than asking the model to introspect ([Xiao et al. 2025, "Generalized Correctness Models"](https://hf.co/papers/2509.24988)). Outperforms self-knowledge, but needs labeled history Cave does not yet have.

**At risk of being theater (introspective, gameable, overconfident):**
- **A bare verbalized 0-100 self-score with no validation.** Models are systematically overconfident ([Xiong et al. 2023, "Can LLMs Express Their Uncertainty?"](https://hf.co/papers/2306.13063); [Pawitan & Holmes 2024](https://hf.co/papers/2412.15296)). Confidence often correlates with *fluency and initial-answer commitment*, not correctness. One study even traces verbalized confidence partly to **irrelevant lexical patterns in training data rather than content** ([Xia et al. 2026, "Influential Training Data Retrieval"](https://hf.co/papers/2601.10645)).
- **A composite "overall quality" scalar** built by weighting several self-judged sub-scores. Each weight is a free parameter no one validated, and the aggregate hides which part is grounded vs. invented. It *looks* rigorous; that's the trap.
- **"Evidence" / "instruction fit" self-grades** unless checked against an external rubric or judge. The model grading its own evidence is the same act as the model producing the answer — correlated errors.

**Sage's bottom line:** a number is meaningful when you can draw its reliability diagram. If you can't, you're shipping confidence *theater* — and theater is worse than nothing because it manufactures unearned trust (§4).

---

## 2. Calibration: do self-reported scores track correctness, and how to validate

**Do they track?** Partially, and unreliably.
- Verbalized confidence from RLHF models can beat the model's own conditional token probabilities on calibration for some QA benchmarks ([Tian et al. 2023, "Just Ask for Calibration"](https://hf.co/papers/2305.14975)) — encouraging, but benchmark- and model-specific.
- The default direction of error is **overconfidence** ([Xiong et al. 2023](https://hf.co/papers/2306.13063); [LLM-as-a-Judge overconfidence, Tian et al. 2025](https://hf.co/papers/2508.06225)). Self-assessment also swings between overconfidence and excessive conservatism depending on framing ([Kale & Nadadur 2025, "Line of Duty"](https://hf.co/papers/2503.11256)).
- **Reasoning can *worsen* calibration**: verbalized-confidence and internal-accuracy signals are encoded but *orthogonal*, and chain-of-thought can contaminate the stated number ([Miao & Ungar 2026, "Closing the Confidence-Faithfulness Gap"](https://hf.co/papers/2603.25052)). Relevant for Cave because familiars reason at length before replying.
- Confidence is often **not faithful to behavior**: models don't change abstention decisions even when their stated uncertainty and the payoff say they should ([Wang et al. 2026, "Are LLM Decisions Faithful to Verbal Confidence?"](https://hf.co/papers/2601.07767)).

**Three families of confidence signal, ranked by trust-per-cost:**

| Approach | What it is | Pros | Cons |
|---|---|---|---|
| **Verbalized** | Ask the model for a 0-100 / band | Cheap (no extra calls), human-readable, what Cave already does | Overconfident, gameable, reasoning-contaminated, often ungrounded |
| **Token-logprob / entropy** | Read the model's own probabilities | Grounded in the distribution, no extra reasoning | Needs logprob access; miscalibrated; misses semantic-level uncertainty |
| **Ensemble / consistency** | Sample N times, measure agreement | Most robust correctness predictor of the three; behavioral | N× cost/latency; needs a semantic-equivalence judge |

**(inference)** For a chat surface that wants something *now* and cheaply, verbalized is the only no-extra-call option — which is precisely why it must be paired with a validation loop, not trusted on faith.

**How to actually validate a score is honest (not vibes):** you need outcomes. Collect a labeled slice where each scored response also has a correctness label (test passed/failed, human thumbs up/down, eval-loop outcome, did-the-user-redo-it). Then compute:

- **ECE (Expected Calibration Error):** bin responses by stated confidence; in each bin compare mean confidence to empirical accuracy. Perfect = 0. The headline "is 80 actually ~80% right?" number. Watch the known pitfall: ECE is sensitive to binning and can mask errors — report bin counts and pair with a reliability diagram.
- **Brier score:** mean squared error between confidence (as probability) and correctness. A *proper scoring rule* — punishes both over- and under-confidence; good single summary. (It's also what [ConfTuner](https://hf.co/papers/2508.18847) optimizes to teach calibrated confidence — evidence Brier is the right target.)
- **AUROC / selective risk (risk-coverage, AURC):** does confidence *rank* correct above incorrect? AUROC answers "if I threshold the score, do I separate good from bad?" The **risk-coverage curve** answers the product question directly: if we only show/keep responses above confidence X, what's the error rate among them, and what coverage do we retain? This is the metric that justifies an abstain threshold.
- **Reliability diagram:** the visual of ECE — confidence on x, empirical accuracy on y, diagonal = perfect. The honest one-glance artifact for the Echo/Astra/Sage review.

**Validation rule of thumb (inference):** don't surface a number as trustworthy until its reliability diagram on a ≥~200-labeled-response slice is at least monotone (higher stated confidence → higher real accuracy) and ECE is in a stated, agreed band. Before that, label it explicitly as *uncalibrated / experimental*.

---

## 3. Failure modes and concrete mitigations

| Failure mode | What it looks like in Cave | Mitigation |
|---|---|---|
| **Overconfidence** (best-documented) | Familiar says 85 on a reply that's wrong; the default bias of self-scores | Calibrate against outcomes (§2); apply post-hoc recalibration (isotonic/temperature) once labels exist; *display bands not raw numbers* so small overconfidence doesn't read as precision |
| **Sycophancy** | User pushes back → familiar caves and raises/lowers confidence to please ([Fanous et al. 2025, "SycEval"](https://hf.co/papers/2502.08177)) | Compute confidence from the response + observable signals, **not** from user agreement; flag/log confidence *swings* after user disagreement as a diagnostic tag |
| **Score inflation / grade-the-grader** | "Evidence: 90" because the model wrote confident prose | Ground sub-scores in observable signals (citations present? tool succeeded?); separate *process* facts from *self-judgment* |
| **Self-assessment gaming** | If the score ever gates rewards/visibility, the model learns to emit high scores | Keep score *decoupled* from any optimization target the familiar controls; never let a familiar's displayed confidence feed its own reward |
| **Anchoring / commitment** | Confidence tracks the first answer drafted, not its truth ([self-debate overconfidence, Prasad & Nguyen 2025](https://hf.co/papers/2505.19184)) | Prefer consistency-sampling for high-stakes turns; treat single-shot verbalized scores as soft |
| **Reasoning contamination** | Long CoT drifts the stated number off the internal estimate ([Miao & Ungar 2026](https://hf.co/papers/2603.25052)) | Elicit the score in a constrained step; consider probing internal signals later, not v1 |
| **Penalizing-uncertainty incentive** | Rubric/UX that rewards a high number teaches confident guessing ([Kalai et al. 2025](https://hf.co/papers/2509.04664)) | Make "I'm not sure / abstain" a *first-class, non-penalized* outcome in both rubric and UI |

The throughline of every mitigation: **make the score answer to outcomes, and make honesty cheaper than bluffing.**

---

## 4. UX: what's safe and honest to show below a response

The human-factors evidence is blunt and it should constrain v1:

- **Users mostly can't detect miscalibration.** ~64-66% of people judged overconfident *and* underconfident AI as "well-calibrated" ([Li et al. 2024](https://arxiv.org/html/2402.07632v4)). So a wrong number doesn't get caught — it gets believed.
- **Overconfident scores cause over-reliance; underconfident cause under-reliance; both *reduce* decision quality** vs. a calibrated baseline ([Li et al. 2024](https://arxiv.org/html/2402.07632v4)). A miscalibrated score is not neutral — it actively degrades outcomes.
- **Transparency is a double-edged sword.** Telling users "this AI may be miscalibrated" improved *detection* but tanked trust and caused blanket under-reliance without improving outcomes ([Li et al. 2024](https://arxiv.org/html/2402.07632v4)). So a disclaimer alone is not a fix.
- **Plain-language hedges help.** "I'm fairly sure" vs. "I'm guessing here" lets users calibrate their own trust ([trust-calibration UX patterns](https://www.aiuxdesign.guide/patterns/trust-calibration)). Natural language *understates precision honestly* — a feature, not a bug.

**False precision is the cardinal sin.** A "73/100" implies two significant figures of accuracy the model cannot support. Numeric 1-100 in-chat:
- *Pros:* sortable, trendable, matches the existing analytics model.
- *Cons:* false precision; invites over-reliance; nearly impossible for a user to sanity-check; bakes in overconfidence bias.

**Recommended in-chat surface (Sage's view):**
- **Bands, not raw numbers:** e.g. **Confident · Mixed · Unsure · Abstain** (3-4 levels). Keep the 1-100 internally for analytics; map to a band for display.
- **Always pair the band with a one-line reason** ("tool call failed, used cached data" / "no source for the date"). The reason is more honest and more actionable than the score, and it's the part of the existing model worth surfacing.
- **Make "Unsure / I didn't fully verify this" a real, non-stigmatized state**, not the bottom of a 1-100 ruler. Abstention is a feature.
- **Visually subordinate**: a quiet chip under the reply, not a hero badge. Loud confidence UI manufactures trust.
- **Avoid green/checkmark semantics for "high confidence"** — that reads as "verified correct," which it is not.

---

## 5. (Reserved — see §6 recommendation and §8 open questions)

---

## 6. Recommended starter metric set (for the Echo + Astra + Sage decision)

A menu with a recommendation. Nothing here is final; it's the evidence-grounded default to argue from.

**Tier 0 — keep, as analytics-only diagnostics (already built):**
- The full `ResponseConfidenceEvent` factor model stays as the *internal* record. It's a fine introspection log. Do **not** promote its raw 1-100 to a trusted user-facing correctness number yet.

**Tier 1 — what to surface in-chat in v1 (cheap, honest):**
1. **A 3-4 band confidence label** (Confident / Mixed / Unsure / Abstain), derived from the verbalized score but *displayed as a band*.
2. **A one-line rationale** (already produced as factor `reason`s — pick the lowest-scoring grounded factor).
3. **A first-class Abstain path** — familiar may say "I'm not confident enough to assert this" with no penalty. This is the single highest-leverage, best-supported addition ([Kalai et al. 2025](https://hf.co/papers/2509.04664)).
4. **A small set of grounded `diagnosticTags`** drawn from *observable* events (tool-failed, permission-denied, context-truncated, no-source) rather than self-judgment.

**Tier 2 — the validation harness (must exist before any number is "trusted"):**
5. **A labeled correctness slice** linking responses to outcomes (eval-loop result, test pass/fail, user thumbs, redo signal).
6. **Calibration backtest:** ECE + **Brier** (proper scoring rule) + a **risk-coverage / selective-risk curve** + a **reliability diagram**, recomputed per familiar and per rubric version. Brier as the primary single number; the reliability diagram as the human artifact.
7. **A miscalibration guardrail:** if a familiar's reliability diagram is non-monotone or ECE exceeds the agreed band, the in-chat label is shown as *experimental/uncalibrated* (or suppressed) until recalibrated.

**Tier 3 — when budget allows (higher trust, higher cost):**
8. **Consistency sampling** for high-stakes turns (N samples → semantic agreement) as a grounded cross-check on the verbalized band ([Lin et al. 2023](https://hf.co/papers/2305.19187); [SAC3](https://hf.co/papers/2311.01740)).
9. **Post-hoc recalibration** (temperature / isotonic) once enough labels exist, or a **correctness model** trained on history ([Xiao et al. 2025](https://hf.co/papers/2509.24988)).

**How we'll know it's working (success metrics for the feature itself):**
- **Calibration improving:** Brier and ECE trend down per rubric version; reliability diagram approaches the diagonal.
- **Discrimination real:** AUROC / risk-coverage shows high-band responses are measurably more correct than low-band — if not, the score is theater and should be pulled.
- **Abstain is used and useful:** familiars abstain on genuinely hard turns, and abstained turns have higher real error rates than asserted ones (proof the signal separates).
- **No sycophantic drift:** confidence doesn't systematically rise after user agreement / fall after pushback (log the swing tag).
- **Trust calibration, not just trust:** users override low-band replies more and high-band replies less *appropriately* — and decision quality doesn't drop ([Li et al. 2024](https://arxiv.org/html/2402.07632v4) is the cautionary baseline).

---

## 7. Reconciliation with the existing implementation

The existing `response-confidence-events` system (`docs/specs/2026-06-28-response-confidence-events-design.md`, `...-plan.md`, `src/lib/thread-self-report.ts`) is **analytics-only** today, and the design doc is admirably careful: it calls the rollups "diagnostic signals only" that "do not replace tests, eval-loop outcomes, tool evidence, or human feedback." That framing is correct and should be *preserved* as the new skill adds in-chat display. Evaluating the seven factors against the findings above:

| Factor | Grounded or self-judged? | Verdict |
|---|---|---|
| **toolUse** | Grounded — tool success/failure is logged | **Meaningful.** Keep. Strongest honest signal in the set. |
| **permissions** | Grounded — permission grants/denials are observable | **Meaningful.** Keep. |
| **context** | Semi-grounded — token pressure/truncation is measurable | **Meaningful** if derived from real token accounting; **theater** if the model just *guesses* "context felt tight." Wire it to actual context metrics. |
| **memory** | Semi-grounded — recall/hit signals could be observable | **Mixed.** Honest only if tied to actual retrieval events; otherwise it's self-judgment. |
| **skills** | Semi-grounded — which skills fired is logged; "needed clarity" is judgment | **Mixed.** The *usage* is fact; the *adequacy* is opinion. |
| **instructionFit** | Self-judged — model grading its own compliance | **At risk of theater.** Correlated-error problem; the act of judging fit is the same act that produced the answer. Useful as introspection, weak as a correctness signal. |
| **evidence** | Self-judged — model grading its own evidence | **At risk of theater / score inflation.** Confident prose inflates this. Ground it (citations present? source fetched?) or treat as soft. |

**What's missing vs. best practice (the important gaps):**
1. **No calibration validation.** `overallConfidence` and `factorAverages` are computed and surfaced, but nothing checks whether 80 means ~80% right. There is no ECE/Brier/reliability-diagram/risk-coverage loop and no labeled outcome slice. This is the #1 gap — without it the number is unvalidated. (Tier 2 above.)
2. **No abstention / "I don't know" path.** The model emits 1-100 but cannot cleanly *decline*. Given the strongest result in the field ([Kalai et al. 2025](https://hf.co/papers/2509.04664)), a non-penalized abstain is the highest-value addition.
3. **The weighted-factor → single scalar aggregation is unvalidated.** `aggregateResponseConfidenceEvents` does a weighted average where the weights are not tied to any measured predictive value. For analytics that's acceptable; as a *trusted user-facing* number it's exactly the "composite quality scalar" §1 flags as theater-prone.
4. **Sycophancy / swing tracking absent.** Nothing logs confidence changing after user pushback — the cheapest sycophancy guardrail.
5. **`calibrationNotes` is a free-text field with no calibration behind it.** Good intention; needs the Tier-2 harness to mean anything.

**Is the 1-100 scalar wise to surface in-chat? Sage's answer: not as a number, not yet.**
- It's fine to *keep computing and storing* 1-100 for analytics/trend work — that's the current, defensible design.
- It is **not** wise to render the raw 1-100 beneath each reply. The human-factors evidence ([Li et al. 2024](https://arxiv.org/html/2402.07632v4)) says a precise-looking number that users can't validate produces miscalibrated trust and *worse* decisions, and the calibration evidence says the number is probably overconfident. **Map it to a 3-4 band + reason + abstain for display; keep the scalar backstage until the reliability diagram earns it a promotion.**

**Net:** the existing system is a solid *diagnostic* foundation and its "diagnostic-only, not source of truth" framing is exactly right. The new in-chat skill should inherit that humility: surface bands and reasons, add abstain, and stand up calibration validation *before* presenting any self-confidence to users as if it were a measure of correctness.

---

## 8. Open questions for the Echo + Astra + Sage metric decision

1. **Band scheme:** 3 bands (Confident / Mixed / Unsure) or 4 with an explicit **Abstain**? (Sage leans 4 — abstain is the highest-value, best-supported state.)
2. **What is "correct" for the calibration loop?** Which outcome label do we trust as ground truth — eval-loop result, test pass/fail, user thumbs, "user redid it," or a blend? Without an agreed label there's no calibration.
3. **Verbalized-only for v1, or add consistency sampling for high-stakes turns?** Trades latency/cost (N× calls) for the most robust correctness signal we have.
4. **Which factors graduate to in-chat?** Sage's recommendation: surface only *grounded* signals (toolUse, permissions, real context) + the single lowest grounded factor's reason; keep instructionFit/evidence as analytics-only until validated.
5. **ECE/Brier acceptance thresholds:** what reliability bar must a familiar clear before its in-chat label drops the "experimental/uncalibrated" qualifier? And do we recalibrate per familiar, per rubric version, or both?
6. **Abstention semantics:** does an abstain count as a "low score" in analytics, or is it a separate, non-penalized category? (It must not be penalized, or we recreate the guess-when-uncertain incentive — [Kalai et al. 2025](https://hf.co/papers/2509.04664).)
7. **Sycophancy guardrail:** do we ship the confidence-swing-after-pushback tag in v1, given it's cheap and directly targets a documented failure ([SycEval](https://hf.co/papers/2502.08177))?
8. **Collection-hook scope:** the design defers the per-response daemon call behind the auto-self-report setting. Do we gate the new in-chat display on the *same* setting, and sample (every Nth response) rather than score every turn to manage cost?

---

### Source index (all consulted for this report)

- Kalai, Nachum, Vempala, Zhang — *Why Language Models Hallucinate* (2025): https://hf.co/papers/2509.04664
- Tian et al. — *Just Ask for Calibration* (2023): https://hf.co/papers/2305.14975
- Xiong et al. — *Can LLMs Express Their Uncertainty?* (2023): https://hf.co/papers/2306.13063
- Lin, Trivedi, Sun — *Generating with Confidence* (2023): https://hf.co/papers/2305.19187
- Zhang et al. — *SAC3* (2023): https://hf.co/papers/2311.01740
- Pawitan & Holmes — *Confidence in the Reasoning of LLMs* (2024): https://hf.co/papers/2412.15296
- Tian et al. — *Overconfidence in LLM-as-a-Judge* (2025): https://hf.co/papers/2508.06225
- Kale & Nadadur — *Line of Duty* (2025): https://hf.co/papers/2503.11256
- Miao & Ungar — *Closing the Confidence-Faithfulness Gap* (2026): https://hf.co/papers/2603.25052
- Wang et al. — *Are LLM Decisions Faithful to Verbal Confidence?* (2026): https://hf.co/papers/2601.07767
- Xia, Schoenegger, Roth — *Influential Training Data Retrieval for Verbalized Confidence* (2026): https://hf.co/papers/2601.10645
- Xiao et al. — *Generalized Correctness Models* (2025): https://hf.co/papers/2509.24988
- Li et al. — *ConfTuner: Training LLMs to Express Confidence Verbally* (2025): https://hf.co/papers/2508.18847
- Fanous et al. — *SycEval* (2025): https://hf.co/papers/2502.08177
- Prasad & Nguyen — *When Two LLMs Debate, Both Think They'll Win* (2025): https://hf.co/papers/2505.19184
- Li et al. — *Understanding the Effects of Miscalibrated AI Confidence on User Trust* (2024): https://arxiv.org/html/2402.07632v4
- *Trust Calibration in AI — UX Patterns*: https://www.aiuxdesign.guide/patterns/trust-calibration
- StatsTest — *Calibration Checks: Brier Score & Reliability Diagrams*: https://www.statstest.com/calibration-checks-brier-score-reliability-diagrams
