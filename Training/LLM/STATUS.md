# Initial experiment status

Completed October 23, 2026: training, automated before/after testing and actual-app visual inspection. The trained model is not accepted for production. [Results](runs/qwen3-06b-queue-lora-v1-2026-10-23/RESULTS.md).

- [x] Preserve the frozen 400/50/50 whole-conversation assignments across 500 authored cases.
- [x] Validate references through the shared engine with no deterministic parser shortcut.
- [x] Remove lower-priority exact prompt duplicates across splits; freeze 1,278 training / 163 validation / 166 test rows, with 164 primary unique test inputs.
- [x] Complete same-runtime CUDA baseline inference and shared-engine grading.
- [x] Train rank-8 query/value LoRA for two epochs and 320 optimizer updates; select by validation loss only.
- [x] Verify frozen base hashes and reload the selected adapter.
- [x] Complete inference and grading on exactly the same held-out test prompts and decoder settings after training.
- [x] Generate and inspect learning curves.
- [x] Inspect every visible baseline/adapted outcome: 166 rows each, 175 distinct screenshot states, mobile and desktop; recover and inspect both failed captures.
- [x] Publish results, source/runtime evidence, selected adapter, review records and screenshots.
- [x] Verify Runpod resources were deleted and current hourly spend is zero.

## Results and limits

Validation answer-token loss: 2.4322 before training → 0.1437 after epoch 1 → 0.1143 after epoch 2. Selected epoch 2 reload matches exactly; frozen base hashes match.

Primary unique-input automated pass: 0/164 → 112/164 (68.3%). All-row pass: 0/166 → 114/166 (68.7%). Parseable JSON: 4/166 → 166/166. Schema/DSL validation: 0/166 → 135/166. Parsing JSON is not the same as choosing correct tools or executing correct math.

Complete visual coverage is recorded in `runs/qwen3-06b-queue-lora-v1-2026-10-23/full-visual-review/visual-review.json`. Model failures and renderer concerns are separate. Four visually equivalent failed rows remain grading-adjudication candidates; scores were not changed. A long mobile equation was verified reachable by horizontal touch pan and focused arrow keys, correcting the initial static-clipping concern. No generated intermediate graph/geometry saved snapshots existed; no live-streaming acceptance is claimed.

This is conditional per-turn evaluation using authored prior state, not autonomous conversation rollout. The synthetic corpus was previously examined; it is not an unseen external benchmark or student usability study. The initial prompt includes shared web instructions, DSL and schemas, without complete worked response demonstrations or constrained JSON decoding. No optimized prompting-only baseline, microphone/STT acceptance, native iPhone integration, quantization or production deployment is claimed.

## Runtime, cost and publication checks

The verified worker was NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 1g.24gb, Torch 2.9.1+cu128 / CUDA 12.8. The Mac reference used Torch 2.14.1, so cross-hardware timing is not a software-controlled comparison. Both CUDA before/after passes share one runtime. Trainer time: 39.2 minutes; queue session: 40.8 minutes. Observed total account change including probes and the earlier connection attempt: about $0.53, not an itemized invoice. No Pods/endpoints remained; current hourly spend was zero on independent recheck.

Verification: 652 tests passed, 5 skipped; boundaries, TypeScript, lint and build passed. Six capture-planning tests pass. The capture helper now waits for the actually active graph panel, so inactive graph metadata after mode changes cannot block geometry capture.

Historical evidence remains preserved: the interrupted Mac run stopped after 48 baseline predictions before training; its partial visual review is separate and never substituted into the CUDA comparison. The initial A40 Pod was deleted after Fortinet blocked its proxy. Runpod's supported HTTPS queue API then completed GPU smoke and the full experiment with verified TLS and independent cleanup/budget checks. The mobile graph-scene height bug found during the partial review was fixed and verified before both full screenshot sets were captured.
