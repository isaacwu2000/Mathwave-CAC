# Web journey latency

Run from the repository root:

```sh
RUN_LIVE_CHECK=true pnpm run eval:journey http
RUN_LIVE_CHECK=true pnpm run eval:journey voice
RUN_LIVE_CHECK=true pnpm run eval:journey voice --repetitions 5
```

The voice lane uses Playwright's Chromium. Install it once with
`pnpm --dir Evals exec playwright install chromium`. Both lanes require the
app's existing local provider/database configuration and cloud test mode.
These are bounded live-provider evaluations, separate from `pnpm run test`.
The HTTP lane makes three interpreted requests and one deterministic control.
The voice lane uses three recordings through GPT Live and the command backend.
`--repetitions 5` creates five fresh browser/problem trials, with five observations
per connection scenario. Trials rotate Daniel, Karen and Rishi fixture voices;
the equations stay fixed. Failed or unavailable scenarios stay in the denominator.
Provider calls incur their normal charges.

Each command starts its own dev app on a free port with a unique synthetic
problem owner. It closes its own app process group in cleanup. Voice uses a new
browser context and substitutes checksum-verified WAV fixtures for the input
device. The audio worklet, WebRTC connection, GPT Live, backend interpreter,
math validation, persistence, and React rendering remain the application path.
It never opens the physical microphone. Expected transcripts and answers are
not sent to the provider. Physical acoustics and dyslexic-student usability
require separate evidence.

The existing `eval:agent` endpoint reports also include server-stage timings;
their `latencyMs` continues to exclude the intentional inter-case rate-limit wait.

Reports are written automatically to new `Evals/evaluations/journey-*.json`
files. They include source revision/fingerprint, model IDs, fixture hashes,
scenario outcomes, raw timing entries, missing stages, and p50/p95 summaries.
The percentile method selects the nearest rank; three examples are a baseline,
not a reliable estimate of production tail latency. HTTP reports separate
interpreted requests from the deterministic control. Failures have their own
summary and unattempted cases remain explicit. A later setup or
cleanup failure preserves completed samples.

## Success-rate uncertainty

Per-scenario summaries include two-sided 80% Wilson score intervals using
z = 1.2815515655446004, following the [NIST Wilson formula](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm).
These intervals describe pass/fail rates, not latency uncertainty. Even 5/5
successes gives approximately 75.3%–100%. Repeated fixtures and shared provider
conditions limit generalization beyond this synthetic campaign. Conditions
within a browser trial are related, so use the separate n=5 scenario intervals;
a pooled n=15 interval does not account for that dependence. New runner reports
omit the pooled interval. To recompute statistics for a saved voice report without
paid calls, run `pnpm exec tsx Evals/scripts/summarize-journey.ts <report.json>` from the
repository root. This writes a separate analysis and preserves the raw report.
With Matplotlib installed, `python3 Evals/scripts/plot-journey-confidence.py <analysis.json>`
exports the corresponding error-bar figure.

## Scenarios and measurement

The HTTP lane writes `x=0` without AI, then interprets an equation and two
algebra operations. It checks saved expressions against authored expected
answers and rejects AI-unavailable fallback as live-provider success.

The voice lane replays Daniel's equation recording on a cold connection, the
subtraction recording on the same connection, and the equation after an idle
close. Warm runs must omit a new connection; cold/reconnected runs must observe
one. A mismatch is a failed scenario, not a silently relabelled timing. The independent
reconnection case still runs if the warm connection is unavailable.

HTTP `elapsedMs` ends after the response body is read and parsed. Successful
voice `elapsedMs` / `responseLatencyMs` measures the last detected input signal
to the React display commit. `harnessElapsedMs` also includes fixture duration,
verification reads, polling and the deliberate idle wait. Missing voice latency
stays null; failed-attempt durations describe the harness wait. The volume
monitor is an acoustic signal detector, not a semantic end-of-speech detector.
A display commit establishes a rendered React update, not physical screen paint.

Browser timing entries have one request ID and a stage in `detail`. Milestones
are cumulative from that request's first milestone; span durations measure one
stage. Subtract `last-input-signal` from `delegated`, `result-returned`, or
`display-commit` for the corresponding input-to-result intervals.
`transcript-fallback` identifies the existing silence-deadline execution path.
`next-audio-observed` is the next idle-to-audio transition after a result; full
duplex audio has no result ID, so this is a proxy, not proof that the answer's
first word played. Already-speaking, muted and interrupted results can omit it.

Server durations use `Server-Timing`. Connection stages use `live-server:*`;
command stages use `problem-server:*`. HTTP reports read the header directly.
`model_N` includes provider response headers and the full parsed response body.
`preview_N` identifies a local preview before another model round; `validate_N`
measures validation, including a failed proposal that triggers repair. Nested
`model`, `interpret`, `execute` and `total` durations overlap: do not sum them.
Browser and server timestamps are never subtracted across machines.

Timing records are local and bounded to 300 measurements / 100 request starts.
They contain IDs, stage names and durations, with no transcripts or credentials,
and are not transmitted to an analytics service. The Evals reports contain only
known synthetic scenario text and fixture references. The isolated voice evaluator
also records up to 500 selected provider events: session model, instructions and
delegation mode; input/output transcript deltas; delegation IDs/targets; and
session closure. These traces are injected only into the synthetic browser context,
filtered by scenario start time, and contain no credentials. Production timing
records do not collect transcripts. A full buffer drops the oldest events.

## Design sources and next experiments

[OpenAI's GPT Live delegation guide](https://developers.openai.com/api/docs/guides/live-delegation)
describes GPT Live as the spoken frontend with reasoning/tool use in a delegated
backend. Managed Responses delegation uses a separate model and persistent
Responses connections; client delegation lets application code choose a model
or execute its own service. Moving to managed delegation does not remove the
backend model. The guide recommends measuring each stage, reusing connections,
returning concise verified results, and preserving cancellation/dependencies.

[OpenAI's latency guide](https://developers.openai.com/api/docs/guides/latency-optimization)
recommends fewer sequential requests, smaller suitable models, concise outputs,
streaming, and deterministic code where appropriate. Apply these after comparing
actual request outcomes and latency. Keep graph preview streaming intact.

The measurement approach uses [W3C Server Timing](https://www.w3.org/TR/server-timing/)
and [User Timing](https://www.w3.org/TR/user-timing/), with request correlation
following the purpose of [OpenTelemetry context propagation](https://opentelemetry.io/docs/concepts/context-propagation/).
This lightweight capture is not an OpenTelemetry exporter.

The initial automated HTTP baseline found additional model rounds after previews
for simple algebra. Compare preview frequency and interpretation latency before
changing models. Separately compare cold, warm and reconnected voice requests,
including fallback delays. Models, prompts, session silence deadlines and save
semantics are unchanged by the instrumentation.

## Captured baseline — October 15, 2026

The completed automated [HTTP report](../evaluations/journey-http-ae196ea2-ded3-42a4-80ff-2584e1a12ecd.json)
passed 4/4 authored expression checks. The deterministic write took 154 ms;
interpreted requests took 1.87–4.68 seconds. Two of the three used a preview
followed by a second model call. These are local dev-server measurements with
live providers and database access, not production benchmarks.

The [voice report](../evaluations/journey-voice-57ff5738-ab4f-46e7-91d6-e01d074dffdc.json)
passed all three expression, revision and connection-condition checks:

| Scenario | Last input signal → display commit | Before backend execution starts | Backend interpretation |
| --- | ---: | ---: | ---: |
| Cold equation | 5.82 s | 2.51 s | 3.17 s |
| Warm subtraction | 6.28 s | 2.18 s | 3.98 s |
| Equation after reconnect | 17.55 s | 14.53 s | 2.82 s |

The reconnect case used transcript fallback rather than normal delegation.
Connection setup itself took roughly 0.78–1.02 seconds and can overlap incoming
speech. This identifies fallback/dispatch waiting as a separate optimization
candidate from model latency. Two of three results observed subsequent audio;
the third audio observation remains missing. The earlier failed warm run is
retained as evidence that a warm connection is not always available.

Earlier reports from this implementation session are preliminary. In particular,
`journey-voice-a3bef55b-409f-4018-902c-e3d5eece2d37.json` reports harness wall time
and uses the earlier shared server-stage namespace. Use the completed reports
linked above for the baseline comparison.


## Five-trial campaign — October 15, 2026

The [raw 15-observation report](../evaluations/journey-voice-15d389ca-68fb-4c17-9085-3b3d091249d0.json)
retains all outcomes. Use the [reviewed per-scenario analysis](../evaluations/journey-voice-15d389ca-68fb-4c17-9085-3b3d091249d0-analysis.json)
for Wilson intervals; it omits the raw runner's pooled interval because the three
conditions share each trial. The analysis records the raw report's checksum.
The [error-bar figure](../evaluations/journey-voice-15d389ca-68fb-4c17-9085-3b3d091249d0-analysis-wilson80.png)
was generated from that analysis with Matplotlib.

Five separate browser/problem trials rotated Daniel, Karen, Rishi, Daniel,
and Karen. These repeat the same equation/subtraction tasks; they are not five
distinct math questions or a representative sample of student speech.

| Scenario | Successes | 80% Wilson interval | Successful response times |
| --- | ---: | ---: | ---: |
| Cold equation | 5/5 | 75.3%–100% | 5.68–9.25 s |
| Warm subtraction | 4/5 | 51.4%–93.8% | 5.19–7.26 s |
| Equation after reconnect | 4/5 | 51.4%–93.8% | 13.85–21.12 s |

The warm failure occurred because the session had closed before the follow-up.
The reconnect failure returned a displayed result but left the prior subtraction
equation unchanged. Both remain failures; unavailable warm scenarios are not
silently retried as cold successes.

All five reconnect requests took the transcript-fallback path. Their delay from
last input signal to backend start was 11.85–17.45 seconds. Cold and available
warm requests used normal delegation. This repeats the earlier evidence that
reconnect/fallback dispatch deserves attention separately from model latency.
Success-rate intervals are conditional on this small synthetic fixture campaign;
response-time ranges contain completed successful scenarios only.

## Reconnect investigation — October 15, 2026

Reconnect uses the same `/api/live-token` path, `gpt-live-1` model, instructions,
and client delegation as the initial connection. Saved problem context is
refreshed. The command backend retains `gpt-6-luna`, `preview_math`,
`preview_explanation`, and the same strict output schema. Regression tests cover
both the live session request and the backend tool definitions after saved state
changes.

The [provider-event diagnostic](../evaluations/journey-voice-2378c137-bf28-41db-bcac-700c6ee7b2ae.json)
confirmed matching live capabilities. Cold and warm requests emitted delegation;
the reconnect transcribed the equation and announced it would write it, but
emitted no delegation. This establishes the missing event, not why the provider
omitted it. A [prompt-only experiment](../evaluations/journey-voice-f60a4681-1f7a-4ff6-87f7-2de0e59d4e7c.json)
clarifying that fresh requests may repeat saved actions still used fallback and
took 16.34 seconds. That prompt change was reverted.

Two coupled application behaviors then prolonged fallback: reply playback kept
moving the shared silence deadline, and the same keep-alive kept forwarding
silent microphone frames, delaying input-queue drainage. The
[partial-fix campaign](../evaluations/journey-voice-d6395b66-8523-48df-ae7f-d4e173a1d090.json)
changed the request clock alone and still dispatched reconnect requests after
11.88–17.13 seconds. It passed 4/5 in each scenario; all failures are retained.
Tests reproduced both the moving deadline and the audio-drain interaction before
the full fix.

Fallback now waits for five seconds of student silence, at least 500 ms without
a transcript delta, and drained outgoing input audio. Playback keeps the
connection alive independently. Silent input forwarding stops after five seconds
of microphone silence even during a reply, and new speech resumes forwarding.
Continuing speech, late transcript text, queued audio, and late delegation have
regression coverage. This keeps the existing five-second hesitation allowance;
it does not switch models or add direct tool access to GPT Live.

The [full-fix five-trial report](../evaluations/journey-voice-c763fc38-1306-4c05-9746-4adc16ad39b9.json),
[per-scenario analysis](../evaluations/journey-voice-c763fc38-1306-4c05-9746-4adc16ad39b9-analysis.json),
and [80% Wilson error-bar figure](../evaluations/journey-voice-c763fc38-1306-4c05-9746-4adc16ad39b9-analysis-wilson80.png)
retain all 15 outcomes with the same rotating fixtures and live providers:

| Scenario | Successes | 80% Wilson interval | Successful response times |
| --- | ---: | ---: | ---: |
| Cold equation | 3/5 | 33.0%–82.0% | 4.51–6.74 s |
| Warm subtraction | 3/5 | 33.0%–82.0% | 4.69–5.28 s |
| Equation after reconnect | 5/5 | 75.3%–100% | 9.14–12.31 s |

Four reconnects still used fallback; input-to-dispatch was 6.16–6.66 seconds,
including the five-second silence allowance and queued-input drainage. One
reconnect emitted normal delegation at 2.82 seconds. Backend interpretation took
3.94–6.11 seconds across reconnects. Successful reconnect response p50 was
11.54 seconds, compared with 17.17 seconds in the original baseline. These are
descriptive small-sample comparisons under changing provider conditions, not
latency confidence intervals or a production speed guarantee.

Both Karen cold trials were misrecognized: provider input text began “Run to x”
and “Round to x” rather than the authored “Write two x”. Their warm follow-ups
then inherited incorrect starting math. All four remain failures, and the command
exited unsuccessfully despite reconnect passing 5/5. The sample does not establish
an overall accuracy improvement. Recognition and initial-state failure propagation
need separate investigation; swapping the backend model cannot recover words
that never reach it reliably.

## Short reconnect prompt experiment — October 15, 2026

The next experiment changed only the final reconnect rule to:

> After reconnect, treat saved state as context. Delegate every new math request,
> including repeated requests. A spoken acknowledgment does not complete an action.

This replaces the previous instruction to retain saved context without repeating
completed actions. The rest of the prompt, models, tools, fallback deadlines,
fixture rotation, and evaluator remained unchanged. The candidate runs on both
initial and reconnected sessions, preserving capability parity. This is a focused
prompt experiment rather than a rewrite to the full
[official prompting template](https://developers.openai.com/api/docs/guides/live-prompting).

The [candidate raw report](../evaluations/journey-voice-02e655d9-0d55-4ed7-8118-45788a1de7d9.json),
[analysis](../evaluations/journey-voice-02e655d9-0d55-4ed7-8118-45788a1de7d9-analysis.json),
and [80% Wilson figure](../evaluations/journey-voice-02e655d9-0d55-4ed7-8118-45788a1de7d9-analysis-wilson80.png)
contain five observations per scenario. Comparison uses the immediately preceding
full-fix campaign above, not a new randomized or interleaved control campaign.

| Measure | Previous prompt | Candidate prompt |
| --- | ---: | ---: |
| Cold correctness | 3/5 | 5/5 |
| Warm correctness | 3/5 | 5/5 |
| Reconnect correctness | 5/5 | 4/5 |
| Reconnect direct delegation | 1/5 | 2/5 |
| Successful reconnect response p50 | 11.54 s | 11.44 s |
| Reconnect fallback input-to-dispatch | 6.16–6.66 s (4 cases) | 6.00–6.45 s (3 cases) |

Candidate correctness 80% Wilson intervals are 75.3%–100% for cold and warm,
and 51.4%–93.8% for reconnect. Direct-delegation intervals are 6.2%–48.6% for
the previous prompt and 18.0%–67.0% for the candidate; these also use the Wilson
formula with n=5 and count executed requests carrying a `delegated` milestone.
The broad overlapping intervals do not establish a delegation improvement.
Intervals describe rates, not latency, and no pooled interval is reported.

The candidate reconnect failure transcribed the Karen fixture as “Run to X plus
three equals eleven” and left the prior subtraction equation unchanged. One
directly delegated reconnect still took 13.58 seconds, including 9.78 seconds
of backend interpretation. Earlier dispatch alone therefore does not ensure a
fast complete response. The evaluation exited unsuccessfully and retains this
failure. Its source fingerprint and provider session events record the tested
prompt before unrelated work resumed in the shared checkout.

Retain the clearer wording as a prompt clarification, without claiming it fixes
delegation, recognition, or latency. Three of five reconnects still needed fallback.
This small sequential campaign is inconclusive about the prompt's effect; the
cold/warm pass-rate change also cannot be attributed confidently to the prompt.

## Direct requests, provisional display, and provider comparison — October 16, 2026

Complete explicit `write ... = ...` requests and add/subtract/multiply/divide on
both sides now use the deterministic command engine, without an AI call or a
model preview. The direct route rejects incomplete expressions, conditional
instructions, explanations, corrections, and multi-part requests. Pending
clarification continues through the interpreter.

The voice callback recognizes only those same complete requests. They become
eligible after 1.2 seconds of student silence, 500 ms of settled transcript text,
and drained input audio. The latest transcript must arrive after the latest
detected student sound; a complete but older transcript cannot dispatch newer
untranscribed speech. Input silence stops forwarding at the request deadline so
the queue can drain. Other requests and the connection idle allowance retain five
seconds. This bounded grammar is not a general semantic end-of-turn detector.

AI requests offer preview tools on explanations and repair attempts, rather than
on every first proposal. A complete valid proposal is displayed while persistence
finishes. Tool observations appear while checking continues; invalid proposals
show a fixing state. Previews are read-only and explicitly unsaved. They never
replace the client's confirmed snapshot, saved history, or request receipt.
Failed requests restore the last confirmed work; uncertain saves retain the
original request ID for recovery. Newer requests ignore older progress updates.

The opt-in `Accept: application/x-ndjson` problem response carries progress before
the final durable response. Existing JSON clients and receipt replay remain
compatible. The final stream frame carries HTTP status and Server-Timing values;
a missing final frame never confirms a save. `command-preview` and
`preview-display-commit` timings are distinct from the final `display-commit`.

### Bounded verification

After the user reduced scope, remaining checks were four backend cases (two each
for Haiku low and medium), the three voice scenarios, and one mocked browser
lifecycle case. No further paid reruns were added. Two earlier 25-observation
backend batches had already finished when the reduction was processed; those
reports remain below rather than being discarded or called an eight-case run.

The [three-scenario live report](../evaluations/journey-voice-0a1e8d43-ce90-4072-932f-2f1cd0810f7c.json)
uses Daniel's synthetic recordings through Live, the real API, persistence and
React. All three authored mathematical answers matched:

| Scenario | Last student signal → displayed saved result | Backend execution |
| --- | ---: | ---: |
| Cold equation | 2.81 s | 20 ms |
| Warm subtraction | 1.17 s | 2 ms |
| Reconnected equation | 3.59 s | 2 ms |

None used an interpreter model call. The reconnect used `fast-dispatch`; the
other two received native delegation. This is one observation per scenario,
not a reliable latency distribution. Earlier five-trial results are historical
comparisons with different dispatch/interpreter behavior.

The stricter complete-journey result remains **1/3**, not 3/3: cold failed the
speaking-indicator/audio check and reconnect failed visible/spoken transcript
parity. Warm passed both math and parity. These failures remain in the raw report
and were supplied to the concurrent audio/UI investigation; fast mathematical
display does not establish a correct spoken experience.

The [mocked browser lifecycle report](../evaluations/command-progress-ce9eb00d-c04d-402c-a068-9978dbaf09de.json)
checks a visible checking result, a replacement fixing result, and final save.
It verifies revision zero during previews and exactly one revision after saving,
including the rendered final equation. Browser input, Live transport, and API
responses are mocked; it uses no paid provider or physical microphone and writes
no problem data. [Desktop](../evaluations/command-progress-ce9eb00d-c04d-402c-a068-9978dbaf09de-desktop.png)
and [mobile](../evaluations/command-progress-ce9eb00d-c04d-402c-a068-9978dbaf09de-mobile.png)
captures show checking/fixing at 1280×900 and 390×844 without horizontal overflow.
Earlier failed mock setup reports are retained; the harness now waits for the
same hydration-ready marker as the live evaluator before clicking.

### Models and thinking

Luna remains the default. Haiku uses the same strict proposal schema,
deterministic validation, preview tools, repair budget and save path through
OpenRouter's Responses endpoint. Voice recognition remains `gpt-live-1` in every
profile; this work adds no separate transcription service.

| Profile | Requested thinking | Observed screen result | Successful response times |
| --- | --- | --- | --- |
| `luna-default` | Provider default | 23/25 | p50 2.94 s |
| `haiku-off` | Disabled, low effort | 20/25 | p50 1.88 s |
| `haiku-low` | Enabled, low effort | 2/2 | 7.59–8.27 s |
| `haiku-medium` | Enabled, medium effort | 2/2 | 8.89–9.78 s |

Raw reports: [Luna](../evaluations/journey-backend-40165b8a-210d-44fe-9bd6-9ec28fecb0dc.json),
[Haiku off](../evaluations/journey-backend-f3b51441-0e96-44eb-a1ff-41f289415268.json),
[Haiku low](../evaluations/journey-backend-726cbe63-e92d-4400-b9fb-54e1f9fd618c.json),
[Haiku medium](../evaluations/journey-backend-3f0fad2b-00ae-43e1-9054-0d4600deb94f.json).
The initial two profiles ran five tasks five times; low and medium ran only the
two-step and explanation cases once each. These are different sample sizes and
task mixes, so the pooled timings are not a matched comparison of all profiles.

Haiku off returned simplified `x = 4` on all five two-step requests instead of
the requested unsimplified operation result. This is an instruction/step-display
failure, not a claim that x equals four is mathematically wrong. Low and medium
matched the expected final form on their single two-step attempts. Low was faster
on both matched cases, but two observations do not establish a universally best
thinking level or justify replacing the default.

These captured backend screens checked status and exact final expression. Review
found that a shortcut writing the expected final expression could still pass
without preserving both steps. The evaluator now additionally checks the authored
intermediate expression and two-command sequence, with a regression test rejecting
that shortcut. Historical screens are not retroactively described as passing this
stronger check: their reports did not retain the full proposal. Future reports
record the proposal and intermediate expressions for offline rescoring. Explanation
checks establish the response type and unchanged math, not full pedagogical quality.

Use small selected backend cases explicitly:

```sh
RUN_LIVE_CHECK=true pnpm run eval:journey backend --profile haiku-low --cases two-steps,explanation
RUN_LIVE_CHECK=true pnpm run eval:journey voice --repetitions 1 --profile luna-default
pnpm exec tsx Evals/scripts/check-command-progress.ts http://localhost:3033
```

Profiles are server configuration (`MATH_AUDIO_COMMAND_PROFILE`), not a browser
model selector. OpenRouter profiles require the ignored `OPENROUTER_API_KEY`;
credentials and hidden reasoning are never written to reports. Official references:
[Haiku model](https://openrouter.ai/anthropic/claude-haiku-5.5),
[thinking controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens),
and [Live application-owned work](https://developers.openai.com/api/docs/guides/live-delegation).

### Streaming student captions

Live input transcript fragments already pass directly through the session and
React state to the microphone caption, without waiting for a full request or
delegation. Dispatch previously cleared that caption immediately; a final fragment
and delegation arriving in the same browser task could erase the text before it
painted. Both native delegation and silence fallback now retain the caption until
the next input transcript replaces it or listening stops. Command input still
resets at dispatch, so retained display text is never executed again.

The [mocked streaming check](../evaluations/command-progress-9a0c41f8-5012-49d5-8d62-9c5146b3047b.json)
observes successive partial captions before delegation and retains the final
caption when the last fragment and delegation share one task. It also checks
checking/fixing previews and the final saved result at desktop and mobile sizes.
This establishes browser display behavior, not faster provider transcription or
an end-to-end latency improvement. No paid provider calls were made for this check.
See [Live transcript events](https://developers.openai.com/api/docs/guides/live-conversations)
for the provider's fragment-based contract and uneven delivery caveat.
