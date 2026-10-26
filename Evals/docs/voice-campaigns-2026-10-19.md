# Categorized voice campaigns — October 19, 2026

## Checklist

- [x] Keep correctness and latency independent, with no performance pass threshold.
- [x] Group recordings by case family and expose category/ID filters.
- [x] Add seeded stratified sampling, selection preview and replay metadata.
- [x] Preserve complete dependent conversations and explicit unattempted turns.
- [x] Capture actual screens, rendered math, saved work, history and spoken replies.
- [x] Run live campaigns, inspect screenshots and fix evaluation mistakes.
- [x] Verify sampling, grading, timing, CLI and screen contracts with automated tests.

## Selection and evidence

`pnpm run eval:voice` uses the suite lane of the journey runner. The catalog has
23 families: algebra 2, statistics 2, graphs 4, geometry 11, clarification 3 and
conversation 1. It reuses the 75 frozen algebra/graph/geometry recordings and four
natural-conversation recordings. Recovery phrasings and voices are variants of a
family, rather than extra reasoning capabilities. This adds current GPT Live
browser coverage for recordings previously assessed through other recognition
lanes; those earlier results are not relabeled as GPT Live evidence.

Filters intersect before sampling. A sample balances eligible categories without
replacement and must cover every eligible category. A seed reproduces family
selection and one voice/wording variant per family for the same catalog. The
conversation is one sampled family containing all four dependent turns. Sample
size six across all categories therefore schedules nine turns. Repetitions keep
the selected variants fixed and create fresh problems. See the
[run examples](../README.md#filtered-voice-campaigns).

Correctness checks intended state, history, persistence, rendered mathematical
content and audio/display parity. Latency separately measures the last detected
input signal to the saved display commit. Missing timing stays missing. Harness
time includes setup, recording duration, reply completion and screenshot capture.
No speed threshold affects a correctness pass. Functional timeouts mean the
journey was not verified complete. Category summaries and unattempted case IDs
remain explicit; no pooled reliability confidence is inferred from this sample.

Every standalone case has before/after screenshots and visible workspace text.
Conversation screenshots capture each attempted turn. These let the evaluating
agent inspect what appeared on screen without changing the product layout.
The screenshots for the median and corrected equation were inspected directly:
the final median caption says six; the corrected equation is `8*x-2=14` with the
original equation retained as the earlier step.

## Runs and iteration

The fixed seed `voice-2026-10-19` selected median (Daniel), intercepts (Karen),
equation dictation (Karen), hypotenuse (Daniel), missing-height clarification
(Rishi), and the Daniel conversation.

1. The [sandbox-blocked setup](../evaluations/journey-suite-b8585983-52a4-4d75-909e-9636178cbb42.json)
   attempted no cases. Its planned nine turns remain unattempted.
2. The [first live campaign](../evaluations/journey-suite-f68064f3-4e53-43ad-a8e4-25b62427a078.json)
   retained setup/network failures and exposed overly strict exact-answer grading
   plus an incorrect equation requirement for a correctly empty workspace.
3. The [second campaign](../evaluations/journey-suite-184bac33-654b-4a51-adbc-1edb48077023.json)
   attempted nine turns and passed seven under that grader. Karen's equation
   recording was heard as “What do x plus 3 equals 11”; the app asked for
   clarification instead of writing the authored equation. This recognition
   failure stays in the report. The other failure was the median oracle below.
4. The [stronger nine-turn campaign](../evaluations/journey-suite-3742f32a-fa32-413f-8dbc-928714397b63.json)
   passed eight, including the whole conversation, and retained the median
   oracle failure. It requires new output transcript text and independently
   metered playback after the saved result is sent to Live. An earlier spoken
   acknowledgment cannot stand in for the result. All nine input-to-display
   times were observed: p50 **5.95 s**, p95 **17.91 s**, including the failed
   case. The slow 17.91 s intercept result still passed correctness.
5. Investigation confirmed that the program instructions explicitly prohibit
   saving merely to answer a query. The legacy parser command for an inline
   median saves its temporary data list; an agent program should instead answer
   six and preserve work. The agent-specific median expectation now requires the
   correct answer with unchanged state/history, rejecting both seven and an
   unwanted save. Historical fixtures and reports remain unchanged.
6. A [focused replay setup timeout](../evaluations/journey-suite-7ff4f59d-50af-406c-b6be-1bda146b1906.json)
   attempted no case. The subsequent [median replay](../evaluations/journey-suite-72a479e6-8265-4dac-a1d1-151087a494a0.json)
   passed **1/1** with the corrected oracle and observed **6.05 s** input-to-display
   latency. It retains before/after problem snapshots for further review.

The nine-turn result remains 8/9 in its original report, followed by a separate
1/1 median verification. These are not a single new 9/9 campaign. Runs were
captured from a dirty development checkout while evaluation hardening continued;
use the saved source/catalog fingerprints and raw reports as development evidence,
not an immutable release or production benchmark.

Review also found that naive root text matching could accept one negative root
as both intercepts, or accept decimal prefixes such as -2.5 and 2.5 as -2 and 2.
Regression tests now require both complete signed values. Read-only explanations
can use natural wording while preserving the authored numeric facts and history.

## Limits

These are small, selected synthetic regression runs. Repeated recordings and
shared conversation state do not establish population accuracy or a stable tail
latency distribution. The recognition failure in an earlier campaign remains
unresolved evidence; a later pass does not erase it. No model, voice prompt,
student-facing display or dispatch deadline changed in this task.

This work does not add human speech, noise, physical microphone, hesitation,
barge-in or real student trials. Existing deterministic lifecycle tests cover
some of those boundaries; they still need their own recorded/live evaluation
families. Numeric checks and state comparisons are bounded grading rules, not
a full pedagogical judge or an independent proof of every engine calculation.
