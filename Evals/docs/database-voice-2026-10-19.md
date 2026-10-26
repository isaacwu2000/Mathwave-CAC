# Database and browser voice verification — October 19, 2026

The local app now uses a dedicated free Neon project named
`math-audio-development`. Its connection is stored only in ignored
`Web/.env.local`. Both existing migrations were applied. Local test mode remains
development-only; this does not establish production student accounts.

## Fixes

- The migration command previously forced `.env`, ignoring `.env.local` even
  though the app uses it. It now uses Bun's normal environment loading. A
  subprocess regression verifies both base and local configuration without a
  database or real credentials.
- Microphone startup now has a 15-second deadline. Timeout and cancellation abort
  initialization, immediately close acquired tracks/audio contexts, ignore stale
  results, and allow retry. A late permission grant is closed before audio
  initialization. Tests cover stalled initialization, late grants, and retry.

## Real database evidence

[Persistence report](../evaluations/cloud-persistence-0cd3b63b-80f1-4fc9-9cac-243b9b4fba38.json)
passed four checks on the isolated synthetic owner: write, idempotent retry,
stale-write rejection, and fresh-read persistence. A separate browser reload
restored `2*x+3=11` as a saved step. No student work was modified.

## Browser voice evidence

Desktop Chrome reached Listening and connected to GPT Live using its real
microphone path. Speaker-to-microphone playback did not yield a transcript; that
acoustic path is not a passing spoken-command check.

The recorded-input browser lane substitutes only the input device. WebRTC,
GPT Live, command execution, Neon saves, rendered results, and spoken replies
remain real. The first complete
[recorded run](../evaluations/journey-voice-818ae445-2b70-4289-95fc-691ec1aa018f.json)
passed 3/3 cases: cold equation, warm subtraction, and equation after reconnect.
Input-end to display took 3.25–4.88 seconds. These fixtures exercise clear commands,
including deterministic command fast paths; they do not establish broad natural
conversation quality or human microphone accuracy.

The [final run](../evaluations/journey-voice-81f774f1-ac6a-4551-8ebe-6e6707217f2b.json)
repeated all three cases on committed runtime `c4c2174` and passed 3/3. Input-end
to display took 2.52–5.17 seconds. Both runs are retained; the small sample is
not a production latency benchmark.

The initial [setup failure](../evaluations/journey-voice-a4801bbb-5b6a-4d57-a47a-84a8e9945445.json)
is retained. All three cases were blocked because the pinned test browser was
not installed. Installing that browser resolved the setup failure.

The embedded browser's stalled capture now returns to Start listening and shows
permission/Chrome guidance instead of spinning indefinitely, retaining the saved
equation. [Recovery screenshot](../evaluations/database-voice-2026-10-19/startup-recovery.png).

Full deterministic verification passed 455 tests, with two skipped, plus type
checking, lint, architecture checks, and the production build. Neither these tests
nor the synthetic voice lane establish dyslexic-student usability.
