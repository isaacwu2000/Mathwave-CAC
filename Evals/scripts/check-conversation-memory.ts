import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  applyCloudOperation,
  createProblemLibrary,
  currentProblem,
  decodeProblemLibrary,
  historyContext,
} from "../../Web/src/modules/problems/index.ts";
import { type Interpretation, conversationContext } from "../../Web/src/modules/commands/index.ts";

// This small live text lane uses synthetic in-memory work, never a student's database.
const origin = process.argv[2];
const scenario = process.argv[3] ?? "all";
const startedAt = new Date().toISOString();
if (!["all", "algebra", "geometry"].includes(scenario))
  throw new Error("Use all, algebra or geometry.");
if (
  process.env.RUN_LIVE_CHECK !== "true" ||
  !origin ||
  !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
)
  throw new Error("Set RUN_LIVE_CHECK=true and pass a local CLOUD_TEST_MODE server URL.");
const output = resolve(`Evals/evaluations/conversation-memory-${randomUUID()}.json`);
let saved = { book: createProblemLibrary(), clarification: null } as Parameters<
  typeof applyCloudOperation
>[0];
const results: object[] = [];
let calls = 0;
/** Calls the live interpreter with validated synthetic state; fails on transport errors. */
const interpret: NonNullable<Parameters<typeof applyCloudOperation>[2]> = async (text, library) => {
  calls++;
  const problem = currentProblem(library.book);
  const response = await fetch(`${origin}/api/interpret`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      state: problem.state,
      history: historyContext(library.book),
      conversation: problem.conversation,
      conversationArchive: problem.conversationArchive,
      clarification: library.clarification ?? undefined,
      exploration: problem.exploration,
    }),
    signal: AbortSignal.timeout(45000),
  });
  const body = await response.json();
  if (!response.ok) {
    results.push({ text, interpreterFailure: { status: response.status, body } });
    throw new Error(`Interpreter ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as Interpretation;
};
/** Retains each response and independent expectation, including failed turns, in a new report. */
async function check(
  text: string,
  assess: (
    result: Awaited<ReturnType<typeof applyCloudOperation>>,
    before: typeof saved,
  ) => boolean,
) {
  const before = saved;
  const previousCalls = calls;
  const start = performance.now();
  try {
    const result = await applyCloudOperation(
      saved,
      { kind: "command", text, interpret: true },
      interpret,
    );
    const passed = assess(result, before);
    results.push({
      text,
      passed,
      ms: performance.now() - start,
      interpreterRequests: calls - previousCalls,
      status: result.status,
      message: result.message,
      state: currentProblem(result.book).state,
    });
    saved = {
      book: decodeProblemLibrary(JSON.stringify(result.book)),
      clarification: result.clarification,
    };
    console.log(`${passed ? "PASS" : "FAIL"} ${text} (${Math.round(performance.now() - start)}ms)`);
  } catch (error) {
    results.push({ text, passed: false, ms: performance.now() - start, error: String(error) });
    console.log(`FAIL ${text}: ${String(error)}`);
  }
}
const sameWork = (result: typeof saved, before: typeof saved) =>
  JSON.stringify(currentProblem(result.book).state) ===
    JSON.stringify(currentProblem(before.book).state) &&
  currentProblem(result.book).steps.length === currentProblem(before.book).steps.length;

if (scenario !== "geometry") {
  await check(
    "write 3*x+5=20",
    (r) => currentProblem(r.book).state.expression === "3 * x + 5 = 20",
  );
  await check(
    "What would get the added five out of my way without changing the answer?",
    (r, b) =>
      ["reply", "explanation"].includes(r.status) &&
      /subtract|minus/i.test(r.message) &&
      sameWork(r, b),
  );
  await check(
    "Okay, go ahead.",
    (r) =>
      !["clarification", "unsupported"].includes(r.status) &&
      /15|20 - 5/.test(currentProblem(r.book).state.expression),
  );
  // Read-only discussion must not erase the original operation needed for a later correction.
  for (let i = 0; i < 18; i++)
    saved = await applyCloudOperation(saved, { kind: "command", text: "read equation" });
  const p = currentProblem(saved.book);
  const memory = conversationContext(
    "Actually, take away seven instead of five.",
    p.conversation || [],
    p.conversationArchive,
  );
  results.push({
    memoryBytes: JSON.stringify(memory).length,
    retainedBytes: JSON.stringify({ recent: p.conversation, archive: p.conversationArchive })
      .length,
  });
  await check(
    "Actually, take away seven instead of five.",
    (r) =>
      r.status === "correction" &&
      /13|20 - 7/.test(currentProblem(r.book).state.expression) &&
      /3 \* x - 2|3 \* x \+ 5 - 7/.test(currentProblem(r.book).state.expression),
  );
  await check(
    "Simplify.",
    (r) => currentProblem(r.book).state.expression.replace(/\s/g, "") === "3*x-2=13",
  );
  await check(
    "Why are we allowed to do that on both sides?",
    (r, b) =>
      ["explanation", "reply"].includes(r.status) &&
      /equal|balance|same/i.test(r.message) &&
      sameWork(r, b),
  );
  await check("Read the right side.", (r, b) => /13|thirteen/i.test(r.message) && sameWork(r, b));
  await check(
    "Make the other one smaller.",
    (r, b) => r.status === "clarification" && sameWork(r, b),
  );
}
if (scenario !== "algebra") {
  saved = { book: createProblemLibrary(), clarification: null };
  await check(
    "For later: my triangle's sides are five, twelve and thirteen. Please just remember that; no drawing yet.",
    (r, b) => ["reply", "explanation"].includes(r.status) && sameWork(r, b),
  );
  await check(
    "write y=x^2",
    (r) => currentProblem(r.book).state.expression.replace(/\s/g, "") === "y=x^2",
  );
  for (let i = 0; i < 18; i++)
    saved = await applyCloudOperation(saved, { kind: "command", text: "read equation" });
  await check(
    "Back to my earlier triangle, which length would be the hypotenuse?",
    (r, b) =>
      ["reply", "explanation"].includes(r.status) &&
      /13|thirteen/i.test(r.message) &&
      sameWork(r, b),
  );
}
await mkdir(resolve("Evals/evaluations"), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      lane: "live text interpreter plus in-memory cloud operations; no DB or microphone",
      startedAt,
      scenario,
      interpreterRequests: calls,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(output);
if (results.some((r) => "passed" in r && !r.passed)) process.exitCode = 1;
