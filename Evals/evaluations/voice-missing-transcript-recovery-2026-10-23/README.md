# Recover missing voice transcripts — 23 October 2026

Starting revision: d288f0a. Existing Native and Training/LLM work belongs to the local voice pipeline chat and is preserved. This task owns the Web voice-session implementation and its lifecycle tests, plus the recorded-suite fixture and its tests.

The application previously discarded captured audio after its first delivery. A connected session that never produced a transcript could idle-close without recovering or explaining the lost request. A deterministic public voice-session test reproduced that missing recovery: after closure it had one connection instead of the required second connection, with no recovered action.

## Completed checklist

- [x] Retain up to twelve seconds of untranscribed audio in memory, with a short silence tail. Discard it on accepted transcription/delegation, stopping, pausing or failure. Nothing is written to disk by recovery.
- [x] After the normal idle deadline, close the unheard session and replay the complete retained request once on a fresh connection. An unexpected early closure uses the same bounded recovery.
- [x] Allow the replayed audio to finish draining and give the provider its transcript window before declaring the second attempt unsuccessful.
- [x] Never automatically replay a request after any meaningful transcript or accepted delegation. Keep the same request identity during recovery and ignore events from the closed generation. A recovered request creates one saved action.
- [x] If the second attempt also lacks a transcript, explain that no action was taken and ask the student to repeat. Listening remains available; a newly recognized request clears that specific error. Overlong audio is not replayed as an incomplete request.
- [x] Verify microphone stop, stop during retry closure, pause, long input, recognized work and stale events through the existing public session seam.
- [x] Prove recovery through the actual browser, real GPT Live, deterministic engine and isolated persistence while intentionally withholding the first connection's transcript/delegation from the client.
- [x] Check the ordinary recorded path without fault injection.
- [x] Visually inspect every captured before/after result from the three rendered cases below at 1280×900. No graph was requested or rendered; no responsive layout or progressive graph generation was changed.
- [x] Run the full verification gates and focused final checks.
- [x] Publish owned source and evidence in the containing commit.

## Recorded evidence

- ../journey-suite-0ad4adbc-11e2-4794-b204-991aadce97ab.json: PASS with MATH_AUDIO_VOICE_FAULT=drop-first-recognition. Actual provider transcript/delegation events from the first connection were withheld by the browser fixture. The client recorded exactly one transcription-retry and two session starts. Recovery saved exactly one 2x+3=11 equation, with correct history, matching displayed math, a finished spoken reply and passing audio/display parity. Input-to-display latency was approximately 16.94 seconds in this deliberately failed-first-attempt case.
- ../journey-suite-d4477271-680f-4cba-b466-0d55e492c760.json: ordinary recorded equation PASS without injected failure. It saved one 2x+3=11 equation and passed history, screen, completed speech and parity. Input-to-display latency was approximately 3.45 seconds. These single samples are not a performance benchmark.
- ../journey-suite-91d6da12-49ec-427a-b517-3275b8dd4c70.json: the first injected attempt recovered and saved correct math, but FAILED parity because the fixture carried expected reply text across sessions. Its screenshot also revealed a stale transient recovery notice. Both issues were fixed before the passing injected run: reset fixture input-turn tracking on session closure and reserve failure notices for exhausted recovery. This failed run remains retained and was visually inspected.
- ../journey-suite-c83018bd-0687-490c-9b6c-3b636efc32a9.json and ../journey-suite-4820a5c5-a378-419e-bdae-1379167e500e.json: setup failures while full verification and model-training work overlapped. One app did not reach ready; the other did not start. No audio case or rendered capture was produced, so these are not voice acceptance results. Work was coordinated before sequential replays.

Before views show the welcome workspace. The passing after views show 2x+3=11, a completed corresponding spoken transcript and no stale recovery error. The microphone's [No audio] indicator reflects current silence after the request, not a failed action.

## Verification and limits

The new session regression failed before implementation. Tests now cover one recovery, no duplicate execution, stale delegation rejection, exhausted retries, fresh input after exhaustion, stopping/pausing, cancellation during closure, twelve-second retention limits, and unexpected closure. The fixture test also failed before resetting cross-session transcript tracking.

Full bun run verify passed all gates with 643 tests passed and 5 skipped. A final follow-up that clears an exhausted-recovery message when fresh speech is recognized passed all 45 focused voice/fixture/completion tests, TypeScript and repository lint. A final production build is recorded below after that follow-up.

The original provider's reason for returning no transcript remains unknown. This change fixes the application's missing recovery and silent-loss behavior; it does not claim to eliminate all provider outages or speech-recognition errors. Evidence uses a synthetic Rishi recording and an injected first-attempt failure, not a physical microphone or real-student usability study. All paid sessions used isolated evaluation work and owned app processes, which the runner stopped afterward.

Final production build after the exhausted-notice clearing follow-up: PASS. No required verification gate remains blocked for this recovery change. The unrelated concurrent Native and Training/LLM changes remain outside its commit.
