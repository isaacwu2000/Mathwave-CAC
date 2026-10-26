import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import {
  interpretationInstructions,
  voiceInstructions,
  COMMAND_MODEL,
} from "../../Web/src/modules/ai/index.ts";
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  applyCloudOperation,
  type CloudSnapshot,
} from "../../Web/src/modules/problems/index.ts";
import { runCommand } from "../../Web/src/modules/commands/index.ts";
import { interpretWithPrompt } from "../src/prompt-provider.ts";
if (process.env.RUN_LIVE_CHECK !== "true")
  throw new Error("Three bounded live checks require RUN_LIVE_CHECK=true.");
process.loadEnvFile(new URL("../../Web/.env", import.meta.url).pathname);
const origin = process.argv[2] ?? "http://localhost:5184";
const output = new URL(`../evaluations/problem-reset-${crypto.randomUUID()}/`, import.meta.url);
await mkdir(output, { recursive: true });
const cases = [
  {
    id: "removed-flowchart",
    text: "Make a flowchart with Start, Process, and Finish.",
    expected: "unsupported",
  },
  {
    id: "symbolic-triangle",
    text: "Draw a right triangle with legs 3 and 4, and label the hypotenuse h. Do not calculate h.",
    expected: "command",
  },
  { id: "equation", text: "Write x squared plus three x plus two.", expected: "command" },
];
const hashes: Record<string, string> = {};
for (const path of [
  "Web/src/modules/commands/config/tool-catalog.ts",
  "Web/src/modules/ai/config/unavailable-features.ts",
])
  hashes[path] = createHash("sha256")
    .update(await readFile(new URL("../../" + path, import.meta.url)))
    .digest("hex");
await writeFile(
  new URL("prompts.json", output),
  JSON.stringify(
    { interpretationInstructions, voiceInstructions, model: COMMAND_MODEL, hashes },
    null,
    2,
  ),
);
const results = [];
const replay = process.argv[3] ? JSON.parse(await readFile(process.argv[3], "utf8")) : [];
const browser = await chromium.launch({ headless: true });
try {
  for (const example of cases) {
    let book = createProblemLibrary();
    book = recordStep(
      book,
      runCommand(currentProblem(book).state, "graph y=x^2").state,
      "graph y=x^2",
    );
    const answer =
      replay.find((row: { id: string }) => row.id === example.id)?.answer ??
      (await interpretWithPrompt(
        example.text,
        { book, clarification: null },
        interpretationInstructions,
        {
          model: COMMAND_MODEL,
          url: "https://api.openai.com/v1/responses",
          key: process.env.OPENAI_API_KEY!,
        },
      ));
    const plan = answer.interpretation;
    const row = {
      ...example,
      answer,
      passed: plan?.status === example.expected,
      visualReview: "pending",
    };
    results.push(row);
    await writeFile(new URL("results.json", output), JSON.stringify(results, null, 2));
    if (!plan) continue;
    let saved: CloudSnapshot = { book, clarification: null, revision: 0 };
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route("**/api/account", (r) =>
      r.fulfill({
        json: {
          identity: { kind: "development", owner: "reset-model", verified: true },
          allowanceMs: 600000,
          remainingMs: 600000,
          resetsAt: null,
          authConfigured: true,
        },
      }),
    );
    await page.route("**/api/live-token", (r) => r.fulfill({ json: { configured: false } }));
    await page.route("**/api/problems", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        const operation = request.postDataJSON().operation;
        const result = await applyCloudOperation(
          saved,
          operation.kind === "command"
            ? { kind: "command", text: example.text, interpret: true }
            : operation,
          async () => plan,
        );
        saved = { ...result, revision: saved.revision + 1 };
      }
      await route.fulfill({ json: saved });
    });
    await page.goto(origin);
    await page.locator('.app-shell[data-ready="true"]').waitFor();
    const editor = page.locator('math-field[aria-label="Graph expression 1"]');
    await editor.waitFor();
    await editor.focus();
    await editor.evaluate((element) => {
      (element as HTMLElement & { setValue(value: string): void }).setValue("x^{2}+1");
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await page.keyboard.press("Enter");
    if (example.id === "removed-flowchart") await page.locator(".pico-reply").waitFor();
    if (example.id === "symbolic-triangle")
      await page.locator(".learnunlock-canvas").getByText("h", { exact: true }).waitFor();
    if (example.id === "equation") await page.locator(".equation-carousel li").nth(1).waitFor();
    await page.waitForTimeout(300);
    if (example.id === "symbolic-triangle") {
      row.passed &&=
        currentProblem(saved.book).state.mode === "geometry" &&
        Boolean(currentProblem(saved.book).state.construction?.includes("h"));
    }
    if (example.id === "equation")
      row.passed &&= currentProblem(saved.book).state.expression === "x^2 + 3 * x + 2";
    await page.screenshot({ path: new URL(example.id + "-desktop.png", output).pathname });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: new URL(example.id + "-mobile.png", output).pathname });
    await writeFile(new URL(example.id + "-saved.json", output), JSON.stringify(saved, null, 2));
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(new URL("results.json", output), JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify({
      output: output.pathname,
      results: results.map((r) => ({
        id: r.id,
        passed: r.passed,
        status: r.answer.interpretation?.status,
        error: r.answer.error,
      })),
    }),
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
