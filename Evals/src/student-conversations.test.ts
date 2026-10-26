import { expect, test } from "vitest";
import { replayStudentConversation, type StudentConversation } from "./student-conversations.ts";

test("reference replay keeps follow-up context and detects an incorrect authored answer", async () => {
  const scenario: StudentConversation = {
    id: "checker-example",
    family: "checker-example",
    category: "statistics",
    focus: "Read the saved list",
    turns: [
      {
        student: "Put down two, four, and nine.",
        programs: ["problem.save(statistics.data([2,4,9]));"],
        expect: { data: [2, 4, 9] },
      },
      {
        student: "What is the average of those?",
        programs: ["statistics.mean(statistics.current());"],
        expect: { readOnly: true, messageIncludes: ["Mean: 5."] },
      },
    ],
  };
  expect((await replayStudentConversation(scenario)).errors).toEqual([]);
  scenario.turns[1].expect!.messageIncludes = ["Mean: 6."];
  expect((await replayStudentConversation(scenario)).errors.join(" ")).toContain("Mean: 6.");
});

test("a fixed explanation cannot hide a failed preview", async () => {
  const result = await replayStudentConversation({
    id: "bad-preview",
    family: "bad-preview",
    category: "geometry",
    focus: "Preview failure",
    turns: [
      {
        student: "Draw a circle with radius four.",
        programs: ['problem.save(geometry.construct("O=point(0,0)\\nc=circle(O,4)\\ndraw c"));'],
      },
      {
        student: "What does that circle look like?",
        programs: [],
        previews: ['geometry.inspect(geometry.current(),"notDefined");'],
        status: "explanation",
        message: "The circle has radius 4.",
        expect: { readOnly: true, messageIncludes: ["radius 4"] },
      },
    ],
  });
  expect(result.errors.join(" ")).toContain("preview");
});

test("numeric phrases cannot accept a different number or its sign", async () => {
  for (const [answer, expected] of [
    [50, "Mean: 5"],
    [-5, "Mean: 5"],
    [5, "Mean: -5"],
  ]) {
    const result = await replayStudentConversation({
      id: "bad-number",
      family: "bad-number",
      category: "statistics",
      focus: "Numeric oracle boundaries",
      turns: [
        {
          student: "Use these numbers for my data.",
          programs: [`problem.save(statistics.data([${answer},${answer}]));`],
        },
        {
          student: "Tell me their average.",
          programs: ["statistics.mean(statistics.current());"],
          expect: { messageIncludes: [String(expected)] },
        },
      ],
    });
    expect(result.errors.join(" ")).toContain("answer missing");
  }
});
