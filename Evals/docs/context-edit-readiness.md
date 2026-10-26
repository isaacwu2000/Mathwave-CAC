# Contextual math editing verification · October 10, 2026

The interpreter receives bounded, server-derived math context: numbered parts, the selected part, and explicit numeric coefficient locations. It can propose replacing a single part rather than relying on an expression value that may occur several times. The local path supports unique coefficients, a named variable, a selected term/variable, selected occurrence edits, and explicit part numbers.

Unqualified “that” at the default whole-equation selection still asks which part. Multiple coefficients require a variable or selected term. Short clarification answers such as “y” preserve the original requested edit instead of writing a new equation. A numbered part answer can complete a selected-part clarification.

Saved steps retain readable requests alongside executable structural targets. Targets include the expected old sub-expression; cancelling earlier work stops safely if replay encounters a changed target. Display labels are validated during import, including recovery snapshots. Named cancellation uses readable requests.

## Evidence

98 tests pass, including repeated numeric values, negative coefficients, variable powers, multiple variables, selected occurrences, invalid part bounds, equation replacement restrictions, guarded replay, reload/undo, plans, follow-up replies, readable export, and malformed import labels. Typecheck, lint, and production build pass.

Browser verification in separate Problem 5 preserved earlier problems:

- “Change the coefficient to five” transformed 2*x+2=2 into 5*x+2=2; both other occurrences of 2 remained.
- After selecting part seven, “change that number to nine” changed only the right-hand value.
- For 2*x+3*y=9, a coefficient request asked which variable and added no step. Replying “y” produced 2*x+5*y=9, with exactly one new step.

These browser checks used the local command path. No new live model-quality score or microphone recognition result is claimed. The last provider-backed request in the preceding update returned the credits/limits error.
