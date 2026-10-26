# Minimal clarification choices · October 10, 2026

Answer buttons appear only for an active clarification on the unchanged workspace. Clear requests execute immediately with no confirmation step. Up to four validated suggestions cover ambiguous coefficients, sample/population statistics, repeated saved steps, missing both-sides intent, and missing part targets. Repeated coefficient labels identify their part numbers. Unknown or incomplete operands do not generate misleading choices.

Typing or speaking an answer still works. “Keep editing” dismisses the question, preserves the draft and equation, and focuses the command field. “Never mind” or “cancel clarification” can dismiss a pending question through the command path. Provider-backed voice results carry the original transcript for the same UI flow; real microphone/provider behavior is not newly verified.

104 automated tests pass. Browser checks confirmed that an ambiguous coefficient request added no step, clicking y edited only that coefficient and removed the choices, a clear named-variable request showed no choices, and dismissing a question preserved all eight saved steps and the unsubmitted draft. Typecheck, lint, and production build pass.

The browser check also exposed a response bug in ordered plans: an intermediate selection's old value could hide the final edit response. That fix has its own regression test and commit.

Graphing and geometry changes remain for the next update.
