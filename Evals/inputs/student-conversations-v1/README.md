# Student conversations, version 1

400 authored scenario families, 1,197 student turns. These are synthetic student-style conversations about existing Mathwave commands, not recordings or usability evidence from real students.

| File | Conversations | Main coverage |
| --- | ---: | --- |
| algebra.json | 100 | Signs, grouping, fractions, substitution, equation steps, suggestions, corrections and history |
| graphs.json | 100 | Function families, edits, comparisons, linked definitions, viewport changes, tables, relations and parameterized paths |
| geometry.json | 100 | Shape measurements, constructions, parallel lines/transversals, angle relationships, triangle centers and dependent edits |
| statistics-and-context.json | 100 | Statistical distinctions, data corrections, temporary side questions, topic changes, diagrams and undo/redo |

Each family contains a complete ordered conversation. Keep all its turns together. The first turn establishes the problem; subsequent student requests may refer to earlier work. Different voices do not count as additional families. Some mathematical skills recur in different contexts; 400 family IDs do not imply 400 statistically independent skills.

The language should sound spoken: “Wait, the last one was nine, not ninety,” “Which number came up most?” and “Mark the matching upper-right angles at the crossings.” Exact executable commands belong only in reference answers. Coordinate constructions necessarily include more explicit givens than ordinary follow-ups.

## Reference format

Each entry has `id`, `family`, `category`, `focus` and `turns`. A turn contains:

- `student`: the exact reference transcript.
- `programs`: the existing DSL programs expected for that request. Ordered saves preserve distinct steps.
- Optional `status` and `message`: final response type and an independently authored assistant reply.
- Optional `previews`: read-only engine queries used before explaining a result. Preview observations are checked against the authored answer; a fixed assistant reply cannot conceal a failed preview.
- `expect`: independent answers and state/history constraints. These include complete data/diagram lists, read-only state preservation, curve samples/points, curve count, saved-step changes, overlays, named construction statements and calculated marked angles.

Equivalent valid programs may exist. The supplied programs are reference solutions, not the sole permissible model spelling. A future model grader should assess requested outcomes and preserved work, not exact source-string identity.

## Checks and review

Run the reference fixture check from the repository root:

```sh
pnpm exec tsx Evals/scripts/check-student-conversations.ts /tmp/student-reference-checks.json
```

This injects the authored answers into the same executor used by local and web agents. It performs no model inference and cannot establish STT accuracy or visual acceptance. It exits nonzero for a failed reference journey.

The frozen [reference report](../../evaluations/student-conversations-v1-2026-10-22/reference-checks.json) records two existing failures: hyphenated spoken “twenty-three” and “twenty-one” are interpreted as subtraction by the deterministic input route. Their correct expectations and natural wording remain as regression cases; do not silently relabel the wrong answers as correct.

[Independent reviews](../../evaluations/student-conversations-v1-2026-10-22/reviews) contain one record for every conversation. Each reviewer was different from its author; findings and resolutions are retained. These are individual text/contract reviews, not actual-app visual acceptance or student research.

[Visual evidence](../../evaluations/student-conversations-v1-2026-10-22/visual/visual-review.json) covers two representative conversations and all seven intermediate states, at desktop 1440×1000 and mobile 390×844. The actual web renderer used isolated synthetic problem data and mocked problem transport. Full 400-conversation visual review remains incomplete. Do not claim a fully accepted evaluation suite from these fixture checks.

## Pre-generated audio

```sh
python3 Evals/scripts/prepare_student_audio.py
python3 Evals/scripts/verify_student_audio.py
```

The generated `audio/manifest.json` maps every case and one-based turn to its exact transcript, voice, synthesis settings, duration and WAV checksum. Audio is 16 kHz mono signed 16-bit PCM. The six installed macOS voices are Samantha, Daniel, Flo (English US), Eddy (English US), Karen and Reed (English US). One voice stays consistent within each conversation. Each conversation's voice is selected deterministically from its family ID.

This is local `say` synthesis with no paid API calls. It is synthetic audio, not evidence of how human students pronounce math. Context is carried by the ordered conversation; a single WAV contains only that turn. Fingerprints include the full text, voice, speaking rate and format; changed speech creates a different file. Reuse requires a matching checksum. The generator checks free disk and keeps a 2 GiB reserve.

[The separate paid pilot](../../evaluations/student-conversations-v1-2026-10-22/audio/transcription-scores.json) compares two OpenRouter audio-input models on eight paired synthetic clips. Sixteen requests completed; the next returned HTTP 429 without a cost. Reported spend was $0.00124458, with a conservative $2 reservation retained for the unknown charge, within the approved $8 cap. No paid retries or fallback were attempted. Model, case, turn, request settings, raw transcript and reported cost are in the ledger. This tiny sample is not a broad model-quality comparison, a streaming benchmark or iPhone evidence. Its original pilot recordings remain frozen separately from the full corpus audio.

The pilot uses OpenRouter's documented [base64 audio input](https://openrouter.ai/docs/guides/overview/multimodal/audio). To reproduce scoring without new paid calls:

```sh
python3 Evals/scripts/score_student_audio.py Evals/evaluations/student-conversations-v1-2026-10-22/audio/ledger.json
```

At dataset publication, no weights had been trained and no split had been assigned. The subsequent [local speech LoRA experiment](../../evaluations/speech-lora-tiny-v1-2026-10-22/README.md) now provides a frozen grouped train/validation/test split and paired before/after results. Its filtered speech clips and limitations are documented separately. The earlier 79-recording benchmark remains unchanged.
