import { runCommand, validateInterpretation } from "../../Web/src/modules/commands/index.ts";
import { blankWorkspace } from "../../Web/src/modules/problems/index.ts";

export const backendCases = [
  {
    id: "equation",
    text: "Please set up the equation: twice x plus three equals eleven.",
    status: "command",
    expression: "2 * x + 3 = 11",
  },
  {
    id: "both-sides",
    text: "Take three away from each side of my equation.",
    status: "command",
    expression: "2 * x + 3 - 3 = 11 - 3",
  },
  {
    id: "two-steps",
    text: "Subtract three from both sides, then divide both sides by two. Keep both steps.",
    status: "command",
    expression: "(2 * x + 3 - 3) / 2 = (11 - 3) / 2",
  },
  {
    id: "clarification",
    text: "Make it better.",
    status: "clarification",
    expression: "2 * x + 3 = 11",
  },
  {
    id: "explanation",
    text: "Explain why subtracting three from both sides keeps this equation balanced without changing my work.",
    status: "explanation",
    expression: "2 * x + 3 = 11",
  },
] as const;

export const backendState = () => ({ ...blankWorkspace(), expression: "2 * x + 3 = 11" });

/** Executes validated proposals on fresh synthetic state and checks authored answers, never saved work. */
export function assessBackendAnswer(value: unknown, example: (typeof backendCases)[number]) {
  const initial = backendState();
  const plan = validateInterpretation(value, initial, undefined, example.text);
  let state = initial;
  const intermediateExpressions: string[] = [];
  if (plan.status === "command")
    for (const command of plan.commands?.length ? plan.commands : [plan.command]) {
      const result = runCommand(state, command);
      if (result.action) throw new Error("Unexpected control action.");
      state = result.state;
      intermediateExpressions.push(state.expression);
    }
  return {
    passed:
      plan.status === example.status &&
      state.expression === example.expression &&
      (example.id !== "two-steps" ||
        (intermediateExpressions.length === 2 &&
          intermediateExpressions[0] === "2 * x + 3 - 3 = 11 - 3")),
    status: plan.status,
    expression: state.expression,
    intermediateExpressions,
  };
}
