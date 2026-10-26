import { expect, test } from "vitest";
import { assessBackendAnswer, backendCases } from "./backend-journey.ts";

test("backend scores require the authored status and math result, not merely valid JSON", () => {
  const command = (commands: string[]) => ({
    status: "command",
    command: "",
    commands,
    message: "",
  });
  expect(
    assessBackendAnswer(
      command(["subtract 3 from both sides", "divide both sides by 2"]),
      backendCases[2],
    ).passed,
  ).toBe(true);
  expect(assessBackendAnswer(command(["subtract 3 from both sides"]), backendCases[2]).passed).toBe(
    false,
  );
  expect(assessBackendAnswer(command(["write (2*x+3-3)/2=(11-3)/2"]), backendCases[2]).passed).toBe(
    false,
  );
  expect(
    assessBackendAnswer(
      { status: "clarification", command: "", message: "Which change?" },
      backendCases[3],
    ).passed,
  ).toBe(true);
  expect(
    assessBackendAnswer(
      { status: "unsupported", command: "", message: "Cannot help." },
      backendCases[3],
    ).passed,
  ).toBe(false);
});
