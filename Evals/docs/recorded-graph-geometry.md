# Recorded graph and geometry evaluation

These are synthetic installed macOS voices, not human participants or Gemini voices. Recordings were transcribed locally with OpenAI Whisper base.en on CPU; no reference text, expected command, prompt, or API key was supplied to recognition. WAV checksums and durations are preserved. Model weights and Python dependencies remain in /tmp, outside the repository.

## Results

| Stage | Correct command or intended clarification | Clips |
| --- | ---: | ---: |
| Frozen original parser, original recordings | 24 | 51 |
| Tuned parser, exact same recordings/transcripts | 49 | 51 |
| Short recorded recovery replies added | 51 | 57 |
| Full sentence recovery replies and follow-up fixes | 55 | 63 |

The final 55 successes include three intentionally incomplete shape requests that correctly ask for a missing dimension. The remaining eight recordings produce clarification instead of a wrong action; none of the 63 evaluated clips caused an incorrect action. This is not a claim of 100% speech accuracy. Short replies and even some full sentences still fail recognition (examples: eight -> age/aid, height four -> hide for, the height is four -> the heart is full). One decoder result hallucinated repeated slashes after a correct number; the app asks again rather than extracting a guessed value from malformed input.

The original 51 audio files and transcripts remain unchanged. Their before/after results are comparable. Added recovery examples were chosen after examining failures; this entire set is now a development regression set, not an unbiased holdout. The baseline file records production implementation hashes before tuning.

## Fixes

- Hyphenated x-intercepts and ordinary articles are accepted.
- Right triangles accept two named legs or “with legs three and four.” Triangles accept an explicit three-side list.
- Shape creation accepts “with a radius of five.” Inline requests such as “find the area of a triangle with base ten and height six” save the supplied shape and return the requested calculation.
- Contextual “find its volume” works in geometry. Scoped noun corrections recognize high potter news as hypotenuse and angles see as angle C only in a geometry workspace.
- Unrecognized dimensions ask for a number without changing geometry. Replies can say “the width should be eight” or “the height is four.” Missing-dimension replies retain the original calculation, including inline area requests.
- Repeated unclear replies preserve the original question. Explicit new commands such as undo, graph, and hide graph remain available.
- The recording generator validates a temporary WAV before replacing a fixture, preventing empty audio from overwriting a valid recording.

## Evidence and limits

125 automated tests, typecheck, lint, and production build passed. Integrity checks cover all 75 recordings (12 earlier algebra clips plus 63 graph/geometry clips).

Integration tests feed the actual recognized transcripts through VoiceSession and problem commands. The recognition event source is mocked to check duplicate delivery and saved-step behavior; local Whisper recognition itself used the WAV files. Recorded clear follow-ups successfully recover both an uncertain width and an uncertain height.

Computer-controlled browser replay verified natural right-triangle entry, correction of high potter news to hypotenuse 5, preservation of width 6 after a misheard edit, and a subsequent full-sentence correction to width 8 with one additional step. Graph replay verifies hyphenated intercepts. This is transcript replay, not microphone recognition.

Actual browser speech startup was attempted in the in-app browser. It timed out before Listening, reporting “The microphone did not start. Check microphone permission, then try again.” Browser microphone recognition and GPT Live remain unverified. No claim is made about dyslexic-student usability, real human voices, noise robustness, or production browser speech accuracy.

## Reproduce

Run the commands below from `Web/`. Captured transcripts live in
`Evals/inputs/recorded-graph-geometry/`; scores go to
`Evals/evaluations/recorded-graph-geometry/`. The frozen baseline manifest is
`Evals/snapshots/recorded-graph-geometry.json`.

1. Install openai-whisper in an isolated Python environment with ffmpeg available.
2. Run `python scripts/transcribe-demo-voices.py`. The default downloads base.en to /tmp/math-audio-whisper-models. Use --model-cache to choose another cache. No cloud recognition call is made.
3. Run `pnpm exec tsx scripts/evaluate-recorded-voices.ts <transcripts.json> <report.json>`.
4. Use --resume with the same output file to reuse exact checksum-matching transcripts. Use `python scripts/prepare-demo-voices.py --suite graph-geometry --case <id>` to generate selected clips without replacing other recordings.
5. Open /demo-voices/, select Graphs and geometry, and use the recordings for browser/device testing. Synthetic recordings do not replace testing with dyslexic students.

Audio-track recognition is browser dependent; reference: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start. No browser audio-track recognition is claimed by this local evaluation.
