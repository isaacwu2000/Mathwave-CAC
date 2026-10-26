import { runLocalAgent } from "../../Native/Engine/agent.ts";
import { createProblemLibrary, currentProblem } from "../../Web/src/modules/problems/index.ts";
import {
  validateConstruction,
  numberedGraphs,
  graphFunction,
  compileGraphScene,
} from "../../Web/src/modules/visuals/index.ts";

export type StudentTurn = {
  student: string;
  programs: string[];
  previews?: string[];
  status?: "command" | "correction" | "explanation";
  message?: string;
  expect?: {
    expression?: string;
    data?: number[];
    stepDelta?: number;
    geometryOverlay?: string | null;
    constructionIncludes?: string[];
    graphCount?: number;
    graphSamples?: { curve: number; x: number; y: number }[];
    graphPoints?: { curve: number; parameter: number; x: number; y: number }[];
    mode?: string;
    graph?: boolean;
    readOnly?: boolean;
    messageIncludes?: string[];
    action?: string;
    angles?: { points: [string, string, string]; degrees: number }[];
  };
};

/** Matches literal wording while bounding every numeric token, including numbers inside phrases. */
function answerIncludes(answer: string, expected: string) {
  const normalize = (text: string) => text.replace(/−/g, "-").toLowerCase();
  const pattern = normalize(expected)
    .split(/(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i)
    .map((part, index) => {
      const literal = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return index % 2 ? `(?<![\\d.\\-+eE])${literal}(?!\\d|\\.\\d|e[+-]?\\d)` : literal;
    })
    .join("");
  return new RegExp(pattern, "i").test(normalize(answer));
}
export type StudentConversation = {
  id: string;
  family: string;
  category: string;
  focus: string;
  turns: StudentTurn[];
};

/**
 * Replays authored answers through the shared local/web executor in an isolated book.
 * Checks independent authored expectations after each turn, retaining conversation/history.
 * This checks reference fixtures; the injected answers cannot measure model accuracy or rendering.
 */
export async function replayStudentConversation(scenario: StudentConversation) {
  let book = createProblemLibrary();
  const errors: string[] = [];
  const turns = [];
  for (const [index, turn] of scenario.turns.entries()) {
    const before = currentProblem(book);
    try {
      let previewed = false;
      const observations: string[] = [];
      const result = await runLocalAgent(book, turn.student, async (request) => {
        if (turn.previews?.length && !previewed) {
          previewed = true;
          return {
            calls: turn.previews.map((program, index) => ({
              id: `reference-preview-${index}`,
              name: "preview_math",
              arguments: JSON.stringify({ program, programs: [] }),
            })),
          };
        }
        for (const input of request.input) {
          const item = input as { type?: string; output?: string };
          if (item.type !== "function_call_output" || !item.output) continue;
          const observation = JSON.parse(item.output);
          if (observation.error)
            errors.push(`turn ${index + 1}: preview error: ${observation.error}`);
          observations.push(...(observation.messages ?? []));
        }
        return {
          answer: {
            status: turn.status ?? "command",
            programs: turn.programs,
            message: turn.message ?? "",
            presentation: null,
          },
        };
      });
      const problem = currentProblem(result.book);
      const expected = turn.expect ?? {};
      const fail = (reason: string) => errors.push(`turn ${index + 1}: ${reason}`);
      if (result.status !== (turn.status ?? "command"))
        fail(`executor returned ${result.status}: ${result.message}`);
      for (const key of ["expression", "data", "mode", "graph"] as const) {
        if (
          expected[key] !== undefined &&
          JSON.stringify(expected[key]) !== JSON.stringify(problem.state[key])
        )
          fail(
            `${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(problem.state[key])}`,
          );
      }
      if (
        expected.stepDelta !== undefined &&
        problem.steps.length - before.steps.length !== expected.stepDelta
      )
        fail(
          `expected ${expected.stepDelta} added steps, got ${problem.steps.length - before.steps.length}`,
        );
      if (
        expected.graphCount !== undefined &&
        numberedGraphs(problem.state).length !== expected.graphCount
      )
        fail(
          `expected ${expected.graphCount} graph rows, got ${numberedGraphs(problem.state).length}`,
        );
      for (const sample of expected.graphSamples ?? []) {
        const value = problem.state.graphScene
          ? compileGraphScene(problem.state.graphScene).sample(sample.curve - 1, sample.x)
          : graphFunction(numberedGraphs(problem.state)[sample.curve - 1].expression).value(
              sample.x,
            );
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          Math.abs(value - sample.y) > 0.000001
        )
          fail(`graph ${sample.curve} at ${sample.x}: expected ${sample.y}, got ${value}`);
      }
      for (const expectedPoint of expected.graphPoints ?? []) {
        const scene = problem.state.graphScene ?? {
          rows: numberedGraphs(problem.state).map(({ expression }) => ({ expression })),
        };
        const point = compileGraphScene(scene).point(
          expectedPoint.curve - 1,
          expectedPoint.parameter,
        );
        if (
          !point ||
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          Math.abs(point.x - expectedPoint.x) > 0.000001 ||
          Math.abs(point.y - expectedPoint.y) > 0.000001
        )
          fail(
            `graph ${expectedPoint.curve} expected point (${expectedPoint.x},${expectedPoint.y}), got ${JSON.stringify(point)}`,
          );
      }
      if (
        expected.geometryOverlay !== undefined &&
        (problem.state.geometryOverlay ?? null) !== expected.geometryOverlay
      )
        fail(
          `expected geometry overlay ${expected.geometryOverlay}, got ${problem.state.geometryOverlay}`,
        );
      for (const statement of expected.constructionIncludes ?? []) {
        const lines = (problem.state.construction ?? "")
          .split("\n")
          .map((line) => line.replace(/\s/g, ""));
        if (!lines.includes(statement.replace(/\s/g, "")))
          fail(`construction missing ${statement}`);
      }
      if (
        expected.readOnly &&
        (["state", "steps", "undoStates", "undoRevisions", "redoRevisions"] as const).some(
          (key) => JSON.stringify(before[key]) !== JSON.stringify(problem[key]),
        )
      )
        fail("read-only turn changed work or history");
      for (const text of expected.messageIncludes ?? []) {
        if (!answerIncludes(result.message, text))
          fail(`answer missing ${JSON.stringify(text)}: ${result.message}`);
        if (turn.previews?.length && !answerIncludes(observations.join("\n"), text))
          fail(`preview answer missing ${JSON.stringify(text)}: ${observations.join("\n")}`);
      }
      if (expected.angles?.length) {
        const source = problem.state.construction ?? "";
        const construction = validateConstruction(source);
        for (const angle of expected.angles) {
          const [first, vertex, last] = angle.points.map((name) => construction.values.get(name));
          if (first?.kind !== "point" || vertex?.kind !== "point" || last?.kind !== "point") {
            fail(`missing angle points ${angle.points.join(",")}`);
            continue;
          }
          const a = [first.x - vertex.x, first.y - vertex.y];
          const b = [last.x - vertex.x, last.y - vertex.y];
          const degrees =
            (Math.acos(
              Math.max(
                -1,
                Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b))),
              ),
            ) *
              180) /
            Math.PI;
          const marked = source
            .split("\n")
            .some((line) =>
              [`angle${angle.points.join(",")}`, `rightangle${angle.points.join(",")}`].includes(
                line.replace(/\s/g, ""),
              ),
            );
          if (!marked || !Number.isFinite(degrees) || Math.abs(degrees - angle.degrees) > 0.00001)
            fail(
              `angle ${angle.points.join(",")} expected marked ${angle.degrees} degrees, got ${degrees}, marked=${marked}`,
            );
        }
      }
      if (expected.action !== undefined && result.action !== expected.action)
        fail(`expected action ${expected.action}, got ${result.action}`);
      turns.push({
        student: turn.student,
        status: result.status,
        message: result.message,
        state: problem.state,
        steps: problem.steps.length,
      });
      book = result.book;
    } catch (error) {
      errors.push(`turn ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
  }
  return { id: scenario.id, errors, turns };
}
