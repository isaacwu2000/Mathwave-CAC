# Short, natural drawing confirmations

Task starting revision: 4defdb4. The user requested natural, varied short replies (for example “Made the triangle!”) and separation between adjacent spoken captions. Concurrent Native changes were preserved; no Native generated bundle is published here.

## Completed checklist

- [x] Remove the exact “OK.” then “Done!” instruction and the workspace receipt override that replaced successful drawing results with “Done!”. Keep the rendered-and-saved DrawingReceipt wait. Live receives the actual confirmed result and summarizes the action in a few words; drawing examples are stylistic examples, not fixed responses. Read, explain, solve, clarification and failure messages keep their specific policies.
- [x] Separate captions at a confirmed-result boundary or a sentence pause of at least 400ms when the provider omits a separator. Preserve streamed word fragments and decimal numbers. Original provider fragments remain in the evaluation trace; this is display formatting, not fabricated speech.
- [x] Demonstrate regression failures first through OpenAIVoiceSession: missing space after a timed sentence and after a result receipt with absent timestamps. Both pass after the fix; split “triangle” and decimal 3.14 remain intact.
- [x] Update evaluation caption fidelity to permit only sentence-separator whitespace differences; new tests still reject split tokens and changed words. The raw expected provider text is retained.
- [x] Refresh docs/WEB-AI-SYSTEM-PROMPTS.txt from active sources and make the generator's heading describe a current source snapshot rather than retaining its old date. This also refreshes already-implemented construction-label guidance that the previous snapshot lacked; the label behavior was not changed by this task.
- [x] Run full verification: 139 test files passed, 3 skipped; 668 tests passed, 5 skipped; TypeScript, lint, module boundaries and production build passed. After formatting, repeat the 57 focused tests plus TypeScript, lint and boundaries.
- [x] Run the bounded live campaign below: 2/2 cases passed. Confirm session.started instructions contain the new action-specific policy and no exact-script requirement.
- [x] Visually inspect both cases' before and after screenshots at 1280×900. Right triangle: legs 3 and 4, hypotenuse 5, right angle at A, natural caption. Rectangle: width 6, height 4, existing diagonal 7.2111, natural caption. Both match the stored math; before screens show a clean synthetic problem.

## Live evidence

Command: `RUN_LIVE_CHECK=true bun Evals/scripts/evaluate-journey.ts suite --cases right-triangle,rectangle --repetitions 1 --seed concise-drawings-2026-10-24`.

Report: [journey-suite-2191c0d6-59ce-49c5-8ee4-3c5fc21025dd.json](../journey-suite-2191c0d6-59ce-49c5-8ee4-3c5fc21025dd.json).

Models: gpt-live-1 and gpt-6-luna, existing provider-default reasoning. Recorded fixtures go through the app's ordinary audio, backend, saved-work and rendering paths in an isolated local app/problem. Provider transcript events, playback-meter observations, input fixture checksums, source fingerprint and correctness checks are in the report.

Observed captions:

- Right triangle: “Okay, making that triangle. Triangle's ready.”
- Rectangle: “Okay. Made the rectangle!”

Confirmed completion phrases are short and action-specific. Both caption fidelity and playback-indicator checks passed. No human listening/prosody, physical microphone, real-student usability or production deployment acceptance is claimed. These are single-shape cases, not compound progressive graph builds; the unchanged render-receipt gate is also covered by lifecycle tests.

Reviewed screenshots:

- [Triangle before](trial-1/right-triangle-before.png), [triangle after](trial-1/right-triangle-after.png).
- [Rectangle before](trial-1/rectangle-before.png), [rectangle after](trial-1/rectangle-after.png).

`prompts.json` records generated instruction/tool views. `tested-sources/` preserves the exact relevant implementation sources and individual hashes used for the live run, before subsequent formatting-only changes. The canonical prompt snapshot is also committed.

The [official OpenAI session documentation](https://developers.openai.com/api/docs/guides/live-conversations) describes timestamped transcript fragments without transcript-done/item boundaries and leaves grouping for display to the application. The implementation uses result boundaries and session-timeline pauses, not packet-arrival delays.
