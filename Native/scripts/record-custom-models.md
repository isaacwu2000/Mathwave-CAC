# Record the native custom-model journey

This is a development verification workflow.

The recording must show Settings → Custom, actual recorded audio recognition,
automatic execution of the final transcript, the resulting mathematics, and
automatic spoken readback. No keyboard entry or Run tap is permitted. A passing screenshot or UI test alone does not prove model inference.
The host checks actual native model events and independently hashes bundled
weights before accepting a completed journey.

## iPhone simulator

Use an existing simulator and a Debug app containing the custom C++ runtime,
model manifest and weights. The script does not download runtimes or models.
It reuses the existing derived-data directory rather than creating another full
build cache. It never resets a simulator or deletes student work; a new test ID
selects an isolated notebook and preferences.

```bash
python3 Native/scripts/record-custom-models.py \
  --device SIMULATOR_UUID \
  --output Native/build/custom-model-recording-NEW_NAME
```

An existing `build-for-testing` output can avoid rebuilding:

```bash
python3 Native/scripts/record-custom-models.py \
  --device SIMULATOR_UUID \
  --xctestrun /absolute/path/to/Mathwave_iphonesimulator.xctestrun \
  --app /absolute/path/to/Debug-iphonesimulator/Mathwave.app \
  --output /absolute/path/to/NEW_EVIDENCE_DIRECTORY
```

The default input is the existing synthetic student-voice recording
`alg-combine-repeated-variable-1-bf897c108b96.wav`: “Put down two x plus three x
minus four equals eleven.” The independent expected saved equation is
`2 * x + 3 * x - 4 = 11`. This wording requires model interpretation rather than
the direct-command parser. The recording verifies integration with a previously
used synthetic example; it is not an unseen benchmark or student-usability study.

The script copies the real WAV into the app's Documents directory and passes its
container-relative path through Debug-only verification environment. XCTest can
reinstall an app into a new container UUID; the app resolves these paths against
its current home, and the host collects evidence from the current container. Voice input reads and converts
that audio through the same custom recognizer used for microphone samples. It
does not inject a transcript or an LLM response. The transcript is displayed inline; final recognition automatically runs the
command. Spoken responses are enabled in Settings before recording.

The generated XCTest plan injects these values only for the dedicated test:

- `MATHWAVE_VERIFICATION_AUDIO_PATH`: the actual recorded WAV.
- `MATHWAVE_VERIFICATION_EVENTS_PATH`: the native JSONL timeline.
- `MATHWAVE_VERIFICATION_READBACK_PATH`: actual synthesized readback WAV.
- `MATHWAVE_VERIFICATION_MODEL_MODE=custom` and `MATH_AUDIO_UI_TEST_ID`.

`testCustomAudioAutomaticallyRunsWithoutCommandEntry` skips in ordinary UI suites without a staged
fixture. The recording script supplies it and requires the test to pass.

## Mac window

Use a Debug Mac app containing the same custom runtime and its models:

```bash
python3 Native/scripts/record-custom-models-macos.py \
  --app /absolute/path/to/Mathwave.app \
  --output /absolute/path/inside/your/home/NEW_EVIDENCE_DIRECTORY \
  --duration 120
```

This launches a separately identified app session and records only its window.
Drive the real UI during the bounded recording: inspect Custom mode, choose
Voice input, stop the recording, and inspect the automatically generated
equation and spoken readback. Enable spoken responses in Settings first. Computer-control tools or a person may drive this part;
the script does not fabricate clicks or model results. It stops its own app
process after preserving the recording. macOS screen-recording access must
already be available; a system denial remains a failed recording. Let the timed
recording finish naturally: interrupting `screencapture` can discard its video. A
missing or empty movie fails the recording even if the inference trace passed.
Mac audio alignment uses the recorder process-launch time as an approximate
start, because the command supplies no confirmed first-frame timestamp.

## Evidence and review

Each new evidence directory retains the source WAV and hash, exact model hashes,
native event log, recognized transcript, visible generated DSL response, final
expression, actual readback WAV, and recording. Simulator runs also retain the
XCTest result bundle and exported screenshot attachments. Failures retain their
logs and partial recordings. Existing evidence directories are never overwritten.

Simulator `recordVideo` and the Mac window command record **silent video**.
`source-input.wav` / `input.wav` is recorded input, not a physical-microphone
capture. `readback.wav` is actual `AVSpeechSynthesizer.write` output; the app
separately plays its normal readback. These files are not dubbed into the video
or presented as a recording of system audio.

Extract actual video frames for inspection:

```bash
xcrun swift Native/scripts/record-custom-models-inspect.swift \
  /absolute/path/to/journey.mp4 /absolute/path/to/NEW_FRAME_DIRECTORY
```

Optional trailing numbers select frame times in seconds. The emitted metadata
records requested and actual decoded times. Use the native event times and the
host's recording-start interval to locate recognition, automatic execution, math result and
readback; timestamps provide an approximate video alignment, not audio syncing.

Inspect the full recording, relevant frames and screenshot attachments; confirm
that Custom is selected, the transcript came from the recorded audio, no command form or Run step was
used, the mathematical result is correct, and the actual spoken readback
matches it. Listen to `readback.wav`. Record each reviewed frame/path, observed
result and limitations in a separate review file. Frame extraction never marks
video or visual review complete. No physical-iPhone or live-microphone claim
follows from simulator evidence.

Quick infrastructure checks, without models or simulators:

```bash
python3 Native/scripts/record-custom-models-tests.py
xcrun swiftc -typecheck Native/scripts/record-custom-models-inspect.swift
```

## Optional video with labeled recorded audio

Preserve the silent original. After a completed trace, combine that exact source
WAV and the actual retained readback into a separate video:

```bash
xcrun swift Native/scripts/record-custom-models-mux.swift \
  /absolute/path/to/report.json /absolute/path/to/journey.mp4 \
  /absolute/path/to/source-input.wav /absolute/path/to/readback.wav \
  /absolute/path/to/NEW-recorded-fixture-and-readback.mp4
```

The mux helper uses `customRecordingStarted` and `readbackstarted` event offsets
relative to `recordingStartedObservedUnix`. It verifies the source recording hash
and readback path against the completed trace. The MP4 description and adjacent
JSON explicitly identify fixture input and separately synthesized readback;
these are not captured physical-microphone or system-audio tracks. The helper
refuses to truncate audio, overwrite evidence, or relabel an incomplete trace.

Alignment is approximate. The recognizer receives a complete audio file, so the
UI may finish processing before the overlaid input clip finishes playing. The
combined video does not establish streaming latency or physical microphone
behavior. Listen and inspect the combined export before marking its review done.

Legacy deterministic UI tests can opt into `MATHWAVE_TEST_COMMAND_ENTRY=1` in
Debug builds to seed other UI checks. Normal launches and the recorded-audio
journey do not expose that fixture. `voiceCommandAccepted` is required in the
actual model trace, connecting finalized recognized audio to automatic execution.

## Live simulator microphone demo

Use `record-live-microphone.py` to exercise the recorder rather than pass an
audio file to the app. Keep the intended host microphone and speakers selected;
the helper never changes system device defaults. Its playback is synthetic
speech, not a human speaker or physical iPhone hardware.

```sh
python3 Native/scripts/record-live-microphone.py \
  --app Native/build/xcode/Build/Products/Debug-iphonesimulator/Mathwave.app \
  --output /absolute/path/to/NEW-live-recording \
  --utterance /absolute/path/to/source-input.wav
```

In the actual app UI, enable **Spoken responses** for this isolated notebook,
then tap Voice input. Each fresh recording has its own preferences, so verify
the switch on every run. The helper retains the live microphone file and plays
the utterance through the host output. When it prints `PLAYBACK_FINISHED`, tap
Stop recording. Do not enter a command or press Run. The helper requires actual
microphone-source, custom STT/LLM, automatic execution and readback evidence.

The retained `microphone.caf` is the app's actual capture, kept with a hard link
before temporary-file cleanup. The playback file is not substituted for it.
Use the audiovisual helper with this capture:

```sh
swift Native/scripts/record-custom-models-mux.swift \
  /absolute/path/to/NEW-live-recording/report.json \
  /absolute/path/to/NEW-live-recording/journey.mp4 \
  /absolute/path/to/NEW-live-recording/microphone.caf \
  /absolute/path/to/NEW-live-recording/readback.wav \
  /absolute/path/to/NEW-live-recording/NEW-live-with-audio.mp4
```

The helper checks the capture hash and explicit microphone lane. Readback is
separately synthesized app output. Both overlays have approximate video timing;
they are not captured system audio or a latency benchmark. Inspect listening,
working, actual speaking and the fully rendered result. Record missing visual
or listening review honestly, retaining failed attempts alongside the final demo.
