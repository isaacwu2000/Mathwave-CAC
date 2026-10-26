# Initial Qwen3 0.6B LoRA results

Training completed: two epochs, 320 optimizer updates, rank-8 query/value adapters. Frozen base hashes match. Epoch 2 was selected by validation loss and reloaded successfully. This is conditional per-turn evaluation with authored prior workspace, not autonomous conversation rollout.

| Metric | Before | After |
|---|---:|---:|
| Validation answer-token loss (163 rows) | 2.4322 | 0.1143 |
| Parseable JSON (166 test rows) | 4 (2.4%) | 166 (100%) |
| Responses passing schema/DSL validation (166 test rows) | 0 | 135 (81.3%) |
| Automated pass (166 test rows) | 0 | 114 (68.7%) |
| Primary unique-input pass (164 inputs) | 0 | 112 (68.3%) |

Epoch 1 training/validation loss: 0.3484 / 0.1437. Epoch 2: 0.1066 / 0.1143. Loss is not an accuracy percentage. [Learning curves](run/learning-curves.png).

Algebra: 52/69 pass; graphs: 17/36; geometry: 18/26; arithmetic: 8/9; statistics: 10/10; cross-topic: 7/9; history/diagrams: 2/7. These are small synthetic subsets. Reply grading conservatively requires normalized reference matches and can reject valid paraphrases.

Trainer time was 39.2 minutes; the queue session took about 40.8 minutes. Same-GPU raw generation averaged 1.15 seconds before and 0.64 after, with shorter generated responses. These are isolated CUDA inference timings, not app, speech or iPhone latency.

The initial prompt includes the shared web instructions, DSL API, schema and full workspace context. It lacks complete worked request-to-response demonstrations and forced JSON decoding. This is the unchanged initial prompting configuration, not an optimized prompting-only baseline.

**Visual inspection is complete for all 166 baseline and 166 adapted rows.** Reviewers inspected 175 distinct screenshot states on mobile (390 × 844) and desktop (1280 × 900). This includes 143 newly reviewed images and 32 exact SHA256 matches to previously inspected pixels. Both failed captures were recovered and inspected. Their cause was a helper waiting for an inactive graph after the model wrongly switched to geometry; original failures are preserved.

Visible failures include lost equation terms, wrong graph translation direction, moving a curve instead of inspecting it, incorrect naming/history, and an unrelated triangle replacing a requested polar graph. Four failed rows appear visually equivalent to their references, but need full state/history adjudication before changing grades. Automated scores remain unchanged.

Renderer concerns are recorded separately: vertically offset y-axis tick text, unequal polar axis scales, and two desktop expression fields apparently showing only a trailing 1. The long mobile equation is accessible by horizontal touch pan and focused arrow keys; it is not an inaccessible-clipping defect. Hidden scrollbars provide no persistent swipe hint. No extra UI polish or model retraining was performed.

[Complete case-mapped review](full-visual-review/visual-review.json) · [Before gallery](visual-baseline/index.html) · [After gallery](visual-adapted/index.html) · [Recovered outcome](visual-adapted-recovery/recovery-review.json).

No generated intermediate graph/geometry saved steps existed in this run. Saved-state review does not establish live progressive streaming, speech, native iPhone behavior, physical-device interaction or autonomous conversation rollout.

Resources are cleaned up: independent recheck found no endpoints or Pods and zero current hourly spend. Observed account balance change is about $0.53 including probes and the earlier connection attempt; it is not an itemized invoice. See cleanup-recheck.json.

The selected adapter is in run/adapter/. It is not installed in the iPhone app. Graph and history failures remain substantial; this is a demonstrated training improvement, not a production-ready model.
