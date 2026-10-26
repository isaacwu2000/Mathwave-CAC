import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  createProblemLibrary,
  currentProblem,
  type CloudSnapshot,
} from "../../Web/src/modules/problems/index.ts";
import {
  createProblemLibraryApi,
  type ProblemLibraryStore,
} from "../../Web/src/modules/problems/server/cloud-api.ts";
import { runLocalAgent } from "../../Native/Engine/agent.ts";
import type { StudentConversation } from "../src/student-conversations.ts";

// Capture authored reference states in the actual app; transport is synthetic.
const origin = process.argv[2] ?? "http://127.0.0.1:3189";
const output = new URL(
  "../evaluations/student-conversations-v1-2026-10-22/visual/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
const cases = (
  await Promise.all(
    ["graphs", "geometry"].map(
      async (domain) =>
        JSON.parse(
          await readFile(
            new URL(`../inputs/student-conversations-v1/${domain}.json`, import.meta.url),
            "utf8",
          ),
        ) as StudentConversation[],
    ),
  )
)
  .flat()
  .filter((c) =>
    ["graph-viewport-then-translation", "geo-corresponding-angle-marks"].includes(c.id),
  );
const browser = await chromium.launch({ headless: true });
const captures = [];
try {
  for (const c of cases) {
    let book = createProblemLibrary();
    for (const [index, turn] of c.turns.entries()) {
      let previewed = false;
      const outcome = await runLocalAgent(book, turn.student, async () => {
        if (turn.previews?.length && !previewed) {
          previewed = true;
          return {
            calls: turn.previews.map((program, i) => ({
              id: `visual-preview-${i}`,
              name: "preview_math",
              arguments: JSON.stringify({ program, programs: [] }),
            })),
          };
        }
        return {
          answer: {
            status: turn.status ?? "command",
            programs: turn.programs,
            message: turn.message ?? "",
            presentation: null,
          },
        };
      });
      book = outcome.book;
      let saved: CloudSnapshot = { book, clarification: null, revision: 0 };
      const store: ProblemLibraryStore = {
        load: async () => structuredClone(saved),
        receipt: async () => null,
        commit: async (_owner, _id, revision, outcome) => {
          if (revision !== saved.revision) return false;
          saved = { ...outcome, revision: revision + 1 };
          return true;
        },
      };
      const api = createProblemLibraryApi({ store, owner: async () => "student-reference-visual" });
      for (const [viewport, width, height] of [
        ["desktop", 1440, 1000],
        ["mobile", 390, 844],
      ] as const) {
        const page = await browser.newPage({ viewport: { width, height } });
        await page.route("**/api/live-token", (route) =>
          route.fulfill({ json: { configured: false } }),
        );
        await page.route("**/api/problems", async (route) => {
          const request = route.request();
          const response = await api.GET(
            new Request(request.url(), { headers: { ...request.headers(), origin } }),
          );
          await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: await response.text(),
          });
        });
        await page.goto(origin);
        await page.locator('.app-shell[data-ready="true"]').waitFor({ timeout: 20000 });
        await page.locator("canvas, svg[aria-label]").first().waitFor({ timeout: 10000 });
        await page.waitForTimeout(450);
        const filename = `${c.id}-turn-${index + 1}-${viewport}.png`;
        await page.screenshot({ path: new URL(filename, output).pathname, fullPage: true });
        captures.push({
          case: c.id,
          turn: index + 1,
          student: turn.student,
          viewport: { width, height },
          filename,
          horizontalOverflow: await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          expression: currentProblem(book).state.expression,
        });
        await page.close();
      }
    }
  }
  await writeFile(
    new URL("captures.json", output),
    JSON.stringify(
      {
        lane: "Actual Web application; authored reference states; intercepted problem API with in-memory synthetic store; no model or audio provider calls.",
        captures,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ captures: captures.length, output: output.pathname }));
} finally {
  await browser.close();
}
