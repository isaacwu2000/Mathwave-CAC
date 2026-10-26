# Structured math input verification

Checked locally on October 14, 2026, against `02e17b1` plus this task's changes.
The earlier concurrent fraction/readback changes remain intact.

Web now shares one MathLive editor across commands, graph expressions, numeric
graph controls and geometry dimensions. Student-facing wording uses problem
history. The internal saved-work module is `problems`; `ProblemLibrary` holds
assignments and their problems. Historical evaluation inputs remain unchanged.

## Automated checks

`bun run verify` passes module boundaries, 328 tests, TypeScript, lint and the
production build. Two live database integration tests remain skipped in the
default lane. Agent documentation validation checks 137 links. The Impeccable
detector reports no findings on changed UI targets.

Regression coverage includes command-word boundaries and quoted titles,
fractions/powers, unfinished exponents, constant evaluation and numeric limits,
unsupported structured notation recovery, invalid graph preview retention and
legacy saved-program execution.

## Browser evidence

Chromium exercised the actual local Vinext app at desktop 1280 × 1000 and touch
390 × 844. The named `math-editor-qa` development instance owns synthetic cloud
problem data. Final assertions replace graph interpretation with deterministic
preview records and bypass paid command interpretation, while saving through
the real application and its isolated problem store. Early smoke checks used
configured interpretation; they do not establish provider accuracy or latency.

Verified journeys and states:

- Type a mixed command; retain upright command words and typeset math.
- Display editable fractions; preview graph changes without saving a step.
- Keep the last valid curve during incomplete or unsupported input; reject Save.
- Restore the saved expression with Escape and preserve workspace Escape handling.
- Save one history step, undo it, discard stale drafts and reload saved work.
- Keep the trace marker and readout on the previewed curve.
- Evaluate `1/2` and `sqrt(2)` as coordinates; reject out-of-range values.
- Evaluate a fractional geometry dimension; reject non-real dimensions.
- Open the math keyboard explicitly on touch; retain the closed state on focus.
- Keep mobile content within the viewport.
- Recover an indexed-root draft without changing its notation.
- Fail the MathLive module request; keep an editable fallback with associated
  validation errors and invalid state.
- Read identical saved data through the current and legacy API routes.

Local screenshots and executable smoke-check records are retained under
`outputs/math-input-2026-10-14/` (ignored artifacts). These are synthetic local
checks, not production acceptance, microphone evidence or real-student usability
research. Native's editor is unchanged.

## Review

Standards review identified legacy parser compatibility and fallback error
associations; both were corrected and independently reinspected. Its duplicated
draft-state type observation was also resolved.

Spec review identified legacy program replay and lossy unsupported-notation
recovery; both were corrected with regression tests and independently
reinspected. Neither review found a residual issue in those fixes.

Existing storage keys, SQL columns, backup import fields, the legacy API route,
old environment variable names and stored `notebook.*` programs remain accepted.
The editor's broad notation does not expand the engine's mathematical domains.
