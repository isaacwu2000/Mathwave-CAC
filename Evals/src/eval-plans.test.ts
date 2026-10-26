import { test } from "vitest";
import assert from "node:assert/strict";
import { grade, type Case } from "./grade.ts";
import { validateInterpretation } from "../../Web/src/modules/commands/index.ts";
const item: Case = {
  id: "plan",
  family: "algebra",
  category: "algebra",
  utterance: "isolate x",
  state: {
    mode: "equation",
    expression: "2*x+3=11",
    data: [2, 4],
    selection: 0,
    graph: false,
  },
  expected: { status: "command", command: "write x=4" },
};
test("evals grade validated multi-step plans by their final result", () => {
  const original = JSON.stringify(item.state);
  assert.equal(
    grade(item, {
      status: "command",
      command: "",
      message: "",
      commands: ["subtract 3 from both sides", "simplify", "divide both sides by 2", "simplify"],
    }).pass,
    true,
  );
  assert.equal(JSON.stringify(item.state), original);
});
test("evals reject incomplete and unsafe AI plans", () => {
  for (const commands of [
    ["subtract 3 from both sides"],
    ["divide both sides by 0"],
    ["undo", "write x=4"],
  ])
    assert.equal(
      grade(item, { status: "command", command: "", message: "", commands }).pass,
      false,
    );
});
test("focused cancellation is graded separately from solving the whole equation", () => {
  const cancellation = {
    ...item,
    utterance: "cancel out the plus three but leave the rest",
    expected: { status: "command" as const, command: "write 2*x=8" },
  };
  assert.equal(
    grade(cancellation, {
      status: "command",
      command: "",
      message: "",
      commands: ["subtract 3 from both sides", "simplify"],
    }).pass,
    true,
  );
  assert.equal(
    grade(cancellation, {
      status: "command",
      command: "write x=4",
      message: "",
    }).pass,
    false,
  );
});
test("vague edits can carry a validated explicit target and a stated assumption", () => {
  const response = validateInterpretation(
    {
      status: "command",
      command: "replace part 4 with 7",
      message: "I changed the coefficient of x to seven.",
    },
    item.state,
    undefined,
    "make that seven",
  );
  assert.equal(response.status, "command");
  assert.equal(response.command, "replace part 4 with 7");
});

test("eval grading accepts both contextual and inferred explicit targets", () => {
  const followup: Case = {
    ...item,
    utterance: "the coefficient of x",
    clarification: {
      request: "make that seven",
      question: "Which number should change?",
    },
    expected: { status: "command", command: "write 7*x+3=11" },
  };
  const prediction = {
    status: "command" as const,
    command: "replace part 4 with 7",
    message: "",
  };
  assert.equal(grade(followup, prediction).pass, true);
  assert.equal(
    grade({ ...followup, clarification: undefined, utterance: "make that seven" }, prediction).pass,
    true,
  );
});

test("clear equation shorthand needs no clarification", () => {
  for (const [request, command] of [
    ["take away three", "subtract 3 from both sides"],
    ["subtract 3", "subtract 3 from both sides"],
    ["add negative two", "add negative two to both sides"],
  ])
    assert.equal(
      validateInterpretation(
        { status: "command", command, message: "" },
        item.state,
        undefined,
        request,
      ).status,
      "command",
    );
});
