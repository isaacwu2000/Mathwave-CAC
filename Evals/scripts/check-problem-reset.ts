import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import {
  applyCloudOperation,
  createProblemLibrary,
  currentProblem,
  recordStep,
} from "../../Web/src/modules/problems/index.ts";
import { runCommand } from "../../Web/src/modules/commands/index.ts";
const origin = process.argv[2] ?? "http://localhost:5184";
const output = new URL("../../output/playwright/problem-reset/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
let saved = { book: createProblemLibrary(), clarification: null, revision: 0 };
const construction =
  "A=point(0,0)\nB=point(3,0)\nC=point(0,4)\ndraw triangle(A,B,C)\nrightangle B,A,C\nmeasure segment(A,B)\nmeasure segment(A,C)\nlabel segment(B,C), h";
const command =
  "typescript\nproblem.save(geometry.construct(" + JSON.stringify(construction) + "));";
saved.book = recordStep(
  saved.book,
  runCommand(currentProblem(saved.book).state, command).state,
  command,
);
const previousProblem = currentProblem(saved.book).id;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("**/api/account", (route) =>
    route.fulfill({
      json: {
        identity: { kind: "development", owner: "reset-check", verified: true },
        allowanceMs: 600000,
        remainingMs: 600000,
        resetsAt: null,
        authConfigured: true,
      },
    }),
  );
  await context.route("**/api/live-token", (route) =>
    route.fulfill({ json: { configured: true } }),
  );
  await context.route("**/api/problems", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const outcome = await applyCloudOperation(saved, request.postDataJSON().operation);
      saved = { ...outcome, clarification: null, revision: saved.revision + 1 };
    }
    await route.fulfill({ json: saved });
  });
  // Substitute only the voice transport; the real hook and workspace own the reset.
  await context.route("**/openai-voice-session.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    export class OpenAIVoiceSession {
      constructor(events) { this.events = events; window.resetVoice = this; }
      stop() { this.events.reply(''); this.events.partial(''); this.events.state('idle'); this.events.playback(false); }
      setReplies() {} resume() {} stopListening() {} setPace() {} reportFacts() {} toggle() {}
    }
  `,
    }),
  );
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator('.app-shell[data-ready="true"]').waitFor();
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { resetVoice: { events: { reply(text: string): void } } }).resetVoice,
    ),
  );
  await page.locator(".learnunlock-canvas").getByText("h", { exact: true }).waitFor();
  assert.equal(
    await page.locator(".learnunlock-canvas").getByText("0.36", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.locator(".learnunlock-canvas").getByText("5", { exact: true }).count(),
    0,
  );
  await page.screenshot({ path: output + "triangle-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: output + "triangle-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() =>
    (
      window as unknown as { resetVoice: { events: { reply(text: string): void } } }
    ).resetVoice.events.reply("Previous triangle response"),
  );
  await page.getByText("Previous triangle response", { exact: true }).waitFor();
  await page.screenshot({ path: output + "before.png" });
  await page.getByRole("button", { name: "Your problems and account", exact: true }).click();
  await page.getByRole("button", { name: "New problem", exact: true }).click();
  await page.getByRole("heading", { name: "What math shall we play with today?" }).waitFor();
  await page.waitForTimeout(100);
  assert.equal(await page.getByText("Previous triangle response", { exact: true }).count(), 0);
  assert.equal(currentProblem(saved.book).steps.length, 0);
  assert.equal(saved.book.assignments[0].problems.length, 2);
  assert.equal(
    saved.book.assignments[0].problems.find((p) => p.id === previousProblem)?.state.construction,
    construction,
  );
  await page.screenshot({ path: output + "desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: output + "mobile.png" });
  // Use the command interface so the scene, saved rows and rendering match ordinary work.
  for (const text of ["graph (x+1)*(x+2)", "add graph (-1,0)", "add graph (-2,0)"]) {
    const result = runCommand(currentProblem(saved.book).state, text);
    saved.book = recordStep(saved.book, result.state, text);
  }
  await page.reload();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Show graph", exact: true }).click();
  await page.waitForTimeout(1000);
  await page.locator(".learnunlock-canvas canvas").first().waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: output + "points-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: output + "points-desktop.png" });
  console.log(
    "PASS: new problem clears Pico reply and preserves previous problems; desktop/mobile captured.",
  );
} finally {
  await browser.close();
}
