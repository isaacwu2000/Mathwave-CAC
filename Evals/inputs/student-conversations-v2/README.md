# Student speech conversations v2

V2 references the 400 frozen v1 conversations and adds 100 independently reviewed families in `equation-extension.json`: 85 algebra and 15 arithmetic families, 418 new turns. The combined corpus has 500 conversations and 1,615 spoken turns. New cases each contain 3–6 turns, emphasizing edits, multiple algebra steps, correction, read-only queries and undo/redo. Arithmetic already uses existing expression editing, simplification and evaluation tools; no product tool was added.

## Files and reproduction

From the repository root:

```sh
pnpm exec tsx Evals/scripts/check-student-conversations-v2.ts Training/STT/runs/tiny-en-lora-v2-2026-10-22/provenance/notes/reference-checks.json
python3 Training/STT/scripts/student_speech_v2.py prepare
python3 Training/STT/scripts/student_speech_v2.py split
python3 Training/STT/scripts/student_speech_v2.py audit
HF_HUB_OFFLINE=1 Training/STT/.venv/bin/python Training/STT/scripts/train_student_speech_v2.py --split Training/STT/splits/student-speech-v2.json --output Training/STT/runs/tiny-en-lora-v2-2026-10-22
HF_HUB_OFFLINE=1 Training/STT/.venv/bin/python Training/STT/scripts/verify_speech_adapter_v2.py Training/STT/runs/tiny-en-lora-v2-2026-10-22
Training/STT/.venv/bin/python Training/STT/scripts/plot_student_speech_v2.py Training/STT/runs/tiny-en-lora-v2-2026-10-22
```

The split command refuses to overwrite a frozen manifest; training refuses to replace an existing run directory. Use a new path for another experiment. The training environment needs PyTorch, Transformers, PEFT, safetensors, NumPy, soundfile and matplotlib, plus the pinned cached Whisper tiny.en base. Preparation uses macOS `say` and `afconvert`. No paid API is involved.

`audio/manifest.json` references original v1 WAVs in place and adds 418 v2 WAVs. Each turn has a source fingerprint, waveform checksum and audio-format checks. Six synthetic voices are used; a conversation retains one voice. Source hashes bind all five JSON files. Historical v1 sources, recordings and experiment results stay unchanged.

## Split and scoring

The fixed random seed assigns whole related conversation groups approximately 80/10/10 within categories. Complete program/preview/status sequences with numbers masked group numeric variants. The 24 parallel/transversal geometry families stay together. Shared first equations alone do not create a group. Algebra and arithmetic share the primary algebra stratum, with secondary balancing by their original categories so arithmetic appears in validation and test; other categories remain separate. All turns of a conversation retain their assigned partition.

Duplicate normalized transcripts or waveforms are excluded from lower-priority STT partitions (test, then validation, then train). Within each partition, the first clip per normalized transcript is the fixed primary representative. Primary domain scores partition this global representative set; they do not pick fresh representatives per category. Full retained-clip scores are secondary. See the frozen manifest for actual counts after exclusions.

V2 normalization folds number words, explicit decimals and math operators to common tokens while preserving sign, value, operation order and ordinary words. Punctuation commas are ignored, but delimit number phrases; wrong values/signs, corrections, inequalities and coordinate order remain distinguishable. It does not infer homophones, evaluate expressions or convert fraction words to calculated values. Raw whitespace WER is also reported. WER measures transcription edits, not successful math commands.

## Review and limits

Every new conversation was independently read and its math expectations checked. Records and source hashes are in `Training/STT/runs/tiny-en-lora-v2-2026-10-22/provenance/notes/equation-review.json`. The v1 review covers the unchanged original 400 cases.

Reference replay passes 497/500 cases. Three recorded product regressions remain: `alg-solve-sides-reversed`, `alg-undo-two-separate-steps`, and `eq2-edit-added-variable-term` parse hyphenated number words incorrectly. Correct independent expected answers are retained. The checker exits unsuccessfully and records these failures rather than counting them as passes.

This is a fresh speech-adapter run on a reorganized, previously examined synthetic corpus. It is not a new unseen or held-out-speaker benchmark. Whole conversations group speech clips, but this experiment does not train conversation context or LLM tool use. Speech scores do not establish human-student, microphone, iPhone or visual acceptance. No app-rendering evaluation is added; earlier actual-app visual review remains partial (2/400 v1 conversations).

An incomplete initial v2 run was stopped after a split audit found no arithmetic cases in test. Its frozen inputs, partial outputs and stop reason are retained under the notes directory. No test scores were inspected to make that decision. The reported final run starts from the original base with fresh adapters and a corrected frozen split.
