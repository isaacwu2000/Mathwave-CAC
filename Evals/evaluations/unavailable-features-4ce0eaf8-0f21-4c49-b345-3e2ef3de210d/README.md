# Unavailable voice features — 23 October 2026

Starting checkout: b5a1b6a, with concurrent Native and system-prompt snapshot edits. Another UI chat published bc858dc during this task. The task owns AI prompt configuration, its focused checks, the two generated Native engine bundles, and the evidence listed here. Existing Native Swift, presentation, and older prompt snapshot edits were preserved.

## Checklist

- [x] Rename the chat to Clarify unavailable voice features.
- [x] Explain the specific missing capability, without promising success, inventing availability, silently substituting a different feature, or treating a transient error as a missing feature.
- [x] Ask one focused clarification when the intended feature cannot reasonably be inferred. Clear unsupported requests receive an explanation.
- [x] Keep Live, the delegated interpreter, graph-only generation and the Native shared engine aligned.
- [x] Focused prompt/delegation tests: 11 passed; Native LocalAgentTests: 3 passed. Typecheck, lint and module boundaries passed.
- [x] Live Luna responses captured with exact requests, schemas, tools, settings and source hashes. Final four-case replay passed; no new provider calls were made during the final replay.
- [x] Visually inspect all four final outputs in the actual application at a 1280×900 desktop viewport. Full-page screenshots include the response below the workspace. No layout or responsive change was made.
- [ ] Recorded Live acceptance remains incomplete: the isolated equation recording connected with the new instructions but produced no transcript, delegation or spoken response before its 45-second deadline. The final view showed [No audio]. This run does not establish spoken correctness.

## Reviewed cases

The synthetic state contains the current graph equation y=x² and an earlier 2x+3=11 history entry. The graph-editor submission is a transport trigger: the adapter replaces that request with the exact evaluated case text and replays its captured model answer through the real problem API. Accordingly, the screenshots' You line names the trigger edit, not the evaluated request. This is live text-model evidence plus browser replay, not live microphone evidence.

- export.png: explicitly states PDF export is unavailable; saved work unchanged. Parabola y=x² retains vertex (0,0) and passes (±2,4).
- network.png: explicitly states it cannot email graphs; the same saved graph is preserved.
- unknown-feature.png: explains that another chat's reference is unavailable and asks which feature is meant; the same saved graph is preserved.
- supported-zoom.png: graph remains y=x²; both viewport ranges change from [-10,10] to [-5,5], with vertex and sampled points visually consistent.

No progressive graph-build evaluation was run. The full-page response cards are readable and name the requested feature without a fabricated action. These are synthetic checks, not evidence of dyslexic-student usability.

The separate recorded suite has before/after screenshots in ../journey-suite-86a51b46-8230-428b-8ea8-34ab1b5a5417/trial-1/. Both were visually inspected: the welcome remained unchanged and no equation or graph was generated. Its failure is retained in the report.

Earlier browser-harness attempts are preserved locally under unavailable-features-* and are not acceptance evidence: startup timing, MathLive hydration, preview-only edits, a redundant blur and stale element waits caused failures. A discarded subtraction-on-graph regression also exposed an existing renderer error on y−3=x²−3; its screenshot and report remain preserved locally. This task does not fix that renderer path. The final regression uses the directly supported graph zoom operation.

Current reviewable prompts are also saved in docs/VOICE-FEATURE-PROMPTS-2026-10-23.json; the pre-existing concurrent edit to docs/WEB-AI-SYSTEM-PROMPTS.txt was preserved. Publication is recorded by the containing Git commit; no deployment or physical microphone acceptance is claimed.
