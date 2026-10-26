import { expect, test } from "vitest";
import { stepReadback } from "./readback.ts";

for (const [expression, spoken] of [
  ["x^20=1", "x raised to the power 20 equals 1"],
  ["x^3=8", "x cubed equals 8"],
  ["(x+1)/(x-2)=5", "x plus 1, all divided by the quantity x minus 2 end quantity equals 5"],
]) {
  test(`reading a saved step preserves the meaning of ${expression}`, () => {
    expect(stepReadback(expression)).toBe(spoken);
  });
}

test("reading extended graph notation preserves the saved notation when scalar speech is unavailable", () => {
  expect(stepReadback("r=2*cos(3*theta)")).toBe("r=2*cos(3*theta)");
});
