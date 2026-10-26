import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { installVoiceFixture, type FixtureWindow } from "../src/voice-fixture.ts";
import { waitForSpokenResult } from "../src/spoken-result.ts";
import { currentProblem, type CloudSnapshot } from "../../Web/src/modules/problems/index.ts";
import {
  voiceInstructions,
  interpretationInstructions,
  LIVE_MODEL,
  COMMAND_MODEL,
  commandInstructionsFor,
  interpretationSchema,
  previewTools,
} from "../../Web/src/modules/ai/index.ts";
if (process.env.RUN_LIVE_CHECK !== "true")
  throw new Error("This bounded recorded evaluation requires RUN_LIVE_CHECK=true.");
const origin = process.argv[2] ?? "http://localhost:5184";
const directory = new URL(`../evaluations/quadratic-conversation-${randomUUID()}/`, import.meta.url)
  .pathname;
await mkdir(directory, { recursive: true });
const pythagoras = process.argv[3] === "pythagoras";
const turns = pythagoras
  ? [
      {
        id: "triangle",
        text: "My problem is to find the hypotenuse of a right triangle with legs three and four. Draw it and label the hypotenuse h, but do not solve it yet.",
      },
      {
        id: "hypotenuse",
        text: "Find h using Pythagoras and write the answer.",
      },
    ]
  : [
      {
        id: "introduce",
        text: "I am finding the roots of x squared plus three x plus two. Could you write the expression without solving it yet?",
      },
      { id: "graph", text: "Could you graph that expression too?" },
      { id: "factor", text: "Let us factor this expression." },
      {
        id: "roots",
        text: "The solution should be x equals negative two and x equals negative one.",
      },
    ];
const fixtures = [];
for (const turn of turns) {
  const aiff = `${directory}${turn.id}.aiff`,
    wav = `${directory}${turn.id}.wav`;
  execFileSync("say", ["-v", "Daniel", "-r", "165", "-o", aiff, turn.text]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
  fixtures.push({
    ...turn,
    wav,
    sha256: createHash("sha256")
      .update(await readFile(wav))
      .digest("hex"),
  });
}
const sourceHashes = Object.fromEntries(
  await Promise.all(
    [
      "Web/src/modules/ai/config/interpretation.ts",
      "Web/src/modules/ai/config/openai-config.ts",
      "Web/src/modules/commands/services/command-interpreter.ts",
      "Web/src/modules/problems/services/cloud-problem-library.ts",
    ].map(async (path) => [
      path,
      createHash("sha256")
        .update(await readFile(new URL("../../" + path, import.meta.url)))
        .digest("hex"),
    ]),
  ),
);
await writeFile(
  directory + "prompts.json",
  JSON.stringify(
    {
      sourceHashes,
      modelSettings: { store: false, max_output_tokens: 2400, reasoning: null },
      visualReview: "Pending human or agent inspection of captured screenshots",
      LIVE_MODEL,
      COMMAND_MODEL,
      commandInstructionsFor,
      interpretationSchema,
      previewTools,
      voiceInstructions,
      interpretationInstructions,
      fixtures,
      source: "macOS synthetic Daniel recording; not a student recording",
    },
    null,
    2,
  ),
);
const guest = await fetch(`${origin}/api/account`, {
  method: "POST",
  headers: { Origin: origin },
});
assert(guest.ok, "Guest setup must succeed");
const cookies = guest.headers.getSetCookie().map((value) => {
  const pair = value.split(";")[0],
    index = pair.indexOf("=");
  return {
    name: pair.slice(0, index),
    value: pair.slice(index + 1),
    url: origin,
  };
});
const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
const read = async () =>
  (await (
    await fetch(`${origin}/api/problems`, { headers: { Cookie: cookie } })
  ).json()) as CloudSnapshot;
let snapshot = await read();
const setup = await fetch(`${origin}/api/problems`, {
  method: "POST",
  headers: {
    Cookie: cookie,
    Origin: origin,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    id: randomUUID(),
    revision: snapshot.revision,
    operation: {
      kind: "new",
      title: "Quadratic roots conversation evaluation",
    },
  }),
});
assert(setup.ok, "Isolated problem setup must succeed");
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const reports: object[] = [];
let failurePage: import("playwright").Page | undefined;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addCookies(cookies);
  await context.addInitScript(installVoiceFixture, `/evaluation-${turns[0].id}.wav`);
  await context.route("**/evaluation-*.wav", async (route) => {
    const id = /evaluation-(\w+)\.wav/.exec(route.request().url())![1];
    await route.fulfill({
      contentType: "audio/wav",
      body: await readFile(directory + id + ".wav"),
    });
  });
  const page = await context.newPage();
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/problems") && response.request().method() === "POST")
      reports.push({ response: await response.text().catch(() => "unreadable") });
  });
  failurePage = page;
  await page.goto(origin);
  await page.locator('.app-shell[data-ready="true"]').waitFor({ timeout: 30000 });
  let previous: string[] = [];
  for (const [index, turn] of turns.entries()) {
    const before = await read();
    if (index === 0)
      await page.getByRole("button", { name: "Start listening", exact: true }).click();
    else
      await page.evaluate(async (id) => {
        await (window as FixtureWindow).playEvaluationFixture!(`/evaluation-${id}.wav`);
      }, turn.id);
    await page.waitForFunction(
      (count) => {
        const completed = (performance.getEntriesByType("measure") as PerformanceMeasure[]).filter(
          (entry) => entry.detail?.stage === "display-commit",
        );
        return completed.length >= count;
      },
      index + 1,
      { timeout: 45000 },
    );
    if (turn.id === "roots" || turn.id === "hypotenuse") {
      await page.locator(".pico-confetti").waitFor({ timeout: 5000 });
      await page.screenshot({ path: directory + "roots-confetti.png" });
    }
    await waitForSpokenResult(page, previous);
    snapshot = await read();
    const problem = currentProblem(snapshot.book);
    const reply = await page.locator(".pico-reply").innerText();
    const events = await page.evaluate(() => (window as FixtureWindow).liveEvaluationEvents ?? []);
    previous = await page.evaluate(() =>
      (performance.getEntriesByType("measure") as PerformanceMeasure[])
        .filter((entry) => entry.detail?.stage === "commentary-sent")
        .map((entry) => entry.detail.id),
    );
    const screen = directory + turn.id + "-desktop.png";
    await page.screenshot({ path: screen });
    reports.push({
      id: turn.id,
      backendInstructions: commandInstructionsFor(
        problem.conversation?.at(-1)?.request ?? turn.text,
        currentProblem(before.book).state,
      ),
      interpretationSchema,
      previewTools,
      beforeSnapshot: before,
      afterSnapshot: snapshot,
      before: currentProblem(before.book).state.expression,
      expression: problem.state.expression,
      steps: problem.steps.map((step) => step.state.expression),
      reply,
      events,
    });
    assert(
      !/open paren|close paren|\bchecking[.!]|\bprocessing[.!]/i.test(reply),
      "Reply must avoid punctuation names and canned progress filler",
    );
    if (turn.id === "introduce") assert.equal(problem.state.expression, "x^2 + 3 * x + 2");
    if (turn.id === "factor")
      assert(
        /\(x \+ [12]\) \* \(x \+ [12]\)/.test(problem.state.expression),
        "Factored expression must be written",
      );
    if (turn.id === "roots" || turn.id === "hypotenuse") {
      if (turn.id === "roots") {
        assert.deepEqual(
          problem.steps.slice(-2).map((step) => step.state.expression),
          ["x = -2", "x = -1"],
        );
        assert(
          problem.state.retainedGraph?.rows.some((row) => row.expression.includes("x")),
          "Original graph must be retained",
        );
      } else assert.equal(problem.state.expression, "h = 5");
      await page
        .getByRole("status")
        .filter({ hasText: "Solution verified." })
        .waitFor({ timeout: 5000 });
      await page.screenshot({ path: directory + "roots-completion.png" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: directory + "roots-mobile.png" });
    }
  }
  console.log(
    "PASS: connected recorded Live turns write the polynomial, factor it and record/celebrate both roots.",
    directory,
  );
} catch (error) {
  if (failurePage) {
    await failurePage.screenshot({ path: directory + "failure.png" });
    reports.push({
      failure: String(error),
      snapshot: await read(),
      events: await failurePage.evaluate(
        () => (window as FixtureWindow).liveEvaluationEvents ?? [],
      ),
    });
  }
  throw error;
} finally {
  await writeFile(directory + "report.json", JSON.stringify({ reports }, null, 2));
  await browser.close();
}
