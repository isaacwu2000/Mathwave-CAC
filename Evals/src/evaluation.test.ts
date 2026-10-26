import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { grade, type Case } from "./grade.ts";
import { runCommand } from "../../Web/src/modules/commands/index.ts";
const read = (split: string): Case[] =>
  readFileSync(`../Evals/inputs/${split}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
test("evaluation splits have unique ids, disjoint scenarios and valid command oracles", () => {
  const train = read("train"),
    testSet = read("test");
  const all = [
    ...train,
    ...testSet,
    ...read("test-v2"),
    ...read("test-v3"),
    ...read("test-v4"),
    ...read("test-v5"),
  ];
  assert.equal(new Set(all.map((c) => c.id)).size, all.length);
  assert.equal(new Set(all.map((c) => c.family)).size, all.length);
  assert.equal(new Set(all.map((c) => c.utterance)).size, all.length);
  for (const item of all) {
    // Retain historical datasets; flowchart cases describe a retired feature.
    if (String(item.state.mode) === "diagram" || item.category === "diagram") continue;
    if (item.expected.command) {
      const result = runCommand(item.state, item.expected.command);
      if (item.expected.messagePattern)
        assert.match(result.message, new RegExp(item.expected.messagePattern, "i"), item.id);
      assert.equal(
        grade(item, {
          status: "command",
          command: item.expected.command,
          message: "",
        }).pass,
        true,
        item.id,
      );
    }
  }
});
test("grader catches altered numbers and wrong read-only answers", () => {
  const cases = read("test");
  assert.equal(
    grade(
      cases.find((c) => c.family === "add_negative")!,
      { status: "command", command: "add 4 to both sides", message: "" },
    ).pass,
    false,
  );
  assert.equal(
    grade(
      cases.find((c) => c.family === "median_inline_even")!,
      { status: "command", command: "mean", message: "" },
    ).pass,
    false,
  );
});
test("grader rejects unsafe actions and empty or contradictory clarifications", () => {
  const c = read("train").find((c) => c.family === "ambiguous_variance")!;
  for (const prediction of [
    { status: "command" as const, command: "export problem", message: "" },
    { status: "clarification" as const, command: "", message: "" },
    {
      status: "clarification" as const,
      command: "sample variance",
      message: "Sample or population?",
    },
  ])
    assert.equal(grade(c, prediction).pass, false);
});
