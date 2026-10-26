# Math Audio command evaluations

These are synthetic development examples, not fine-tuning data and not recordings from dyslexic students. No model has been trained or fine-tuned. Training examples now guide local clarification behavior.

## Split and protocol

- `train.jsonl`: 20 development examples, available for prompt iteration.
- `test.jsonl`: 20 held-out examples with distinct scenario-family IDs and utterances. Freeze these labels before running candidates. Never feed test examples into the prompt.
- `test-v2.jsonl`: 24 fresh examples authored after freezing the clarification changes in `frozen-candidate.json`. Five ambiguity cases intentionally test transfer of training skills with new wording, values, or context; the remaining cases probe additional ambiguities, explicit commands, and safe abstention. Distinct IDs do not imply independent mathematical skills. Both test sets are now observed regression sets for future changes.
- Broad skills (algebra, statistics, reading, navigation, ambiguity, safety) overlap intentionally. This small manually written set is not proof of generalization or exhaustive accessibility coverage.
- All paraphrases, recordings, and voice variants of a scenario must stay in its original split. If these now-observed test failures guide future implementation, treat this as a regression set and create a new unseen holdout for an unbiased estimate.
- Each report records the dataset SHA-256. Archive reports before reruns; the runner replaces the same split/mode report.

## Run

Package scripts run from the repository root or `Web/`. Run direct
`pnpm exec tsx scripts/...` commands below from `Web/`; results are saved in
`Evals/evaluations/` at the repository root. Tests run through `pnpm run test`.

Historical reports and frozen manifests retain their original paths and hashes.
Their `evals/` paths refer to the former `Web/evals/` directory, now organized under `Evals/inputs/`, `Evals/evaluations/`, and `Evals/snapshots/`.

```
pnpm run eval:train
pnpm run eval:test
pnpm run eval:agent
pnpm exec tsx scripts/evaluate.ts test-v2 parser
pnpm exec tsx scripts/evaluate.ts test-v2 endpoint
```

The first two run the local parser with no API calls. The third calls the running app's `/api/interpret` endpoint, which currently uses GPT-6 Luna. It does not test GPT Live audio. Start the app first; set `EVAL_ORIGIN` only for a trusted app server. Requests are sequential and spaced below the app's rate limit. The runner stops API calls at the first non-200 response, reports missing results as unavailable, and exits 2. It never turns provider failure into a model score.

To grade externally captured model predictions:

```
pnpm exec tsx scripts/evaluate.ts test predictions /path/to/predictions.jsonl
```

Each line: `{"id":"test-001","prediction":{"status":"command","command":"median of 2, 4, 8, 10","message":""}}`. Missing predictions are unscored. Run each voice as a separate predictions file using the original case IDs.

## What gets scored

Exact decision type; command validation for agent outputs; resulting workspace and action; answer text for read-only queries; selected independent numeric checks; useful clarification content. The parser baseline allows its own accepted natural syntax, since it is not subject to the agent's canonical-command allowlist. Local clarification errors now have an explicit type; legacy ambiguity errors retain message-based classification. These are parser decisions, not model decisions.

Canonical state comparisons use the existing math engine, so they test intent preservation, not an independent proof of that engine's mathematics. Negative tests require abstention: they never earn credit for applying an operation. No LLM judge is used. Latency excludes deliberate rate-limit waits.

Grader tests reject changed signs/numbers, wrong read-only queries, unsupported tools, empty clarification, and contradictory command-plus-clarification outputs.

## Gemini voices

`gemini-voices.jsonl` specifies 120 planned audio inputs: every case in Kore, Puck, and Aoede. These are prebuilt Gemini TTS voices, used as synthetic students' inputs, not a change to the app's output voice or agent model. Reference: https://ai.google.dev/gemini-api/docs/speech-generation

Status: **not generated**. The account previously failed Gemini eligibility checks and no Gemini key is configured. No workaround to that restriction or alternative voice impersonating Gemini is used. Obtain legitimately available audio through an eligible setup before the audio stage.

Once recordings are available, keep the exact transcript, voice, actual TTS model ID, generation settings, file checksum, and split together. Listen to every clip for spoken math errors. Use natural speech for acoustic tests; literal `out liars` is a transcript-error stress case and should be labeled separately from a correctly spoken `outliers` clip. Feed each clip through the complete voice pipeline in an isolated problem, capture the interpreted command, and score with this grader. Also record transcript word error rate, duplicated actions, startup failure, response latency, and interruption behavior. Synthetic voices do not replace accessibility testing with real students.

## Baseline results

- Training parser: 18/20 (90%).
- Held-out parser: 16/20 (80%).
- Held-out agent: 0 scored, 20 unavailable; the first request returned HTTP 502. The most recent direct provider diagnostic was exhausted API credits.
- Voice pipeline: not run; all 120 audio trials remain pending.

Test misses: indirect outlier request, trailing “please” on standard deviation, ambiguous “that,” and unspecified number correction. No app or model prompt was tuned using these test results. The training average case accepts the equivalent Mean/Average label.

## Clarification revision and fresh evaluation

Only training failures guided the implementation: pronoun replacement targets and vague improvement requests now ask for missing intent. The UI handles these locally without falling back to the API. Work is preserved, and users can submit an explicit correction. Sample/population questions use the same typed error. Literal diagram steps named “This” or “It” still work.

- Training: **20/20 (100%)**, previously 18/20. Original report archived under `evaluations/archive/train-parser-baseline.json`.
- Fresh parser: **19/24 (79.2%)**; clarification **5/8**, explicit commands **10/12**, safety/unsupported **4/4**.
- Fresh misses: unspecified equation repair; unresolved arithmetic operand; incomplete replacement; “first part”; spoken decimal “three point five”. These were recorded without tuning the frozen implementation.
- Fresh agent: **0 scored, 24 unavailable**, first call HTTP 502; no model accuracy can be inferred.
- Verification: 58 tests, typecheck, and lint pass. Browser submission of the training phrase “make this better” displayed the local question and preserved the four saved data values; the existing draft was restored. Microphone/Gemini audio was not evaluated.

Candidate file hashes were frozen before fresh case creation and verified afterward. One canonical navigation label was invalid (“first part”) and was corrected to the supported “read part one”; an intermediate “select part one” label also failed the agent allowlist integrity check. The utterance and expected command behavior were unchanged, and the score stayed 19/24. The initial dataset/report are archived for audit. This is a small synthetic transfer evaluation authored by the same developer, not a blind external benchmark or evidence of user accessibility acceptance.

## Second tuning round

`train-v2.jsonl` promotes all 64 previously observed cases from train, test, and test-v2 to development data, retaining their original IDs and `sourceSplit`. Previous held-out scores remain historical; these examples no longer measure generalization.

The local parser now clarifies unspecified repairs, incomplete replacements, and arithmetic operands such as “that.” It accepts trailing “please,” first/last navigation, digit-by-digit spoken decimals (including signs and zeros), and the observed indirect outlier wording. No model fine-tuning or prompt change was performed.

- Expanded development set: **64/64 (100%)**.
- New `test-v3.jsonl`: **21/24 (87.5%)**. Clarification **6/8**, explicit commands **9/10**, safety/unsupported **6/6**.
- Remaining misses: “could you fix the mistake?”, “replace this term with eight”, and “which values seem extremely distant”. These remain untouched after evaluation.
- All **61 automated tests**, typecheck, lint, and diff checks pass. Browser verification showed that incomplete “replace seven” asks for the new value locally and preserves the saved data and step count. The user's original draft was restored.
- `frozen-candidate-v2.json` records implementation hashes before fresh case creation; those hashes were verified afterward. All canonical command labels were validated before scoring. An initially proposed inline `calculate <expression>` oracle was rejected during label validation and replaced with a supported `write <expression>` case before evaluation.
- This set intentionally contains new phrasings of tuned skills plus additional unsupported and ambiguity probes. Same-developer synthetic results are a transfer check, not an independent external benchmark. The prior 79.2% and current 87.5% come from different sets and cannot establish a controlled accuracy improvement.
- Live AI and Gemini voice evaluations were not rerun: the last endpoint attempt returned HTTP 502 with zero scored cases. These scores cover text parsing only.

Run:

```
pnpm exec tsx scripts/evaluate.ts train-v2 parser
pnpm exec tsx scripts/evaluate.ts test-v3 parser
```

## Third tuning round

`train-v3.jsonl` promotes the 88 previously observed cases to development data, preserving each original `sourceSplit`. Tuning addressed all three v3 misses: polite request prefixes, deictic replacement targets such as “this term,” and additional indirect outlier wording. The draft phrase “could you inspect my unusual observations” is now supported locally. Diagram replacement labels ending in “Please” are preserved as literal text.

- Development: **88/88 (100%)**.
- Fresh `test-v4.jsonl`: **21/24 (87.5%)**; clarification **6/8**, explicit commands **9/10**, safety **6/6**.
- Remaining misses: “replace the value with four,” “make my equation better,” and “identify the suspicious measurements.” No changes were made using these new failures.
- **64 automated tests**, typecheck, lint, and diff checks pass. Browser verification of “could you fix the mistake?” showed a local question; saved data and the one existing step were preserved, and the original draft was restored.
- `frozen-candidate-v3.json` records the implementation before v4 creation; file hashes were verified afterward. Fresh command labels were checked before evaluation, and dataset-integrity tests cover all four original splits without duplicating promoted cases.
- The equal 87.5% scores come from different small synthetic sets, so they do not establish equal performance or a controlled improvement. Live AI and Gemini audio remain unevaluated in this round.

```
pnpm exec tsx scripts/evaluate.ts train-v3 parser
pnpm exec tsx scripts/evaluate.ts test-v4 parser
```

## Fourth tuning round

Production changes were verified and committed first as `52ea3d3`. They clarify generic targets (“the value,” “the number”) and possessive improvement requests (“make my equation better”), and map requests to inspect suspicious measurements to the existing potential-outlier calculation. Exact diagram names still take precedence over generic references.

`train-v4.jsonl` contains all 112 previously observed cases, with original split metadata. `frozen-candidate-v4.json` records the production commit and file hashes before creating `test-v5.jsonl`. All fresh canonical commands were validated before scoring. The runner accepts versioned train/test filenames without changing its code for each round.

- Development: **112/112 (100%)**.
- Fresh text parser: **22/24 (91.7%)**; clarification **7/8**, explicit commands **9/10**, safety/unsupported **6/6**.
- Remaining misses: “replace that coefficient with three” and “find the anomalous readings.” These were not used for further tuning in this round.
- **66 tests**, typecheck, lint, diff checks, and frozen-file verification pass. No additional browser or live audio/model evaluation was performed.
- The fresh examples are developer-authored synthetic transfer and boundary checks. Different-round percentages are not a controlled comparison, and no fine-tuning was performed.

```
pnpm exec tsx scripts/evaluate.ts train-v4 parser
pnpm exec tsx scripts/evaluate.ts test-v5 parser
```
