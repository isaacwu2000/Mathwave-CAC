# Browser speech recordings — 2026-10-10

These results use actual Chrome Web Speech recognition on explicit audio tracks.
Only synthetic fixture audio is sent to the speech service, without expected
transcripts, vocabulary hints, or microphone input. The math checks run locally
in an isolated workspace and never edit saved homework.

## Initial Daniel baseline (en-US)

- 20 completed transcripts: 9 passed the original parser checks.
- The next recording returned no final transcript, stopping the original batch;
  the remaining five recordings have no completed results. This is not a 25-case
  pass-rate measurement.
- Three fixes based on those actual transcripts bring the same 20 transcripts
  to 12 passing local checks: write/right for complete equations, rectangle
  width/with, and three numeric triangle sides without punctuation.
- `daniel-parser-recheck.json` is a local re-evaluation of saved transcripts,
  not a fresh browser-recognition run.
- A lost exponent (`graph y = x - 4` instead of a quadratic) remains an incorrect
  interpretation of the original audio. The app cannot infer a missing exponent
  from an otherwise valid equation. Severe errors such as “change the weather
  today” remain unresolved rather than being assigned a guessed dimension.
- Expected clarification counts in these initial reports check the status, not
  the exact question wording.

## Fresh Daniel run (en-GB)

- 25 attempted recordings, 14 passing checks. Two returned no final transcript
  and are counted as failures; the batch now continues after these failures.
- Used the tuned parser, UK English recognition, and 300 ms of leading silence.
  These changes were tested together, so the run does not isolate their effects.
- Range and point exploration now passed. Median transcription was clear but
  lacked commas; short dimension replies still became "for" or "weather".
- This is a fresh recognition run on the same 25 audio fixtures, not a new
  held-out test set. Clarification checks still score status only.
- Raw transcripts, locale, audio hashes and outcomes are in
  `daniel-uk-fresh.json`; no missing results are excluded from its denominator.

## Recovery UI check

The embedded browser denied microphone access when GPT Live was selected.
The new Use Browser speech button switched provider without altering Problem 8,
its equation, graph or four saved steps. Selecting UK English and reloading
preserved both speech preferences and the saved problem. This verifies recovery
and preference persistence, not a successful GPT Live connection. The embedded
browser still cannot capture the microphone; use desktop Chrome for live input.

## Hardware boundary

This checks recording-to-transcript-to-math behavior. It does not establish live
microphone hardware, acoustic quality, or human dictation accuracy. The separate
[microphone startup report](microphone-startup.md) documents real microphone start/stop evidence.

Chrome's audio-track recognition support is documented in the Chromium
[shipping discussion](https://groups.google.com/a/chromium.org/g/blink-dev/c/4ibjEVQ-i0s/m/oNde5hrICgAJ).

## Further parser tuning (2026-10-10)

Replaying the same Daniel UK transcripts now passes 16/25 (previously 14/25).
The two additional successes are the explicit numeric median list without
commas and "said the radius to 7" while a circle is already active. Numeric
values are still parsed and validated; "weather" and "for" are not guessed.
`daniel-uk-parser-recheck.json` includes the two original recognition failures
in the denominator. This is training-set replay, not new speech recognition.
A new Karen recognition run could not start because Chrome controls stalled;
no fresh Karen result or acoustic improvement is claimed.
