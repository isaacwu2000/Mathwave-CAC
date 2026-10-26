# History and targeted cancellation verification · October 10, 2026

## Behavior

- Undo and redo preserve up to 50 changes per problem, including after reload and backup/import. Old version 2 problems gain redo without losing their existing undo history.
- Returning to an earlier step and cancelling a step are reversible changes. Undo restores the complete previous work; redo reapplies the change. A new edit after undo begins a new branch and clears redo.
- Cancelling a middle step replays subsequent saved commands from the preceding state. If a dependent replacement or other later command cannot execute, the complete original problem remains unchanged and the app asks the student to return before that step.
- Named targets match actual saved commands. Multiple matching steps ask for a step number. Explicit step numbers can reach the entire saved sequence; natural target matching and AI context use the most recent 50 numbered steps.
- Text and voice share the same interpreter instructions. The AI can request validated history actions, expose existing panels, and write diagrams in addition to math commands. It receives active-problem numbered commands and available undo/redo counts. It cannot delete assignments, run network commands, or clear the problem.

## Verification

78 automated tests pass, plus TypeScript, lint, and production build. History tests cover replayed algebra, dependent edits, ambiguity, bounds, immutable originals, isolation between problems, drafts, legacy storage, recovery snapshots, malformed imports, model output validation, and fresh conversational phrasing.

Computer-controlled browser checks used a separate Problem 3 and preserved Problems 1 and 2:

1. Entered 2*x+3=11, subtracted three, then divided by two: three saved steps.
2. Submitted “cancel the subtraction”: two saved steps, with division recalculated as (2*x+3)/2=11/2.
3. Undo restored the original sequence; redo restored the cancellation.
4. “Return here” restored the first saved step.
5. “Take me back to just before I divided” restored the earlier equation locally.
6. Reload retained the correct problem and equation; redo remained enabled in saved steps.

## Limits

The browser's actual AI interpretation request returned “OpenAI could not accept the request. Check API credits or limits; your work is saved.” No successful model-quality score is claimed for the expanded prompt. The subsequent conversational history check succeeded through the local parser without a provider call.

These checks used the command field and buttons. They do not establish microphone recognition, real human voice performance, or screen-reader usability. Recorded samples and voice gates remain documented separately in demo-readiness.md.
