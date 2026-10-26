# Graph studio and geometry checks — 2026-10-10

The native grapher now supports eight expressions, colored curves, editing and
removal, selecting a curve to trace, two-axis viewport commands, keyboard pan
and zoom, and sampled intersections of the first two curves. Saved graph
expressions survive reload and export. Equation parts remain available in a
collapsed disclosure. The expression list and viewport controls take inspiration
from the [Desmos getting-started guide](https://help.desmos.com/hc/en-us/articles/4406040715149-Getting-Started-Desmos-Graphing-Calculator).

Geometry adds right circular cones (volume, surface area, slant height),
parallelograms (area from perpendicular height), and trapezoids (area from
parallel bases and perpendicular height). Diagrams are labeled schematic;
missing side lengths are never inferred for perimeter calculations.

## Verification

- 150 unit and workflow tests; type checking, lint and production build passed.
- New `test-v6.jsonl`: 16/16 local parser checks, with different numbers and
  polite phrases, missing dimensions, nonexistent curves, invalid viewports,
  and unavailable perimeter calculations. This tests text interpretation, not
  model quality, real speech, or usability with dyslexic students.
- Browser UI: created a separate Problem 9, added `y=5` alongside `y=x^2-4`,
  read graph 2 at x=0 as y=5, and obtained intersections (-3,5) and (3,5).
  Edited graph 2 to y=4, panned with ArrowRight, zoomed, and reset the view.
- Browser testing found a routing collision: removing graph 2 canceled a
  matching saved edit step. Fixed and regressed through the complete history
  dispatcher. Browser retest removed the curve, preserved earlier work, and
  Undo restored it. Reload preserved both restored curves.
- Problem 10: cone radius 3 height 4 returned slant height 5; trapezoid parallel
  bases 8 and 4 with height 3 returned area 18 and its formula.
- Screenshot: `/tmp/math-audio-desmos-style-graph.png`.

## Limits

This is a Desmos-style function grapher, not full Desmos parity. General implicit
relations, inequalities, parameter sliders, and arbitrary geometric constructions
are not added here. Non-y equations retain the existing residual plotting behavior.
Intersections and intercepts are approximate samples and can miss tangent roots,
features between samples, or singularities. Pointer panning is implemented but
was not independently exercised through native computer control in this pass;
keyboard panning was verified. Fresh recorded speech was blocked by stalled
Chrome controls; the reported 16/25 speech result is a parser replay of existing
transcripts, not a new speech-service run. The embedded browser still denies
microphone capture; use desktop Chrome for live input.

## Further tuning — 2026-10-10

- Linear and quadratic graph roots now use polynomial coefficients rather than
  relying on sample crossings. Tangent roots between samples are detected.
  Matching literal offsets are canceled before coefficient arithmetic so tangent
  intersections do not become two nearby roots through rounding.
- Other functions still use sampling and bisection, with a shrinking-residual
  check that rejects poles and avoids scale-dependent early termination.
  General tangencies and fine features can still be missed.
- Fit curves adjusts the y viewport to include all finite sampled curve values
  in the current x range, with padding. It does not establish global extrema.
- Intercepts and sonification can target numbered curves. The UI uses the
  selected curve for both, without altering the saved primary equation.
- Geometry dimensions can be edited together. Browser check: a 3-4-5 triangle
  became a 100-100-100 triangle in one edit; area was 4330.13. An invalid 1-2-9
  edit left the valid shape untouched, and Undo restored 3-4-5.
- The first invalid editor submission attempted AI interpretation and reported
  a credits/limits error. Direct graph and geometry controls now bypass AI
  fallback and show local validation errors. Retesting showed the triangle
  inequality error immediately, preserving the two saved steps.
- Browser check: tangent intersection (0.371,50), fit of originally out-of-view
  curves, and graph 2's intercept at x=7. Audio dispatch identified graph 2;
  the selected expression payload is tested, but audible hardware output and
  new human speech recognition were not independently verified in this pass.
- 156 tests passed, plus type checking, lint and production build. Fresh
  `test-v7.jsonl` text checks passed 10/10, including separate tangent numbers,
  scaled roots, selected-curve commands and invalid targets. These are local
  parser checks, not live AI evaluations or fresh speech-service results.
- Screenshots: `/tmp/math-audio-graph-tuning.png` and
  `/tmp/math-audio-geometry-editor.png`.

## Atomic spoken edits and curve pairs (2026-10-11)

- Simultaneous labeled geometry edits apply as one validated change. Example: `set a to 100 and b to 100 and c to 100` can change a 3/4/5 triangle without rejecting intermediate sides. Partial edits preserve other dimensions. Duplicate dimensions ask for clarification; invalid final triangles and unknown dimensions leave work untouched. Undo and targeted cancellation recover the original shape.
- Intersections accept explicit pairs (`find intersections of graphs 1 and 3`). The graph editor compares the selected curve with another numbered curve and marks the computed points. Changing a curve or the comparison invalidates the old markers. The response includes coordinates and retains the sampled-analysis limitation.
- Browser verification in isolated Problems 13/14: triangle changed to 100/100/100 in one saved step; one Undo restored 3/4/5. Curves x², 8, x+2: pair 1/3 marked (-1,1) and (2,4). Editing curve 3 cleared those markers; Undo plus another intersection check restored them. Intersection queries did not add work steps. Screenshot: `/tmp/math-audio-curve-intersections.png`.
- 159 unit/integration tests pass; lint, type checking, and production build pass. Fresh local text evaluation `test-v8`: 10/10. These are local command and UI checks, not fresh audio recognition or live model evaluations. No API requests were needed for the successful commands.

## Key points and spoken curve references (2026-10-11)

- Key-point queries report x-intercepts in the current x range, the y-intercept where defined, and a minimum/maximum vertex only for expressions proved quadratic by coefficient extraction. Analytic y-intercepts and vertices can be outside the current x range. General functions do not acquire fabricated vertices. Markers outside the visible viewport are omitted.
- The graph's Key points control marks these points and offers a collapsed list of coordinate-reading buttons. The exact vertex can be read even when it lies between trace-slider samples. Queries do not add work steps.
- Number words zero through ten normalize only in explicit curve-reference positions. `read key points of graph two`, `evaluate graph two at x three`, `edit graph two to y=x+one`, and `cancel graph two` work locally. Operands remain untouched; numeric homophones such as "for" are not guessed. Spoken curve removal bypasses fuzzy work-step cancellation.
- Browser check in isolated Problem 15: y=(x-0.371)²−2 showed four points; reading its minimum vertex reported x=0.371, y=−2 while saved work stayed at one step. Added y=x+2; `read key points of graph two` reported (-2,0) and (0,2). `cancel graph two` removed just that curve; one Undo restored it. Screenshot: `/tmp/math-audio-key-points.png`.
- 162 unit/integration tests, lint, type checking, and production build pass. Fresh local text evaluation test-v9: 10/10. Browser tests submitted spoken-style text, not audio. No new microphone, speech-recognition, or live model evaluation was performed.

## Contextual cancellation and undo wording (2026-10-11)

- Live Chrome Problem 8 was inspected through native accessibility: 5x+3−1=y+1−1, two saved steps, and the exact failed phrase `cancel out the addition in the current step`. The old fuzzy-history route intercepted all `cancel ...` phrases and asked for a step number before mathematical interpretation.
- `cancel out` with named addition/subtraction/constants/like terms now routes to local additive simplification. The original equation becomes 5x+2=y as a new reversible step. Numeric constants and linear like terms combine independently on each equation side; undefined fractions and multiplicative factors are not canceled. Replay stores the canonical `simplify` command.
- Bare `undo`, `cancel`, and `cancel out` undo the latest change. Explicit numbered `undo step N` removes that saved operation with later-step recalculation, preserving the existing recovery behavior. Saved-work buttons say `Undo this step`.
- Browser verification in isolated Problem 16: exact reported phrase simplified without a question; Undo restored the unsimplified equation; plain cancel and cancel out each undid one change; redo two restored the simplification. Earlier steps remained. Chrome interaction could not reliably submit the retry, so original Problem 8 was not edited. Screenshot: `/tmp/math-audio-contextual-cancel.png`.
- 170 unit/integration tests, lint, type checking and production build pass. Browser commands were submitted as text, not a new microphone or ASR test. No AI API call was needed.

### Natural algebra phrasing

Added local cleanup, collect/combine like terms, reduce fractions/equations, and common numeric factor cancellation phrases. Added reversible operations expressed as take-away, equation-wide division/multiplication, operand-first phrasing, and double/triple/halve both sides. Missing operands still request clarification; zero and variable multipliers/divisors retain existing safeguards. Bare subtraction still asks which operation rather than guessing a side.

Fresh text-only test-v10: 17/17 passed. This small authored set checks phrase variants, result equivalence, and missing/unsafe operands; it does not establish general natural-language or ASR accuracy. Full suite: 176 passed; lint, typecheck, and production build passed.

Browser verified in isolated Problem 18: write `(6*x)/3+4-1=y+2-2`; “clean up my work” → `2*x+3=y`; “take three away from each side”; “collect the like terms” → `2*x=y-3`; “divide this equation by two”; unclear “take that away from both sides” preserved equation/history and requested exact operand; “reduce this equation” recovered to `x=(y-3)/2`. Screenshot: `/tmp/math-audio-natural-commands.png`. No live microphone, new recorded-voice, or live provider evaluation in this pass.

### AI-first command routing (October 12)

Typed and browser-transcribed math, history and exploration requests now use the backend before local execution, including already supported commands and clarification replies. Validated GPT Live delegation results and deterministic UI controls execute directly without a second model request. Immediate stop controls and problem management stay local. API failures attempt the original deterministic command and expose the reason in Voice settings, with a 60-second cooldown and Retry AI commands control. Stale requests cannot apply after problem changes. Privacy copy reflects AI-first requests.

Actual provider checks: command endpoint successfully returned an interpretation for `write x=2`; authenticated model lookup returned HTTP 200 for `gpt-live-1`. The backend model remains `gpt-6-luna`. These checks establish current command API/model access, not a completed GPT Live voice session.

Browser Problem 19: simple equation dictation went through AI and saved `2*x+3=11`; contextual “get rid of the plus three so I can get x by itself” produced a validated subtract/divide plan; “finish simplifying so x is alone” produced simplify and saved `x=4`. GPT Live selected; microphone startup correctly reported denied permission in the in-app browser. No live spoken session completed. Added routing policy regression tests; 178 tests, lint, typecheck, and production build pass.

### Live AI tuning: focused cancellation and ambiguous edits

Fixed multi-command evaluation grading to validate sequential plans and compare their final state rather than executing an empty command. In the initial five-case tuning run, three cases were scored: 2 passed; cancellation failed by leaving arithmetic unsimplified. One malformed geometry fixture caused HTTP 422 and the old runner skipped the last case. The archived initial input hash matches the archived report; do not treat this as five scored cases. Corrected the fixture and adjusted the runner so context/interpretation rejection counts as failure and does not skip later cases; genuine provider outages still stop calls.

The tuned prompt distinguishes simplifying already written inverse operations from applying an inverse and simplifying. Focused cancellation must stop before additional solving. Corrected train-v5 live endpoint: 5/5. Fresh test-v11 live endpoint: 5/6; its failure guessed a coefficient for “Make that seven” with the whole equation selected. After observing that failure, added request-aware validation for vague replacement references, which returns clarification without changing work. Explicitly named or selected targets remain usable. Test-v11 is now development evidence and should not be reused as a fresh holdout. Fresh test-v12 live endpoint after the fix: 4/4. These are small authored text sets, not general accuracy or audio-quality estimates.

Browser Problem 20: `3*x+5=17`; “cancel out the plus five but leave the rest for me” → subtract 5 and simplify → `3*x=12`. Undo restored the original equation and Redo restored the cancellation. “Make that nine” asked which part and preserved equation/history. Screenshot `/tmp/math-audio-focused-cancellation.png`. Updated request display while AI interprets so clarifications do not show stale prior commands. 182 tests passed, lint/typecheck and production build passed; no fresh microphone/ASR run.
