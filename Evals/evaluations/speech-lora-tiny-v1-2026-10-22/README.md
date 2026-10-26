# Local speech LoRA experiment — 2026-10-22

Starting checkout: `feb228c`. Source hashes were recorded before baseline inference; existing native/prompt edits were preserved outside this task.

This experiment fine-tunes **Whisper tiny.en speech transcription**, using PyTorch and PEFT on the M3 Mac. It does not train the tool-calling LLM or change the iPhone app's installed recognizer.

The run is baseline → two fixed LoRA epochs → validation-only checkpoint selection → held-out retest. Configuration, source hashes, per-recording predictions, timings and frozen-weight checks are in [report.json](report.json). Base revision: `87c7102498dcde7456f24cfd30239ca606ed9063`.

## Result

On the 110 unique held-out synthetic utterances (740 normalized reference words):

| Metric | Before | After |
| --- | ---: | ---: |
| Normalized word error rate | 17.84% (132 errors) | **4.59% (34 errors)** |
| Exact normalized transcripts | 53/110 | **88/110** |
| Raw whitespace-token word error rate | 35.00% | **6.89%** |

This is a **74.24% relative reduction in normalized word errors** on this holdout. Full-clip secondary WER across all 116 recordings is 18.15% → 4.31%, with exact transcripts 55 → 94. These are point measurements on synthetic audio, not evidence of broad human-speech quality.

The selected checkpoint is epoch 2: validation token loss was 0.11509 after epoch 1 and 0.10356 after epoch 2. Training performed **232 optimizer updates** over two epochs, with **147,456 trainable LoRA parameters** out of 37,907,712 total parameters. Frozen base parameter bytes were unchanged. Training took 633.50 seconds; measured run time after ML imports was 764.50 seconds. Paid compute/API spend: **$0**.

Mean generation-only time across the 116 recordings was **0.190 → 0.242 seconds**. This run improved transcription accuracy, not speed. Timing is one warmed pass with the documented cache/thermal limitations.

[The paired comparison](comparison.json) includes improvements **and regressions**. For example, “Drop the altitude to side c” changed from “Blaapi Altitude Society” to the correct sentence. Conversely, baseline “Plot cosine X” became the worse “Plought cos i next.” Do not deploy this adapter as a universal improvement based on its average score.

[The saved adapter](adapter/adapter_model.safetensors) also passed a [fresh-process reload check](reload-smoke.json) on a validation recording, reproducing the selected checkpoint's output. The full [report](report.json) contains all hashes and checks; per-clip before/after predictions are retained.

- [x] Freeze separate grouped train/validation/test assignments before inference.
- [x] Independently audit cross-partition transcript, waveform and conversation separation.
- [x] Run the untouched baseline on validation and test recordings.
- [x] Train LoRA locally, with all base parameters frozen.
- [x] Choose checkpoint using validation loss only, then lock selection.
- [x] Retest the same held-out recordings and verify paired identities and hashes.
- [x] Verify base weights unchanged, adapter updated and saved checkpoint reloads.
- [x] Run repository verification (609 passing tests, five skipped; boundaries, types, lint and build) plus speech split/scoring checks.
- [ ] Full app visual coverage, real student speech, streaming and iPhone deployment. These remain separate work.

## Stratified held-out results

This is a post-hoc analysis of the original frozen predictions, with no new inference, re-splitting or training. Global transcript deduplication happens before assigning conversation-theme categories, preserving the original 110 clips and 740 reference words. The [machine-readable breakdown](stratified-results.json) includes source hashes, category case IDs and edit counts.

| Conversation theme | Conversations | Unique clips | Reference words | Before WER | After WER | Exact before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Graphs | 14 | 46 | 255 | 21.96% | 6.27% | 18/46 → 35/46 |
| Geometry diagrams | 20 | 50 | 385 | 17.40% | 4.42% | 26/50 → 40/50 |
| Equations | 5 | 12 | 86 | 10.47% | 1.16% | 7/12 → 11/12 |
| Flow diagrams | 1 | 2 | 14 | 0.00% | 0.00% | 2/2 → 2/2 |
| **Total** | **40** | **110** | **740** | **17.84%** | **4.59%** | **53/110 → 88/110** |

Equation and flow-diagram samples are particularly small. Categories refer to the conversation's theme, so a graph conversation's “undo” turn remains in graphs. This does not rebalance the original geometry-heavy split or provide held-out statistics/cross-topic evidence.

### What word error rate means here

[WER](https://github.com/huggingface/evaluate/blob/main/metrics/wer/README.md) is minimum word edits divided by reference words: `(substitutions + deletions + insertions) / N`. It is summed over all selected recordings and divided by their total reference words, not an average of per-clip percentages.

- Before: 89 substitutions + 24 deletions + 19 insertions = **132 / 740 = 17.84%**.
- After: 30 substitutions + 1 deletion + 3 insertions = **34 / 740 = 4.59%**.

Component counts come from one optimal alignment, preferring substitution over deletion over insertion when tied. Other tied alignments can distribute component counts differently; total edits and WER remain the same. After adaptation, **22/110 utterances** still contain at least one normalized word edit. Therefore 4.59% word error rate does not mean 95.41% correct requests or commands.

Each synthetic recording has one canonical reference: the exact sentence passed to the speech synthesizer. Speech can be transcribed with equivalent formatting, so normalization ignores case and much punctuation, converts small spoken numbers to digits, separates `2x`, and maps common math symbols to spoken forms. That is a limited convention, not a unique semantic truth. Equivalent math notation and larger spoken numbers are not fully normalized. “twenty-one” versus `21` is a known scoring artifact. Raw whitespace/case/punctuation-sensitive WER is also recorded: **35.00% → 6.89%**. The difference between raw and normalized scores includes formatting effects and tokenizer limitations; it cannot identify how many mistakes would change the mathematical command.

A separate downstream command/result check is needed to establish correct math actions. It should accept equivalent valid programs and mathematical results while checking signs, variables, selected objects, corrections and saved work. This speech run does not provide that semantic score.

### Why this small run was quick

The pretrained English model has about 37.9 million parameters including adapters. Only 147,456 adapter parameters (about 0.39%) were trainable. The dataset contained **922 short clips / 38.48 minutes** of pre-generated audio. Two epochs present **1,844 training examples**: 461 mini-batches per epoch at batch size 2, with four-batch gradient accumulation, producing **116 optimizer updates per epoch / 232 total**. Most updates have effective batch size 8; the last update of each epoch contains 2 examples.

Training took **10m33.5s** on the M3 GPU; the measured experiment after ML imports took **12m44.5s**. Environment setup, prior model downloads and audio generation occurred earlier and are excluded. LoRA reduces trainable weights and optimizer storage, while forward and backward computation still involves the base network. The small pretrained model, short dataset and two-epoch limit account for much of the speed.

Settings: rank 8, alpha 16, dropout 5%, attention query/value projections, learning rate 0.0005 with ten-update warmup and decay, float32 on MPS. Epoch 2 was chosen using validation token loss, not the held-out test score.

## Split first

[The frozen split](../../inputs/student-speech-split-v1.json) was written before baseline inference or training. [Its audit](split-audit.json) includes independent review and zero cross-partition conversation, transcript or waveform overlap.

| Partition | Conversations | Retained clips | Unique transcripts |
| --- | ---: | ---: | ---: |
| Train | 320 | 922 | 880 |
| Validation | 40 | 115 | 112 |
| Test | 40 | 116 | 110 |

Whole related-conversation groups are assigned together. Numeric-only program/setup variations are grouped transitively; parallel/transversal relationships remain together. Graph setup grouping also considers the follow-up operation. The grouping does not canonicalize all variable/object renamings, so semantic near-duplicates may remain.

Forty-four overlapping clips are explicitly excluded from lower-priority partitions: test takes priority over validation, then training. Complete conversation assignments remain recorded, but speech training uses filtered independent clips. This is not complete-conversation LLM training. The primary score uses one fixed representative per transcript, chosen before predictions; the full retained-clip score is also reported.

| Category | Train | Validation | Test |
| --- | ---: | ---: | ---: |
| Algebra | 91 | 4 | 5 |
| Graphs | 83 | 3 | 14 |
| Geometry | 49 | 31 | 20 |
| Statistics | 50 | 0 | 0 |
| Cross-topic | 25 | 0 | 0 |
| History/diagrams | 22 | 2 | 1 |

Grouping makes held-out data geometry-heavy, with no statistics conversations held out. This is a demonstration on unseen synthetic conversations, not a representative full-app quality estimate. All six synthetic voices recur in each partition; it does not test unseen speakers or real student speech. The prior 79-recording benchmark remains separate.

## Training rules

Rank 8 LoRA, alpha 16, dropout 0.05, applied to attention query/value projections. Only adapter matrices are trainable. Batch size 2, four-batch gradient accumulation, learning rate 0.0005 with warmup/decay, seed 20261022, two epochs. Optimizer steps and frozen-base hashes are recorded.

Validation selection uses token-weighted cross entropy on unique validation transcripts. Neither test predictions nor test metrics are used to choose learning rate, epochs or checkpoint. Baseline test predictions are written to a separate file and only read for the comparison after checkpoint selection is locked. No paid GPU/API calls or new model downloads are used.

Implementation references: [PEFT speech adaptation guide](https://huggingface.co/docs/peft/main/en/task_guides/int8-asr) and [Whisper model documentation](https://huggingface.co/docs/transformers/model_doc/whisper). This run's actual precision/device settings are float32/MPS, recorded in its configuration.

## Reading the results

Primary: normalized word error rate and exact transcripts across 110 unique held-out utterances. Secondary: all 116 held-out clips and unnormalized whitespace-token WER. Every before/after recording uses identical decoder settings: greedy generation, no timestamps, 128-token limit, one warmed eager MPS pass.

Normalization reuses the existing benchmark's small-number and punctuation rules. It is not a complete spoken-number equivalence parser: “twenty-one” becomes `20 minus 1`, while a correct numeric `21` stays one token. Raw WER is reported alongside it. The restricted math-token diagnostic also omits meaningful words such as “point,” “not,” inequality language and some variable names. **Do not interpret it as math-command accuracy.** Both model rounds use the same frozen scoring rules.

Use generation-only timings for the limited comparison. Baseline preprocessing is mostly cold while adapted preprocessing reuses cached features; `processingAndGenerationSeconds` is not an equal-cache before/after comparison. One pass does not establish stable app latency, streaming speed, battery usage or iPhone performance. Model-load and elapsed-run fields start after Python/ML imports; import/startup costs are not measured.

Speech transcription produces no new rendered math in this experiment. Actual-app visual acceptance remains at 2/400 conversations from the earlier dataset review; these speech scores do not fill that gap. No claim is made that every audio recording was listened to manually.

## Reproduce

Use the existing local environment with the package versions recorded in `report.json`:

```sh
python3 -m unittest discover -s Evals/scripts -p 'test_*student_speech.py'
HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false Native/build/speech-benchmark-env/bin/python Evals/scripts/train_student_speech.py --split Evals/inputs/student-speech-split-v1.json --output /tmp/mathwave-speech-new-run
```

The runner refuses to overwrite an experiment directory and verifies source/audio hashes. A new run spends local compute time but no API credits. Do not resplit or tune against the test outcomes from this run.

The selected adapter is saved in `adapter/`; its hashes and base-weight invariance check are in `report.json`. It requires the pinned Whisper tiny.en base and PEFT. This is a PyTorch adapter artifact; deployment to the native app is a separate step.
