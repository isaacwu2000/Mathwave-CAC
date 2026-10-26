import cases from "../inputs/natural-voice-conversation/cases.json";
import { currentProblem, type ProblemLibrary } from "../../Web/src/modules/problems/index.ts";
import { parseMath, simplifyMath } from "../../Web/src/modules/math/index.ts";
import { runCommand } from "../../Web/src/modules/commands/index.ts";

export const naturalVoiceCases = cases;

/** Checks authored math and history outcomes; read-only replies must retain an actionable suggestion. */
export function assessNaturalVoiceTurn(
  before: ProblemLibrary,
  after: ProblemLibrary,
  example: (typeof cases)[number],
) {
  const previous = currentProblem(before);
  const problem = currentProblem(after);
  const last = problem.conversation?.at(-1);
  const normalized = (expression: string) => JSON.stringify(simplifyMath(parseMath(expression)));
  const mathMatches = normalized(problem.state.expression) === normalized(example.expression);
  const stepDelta = problem.steps.length - previous.steps.length;
  const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  let suggestionMatches = false;
  if (example.kind === "explanation" && last?.commands?.length) {
    try {
      let state = structuredClone(previous.state);
      for (const command of last.commands) {
        const result = runCommand(state, command);
        if (result.action) throw new Error("A suggestion must change math, not run a control.");
        state = result.state;
      }
      suggestionMatches =
        normalized(state.expression) === normalized(naturalVoiceCases[2].expression);
    } catch {
      /* Invalid suggestions fail the assessment. */
    }
  }
  const restored = problem.undoRevisions?.at(-1);
  const historyMatches =
    example.kind === "explanation"
      ? stepDelta === 0 &&
        equal(previous.state, problem.state) &&
        equal(previous.steps, problem.steps) &&
        equal(previous.undoStates, problem.undoStates) &&
        equal(previous.undoRevisions, problem.undoRevisions) &&
        equal(previous.redoRevisions, problem.redoRevisions) &&
        ["reply", "explanation"].includes(last?.status || "") &&
        suggestionMatches
      : example.kind === "correction"
        ? stepDelta === 0 &&
          last?.status === "correction" &&
          equal(previous.steps.slice(0, -1), problem.steps.slice(0, -1)) &&
          equal(restored?.state, previous.state) &&
          equal(restored?.steps, previous.steps) &&
          equal(restored?.undoStates, previous.undoStates || [])
        : stepDelta === 1;
  return {
    passed: mathMatches && historyMatches,
    mathMatches,
    historyMatches,
    stepDelta,
    expression: problem.state.expression,
    status: last?.status,
    response: last?.response,
    suggestedCommands: last?.commands,
  };
}
