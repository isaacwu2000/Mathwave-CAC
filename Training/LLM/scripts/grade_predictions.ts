import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateModelInterpretation,
  workspaceKey,
} from "../../../Web/src/modules/commands/index.ts";
import { previewTool } from "../../../Web/src/modules/ai/index.ts";
import { formatMath, parseMath } from "../../../Web/src/modules/math/index.ts";
import {
  applyCloudOperation,
  applyMathPlan,
  currentProblem,
  historyContext,
  type ProblemLibrary,
  type CloudOutcome,
} from "../../../Web/src/modules/problems/index.ts";
import {
  compileGraphScene,
  graphFunction,
  numberedGraphs,
  validateConstruction,
} from "../../../Web/src/modules/visuals/index.ts";
import type { StudentTurn } from "../../../Evals/src/student-conversations.ts";

export type ExperimentRow = {
  id: string;
  caseId: string;
  family: string;
  category: string;
  turn: number;
  stage: "final" | "preview";
  split: string;
  messages: { role: string; content: string }[];
  request: { request: string };
  expected: {
    interpretation: unknown;
    before: { book: ProblemLibrary; clarification: null };
    after: Pick<CloudOutcome, "book" | "status" | "message"> & {
      action?: string;
    };
    assertions?: StudentTurn["expect"];
  };
};
export type Prediction = {
  id: string;
  prediction: string;
  elapsedSeconds?: number;
  inputTokens?: number;
  outputTokens?: number;
  hitTokenLimit?: boolean;
};
export type PredictionGrade = {
  id: string;
  caseId: string;
  category: string;
  stage: ExperimentRow["stage"];
  syntaxValid: boolean;
  semanticCorrect: boolean;
  groundedReplyAssertionsSatisfied: boolean | null;
  replyReferenceMatch: boolean | null;
  exactTarget: boolean;
  pass: boolean;
  reasons: string[];
  book?: ProblemLibrary;
  observations?: unknown[];
  message?: string;
};

/**
 * Compares engine values with numeric tolerance, preserving mathematical structure.
 * - Ignores object key order, while arrays and operation order remain significant.
 * - Uses a small tolerance only for finite numbers, never for missing values.
 */
export function semanticallyEqual(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number")
    return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-6;
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((value, index) => semanticallyEqual(value, right[index]))
    );
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  const keys = Object.keys(a)
    .filter((key) => a[key] !== undefined)
    .sort();
  const others = Object.keys(b)
    .filter((key) => b[key] !== undefined)
    .sort();
  return (
    JSON.stringify(keys) === JSON.stringify(others) &&
    keys.every((key) => semanticallyEqual(a[key], b[key]))
  );
}

/** Removes notation spacing without changing the represented operation or its order. */
function canonical(value: unknown, key = ""): unknown {
  if (typeof value === "string" && key === "expression") {
    try {
      return formatMath(parseMath(value));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value))
    return value.map((item) => canonical(item, key === "graphExpressions" ? "expression" : ""));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, canonical(item, name)]),
    );
  return value;
}

/**
 * Selects saved mathematical work, excluding generated IDs, dates and conversation prose.
 * - Retains every saved step, undo/redo snapshot, active workspace and explanation.
 * - Never compares command spelling; equivalent programs may produce the same work.
 */
export function workProjection(book: ProblemLibrary) {
  const snapshot = (value: {
    state: unknown;
    steps: { state: unknown }[];
    undoStates?: unknown[];
  }) => ({
    state: canonical(value.state),
    steps: value.steps.map((step) => canonical(step.state)),
    undoStates: canonical(value.undoStates ?? []),
  });
  return {
    activeAssignment: book.assignments.findIndex(
      (assignment) => assignment.id === book.assignmentId,
    ),
    activeProblem: book.assignments
      .flatMap((assignment) => assignment.problems)
      .findIndex((problem) => problem.id === book.problemId),
    assignments: book.assignments.map((assignment) => ({
      title: assignment.title,
      problems: assignment.problems.map((problem) => ({
        title: problem.title,
        ...snapshot(problem),
        initialState: canonical(problem.initialState),
        undoRevisions: (problem.undoRevisions ?? []).map(snapshot),
        redoRevisions: (problem.redoRevisions ?? []).map(snapshot),
        exploration: canonical(problem.exploration),
      })),
    })),
  };
}

/**
 * Retains the next-turn effects of suggestions and correction metadata.
 * - Executes pending proposals only on a clone; compares saved effects, not DSL text.
 * - Keeps revision depth and stale-state checks that determine future acceptance/correction.
 */
function conversationOutcome(book: ProblemLibrary) {
  const problem = currentProblem(book);
  const latest = problem.conversation?.at(-1);
  const metadata = (turn: typeof latest) =>
    turn
      ? {
          status: turn.status,
          revisable: turn.revisable ?? false,
          undoDepth: turn.undoDepth ?? null,
          stepCount: turn.stepCount ?? null,
          matchesCurrentState: turn.stateKey === workspaceKey(problem.state),
        }
      : null;
  const revisable = [
    ...(problem.conversationArchive ?? []),
    ...(problem.conversation ?? []),
  ].findLast((turn) => turn.revisable);
  return {
    latest: metadata(latest),
    lastRevisable: metadata(revisable),
    pending: latest?.commands?.length
      ? workProjection(applyMathPlan(structuredClone(book), latest.commands).book)
      : null,
  };
}

/** Bounds numeric tokens so an answer containing 15 cannot satisfy an expected 5. */
function includesAnswer(answer: string, expected: string) {
  const normalize = (text: string) => text.replace(/−/g, "-").toLowerCase();
  const pattern = normalize(expected)
    .split(/(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i)
    .map((part, index) => {
      const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return index % 2 ? `(?<![\\d.\\-+eE])${escaped}(?!\\d|\\.\\d|e[+-]?\\d)` : escaped;
    })
    .join("");
  return new RegExp(pattern, "i").test(normalize(answer));
}

/** Checks authored independent outcomes, including graphs and read-only history. */
function assertionErrors(row: ExperimentRow, outcome: CloudOutcome): string[] {
  const expected = row.expected.assertions ?? {},
    errors: string[] = [];
  const before = currentProblem(row.expected.before.book),
    problem = currentProblem(outcome.book),
    state = problem.state;
  for (const key of ["expression", "data", "mode", "graph"] as const)
    if (
      expected[key] !== undefined &&
      !semanticallyEqual(canonical(state[key], key), canonical(expected[key], key))
    )
      errors.push(`Authored ${key} differs.`);
  if (
    expected.stepDelta !== undefined &&
    problem.steps.length - before.steps.length !== expected.stepDelta
  )
    errors.push("Authored saved-step count differs.");
  if (
    expected.readOnly &&
    !semanticallyEqual(workProjection(row.expected.before.book), workProjection(outcome.book))
  )
    errors.push("Read-only answer changed saved work.");
  if (expected.graphCount !== undefined && numberedGraphs(state).length !== expected.graphCount)
    errors.push("Authored graph count differs.");
  for (const point of expected.graphSamples ?? []) {
    const value = state.graphScene
      ? compileGraphScene(state.graphScene).sample(point.curve - 1, point.x)
      : graphFunction(numberedGraphs(state)[point.curve - 1]?.expression ?? "").value(point.x);
    if (!semanticallyEqual(value, point.y))
      errors.push(`Graph ${point.curve} has wrong value at ${point.x}.`);
  }
  for (const point of expected.graphPoints ?? []) {
    const scene = state.graphScene ?? {
      rows: numberedGraphs(state).map(({ expression }) => ({ expression })),
    };
    if (
      !semanticallyEqual(compileGraphScene(scene).point(point.curve - 1, point.parameter), {
        x: point.x,
        y: point.y,
      })
    )
      errors.push(`Graph ${point.curve} has wrong parameter point.`);
  }
  if (
    expected.geometryOverlay !== undefined &&
    !semanticallyEqual(state.geometryOverlay ?? null, expected.geometryOverlay)
  )
    errors.push("Authored geometry overlay differs.");
  for (const line of expected.constructionIncludes ?? [])
    if (
      !(state.construction ?? "")
        .split("\n")
        .some((actual) => actual.replace(/\s/g, "") === line.replace(/\s/g, ""))
    )
      errors.push(`Missing construction statement: ${line}`);
  if (expected.angles?.length) {
    const construction = validateConstruction(state.construction ?? "");
    for (const angle of expected.angles) {
      const points = angle.points.map((name) => construction.values.get(name));
      if (points.some((point) => point?.kind !== "point")) {
        errors.push("Angle points are missing.");
        continue;
      }
      const [a, b, c] = points as { kind: "point"; x: number; y: number }[];
      const u = [a.x - b.x, a.y - b.y],
        v = [c.x - b.x, c.y - b.y];
      const degrees =
        (Math.acos(
          Math.max(
            -1,
            Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))),
          ),
        ) *
          180) /
        Math.PI;
      const marked = (state.construction ?? "")
        .split("\n")
        .some((line) =>
          [`angle${angle.points.join(",")}`, `rightangle${angle.points.join(",")}`].includes(
            line.replace(/\s/g, ""),
          ),
        );
      if (!marked || !semanticallyEqual(degrees, angle.degrees))
        errors.push("Authored marked angle differs.");
    }
  }
  if (expected.action !== undefined && expected.action !== outcome.action)
    errors.push("Authored action differs.");
  for (const text of expected.messageIncludes ?? [])
    if (!includesAnswer(outcome.message, text))
      errors.push(`Answer missing ${JSON.stringify(text)}.`);
  return errors;
}

/** Parses only direct JSON or one complete JSON code fence, never extracts a guessed answer. */
function decode(text: string): unknown {
  const fence = text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  return JSON.parse(fence ? fence[1] : text);
}

/**
 * Grades one generated answer against the gold pre-turn workspace, without model calls.
 * - Executes generated programs through production validation and persistence.
 * - Uses an inert executor request and verifies the interpreter was called, preventing parser bypass.
 * - This is conditional per-turn scoring, not a free-running conversation rollout.
 */
export async function gradePrediction(
  row: ExperimentRow,
  prediction: Prediction,
): Promise<PredictionGrade> {
  const grade: PredictionGrade = {
    id: row.id,
    caseId: row.caseId,
    category: row.category,
    stage: row.stage,
    syntaxValid: false,
    semanticCorrect: false,
    groundedReplyAssertionsSatisfied: null,
    replyReferenceMatch: null,
    exactTarget: false,
    pass: false,
    reasons: [],
  };
  try {
    const raw = decode(prediction.prediction);
    const target = decode(row.messages.at(-1)?.content ?? "null");
    grade.exactTarget = JSON.stringify(raw) === JSON.stringify(target);
    const state = currentProblem(row.expected.before.book).state,
      history = historyContext(row.expected.before.book);
    if (row.stage === "preview") {
      const calls = (raw as { calls?: { id: string; name: string; arguments: string }[] })?.calls;
      const expectedCalls = (
        target as { calls?: { id: string; name: string; arguments: string }[] }
      )?.calls;
      if (
        !Array.isArray(calls) ||
        !calls.length ||
        calls.length > 4 ||
        !expectedCalls?.length ||
        calls.some(
          (call) =>
            !call ||
            typeof call.id !== "string" ||
            !call.id ||
            typeof call.name !== "string" ||
            typeof call.arguments !== "string",
        ) ||
        new Set(calls.map((call) => call.id)).size !== calls.length ||
        "answer" in (raw as object)
      )
        throw new Error("Invalid preview response envelope.");
      const before = JSON.stringify(row.expected.before.book);
      const observe = (call: { name: string; arguments: string }) =>
        previewTool(call.name, call.arguments, structuredClone(state), history);
      grade.observations = calls.map(observe);
      const expected = expectedCalls.map(observe);
      grade.syntaxValid = grade.observations.every(
        (observation) => !(observation as { error?: string }).error,
      );
      grade.semanticCorrect =
        grade.syntaxValid &&
        semanticallyEqual(
          grade.observations.map((value) => canonical(value)),
          expected.map((value) => canonical(value)),
        ) &&
        before === JSON.stringify(row.expected.before.book);
      grade.book = structuredClone(row.expected.before.book);
      if (!grade.syntaxValid) grade.reasons.push("Preview rejected by production engine.");
      else if (!grade.semanticCorrect)
        grade.reasons.push("Preview observation differs from authored tool result.");
    } else {
      const answer =
        raw && typeof raw === "object" && "answer" in raw
          ? (raw as { answer: unknown }).answer
          : raw;
      if (raw && typeof raw === "object" && "calls" in raw)
        throw new Error("Expected a final answer, received a preview request.");
      const plan = validateModelInterpretation(answer, state, history, row.request.request);
      grade.syntaxValid = true;
      let interpreterCalls = 0;
      const outcome = await applyCloudOperation(
        structuredClone(row.expected.before),
        {
          kind: "command",
          text: "No, execute the generated model proposal for this evaluation.",
          interpret: true,
          consumeDraft: true,
        },
        async () => {
          interpreterCalls++;
          return plan;
        },
      );
      if (interpreterCalls !== 1 || outcome.aiUnavailable)
        throw new Error("Generated proposal did not execute through the model interpreter.");
      grade.book = outcome.book;
      grade.message = outcome.message;
      if (!semanticallyEqual(workProjection(outcome.book), workProjection(row.expected.after.book)))
        grade.reasons.push("Saved workspace or history differs from reference outcome.");
      if (
        outcome.status !== row.expected.after.status ||
        outcome.action !== row.expected.after.action
      )
        grade.reasons.push("Response status or action differs.");
      if (
        !semanticallyEqual(
          conversationOutcome(outcome.book),
          conversationOutcome(row.expected.after.book),
        )
      )
        grade.reasons.push("Pending suggestion or correction revision metadata differs.");
      grade.reasons.push(...assertionErrors(row, outcome));
      const readOnly = semanticallyEqual(
        workProjection(row.expected.before.book),
        workProjection(row.expected.after.book),
      );
      if (readOnly && row.expected.after.message) {
        const required = row.expected.assertions?.messageIncludes ?? [];
        grade.groundedReplyAssertionsSatisfied = required.every((text) =>
          includesAnswer(outcome.message, text),
        );
        // Exact normalized reference matching is deliberately conservative: numeric
        // fragments alone cannot establish that the explanation makes a true claim.
        const normalizeReply = (text: string) =>
          text.normalize("NFKC").replace(/−/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
        grade.replyReferenceMatch =
          normalizeReply(outcome.message) === normalizeReply(row.expected.after.message);
        if (!grade.groundedReplyAssertionsSatisfied)
          grade.reasons.push("Reply fails authored answer assertions.");
        if (!grade.replyReferenceMatch)
          grade.reasons.push(
            "Read-only reply differs from the normalized reference; prose requires review.",
          );
      }
      grade.semanticCorrect = grade.reasons.length === 0;
    }
    if (prediction.hitTokenLimit) {
      grade.reasons.push("Generation reached its output token limit.");
      grade.semanticCorrect = false;
    }
    grade.pass = grade.syntaxValid && grade.semanticCorrect;
  } catch (error) {
    grade.reasons.push(error instanceof Error ? error.message : String(error));
  }
  return grade;
}

/** Writes isolated per-row grades and books; rendering remains explicitly unreviewed. */
export async function gradeFiles(dataPath: string, predictionsPath: string, outputPath: string) {
  const lines = <T>(text: string) =>
    text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as T);
  const rows = lines<ExperimentRow>(await readFile(dataPath, "utf8"));
  const predictions = lines<Prediction>(await readFile(predictionsPath, "utf8"));
  const byId = new Map(predictions.map((prediction) => [prediction.id, prediction]));
  if (byId.size !== predictions.length) throw new Error("Duplicate prediction IDs.");
  const rowIds = new Set(rows.map((row) => row.id));
  if (rowIds.size !== rows.length || predictions.some((prediction) => !rowIds.has(prediction.id)))
    throw new Error("Duplicate data IDs or unexpected predictions.");
  const results: PredictionGrade[] = [];
  for (const row of rows)
    results.push(await gradePrediction(row, byId.get(row.id) ?? { id: row.id, prediction: "" }));
  const summarize = (items: PredictionGrade[]) => ({
    total: items.length,
    syntaxValid: items.filter((item) => item.syntaxValid).length,
    semanticCorrect: items.filter((item) => item.semanticCorrect).length,
    pass: items.filter((item) => item.pass).length,
    exactTarget: items.filter((item) => item.exactTarget).length,
    repliesChecked: items.filter((item) => item.groundedReplyAssertionsSatisfied !== null).length,
    replyAssertionsSatisfied: items.filter((item) => item.groundedReplyAssertionsSatisfied === true)
      .length,
    replyReferenceMatches: items.filter((item) => item.replyReferenceMatch === true).length,
  });
  const report = {
    lane: "conditional per-turn model inference; gold prestate; no rollout",
    visualReview: {
      status: "incomplete",
      reason: "Actual-app screenshots have not been inspected for these generated outcomes.",
    },
    groundingLimit:
      "Read-only replies must match the normalized reference and authored phrases. This conservative reference-match check can reject valid paraphrases; it is not a general prose-accuracy measure. All prose still requires review.",
    summary: summarize(results),
    categories: Object.fromEntries(
      [...new Set(rows.map((row) => row.category))].map((category) => [
        category,
        summarize(results.filter((item) => item.category === category)),
      ]),
    ),
    results,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [data, predictions, output] = process.argv.slice(2);
  if (!data || !predictions || !output)
    throw new Error("Usage: pnpm exec tsx grade_predictions.ts data.jsonl predictions.jsonl output.json");
  const report = await gradeFiles(data, predictions, output);
  console.log(JSON.stringify(report.summary));
}
