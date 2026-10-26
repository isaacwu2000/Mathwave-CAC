import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import {
  interpretationInstructions,
  graphInterpretationInstructions,
  voiceInstructions,
  COMMAND_MODEL,
} from "../../Web/src/modules/ai/index.ts";
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  type CloudSnapshot,
} from "../../Web/src/modules/problems/index.ts";
import {
  createProblemLibraryApi,
  type Receipt,
  type ProblemLibraryStore,
} from "../../Web/src/modules/problems/server/cloud-api.ts";
import { runCommand } from "../../Web/src/modules/commands/index.ts";
import { interpretWithPrompt } from "../src/prompt-provider.ts";

// Four live text requests use private in-memory work; browser transport replays the captured answers.
if (process.env.RUN_LIVE_CHECK !== "true")
  throw new Error("Set RUN_LIVE_CHECK=true for four bounded live text checks.");
process.loadEnvFile(new URL("../../Web/.env", import.meta.url).pathname);
if (!process.env.OPENAI_API_KEY) throw new Error("Provider credentials unavailable.");
const origin = process.argv[2] || "http://localhost:5183";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Use an isolated local app.");
const output = new URL(`../evaluations/unavailable-features-${randomUUID()}/`, import.meta.url);
await mkdir(output, { recursive: true });
const sources = [
  "Web/src/modules/ai/config/unavailable-features.ts",
  "Web/src/modules/ai/config/openai-config.ts",
  "Web/src/modules/ai/config/interpretation.ts",
];
const hashes: Record<string, string> = {};
for (const source of sources)
  hashes[source] = createHash("sha256")
    .update(await readFile(new URL("../../" + source, import.meta.url)))
    .digest("hex");
await writeFile(
  new URL("prompts.json", output),
  JSON.stringify(
    {
      interpretationInstructions,
      graphInterpretationInstructions,
      voiceInstructions,
      model: COMMAND_MODEL,
      hashes,
    },
    null,
    2,
  ),
);
let initial = createProblemLibrary();
for (const text of ["write 2*x+3=11", "graph y=x^2"])
  initial = recordStep(initial, runCommand(currentProblem(initial).state, text).state, text);
const cases = [
  {
    id: "export",
    text: "Export this problem as a PDF file.",
    status: "unsupported",
    feature: /PDF|export/i,
  },
  {
    id: "network",
    text: "Email my current graph to my teacher.",
    status: "unsupported",
    feature: /email|send/i,
  },
  {
    id: "unknown-feature",
    text: "Use the feature I mentioned in another chat.",
    status: "clarification",
    feature: /which|what/i,
  },
  { id: "supported-zoom", text: "Zoom in on my graph.", status: "command", feature: /./ },
];
const previous = process.argv[3] ? JSON.parse(await readFile(process.argv[3], "utf8")).results : [];
const browser = await chromium.launch({ headless: true });
const results: object[] = [];
try {
  for (const example of cases) {
    const answer =
      previous.find((row: { id: string }) => row.id === example.id)?.answer ??
      (await interpretWithPrompt(
        example.text,
        { book: initial, clarification: null },
        interpretationInstructions,
        {
          model: COMMAND_MODEL,
          url: "https://api.openai.com/v1/responses",
          key: process.env.OPENAI_API_KEY,
        },
      ));
    const plan = answer.interpretation;
    const result: Record<string, unknown> = {
      id: example.id,
      text: example.text,
      expectedStatus: example.status,
      answer,
      passed: false,
      visualReview: "pending",
    };
    results.push(result);
    if (!plan) continue;
    let saved: CloudSnapshot = { book: structuredClone(initial), clarification: null, revision: 0 };
    const receipts = new Map<string, Receipt>();
    const store: ProblemLibraryStore = {
      async load() {
        return structuredClone(saved);
      },
      async receipt(_owner, id) {
        return receipts.get(id) ?? null;
      },
      async commit(_owner, id, revision, outcome, request) {
        if (revision !== saved.revision) return false;
        saved = { ...outcome, revision: revision + 1 };
        receipts.set(id, {
          request,
          result: structuredClone({ ...outcome, revision: saved.revision }),
        });
        return true;
      },
    };
    const api = createProblemLibraryApi({
      store,
      owner: async () => "unavailable-features-synthetic",
      interpret: async () => plan,
    });
    let submitted = false;
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route("**/api/live-token", (route) =>
      route.fulfill({ json: { configured: false } }),
    );
    await page.route("**/api/problems", async (route) => {
      const request = route.request();
      const body = request.postDataJSON();
      if (body?.operation?.kind === "command" && submitted) {
        await route.fulfill({ json: { ...saved, status: "reply", message: "" } });
        return;
      }
      if (body?.operation?.kind === "command") submitted = true;
      // A graph-editor submission triggers the real UI response flow using the evaluated request.
      if (body?.operation?.kind === "command")
        body.operation = { kind: "command", text: example.text, interpret: true };
      const response = await api[request.method() === "POST" ? "POST" : "GET"](
        new Request(request.url(), {
          method: request.method(),
          headers: { ...request.headers(), origin },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    });
    await page.goto(origin);
    await page.locator('.app-shell[data-ready="true"]').waitFor({ timeout: 30000 });
    const edit = page.locator('math-field[aria-label="Graph expression 1"]');
    await edit.waitFor();
    await edit.focus();
    await edit.evaluate((element) => {
      (element as HTMLElement & { setValue(value: string): void }).setValue("x^{2}+1");
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await page.waitForTimeout(200);
    await page.locator(".mathwave-brand").click();
    if (plan.message) await page.getByText(plan.message, { exact: true }).last().waitFor();
    else await page.waitForTimeout(500);
    await page.locator(".graph-card canvas").waitFor();
    await edit.press("Escape");
    await page.waitForTimeout(100);
    await page.screenshot({ fullPage: true, path: new URL(example.id + ".png", output).pathname });
    const state = currentProblem(saved.book).state;
    const unchanged = JSON.stringify(state) === JSON.stringify(currentProblem(initial).state);
    const passed =
      plan.status === example.status &&
      (example.status === "command"
        ? state.expression === "y = x^2" &&
          state.graphRange?.min === -5 &&
          state.graphRange.max === 5 &&
          state.graphYRange?.min === -5 &&
          state.graphYRange.max === 5
        : unchanged && example.feature.test(plan.message));
    Object.assign(result, {
      passed,
      unchanged,
      expression: state.expression,
      screenshot: example.id + ".png",
      viewport: "1280x900",
    });
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(
    new URL("report.json", output),
    JSON.stringify(
      {
        lane: "live text with captured-answer browser replay",
        recordedLiveVoice: "not run by this text runner",
        reusedAnswersFrom: process.argv[3] ?? null,
        results,
      },
      null,
      2,
    ),
  );
  console.log(output.pathname);
}

if (results.some((row) => !(row as { passed: boolean }).passed)) process.exitCode = 1;
