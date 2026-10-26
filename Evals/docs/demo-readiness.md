# Live demo preparation · October 10, 2026

## Prepared and verified

- Voice settings expose GPT Live and browser speech. Switching providers stops the previous session. Browser recognition uses the existing guarded VoiceSession and submits recognized transcripts through the same local command path as typing. The provider choice is saved locally.
- Browser speech has no OpenAI audio requirement; the browser may use its own network speech service. Unsupported transcripts can still use the existing OpenAI interpretation endpoint. This is not an offline speech guarantee.
- Twelve actual WAV recordings: Daniel, Karen, and Rishi, each speaking equation entry, subtraction, inline median, and outliers. These are synthetic installed macOS voices, not human participants or Gemini voices. Checksums, durations, transcripts, and expected commands are in public/demo-voices/manifest.json.
- The generator rejects empty/short recordings. Tests verify RIFF/WAVE data, nonzero samples, duration, and checksums. Initial sandbox output was empty; final files were regenerated with access to macOS speech services.
- Browser UI: provider selection and privacy description verified. Microphone startup can be cancelled. Typed equation entry and subtraction produced exactly two saved steps. A separate Problem 2 was used; the original Problem 1 remains saved.
- Reload restored both algebra steps and the selected browser provider. The recorded-sample page loaded all four Daniel clips, and its equation player entered playback with an enabled scrubber. This verifies browser playback, not microphone recognition.
- 69 automated tests, typecheck, lint, and production build pass. Lifecycle tests cover denial, silence, cancellation, pause/resume, and duplicate final transcripts; those use mocked recognition events.

## Still unverified

Neither GPT Live nor browser speech reached Listening during the automated attempt. Chrome control repeatedly timed out or reported an unattached debugger; native control also encountered a screen/audio capture failure. No audio clip has been recognized through the microphone in this run. Recording preparation, audio integrity tests, and mocked lifecycle tests are not an acoustic evaluation score.

The last earlier AI provider diagnostic reported exhausted credits; this run did not establish current provider billing status. Avoid relying on GPT Live for the presentation until it actually connects. The browser alternative also needs a working microphone and recognition service.

## Rehearsal

1. Open Math Audio in Chrome. Start a separate problem; keep existing work saved.
2. Voice settings → Browser speech. Keep spoken responses off. Start listening and allow microphone access. Wait until Listening appears.
3. Open /demo-voices/ on another device, or play through speakers near the microphone. Select a voice and play one clip at a time. Echo cancellation or noise suppression may reject computer playback; human speech is a separate final check.
4. Equation: 2*x + 3 = 11. Step: subtract 3 on both sides, exactly one new saved step. Solve gives x = 4.
5. Median recording should return 6. Enter data 4,5,5,6,7,8,22 before the outlier clip; expect potential outlier 22, with all original values retained.
6. Check transcript accuracy, duplicate steps, stop/start, reload persistence, and export. Record each clip's actual transcript and outcome before changing its recognitionStatus from not-tested.

If microphone startup fails, cancel and use the command field for the walkthrough. Do not present that as a successful voice demonstration.

Regenerate on macOS with `python3 scripts/prepare-demo-voices.py`. It needs installed voices and access to the system speech service.
