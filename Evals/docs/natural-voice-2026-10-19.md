# Natural recorded conversation — October 19, 2026

## Checklist

- [x] Author and record a four-turn conversation before its first provider run.
- [x] Replay actual recordings through GPT Live, backend interpretation, Neon,
  rendered work and independently metered spoken replies.
- [x] Preserve the initial failing report and fix its actionable-memory gap.
- [x] Reject wrong suggestions, altered earlier work and repeated corrections
  through deterministic negative tests.
- [x] Pass repository tests, type checks, lint, architecture checks and build.
- [x] Finish the post-fix recorded replay and document its result.
- [x] Commit and push the verified changes.

## Failure and change

The [first run](../evaluations/journey-conversation-54a43a3c-9737-43ae-a5ab-ecc0adf8e13e.json)
accepted natural equation dictation. For “How would you get rid of that added
three? Don't change it yet,” it correctly explained subtracting three and kept
the equation unchanged, but retained no executable suggestion. The dependent
acceptance and correction were explicitly unattempted.

The interpreter instructions now require an applicable proposed next action to
be retained as an inert program alongside its explanation. Acceptance can apply
the saved suggestion. Conceptual answers without a proposed action still need
no program. This changes the general instruction, without adding a matcher for
the fixture's wording.

The new conversation lane checks mathematical outcomes and saved history. A
read-only explanation must preserve state, steps and undo/redo history; its
suggestion must produce the independently expected next equation. Corrections
must replace the last operation, retain earlier steps and provide an undo
snapshot of the replaced work. Audio or display timeouts retain diagnostic
evidence and remain failures.

## Post-fix result

The [post-fix run](../evaluations/journey-conversation-4e0052ef-7985-4057-a2f8-cda6ee4416a1.json)
passed all four turns, with no dependent cases unattempted:

| Turn | Saved result |
| --- | --- |
| Natural equation dictation | `8*x+3=19` |
| Explain removing three; do not change it yet | Same work, with a retained subtraction program |
| “Yeah, let's do that.” | `8*x=16` |
| “Actually, take away five instead of three.” | `8*x-2=14`, replacing the previous operation |

Each turn passed the persisted-state, history and spoken/display parity checks.
End-to-end time was 8.29–14.30 seconds, including recording playback and waiting
for the spoken reply to finish. Backend model stages took 2.06–3.82 seconds.
These four observations are not a latency benchmark or a causal speed comparison.
The report records the dirty source hash used for the run; afterward, only the
evaluation's failure-diagnostics guard changed, alongside documentation.

Repository verification passed 456 tests with two skipped, type checking,
lint, architecture checks and the production build. The grader regression and
type/lint checks were rerun after the diagnostics hardening.

The four synthetic Daniel recordings are frozen with SHA-256 hashes. They were
new when authored; after this tuning they are regression cases, not an unseen
holdout. This lane does not establish physical microphone accuracy, long-memory
coverage, broad mathematical correctness or usability for dyslexic students.
