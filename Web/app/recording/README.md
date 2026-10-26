# Recording a voice-over take

Run `pnpm run dev` from the repository root, then open `/recording` on the printed
local URL. This route returns not-found outside development.

Choose **Start take** to create a fresh problem in the development server's
isolated synthetic library. The controls hide while five scripted captions
appear in the real AudioPanel. Each completed caption goes through the normal
interpreted voice-command queue. The existing workspace, saved steps, progress,
Pico, mathematics, and graph renderer display the actual results.

The recording variant wraps long captions and hides the graph expression editor
to keep the curve visible. It uses silent input instead of the physical microphone and retains real Live voice replies.
The take waits for observed speaker playback before advancing; verified-completion
confetti follows the final spoken confirmation. **Download app replies** saves
the actual output audio, with its start time on the link for video synchronization.
Press **Escape** to stop and restore the controls. Start again for a fresh take.

The measured durations are command-request-to-result times. They exclude speech
recognition and end-of-speech detection. Caption cadence and narration holds are
authored; backend waits are awaited without acceleration. A clarification or
failure stops the take and shows the app's real message.

The current take graphs x²+5x+2, edits 5x to 3x, zooms, dictates the factored
equation (x+2)(x+1)=0, and dictates both roots. The student chooses each step;
the take never asks the app to factor or solve. The coefficient change is an edit, not an equivalent algebra step.
The ordinary verified-completion mechanism supplies confetti after saved roots.
A clear unique term replacement uses the existing deterministic math engine,
without a model request. Its recording hold is 300 ms; processing is still real.
Captions use 240 ms per word. Rendering motion is opt-in here and respects
reduced motion: first-frame reveal, safe polynomial/sine curve interpolation,
and a continuous camera zoom. The saved expressions and calculations are unchanged.

The recording reply cues are short acknowledgments (Got it, Yup, Okay), with
“Looks like you solved it!” reserved for a verified complete answer. These cues
and the shorter playback tail belong to recording mode. Ordinary voice keeps
its existing reply policy and 350 ms playback tail. The final burst waits for
the complete spoken confirmation and observed playback end, with no added hold.

A short, quiet rising chime starts with the verified confetti. The recording
mix captures the same chime played by the app; ordinary celebrations are unchanged.

## Guided microphone take

Choose **Start guided take** to follow the same five preset actions at your own
pace. Allow microphone access when asked. Read the current cue, then pause for
about two seconds. The caption is the real Live transcript, including any words
you add; the action is the preset cue rather than an interpretation of those
words. No generated transcript is substituted. The microphone stays open while
you read or pause before starting; after actual speech and settled transcription,
it closes before the preset action and app reply. Cue text advances only after
the reply finishes. **Hide cue** removes the helper overlay; Escape stops the take.

**Download take audio** includes your captured microphone input, the actual app
voice, and the victory chime. The automatic **Start take** remains available
without microphone input. This guided mode is limited to the development
recording route; ordinary voice interaction is unchanged.
