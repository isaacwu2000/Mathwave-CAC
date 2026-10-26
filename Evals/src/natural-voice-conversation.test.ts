import { expect, test } from "vitest";
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  rememberConversation,
  correctConversation,
  updateProblem,
} from "../../Web/src/modules/problems/index.ts";
import { runCommand } from "../../Web/src/modules/commands/index.ts";
import { assessNaturalVoiceTurn, naturalVoiceCases } from "./natural-voice-conversation.ts";

test("voice conversation scoring rejects accidental edits, extra steps and repeated subtraction", () => {
  let before = createProblemLibrary();
  before = recordStep(
    before,
    runCommand(currentProblem(before).state, "write 8*x+3=19").state,
    "write 8*x+3=19",
  );
  const after = recordStep(
    before,
    runCommand(currentProblem(before).state, "subtract 3 from both sides").state,
    "subtract 3 from both sides",
  );
  expect(assessNaturalVoiceTurn(before, before, naturalVoiceCases[1]).passed).toBe(false);
  const explained = rememberConversation(
    before,
    before,
    "How would you remove three?",
    "Subtract three from both sides.",
    "explanation",
    ["subtract 3 from both sides"],
  );
  expect(assessNaturalVoiceTurn(before, explained, naturalVoiceCases[1]).passed).toBe(true);
  const wrongSuggestion = rememberConversation(
    before,
    before,
    "What next?",
    "Try this.",
    "explanation",
    ["subtract 9 from both sides"],
  );
  expect(assessNaturalVoiceTurn(before, wrongSuggestion, naturalVoiceCases[1]).passed).toBe(false);
  const rewritten = updateProblem(explained, (p) => ({
    ...p,
    steps: p.steps.map((s) => ({ ...s, command: "different prior work" })),
  }));
  expect(assessNaturalVoiceTurn(before, rewritten, naturalVoiceCases[1]).passed).toBe(false);
  expect(assessNaturalVoiceTurn(before, after, naturalVoiceCases[1]).passed).toBe(false);
  expect(assessNaturalVoiceTurn(before, after, naturalVoiceCases[2]).passed).toBe(true);
  const repeated = recordStep(
    after,
    runCommand(currentProblem(after).state, "subtract 5 from both sides").state,
    "subtract 5 from both sides",
  );
  expect(assessNaturalVoiceTurn(after, repeated, naturalVoiceCases[3]).passed).toBe(false);
  const action = rememberConversation(before, after, "Go ahead.", "Subtracted three.", "command", [
    "subtract 3 from both sides",
  ]);
  const corrected = correctConversation(
    action,
    ["subtract 5 from both sides"],
    "Actually five.",
  ).book;
  expect(assessNaturalVoiceTurn(action, corrected, naturalVoiceCases[3]).passed).toBe(true);
  const wrongTarget = updateProblem(corrected, (p) => ({
    ...p,
    steps: p.steps.map((s, i) => (i === 0 ? { ...s, command: "changed an earlier step" } : s)),
  }));
  expect(assessNaturalVoiceTurn(action, wrongTarget, naturalVoiceCases[3]).passed).toBe(false);
});
