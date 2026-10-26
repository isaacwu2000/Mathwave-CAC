# Math Audio evaluations

Synthetic checks of command interpretation, recorded speech, and conversation
behavior. These support development; they do not establish usability or learning
benefits for dyslexic students.

## Layout

- `inputs/`: versioned train/test datasets and the planned Gemini voice inputs.
  `inputs/recorded-graph-geometry/` contains cases and captured transcripts.
- `src/`: grading code and colocated tests.
- `evaluations/`: machine-readable scores, including archived runs, conversation
  runs, recorded graph/geometry scores, and browser recording results.
- `snapshots/`: frozen implementation commits and file hashes.
- `docs/`: evaluation protocols, readiness reports, and historical findings.
- Optional prompt snapshots are generated locally with
  `pnpm exec tsx Evals/scripts/snapshot-web-prompts.ts` and ignored by Git.

WAV fixtures and their checksum manifests stay in `Web/public/demo-voices/`
because the browser voice-check page serves them directly.

## Run

From the repository root or `Web/`:

```sh
pnpm run eval:train
pnpm run eval:test
pnpm run test
```

The parser evaluations run locally. `pnpm run eval:agent` calls the configured
provider through a running app and requires configured provider access.

Run a particular dataset from `Web/` with
`pnpm exec tsx scripts/evaluate.ts test-v2 parser`. Inputs come from `Evals/inputs/` and
reports go to `Evals/evaluations/`. Archive reports before rerunning the same split
and mode, since the runner replaces that report.

Journey timing runs automatically through `pnpm run eval:journey http` or
`pnpm run eval:journey voice` with `RUN_LIVE_CHECK=true`. The runner owns an isolated
app and writes a new report for each run. See [journey latency](docs/journey-latency.md)
for setup, measurement boundaries and fixture replay.

`RUN_LIVE_CHECK=true pnpm run eval:journey conversation` replays four recorded
turns in one browser session: equation dictation, an unapplied suggestion, natural
acceptance, and a correction of the accepted operation. It uses real GPT Live,
backend interpretation, Neon persistence and spoken replies. Cases are frozen in
`inputs/natural-voice-conversation/cases.json`; their synthetic Daniel recordings
and SHA-256 manifest are in `Web/public/demo-voices/natural-conversation/`.
Expected math is used only by the grader, never sent to the model. The grader
checks actionable suggestions, preserved history, replacement rather than repeated
operations, database revisions and audio/display parity. A failed turn stops
dependent turns and reports them as unattempted. Reports retain diagnostics on
timeouts. This is a focused regression lane, not an unseen test set after tuning
or evidence of physical microphone or student usability.

## Protocols and evidence

The focused conversation-memory check uses a local server with `CLOUD_TEST_MODE=true`
and configured provider access. From the repository root:

```sh
RUN_LIVE_CHECK=true pnpm exec tsx Evals/scripts/check-conversation-memory.ts http://localhost:5174
```

An optional final argument selects `algebra` or `geometry`. This paid text lane
checks natural suggestions, acceptance, delayed corrections, ambiguity, and older
geometry references. It reloads synthetic in-memory work between checked turns
and writes a new report, retaining failures. It does not use a database or microphone.
Counters named `interpreterRequests` count endpoint requests, not model attempts.
See [the October memory checks](docs/conversation-memory-2026-10-18.md) for results
and remaining browser limitations.

- [Text commands](docs/text-commands.md): split rules, scoring, and tuning history.
- [Recorded graph and geometry](docs/recorded-graph-geometry.md): offline speech
  recognition and command evaluation.
- [Browser recordings](docs/browser-recorded-voices.md): browser replay evidence.
- [Microphone startup](docs/microphone-startup.md): microphone start/stop evidence.

Datasets, reports, and frozen manifests retain their original bytes. Historical
paths inside them describe the layout at capture time. Dataset basenames in the
text history now live in `inputs/`; frozen-candidate manifests live in `snapshots/`.

The synthetic core-graph browser check runs against an owned running app:

```sh
pnpm exec tsx Evals/scripts/check-core-graphs.ts http://localhost:3115
```

It uses mocked transport with the real deterministic API and writes a fresh
`evaluations/core-graphs-<id>/` report and desktop/mobile screenshots. It checks
variable edits, dependency recalculation, invalid drafts, saved names, parameter
ranges, reloads, retry idempotency and stale revisions. It makes no provider calls
and does not establish recorded-voice or student usability acceptance.

`inputs/core-graph-candidates.json` proposes multi-turn, multiline and recorded-voice
cases with independently computed answers. These are candidates, not passing
provider scores or captured audio. Include correction, interruption, ambiguity,
strict/inclusive phrasing and negative-number transcription in the voice lane.

## Filtered voice campaigns

`eval:voice` replays a category-filtered or stratified sample through the actual
browser voice pipeline. Correctness and latency are separate report fields;
there is no speed threshold in the pass decision. The existing three-condition
`eval:journey voice` lane remains the focused cold/warm/reconnect check.

Preview a bounded campaign without provider access:

```sh
pnpm run eval:voice --sample 6 --seed voice-2026-10-19 --dry-run
pnpm run eval:voice --list
```

Run the same selection, or focus on a category or case family:

```sh
RUN_LIVE_CHECK=true pnpm run eval:voice --sample 6 --seed voice-2026-10-19
RUN_LIVE_CHECK=true pnpm run eval:voice --categories graphs,geometry --sample 2 --seed graph-check-1
RUN_LIVE_CHECK=true pnpm run eval:voice --cases height-recovery,natural-conversation --seed recovery-1
```

The categories are `algebra`, `statistics`, `graphs`, `geometry`, `clarification`,
and `conversation`. ID and category filters intersect. Unknown IDs, duplicate
filters, empty intersections and invalid sample sizes fail before starting an app.
Sampling is balanced across the eligible categories, without replacement: every
category contributes once before one contributes twice. Exhausted categories
redistribute their remaining slots. A sample must be large enough to cover all
eligible categories. This is a coverage sample, not a prevalence-weighted estimate
of student traffic or a production reliability rate.

A family is the unit of selection. The three height-recovery phrasings and two
width-recovery phrasings each form one family, with voice/wording variants. The
catalog has 23 families covering the 75 original recordings plus the four-turn
natural conversation. Each standalone family draws one variant using the seed;
`natural-conversation` always runs all four dependent turns. `--sample 6` across
all six categories therefore plans nine turns, not six. `--repetitions N` repeats
the same selection and variants on fresh problems; change the seed to vary them.
If omitted, a seed is generated and saved. A seed reproduces selection for the
same catalog; reports retain selected IDs, variants, fixture hashes and a catalog
hash. Historical regression recordings are not an unseen holdout.

The inline median query has an agent-specific read-only expectation: return 6
without saving the temporary list, following the program instruction to avoid
saving merely to answer a query. Historical parser/audio fixtures retain their
original save behavior and bytes.

Each standalone case owns a fresh browser and isolated saved problem. Setup uses
deterministic commands; expected commands and answers stay in the grader and are
never supplied to the model. The report retains before/after screenshots, visible
workspace text, rendered math labels, saved-state/history checks, provider events
and audio observations. Completed replies require fresh output transcript text
and metered playback after the saved result was sent to Live; an earlier spoken
acknowledgment cannot complete a turn. Standalone results also retain before/after
problem snapshots for later review. The conversation retains its shared context and captures
a screenshot for each attempted turn. An agent can open these images to inspect
what actually appeared on screen. No product layout changes are required.

Use `campaignSummary.correctness` for planned/attempted/passed/failed/unattempted
counts, and `campaignSummary.latency` for measured/missing input-to-display timings
and p50/p95 in milliseconds. Both are also broken down by category. The summary's
latencies include observed successes and failures; missing measurements stay
missing, and setup/fixture/polling/screenshot durations remain separate harness
measurements. A slow correct result still passes. Timeouts mark an incomplete
journey, rather than enforcing a performance goal. Dependent conversation turns
remain explicitly unattempted after a failure; later independent families continue.
Small samples do not establish tail-latency distributions.

Screenshots support agent inspection, not an automated visual-quality verdict.
The local grader checks intended state and preserved history against deterministic
commands. Selected read-only answers have authored numeric checks. This does not
independently prove every engine calculation or that audio says the correct math:
existing audio parity checks compare provider captions and independently metered
playback. Physical microphones, noise, real student speech and usability remain
separate evidence lanes. Reports and images are written to fresh
`evaluations/journey-suite-<id>` paths and failures are retained.

## Student conversation corpus

[Student conversations v1](inputs/student-conversations-v1/README.md) adds 400 ordered student-style scenario families with independent reference answers and one review record per conversation. Its audio manifest maps all student turns to pre-generated local synthetic speech. Authored reference replay, paid transcription samples, actual-app visual review and future LoRA training are documented as separate evidence lanes.

## Manual agent regression cases

[Construction candidates](inputs/construction-candidates.json) includes
`symbolic-hypotenuse-h`, reported on October 24, 2026: “Create a triangle with side
lengths 3,4 and hypotenuse h”. The retained user screenshot shows `5` on the side
while the caption claims `h`. This is failure evidence, not a current-build pass.

Run the exact request through the actual agent in an isolated problem. Review
its drawing, progressive states, desktop/mobile labels, reload/undo behavior and
spoken/displayed agreement against the case checks. Record the revision, model,
prompts, contracts, generated program, viewports and reviewed evidence. Expected
answers belong to the reviewer and must not be supplied to the agent. A renderer
unit test or an uninspected screenshot cannot pass this manual case. Keep each
attempt in a fresh evaluation directory and mark missing review as incomplete.
