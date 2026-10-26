import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
} from "../../Web/src/modules/problems/index.ts";
import { runCommand } from "../../Web/src/modules/commands/index.ts";
const origin = process.argv[2] ?? "https://mathwave.app";
const output = new URL("../../output/playwright/deployed-roots/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
let book = createProblemLibrary();
for (const command of ["graph x^2+3*x+2", "write (x+1)*(x+2)", "write x=-2", "write x=-1"])
  book = recordStep(book, runCommand(currentProblem(book).state, command).state, command);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route("**/api/account", (route) =>
    route.fulfill({
      json: {
        identity: { kind: "development", owner: "hosted-root-layout", verified: true },
        allowanceMs: 600000,
        remainingMs: 600000,
        resetsAt: null,
        authConfigured: true,
      },
    }),
  );
  await page.route("**/api/live-token", (route) => route.fulfill({ json: { configured: false } }));
  await page.route("**/api/problems", (route) =>
    route.fulfill({ json: { book, revision: 0, clarification: null } }),
  );
  await page.goto(origin);
  await page.locator('.app-shell[data-ready="true"]').waitFor();
  await page.locator(".graph-desktop canvas").first().waitFor();
  await page.waitForTimeout(300);
  const graph = await page.locator(".graph-desktop").boundingBox(),
    equation = await page.locator(".equation-column").boundingBox();
  assert(graph && equation && graph.x + graph.width <= equation.x + 1);
  assert.equal(await page.locator(".step-equation").count(), 4);
  assert.deepEqual(
    currentProblem(book).state.retainedGraph?.rows.map((row) => row.expression),
    ["x^2 + 3 * x + 2"],
  );
  await page.screenshot({ path: output + "desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Show graph", exact: true }).waitFor();
  await page.screenshot({ path: output + "mobile.png" });
  await page.getByRole("button", { name: "Show graph", exact: true }).click();
  await page.locator(".graph-fullscreen canvas").first().waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: output + "mobile-graph.png" });
  console.log(
    "PASS: hosted assets retain the parabola beside both roots and open it fullscreen on mobile. Storage/account mocked; no provider calls.",
    output,
  );
} finally {
  await browser.close();
}
