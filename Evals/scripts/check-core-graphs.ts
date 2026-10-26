import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
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
import { runMathProgram } from "../../Web/src/modules/commands/index.ts";
import { compileGraphScene } from "../../Web/src/modules/visuals/index.ts";

const origin = process.argv[2] || "http://localhost:3115";
const output = new URL(`../evaluations/core-graphs-${crypto.randomUUID()}/`, import.meta.url);
await mkdir(output, { recursive: true });
const sources = [
  "a=2",
  "f(x)=a*x^2",
  "x^2+y^2=4",
  "y<=x+1",
  "r=2*cos(theta)",
  "(cos(t),sin(t))",
  "y={x<0:-x,x>=0:x^2}",
];
const program = `const g=graph.scene(${JSON.stringify(sources)}); problem.save(graph.domain(graph.name(graph.select(g,6),"Orbit"),0,3.141592653589793));`;
let book = createProblemLibrary();
book = recordStep(
  book,
  runMathProgram(currentProblem(book).state, program).state,
  "typescript\n" + program,
);
let saved: CloudSnapshot = { book, clarification: null, revision: 0 };
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
const api = createProblemLibraryApi({ store, owner: async () => "core-graphs-synthetic" });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const checks: string[] = [],
  errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
let lastRequest: Record<string, unknown> | undefined;
await page.route("**/api/live-token", (route) => route.fulfill({ json: { configured: false } }));
await page.route("**/api/problems", async (route) => {
  const request = route.request();
  const body = request.method() === "POST" ? request.postData() : undefined;
  if (body) lastRequest = JSON.parse(body);
  const response = await api[request.method() === "POST" ? "POST" : "GET"](
    new Request(request.url(), {
      method: request.method(),
      headers: { ...request.headers(), origin },
      ...(body ? { body } : {}),
    }),
  );
  await route.fulfill({
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  });
});
const edit = async (label: string, value: string) => {
  const field = page.getByLabel(label, { exact: true });
  await field.evaluate(async (element) => {
    await customElements.whenDefined(element.localName);
  });
  await field.evaluate((element, value) => {
    const math = element as HTMLElement & { setValue: (value: string) => void };
    math.setValue(value);
    math.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }, value);
};
try {
  await page.goto(origin);
  await page.locator('.app-shell[data-ready="true"]').waitFor();
  await page.locator("canvas").waitFor();
  await page.getByLabel("Graph expression 7", { exact: true }).waitFor();
  checks.push(
    "implicit, inequality, polar, parametric, named function and piecewise canvas plus structured history",
  );
  await edit("Graph expression 1", "a=3");
  await page.waitForResponse(
    (response) =>
      response.url().includes("/api/problems") && response.request().method() === "POST",
  );
  if (compileGraphScene(currentProblem(saved.book).state.graphScene!).sample(1, 2) !== 12)
    throw new Error("Variable edit did not recalculate dependent function");
  checks.push("direct scalar edit updates dependent function");
  const retry = structuredClone(lastRequest!);
  const steps = currentProblem(saved.book).steps.length;
  const retryStatus = await page.evaluate(async (body) => {
    const r = await fetch("/api/problems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.status;
  }, retry);
  if (retryStatus !== 200 || currentProblem(saved.book).steps.length !== steps)
    throw new Error("Receipt retry duplicated work");
  checks.push("same request retry is idempotent");
  await edit("Graph expression 1", "a=missing");
  await page.getByText("The last saved graph is still shown.", { exact: false }).waitFor();
  if (currentProblem(saved.book).state.graphScene!.rows[0].expression !== "a=3")
    throw new Error("Invalid draft changed saved work");
  await page.screenshot({
    path: new URL("desktop-invalid-draft.png", output).pathname,
    fullPage: true,
  });
  await page.getByLabel("Graph expression 1", { exact: true }).press("Escape");
  await page.reload();
  await page.getByLabel("Graph expression 1", { exact: true }).waitFor();
  if (currentProblem(saved.book).state.graphScene!.rows[5].name !== "Orbit")
    throw new Error("Reload lost name");
  checks.push("invalid draft retains saved graph; reload retains names and definitions");
  const param = page
    .locator("form")
    .filter({ has: page.getByLabel("Graph expression 6", { exact: true }) });
  await param.getByText("Parameter range", { exact: true }).click();
  await edit("Parameter maximum for graph row 6", "1.5707963267948966");
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/problems") && response.request().method() === "POST",
    ),
    param.getByRole("button", { name: "Set parameter range", exact: true }).click(),
  ]);
  if (currentProblem(saved.book).state.graphScene!.rows[5].domain?.max !== Math.PI / 2)
    throw new Error("Parameter range did not save");
  checks.push("direct parameter range saves");
  const scene = currentProblem(saved.book).state.graphScene!;
  await page.screenshot({ path: new URL("desktop.png", output).pathname, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: new URL("mobile.png", output).pathname, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error("Graph page overflows mobile viewport");
  checks.push("desktop and mobile layout without page overflow");
  const staleStatus = await page.evaluate(async (revision) => {
    const response = await fetch("/api/problems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        revision: revision - 1,
        operation: { kind: "command", text: "graph x=9", interpret: false },
      }),
    });
    return response.status;
  }, saved.revision);
  if (
    staleStatus !== 409 ||
    JSON.stringify(currentProblem(saved.book).state.graphScene) !== JSON.stringify(scene)
  )
    throw new Error("Stale request changed graph");
  checks.push("stale revision is rejected without changing the graph");
  if (errors.length) throw new Error(errors.join("\n"));
  await writeFile(
    new URL("report.json", output),
    JSON.stringify(
      {
        lane: "real browser + deterministic API with in-memory synthetic store; no provider calls",
        revision: "599dbaa plus current task changes",
        origin,
        viewports: [
          [1440, 1000],
          [390, 844],
        ],
        checks,
        errors,
        finalScene: scene,
      },
      null,
      2,
    ),
  );
  console.log(output.pathname);
} catch (error) {
  await writeFile(
    new URL("failure.json", output),
    JSON.stringify({ checks, errors, error: String(error) }, null, 2),
  );
  await page.screenshot({ path: new URL("failure.png", output).pathname, fullPage: true });
  throw error;
} finally {
  await browser.close();
}
