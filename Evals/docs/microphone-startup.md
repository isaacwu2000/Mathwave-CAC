# Microphone startup check — 2026-10-10

## Changes

Browser speech now explicitly requests microphone access before starting the
speech recognizer. Capture tracks are released before recognition takes over.
Cancellation, switching providers, playback pauses, permission timeouts, and
late permission results cannot revive a stopped session or leak a capture track.

Permission failures identify denied access, a missing device, and a busy device.
A separate recognition timeout reports that capture succeeded but the browser's
speech service did not start. A blocked speech service is not reported as a
microphone permission denial.

## Actual browser evidence

- Google Chrome at `http://localhost:3000/`, Browser speech selected: real capture
  reached **Listening** and Chrome displayed its microphone recording indicator.
- Stop returned to **Mic off** and cleared Chrome's recording indicator.
- Two subsequent starts reached **Listening** again, followed by successful stop.
- Actual microphone input produced interim and final recognized speech. No mocked
  recognition events were used for these browser checks. Unrelated ambient speech
  did not add problem steps; the interpretation endpoint reported API credit or
  limit failure. No ambient transcripts are retained in this report.
- A Daniel equation recording played from `/demo-voices/` while the microphone
  listened in another tab. The expected equation was **not** recorded as a step.
  This speaker-to-microphone math-command test is not a pass; output routing, echo
  cancellation, and ambient speech were not controlled. It does not establish
  recognition accuracy for homework dictation.
- The Codex embedded browser denied `getUserMedia`; the app returned to idle with
  the specific permission notice instead of a misleading Listening state.
  macOS Microphone settings showed Google Chrome enabled. No privacy settings
  were changed. Use Chrome for this local live demo.
- Capture was stopped after testing. The Chrome problem is left on a clean demo
  problem with Browser speech selected.

## Automated checks

Regression coverage includes startup only after recognition's start event,
permission rejection and retry, late permission cleanup after cancel or timeout,
startup timeout after successful capture, duplicate final-event suppression,
silence, playback pause/resume, and device-error classification. These use fake
recognizers/capture functions and do not replace the actual browser evidence.

Final verification: 132 tests passed; TypeScript, lint, production build, and
`git diff --check` passed.
