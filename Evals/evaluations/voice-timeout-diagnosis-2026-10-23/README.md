# Recorded voice timeout investigation — 23 October 2026

Starting revision: 9c70f23. Shared checkout contained concurrent Native changes; the local voice chat subsequently edited prompt generation and its own eval files. This task owns only spoken-result.ts, spoken-result.test.ts, voice-fixture.ts and browser-recorded-suite.ts, plus these new reports. No production voice behavior or mathematical assertions were weakened.

## What the original failure proves

The original report, ../journey-suite-86a51b46-8230-428b-8ea8-34ab1b5a5417.json, contains session.started and session.closed, but no input transcript, delegation or reply. Connection readiness took about 1.94 seconds after detected input. The recording check waited 45 seconds for a displayed result. Its after screenshot showed [No audio] and unchanged work. The trace did not measure outgoing media energy or packet counts, so it cannot distinguish a transport/audio-delivery failure from an untranscribed provider input. The exact cause remains unresolved; a timeout alone is not evidence of either cause.

## Confirmed test bug and fix

A same-recording rerun, ../journey-suite-37976376-8fa1-487e-8b61-66d27976c157.json, transcribed and saved the correct 2x+3=11 equation. It then failed playback parity because the completion wait accepted a short pause between phrases and the screenshot was taken after speaking resumed. The new regression test reproduces this public browser completion boundary: the old implementation returns true during a 400ms pause. The fix requires one second without metered playback, a speaking indicator, or new transcript text. This is a completion heuristic, not a provider final-response event guarantee.

The fixture now records bounded, synthetic-only audio diagnostics: fixture scheduling/end, outgoing source energy/duration, and outgoing audio packet/byte totals. These observations do not contain audio samples, SDP, tokens or credentials. They are included in recorded-suite failure reports.

## Follow-up evidence

../journey-suite-f2154492-6465-4c3f-883a-450165eb8ce0.json contains two replays of the same Rishi equation fixture with the corrected completion wait and audio diagnostics:

- Trial 1 completed input, a save and a full spoken reply. Nonzero outgoing energy was approximately 0.8505 with 337 packets sent. It FAILED mathematical fidelity because Live transcribed an extra y: requested 2x+3=11 became 2x+3y=11. The assertion was preserved and the failure retained.
- Trial 2 completed input, saved 2x+3=11 and finished the corresponding spoken reply. Outgoing energy was approximately 0.8620 with 283 packets sent. Math, history, screen, save and audio/display parity all PASSED.

These runs demonstrate delivered synthetic audio and successful replies in the measured attempts. They do not explain or fix the original missing transcript, and one passing attempt does not establish reliable recognition. No physical microphone, progressive graph generation or real-student usability claim is made.

## Checklist and visual review

- [x] Re-run the same recording and inspect transcript, saved work and playback.
- [x] Reproduce the premature completion bug with a failing deterministic test, fix it and pass the focused tests.
- [x] Add outgoing audio measurements for future no-transcript failures.
- [x] Inspect every before/after screenshot from the three new recorded cases at the actual app's 1280×900 viewport: the 37976376 case shows the correct equation with an unfinished spoken reply; f2154492 trial 1 shows the incorrect extra y; trial 2 shows the correct equation and completed reply. No graph was requested or rendered in these cases.
- [x] Preserve the failed recognition result and original timeout evidence.
- [ ] Identify and fix the original intermittent no-transcript cause. It did not recur in these three reruns, and the original trace lacks audio-delivery measurements. Voice reliability remains unverified.

Verification: three focused tests pass; typecheck and owned-file lint pass. Full repository verification outcomes are recorded below. Concurrent prompt work is outside this task.

Publication checks: the full test run passed 619 tests (5 skipped), module boundaries and TypeScript passed, owned-file lint passed, and the production build passed. `bun run verify` initially stopped at an unused mkdir import in the concurrently owned Evals/scripts/check-compact-prompts.ts. Its owner fixed it; a fresh whole-repository lint run passed. All constituent gates have now passed; no failing gate remains for this eval change. The original no-transcript cause and reliable recognition remain open, as described above.
