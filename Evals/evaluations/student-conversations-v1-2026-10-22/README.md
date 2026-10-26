# Student conversation dataset checks — 2026-10-22

Starting checkout: `c7bfa28`. Existing native Settings/presentation and prompt work was left outside this task.

- [x] Author 400 scenario families, 1,197 ordered student turns, using existing commands.
- [x] Review every conversation with an agent different from its author. The four files in `reviews/` contain exactly 400 unique case records, including findings and resolutions.
- [x] Strengthen independent reference checks: complete data/diagram contents, marked angles, geometry overlays, curve samples/points and saved-step boundaries.
- [x] Check reference journeys through the shared local/web executor. 398 match; two deliberately retain correct expectations that reveal an existing spoken-number defect.
- [x] Run a small paid recorded-input transcription pilot with per-request model/case/cost evidence and stop on the first provider failure.
- [x] Pre-generate checksum-bound local audio for every student turn in six voices; the corpus audio manifest is the source of truth for completion, hashes, size and duration.
- [x] Run repository verification: boundaries, 609 passing tests, five skipped tests, TypeScript, lint and production build. Focused checker tests, TypeScript and lint were repeated after review fixes. Seven Python checks cover speech normalization and audio-cache integrity.
- [ ] Full actual-app visual acceptance for all 400 families. Two families were reviewed at desktop/mobile, with all seven intermediate states. The remaining 398 are unreviewed visually. This dataset is not a fully accepted visual evaluation suite.
- [ ] Real student speech/usability, iPhone microphone/streaming benchmarks, train/test assignment, LoRA training and before/after model comparison. These were not performed in this dataset-authoring step.

`reference-checks.json` records each case and failure without relabeling failed cases as passes. It supplies authored reference responses, so 398/400 is **not a model accuracy score**. The [complete audio integrity report](audio-preparation-verification.json) verifies all 1,197 recordings, all 400 review bindings, six voices, 103,057,066 bytes and 3,067.32 seconds of audio.

The two failures are `alg-solve-sides-reversed` and `alg-undo-two-separate-steps`: a hyphen in “twenty-three” or “twenty-one” becomes subtraction on the direct input path.

All 400 individual reviews cover natural wording, stated givens, follow-up references, supported tool semantics and expected math. They do not substitute for inspecting each rendered app result or listening to every recording. Repeated underlying skills and synthetic speech limit generalization claims; group related families and voice variants before a future training split.

The paid pilot completed eight clips on each of two models. On this tiny paired synthetic sample, normalized word error rate was 17.91% for `google/gemini-2.5-flash-lite` and 5.97% for `qwen/qwen3.8-omni-flash`. There are only 67 reference words per model; this does not support a broad quality ranking. Timings are one recorded HTTP request each and include network/provider latency, not streaming or local runtime speed.

Reported pilot spend: **$0.00124458**. Request 17 returned upstream HTTP 429 without cost. A conservative **$2 unknown-charge reservation** remains recorded; it is not reported as actual spend. The campaign stopped without retry/fallback, within the approved $8 budget. Local audio synthesis costs $0 in API usage. Original pilot recordings/results remain separate from full-corpus preparation.

See [corpus instructions](../../inputs/student-conversations-v1/README.md), [reference checks](reference-checks.json), [individual reviews](reviews), [audio pilot ledger](audio/ledger.json), [audio scores](audio/transcription-scores.json) and [partial visual review](visual/visual-review.json).
