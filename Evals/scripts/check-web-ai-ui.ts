import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  type CloudSnapshot,
} from '../../Web/src/modules/problems/index.ts';
import {
  createProblemLibraryApi,
  type Receipt,
  type ProblemLibraryStore,
} from '../../Web/src/modules/problems/server/cloud-api.ts';
import { runCommand } from '../../Web/src/modules/commands/index.ts';

// The actual browser UI and problem API use private in-memory work; no provider or student data.
const origin = process.argv[2] || 'http://localhost:3067';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const output = new URL(
  `../evaluations/web-ai-ui-${crypto.randomUUID()}/`,
  import.meta.url,
);
await mkdir(output, { recursive: true });
let book = createProblemLibrary();
for (const text of ['write 2*x+3=11', 'graph y=x^2'])
  book = recordStep(
    book,
    runCommand(currentProblem(book).state, text).state,
    text,
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
const api = createProblemLibraryApi({
  store,
  owner: async () => 'web-ai-ui-synthetic',
});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors: string[] = [],
  checks: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(15000);
await page.route('**/api/live-token', (route) =>
  route.fulfill({ json: { configured: false } }),
);
let delayNext = false;
await page.route('**/api/problems', async (route) => {
  const request = route.request(),
    body = request.postData();
  if (body && delayNext) {
    delayNext = false;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  const response = await api[request.method() === 'POST' ? 'POST' : 'GET'](
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
const geometry = () =>
  page.locator('.graph-card').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      viewport: innerHeight,
    };
  });
try {
  await page.goto(origin);
  await page.locator('.app-shell[data-ready="true"]').waitFor();
  await page.locator('.graph-card canvas').waitFor();
  await page.getByRole('button', { name: 'Hide graph', exact: true }).waitFor();
  if (await page.locator('.step-branch').count())
    throw new Error('Fork control remains');
  const mobile = await geometry();
  if (Math.abs(mobile.height - 422) > 2 || Math.abs(mobile.y - 422) > 2)
    throw new Error(
      `Mobile panel is not the bottom half: ${JSON.stringify(mobile)}`,
    );
  const edit = page.getByLabel('Graph expression 1', { exact: true });
  await edit.evaluate(async (element) => {
    await customElements.whenDefined(element.localName);
  });
  await page.screenshot({ path: new URL('mobile-open.png', output).pathname });
  const canvas = await page.locator('.graph-card canvas').elementHandle();
  await page.getByRole('button', { name: 'Hide graph', exact: true }).click();
  if (await page.locator('.graph-panel-body').isVisible())
    throw new Error('Collapsed graph is still visible');
  await page.screenshot({
    path: new URL('mobile-collapsed.png', output).pathname,
  });
  await page.getByRole('button', { name: 'Show graph', exact: true }).focus();
  await page.keyboard.press('Enter');
  if (
    !(await page.evaluate(
      (element) => element === document.querySelector('.graph-card canvas'),
      canvas,
    ))
  )
    throw new Error('Toggle remounted canvas');
  checks.push(
    '390x844: graph occupies the bottom half; collapse and keyboard expansion retain the canvas. Fork control is absent.',
  );
  delayNext = true;
  await edit.focus();
  await edit.evaluate((element) => {
    (element as HTMLElement & { setValue(value: string): void }).setValue(
      'x^2+3',
    );
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Hide graph', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.focus-save')?.textContent?.startsWith('Saved'),
  );
  await page
    .getByRole('button', { name: 'Focus step 3: x^2 + 3', exact: true })
    .waitFor();
  if (saved.revision === 0)
    throw new Error('Graph edit did not reach the problem API');
  if (
    !(await page
      .getByRole('button', { name: 'Show graph', exact: true })
      .isVisible())
  )
    throw new Error('Saving reopened collapsed panel');
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (!(await page.locator('.graph-panel-body').isVisible()))
    throw new Error('Desktop graph hidden by mobile collapse');
  const desktop = await geometry();
  if (desktop.x !== 0 || desktop.width !== 720 || desktop.height !== 1000)
    throw new Error(`Desktop layout changed: ${JSON.stringify(desktop)}`);
  await page.screenshot({ path: new URL('desktop.png', output).pathname });
  checks.push(
    'An equation/graph edit saves while the sheet is collapsed; resize to desktop retains the full left-half graph.',
  );
  await page.reload();
  await page.locator('.app-shell[data-ready="true"]').waitFor();
  await page.getByLabel('Graph expression 1', { exact: true }).waitFor();
  if (currentProblem(saved.book).state.expression !== 'x^2 + 3')
    throw new Error('Graph edit did not persist');
  await page.locator('.graph-card canvas').waitFor();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.screenshot({ path: new URL('mobile-small.png', output).pathname });
  await page.setViewportSize({ width: 844, height: 390 });
  const equation = await page
    .locator('.equation-step[aria-current]')
    .boundingBox();
  if (!equation || equation.y + equation.height > 195)
    throw new Error('Landscape equation is hidden behind the graph');
  await page.screenshot({
    path: new URL('mobile-landscape.png', output).pathname,
  });
  checks.push(
    'Edited graph survives reload; captured 320x640 and 844x390 layouts. Provider and persistence transport are synthetic.',
  );
  if (errors.length) throw new Error(errors.join('; '));
  await writeFile(
    new URL('report.json', output),
    JSON.stringify(
      {
        revision,
        workingChanges: true,
        origin,
        checks,
        mobile,
        desktop,
        errors,
        provider: 'not called',
        persistence: 'in memory',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ output: output.pathname, checks }));
} catch (error) {
  await page.screenshot({ path: new URL('failure.png', output).pathname });
  await writeFile(
    new URL('failure.json', output),
    JSON.stringify({ error: String(error), errors, checks }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
