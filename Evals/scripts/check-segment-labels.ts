import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
} from '../../Web/src/modules/problems/index.ts';
import { runCommand } from '../../Web/src/modules/commands/index.ts';
const origin = process.argv[2] || 'http://localhost:5173';
const source = 'A=point(0,0)\nB=point(3,0)\nC=point(0,4)\ndraw triangle(A,B,C)';
let book = createProblemLibrary();
const command =
  'typescript\nproblem.save(geometry.construct(' +
  JSON.stringify(source) +
  '));';
book = recordStep(
  book,
  runCommand(currentProblem(book).state, command).state,
  command,
);
const snapshot = { book, clarification: null, revision: 1 };
const output = new URL(
  `../evaluations/segment-labels-${crypto.randomUUID()}/`,
  import.meta.url,
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks: string[] = [];
let failure: string | undefined;
try {
  const page = await browser.newPage();
  await page.route('**/api/problems', (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.goto(origin);
  await page.locator('.app-shell[data-ready="true"]').waitFor();
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const length of ['3', '4', '5'])
      await page
        .locator('.learnunlock-canvas')
        .getByText(length, { exact: true })
        .first()
        .waitFor();
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error('Horizontal overflow');
    await page.screenshot({
      path: new URL(`${viewport.width}.png`, output).pathname,
    });
    checks.push(
      `${viewport.width}x${viewport.height}: finite triangle edges show 3, 4 and 5 with no page overflow`,
    );
  }
} catch (error) {
  failure = String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(
    new URL('report.json', output),
    JSON.stringify(
      {
        scope:
          'Mocked synthetic problem; actual geometry engine and browser renderer. No paid provider.',
        checks,
        failure,
        passed: !failure,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ output: output.pathname, checks, failure }));
}
