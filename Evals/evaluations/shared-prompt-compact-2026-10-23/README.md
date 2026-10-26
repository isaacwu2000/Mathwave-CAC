# Shared prompt compression

Checklist completed:
- [x] Condense policy and catalogue prose without changing the DSL, response schema or any of the 105 tool definitions' non-description fields.
- [x] Use one instruction builder for web, native local inference and evaluations. Preserve request-selected specialist references and preview rules.
- [x] Capture baseline/current prompts, contracts, exact provider requests/results and evaluation-time source hashes.
- [x] Run paired live text checks: baseline 7/7, compact 7/7; 14 provider calls. Six families, including two-turn graph editing and ordered algebra.
- [x] Inspect all 28 actual-app desktop/mobile screenshots. See visual-review.json for each case, viewport and observation.
- [x] Independent specification and standards reviews: no blocking findings; function contract comment improved.
- [x] Full verification: 619 tests passed, 5 skipped; boundaries, TypeScript, lint and production build passed. Native tests: 31 passed.
- [x] Regenerate docs/WEB-AI-SYSTEM-PROMPTS.txt from current source. Preexisting local snapshot preserved outside the repository before regeneration.

Base prompt: 14,224 → 12,458 characters (12.4% reduction). Characters are not tokens. This pilot establishes retained behavior on these cases, not full benchmark equivalence or a latency improvement. Approximate standard-rate API cost excluding cache discounts: $0.0055; not an invoice.

The provider results run through the real shared engine. Visual evidence replays the resulting saved work in the actual web app at 1280×900 and 390×844. Algebra history includes its intermediate subtraction; graph turn 1 is the intermediate state before turn 2 shifts the parabola. This does not test microphone input, streamed drawing transport, installed iPhone behavior or real student usability. Voice companion instructions were not changed. No LLM training or weight download occurred.

`source-manifest.json` identifies the exact sources used for the run. Subsequent evaluator edits removed one unused import and applied formatting; evaluation-time copies remain frozen. `report.json` records both evaluated and final source hashes. The seed setup initially aborted before any provider call because it lacked the runner's program wrapper; that setup was repaired before this recorded run. No failed model outcome was discarded.
