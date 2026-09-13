# Research Studio podcast quality

Research podcasts need three separate kinds of quality: faithful source text,
an appropriate voice and delivery, and usable audio. A successful HTTP response
from a speech provider proves none of those by itself.

## Diagnosis

The investigation for `cave-2idgp` found several independent contributors:

| Layer | Observed behavior | Consequence |
| --- | --- | --- |
| Source extraction | The shared slide extractor favored bullets or the first body line, not complete wrapped paragraphs | Later qualifications and prose could disappear before narration |
| Evidence labels | Citation cleanup removed confidence and inference markers along with source IDs | A tentative result could sound more certain than its source |
| Script | Deterministic dialogue templates surround extractive research prose; editorial directions are stored, not interpreted | A dialogue-shaped draft is not the same as a naturally written conversation |
| Voice choice | Host and guest could use the same voice, without an audition step | Users could discover an unsuitable or indistinguishable voice only after rendering |
| Local readiness | Downloaded voice files were treated as ready without checking the speech executable | An apparently available choice could fail immediately at synthesis |
| Local catalog | Research offered model downloads rather than the shared named-speaker catalog | Additional Kokoro speakers in an installed bundle were hidden |
| Audio | Hosted podcast output was 16 kHz PCM; segments had no level alignment; silent or malformed output could survive assembly | Limited bandwidth, uneven level and unusable output were not distinguished from success |

A local inspection of existing generation metadata confirmed missing-Piper
failures despite a selected installed voice. A previously successful hosted
episode measured 16 kHz, mono, 16-bit PCM. Its peak was -0.007 dBFS and RMS was
-16.72 dBFS. That is evidence of little peak headroom, **not proof of clipping**:
the measured sample extrema did not reach the integer rails. No listening panel
or subjective naturalness score was collected. Private research text and audio
were not uploaded for this investigation.

The offline model already differed from the realtime voice default before this
change. Model selection, voice settings and adjacent-text context also already
existed. Reintroducing them would not address the remaining problems.

## Voice-selection workflow

Choose local speech explicitly to keep synthesis on the machine, or choose
ElevenLabs explicitly to send the reviewed script to that hosted provider.
Local speech is not silently replaced with hosted speech when a runtime is
unavailable. Configuring a key is not proof that a hosted account or voice works.

Select the narrator, or host and guest, by name from the available voice
dropdowns. Use a short audition before rendering. Auditions use fixed public
sample text rather than the research artifact; they still consume hosted speech
usage when ElevenLabs is selected. A sample helps compare voice character and
delivery but cannot predict pronunciation of every technical name in the episode.

Review the actual draft. The script remains source-extractive, with complete
paragraphs, list continuations and evidence qualifications preserved within the
selected length budget. References, provenance and code are not narration.
Directions are not a hidden rewriting instruction.

Keep advanced model, delivery and seed choices consistent between audition and
render. A seed is best-effort reproducibility, not a deterministic-output
guarantee.[^speech-api] Voice selection and the wording of the script interact
with delivery settings; raising expressiveness does not reliably improve every
voice.[^speech-practice]

## Reliability boundary

The pipeline rejects unusable waveforms before publishing ready media,
preserves the selected provider and voice, bounds resources, and surfaces
failures. It does not retry paid generation blindly, silently switch voices,
or call a waveform metric a measure of human naturalness.

Level alignment is bounded PCM RMS processing with peak headroom. It is not
LUFS normalization, a mastering compressor, a pronunciation check, or a semantic
transcription check. Increasing the hosted podcast sample rate preserves more
available speech bandwidth; it does not create missing vocal detail or repair
an unnatural script.

Hosted podcasts now request 24 kHz PCM; the shared video path keeps its existing
16 kHz default. Preparation targets -20 dBFS active-sample RMS with at most 6 dB
of gain adjustment and -1 dBFS sample-peak headroom. Segments must contain
nonconstant audible signal, have consistent PCM metadata, last at least 100 ms,
and stay within the segment budget. More than 1% of active samples at integer
full-scale rails is rejected as clipping. These are conservative fault gates,
not a certification of intelligibility.

One fixed-public-text Rachel audition through the real hosted provider produced
a 7.941-second, 24 kHz mono WAV. Its measured sample peak was -3.58 dBFS and its
whole-clip RMS, including pauses, was -22.09 dBFS. This confirms the real output
path, not a before/after listening comparison; the old episode and this sample
contain different text.

The practical promise is **auditionable choices, faithful reviewable input,
consistent audio handling and visible failures**, not "human-like every time."
Neural speech can still mispronounce names, omit words, vary prosody or generate
artifacts while producing a structurally valid waveform.

## Deferred: reviewed spoken-language rewriting

Issue [#4689](https://github.com/OpenCoven/coven-cave/issues/4689) also calls for
an optional local-model rewrite. That stage is **not implemented by this change**.
Do not close the issue merely because voice and audio improvements have landed.

A safe extension would:

1. Keep the current extractive draft as an immutable comparison source. Carry
   citation provenance alongside it before spoken cleanup removes ledger IDs.
2. Run an explicitly selected local model over that extracted text, not the
   entire mission or its operational instructions. Hosted rewriting must be a
   separate opt-in.
3. Offer off, light and conversational rewriting with explicit style controls.
4. Preserve names, quantities, units, citation anchors, negations, attribution
   and confidence qualifiers. Entity and number equality are necessary but not
   sufficient: "did" and "did not" can retain identical names and numbers.
5. Show source and candidate side by side before approval, with an explicit
   warning and extractive fallback when the model is unavailable or a fidelity
   check fails. A model's own confidence must not authorize the rewrite.
6. Freeze the approved text into the draft before synthesis. Never review one
   script and silently render another.

This is a separate text-quality feature, not a substitute for voice auditions
or audio gates. It needs semantic regression cases and review affordances before
it can safely replace source wording.

## Implementation map

- `src/lib/server/research-generations.ts`: podcast extraction and draft text.
- `src/lib/server/research-media-readiness.ts`: runnable, verified local choices.
- `src/lib/voice/speech-models.ts`: shared named-speaker catalog and resolution.
- `src/lib/server/research-podcast-pipeline.ts`: synthesis and assembly.
- `src/components/role-surfaces/research-tab-studio.tsx`: Studio configuration.
- `src/components/role-surfaces/research-studio-modals.tsx`: voice and draft review.

[^speech-api]: ElevenLabs, [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert), inspected 2026-09-10. Documents output formats, context and best-effort seed behavior.
[^speech-practice]: ElevenLabs, [Text-to-speech best practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices), inspected 2026-09-10. Documents voice/settings interaction, pacing and pronunciation limitations.
