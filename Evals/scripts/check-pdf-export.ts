import { chromium } from "playwright";
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  startProblem,
} from "../../Web/src/modules/problems/index.ts";
import { runCommand } from "../../Web/src/modules/commands/index.ts";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.argv[2] || "http://localhost:3047";
const output = new URL("../../output/pdf-export/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
let book = createProblemLibrary();
for (const [name, commands] of [
  ["Algebra steps", ["write 2*x+3=11", "write 2*x=8", "write x=4"]],
  ["Fractions and roots", ["write (x+1)/3=sqrt(16)", "write x=11"]],
  ["Parabola", ["graph x^2"]],
  ["Triangle", ["triangle a 3 b 4 c 5", "write h^2=3^2+4^2"]],
  ["Statistics", ["data 2, 4, 4, 6, 9"]],
] as const) {
  if (currentProblem(book).steps.length) book = startProblem(book, name);
  else currentProblem(book).title = name;
  for (const command of commands) {
    const result = runCommand(currentProblem(book).state, command);
    if (name === "Statistics") {
      // Switching modes can retain a previous figure in storage; it must stay hidden here.
      result.state.graph = true;
      result.state.geometry = { shape: "triangle", dimensions: { a: 3, b: 4, c: 5 } };
    }

    book = recordStep(book, result.state, command);
  }
}
book = startProblem(book, "Implicit circle and inequality");
book = recordStep(
  book,
  {
    ...currentProblem(book).state,
    expression: "x^2+y^2=9",
    graph: true,
    graphScene: { rows: [{ expression: "x^2+y^2=9" }, { expression: "y>x" }] },
  },
  "write x=1",
  "Graph a circle and shade y > x",
);
book = startProblem(book, "Many steps");
for (let i = 1; i <= 24; i++)
  book = recordStep(book, { ...currentProblem(book).state, expression: `x=${i}` }, `write x=${i}`);
book = startProblem(book, "Empty problem");
book.draft = "A saved draft.";
const before = JSON.stringify(book);

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  await context.route("**/api/account", (r) =>
    r.fulfill({
      json: {
        identity: { kind: "development", owner: "pdf-export-test", verified: true },
        allowanceMs: 600000,
        remainingMs: 600000,
        resetsAt: null,
        authConfigured: true,
      },
    }),
  );
  await context.route("**/api/live-token", (r) => r.fulfill({ json: { configured: false } }));
  await context.route("**/api/problems", (r) =>
    r.fulfill({ json: { book, revision: 0, clarification: null } }),
  );
  const page = await context.newPage();
  let verifiedFonts: unknown;
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("CONSOLE", m.text().slice(0, 400));
  });
  await page.addInitScript(
    ({ id }) => {
      sessionStorage.setItem(
        `math-audio-unsent-draft:pdf-export-test:${id}`,
        "Latest recovered draft.",
      );
    },
    { id: book.problemId },
  );
  await page.goto(origin);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Your problems and account" }).click();
  await page.getByRole("button", { name: "All problems PDF", exact: true }).waitFor();
  await page.screenshot({ path: `${output}settings-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  for (const [label, name] of [
    ["All problems PDF", "all"],
    ["Current problem PDF", "current"],
    ["Export Algebra steps as PDF", "algebra"],
  ] as const) {
    const dl = page.waitForEvent("download", { timeout: 120000 });
    await page.getByRole("button", { name: label, exact: true }).click();
    if (name === "all") {
      await page.locator(".problem-pdf-sheet math").first().waitFor({ state: "attached" });
      await page.evaluate(() => document.fonts.ready);
      verifiedFonts = await page
        .locator(".problem-pdf-sheet:has(.pdf-equation-content > math:only-child)")
        .evaluate((sheet) => {
          const number = sheet.querySelector(".pdf-step-number")!.getBoundingClientRect();
          const equation = sheet.querySelector("math")!.getBoundingClientRect();
          return {
            background: getComputedStyle(sheet).backgroundColor,
            appBackground: getComputedStyle(document.body).backgroundColor,
            numberCenterDelta: Math.abs(
              number.top + number.height / 2 - equation.top - equation.height / 2,
            ),
            text: getComputedStyle(sheet).fontFamily,
            math: getComputedStyle(sheet.querySelector("math")!).fontFamily,
            textLoaded: document.fonts.check('18px "Instrument Sans"'),
            mathLoaded: document.fonts.check('25px "STIX Two Math"'),
          };
        });
      const fonts = verifiedFonts as {
        background: string;
        appBackground: string;
        numberCenterDelta: number;
        text: string;
        math: string;
        textLoaded: boolean;
        mathLoaded: boolean;
      };
      assert.match(fonts.text, /Instrument Sans/);
      assert.match(fonts.math, /STIX Two Math/);
      assert.ok(fonts.textLoaded && fonts.mathLoaded);
      assert.equal(fonts.background, fonts.appBackground);
      assert.ok(
        fonts.numberCenterDelta < 1,
        "Step number must be vertically centered beside its equation",
      );
    }
    const download = await Promise.race([
      dl,
      page
        .getByText("Couldn’t create the PDF. Your work is safe. Try again.", { exact: true })
        .waitFor({ timeout: 120000 })
        .then(async () => {
          await page.screenshot({ path: `${output}failed.png`, fullPage: true });
          throw new Error("Export failed");
        }),
    ]);
    await download.saveAs(`${output}${name}.pdf`);
    console.log("Downloaded", download.suggestedFilename());
  }
  await page
    .getByRole("button", { name: "All problems PDF", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Current problem PDF", exact: true })
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  assert.equal(
    await page.getByRole("button", { name: "Current problem PDF", exact: true }).isVisible(),
    true,
  );
  await page.screenshot({ path: `${output}settings-mobile.png`, fullPage: true });
  assert.equal(await page.locator(".problem-pdf-host").count(), 0);
  assert.equal(JSON.stringify(book), before);
  const mobileDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Current problem PDF", exact: true }).click();
  await (await mobileDownload).saveAs(`${output}mobile.pdf`);
  await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'));
  // Fail the real renderer, then verify export cleanup and retry through the same button.
  await page.evaluate(() => {
    const prototype = HTMLCanvasElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "getContext")!;
    const original: HTMLCanvasElement["getContext"] = descriptor.value;
    (window as Window & { restorePdfCanvas?: () => void }).restorePdfCanvas = () => {
      prototype.getContext = original;
    };
    prototype.getContext = function (this: HTMLCanvasElement, kind: string, options?: unknown) {
      if (/webgl/.test(kind)) return null;
      return Reflect.apply(original, this, [kind, options]);
    } as typeof original;
  });
  await page.getByRole("button", { name: "Export Parabola as PDF", exact: true }).click();
  await page
    .getByText("Couldn’t create the PDF. Your work is safe. Try again.", { exact: true })
    .waitFor({ timeout: 30000 });
  assert.equal(await page.locator(".problem-pdf-host").count(), 0);
  await page.screenshot({ path: `${output}error-mobile.png`, fullPage: true });
  await page.evaluate(() => {
    (window as Window & { restorePdfCanvas?: () => void }).restorePdfCanvas?.();
  });
  const retry = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Parabola as PDF", exact: true }).click();
  await (await retry).saveAs(`${output}retry.pdf`);
  await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'));
  await writeFile(
    `${output}checks.json`,
    JSON.stringify(
      {
        environment: "Local app with synthetic account and problem API",
        verifiedFonts,
        viewports: [
          { width: 1440, height: 1000 },
          { width: 390, height: 844 },
        ],
        checks: [
          "All-problem download",
          "Multiple recorded equation steps in order",
          "Instrument Sans text and STIX Two Math notation",
          "Current problem download",
          "Saved problem download without switching",
          "Mobile download",
          "Renderer failure and retry",
          "Temporary DOM cleanup",
          "Original library unchanged",
          "Saved work only: drafts, transcripts and generated descriptions excluded",
        ],
        visualReview: "Required separately: inspect every PDF page and captured app screenshots.",
      },
      null,
      2,
    ),
  );
  console.log("PDF export browser checks passed. Visual review remains separate.");
} finally {
  await browser.close();
}
