import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  applyCloudOperation,
} from "../../Web/src/modules/problems/index.ts";
import { runCommand } from "../../Web/src/modules/commands/index.ts";
const origin = process.argv[2] ?? "http://localhost:5184";
const output = new URL("../../output/playwright/geometry-equation/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const source =
  "A=point(0,0)\nB=point(3,0)\nC=point(0,4)\ndraw triangle(A,B,C)\nrightangle B,A,C\nmeasure segment(A,B)\nmeasure segment(A,C)\nlabel segment(B,C), h";
let saved = { book: createProblemLibrary(), clarification: null, revision: 0 };
for (const text of [
  "typescript\nproblem.save(geometry.construct(" + JSON.stringify(source) + "));",
  "write h^2=3^2+4^2",
]) {
  const result = runCommand(currentProblem(saved.book).state, text);
  saved.book = recordStep(saved.book, result.state, text);
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(5000);
  await page.route("**/api/account", (route) =>
    route.fulfill({
      json: {
        identity: { kind: "development", owner: "geometry-equation-test", verified: true },
        allowanceMs: 600000,
        remainingMs: 600000,
        resetsAt: null,
        authConfigured: true,
      },
    }),
  );
  await page.route("**/api/live-token", (route) => route.fulfill({ json: { configured: false } }));
  await page.route("**/api/problems", async (route) => {
    if (route.request().method() === "POST") {
      const outcome = await applyCloudOperation(saved, route.request().postDataJSON().operation);
      saved = { ...outcome, clarification: null, revision: saved.revision + 1 };
    }
    await route.fulfill({ json: saved });
  });
  await page.goto(origin);
  await page.locator('.app-shell[data-ready="true"]').waitFor();
  await page.screenshot({ path: output + "before-or-desktop.png" });
  await page
    .locator(".graph-desktop .learnunlock-canvas")
    .getByText("h", { exact: true })
    .waitFor();
  const drawing = await page.locator(".graph-desktop").boundingBox();
  const equation = await page.locator(".equation-column").boundingBox();
  assert(
    drawing && equation && drawing.x + drawing.width <= equation.x + 1,
    "Laptop drawing and equation must occupy separate side-by-side columns",
  );
  await page.screenshot({ path: output + "desktop.png" });
  // A real failure should remain available through Pico without the removed attention card.
  await page.getByRole("button", { name: "Start listening", exact: true }).click();
  await page.locator(".pico-reply").filter({ hasText: "Voice is not set up yet" }).waitFor();
  assert.equal(await page.getByText("Needs attention", { exact: true }).count(), 0);
  assert.equal(await page.locator(".response-card").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Show graph", exact: true }).waitFor();
  await page.screenshot({ path: output + "mobile-equation.png" });
  await page.getByRole("button", { name: "Show graph", exact: true }).click();
  await page
    .locator(".graph-fullscreen .learnunlock-canvas")
    .getByText("h", { exact: true })
    .waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: output + "mobile-fullscreen.png" });
  await page.getByRole("button", { name: "Close graph", exact: true }).click();
  await page.locator(".equation-column").waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Show graph", exact: true }).waitFor();
  assert.equal(currentProblem(saved.book).state.construction, source);
  await page.getByRole("button", { name: "Your problems and account", exact: true }).click();
  await page.getByRole("button", { name: "New problem", exact: true }).click();
  await page.getByRole("heading", { name: "What math shall we play with today?" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Show graph", exact: true }).count(), 0);
  console.log(
    "PASS: triangle and equation coexist on laptop; mobile opens/closes full-screen drawing; reload retains it; no attention card.",
  );
} finally {
  await browser.close();
}
