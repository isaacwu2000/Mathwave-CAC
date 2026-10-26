import { parseMath, speakMath } from "../../Web/src/modules/math/index.ts";

/** Narrates equations with grouping; retains extended graph notation if scalar parsing fails. */
export function stepReadback(expression: string): string {
  try {
    return speakMath(parseMath(expression));
  } catch {
    return expression;
  }
}
