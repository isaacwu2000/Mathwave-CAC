import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  createProblemLibrary,
  updateProblem,
} from '../../Web/src/modules/problems/index.ts';

type Problem = Parameters<Parameters<typeof updateProblem>[1]>[0];
type Sample = {
  scenario: string;
  variant: string;
  text: string;
  attempted: boolean;
  passed?: boolean;
  after?: Problem;
  message?: string;
  previews?: { after: Problem }[];
};
const [origin, directory] = process.argv.slice(2);
if (
  !origin ||
  !directory ||
  !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)
)
  throw new Error(
    'Supply an isolated loopback app and a saved report directory.',
  );
const raw = await readFile(directory + '/report.json', 'utf8');
const report = JSON.parse(raw) as { samples: Sample[] };
const output = directory + '/visual';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const reviews: Record<string, unknown>[] = [];
let failure: string | undefined;
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 760 },
  });
  const guest = await page.request.post(origin + '/api/account', {
    headers: { Origin: origin },
  });
  if (!guest.ok()) throw new Error('Guest setup failed: ' + guest.status());
  await page.route('**/api/live-token', (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  let snapshot: unknown;
  await page.route('**/api/problems', (route) =>
    route.fulfill({ json: snapshot }),
  );
  const frames = report.samples.flatMap((sample) => [
    ...(sample.previews || []).map((preview, i) => ({
      ...sample,
      after: preview.after,
      scenario: sample.scenario + '-preview-' + (i + 1),
    })),
    sample,
  ]);
  for (const [index, sample] of frames.entries()) {
    if (!sample.attempted || !sample.after) continue;
    const after = sample.after;
    const book = updateProblem(createProblemLibrary(), (p) => ({
      ...after,
      id: p.id,
    }));
    snapshot = {
      book,
      clarification: null,
      revision: 1,
      status: sample.passed ? 'command' : 'clarification',
      message: sample.message,
    };
    await page.goto(origin);
    await page.locator('.app-shell[data-ready="true"]').waitFor();
    const visual = after.state.graph || after.state.mode === 'geometry';
    if (visual)
      await page.locator('.learnunlock-canvas canvas').first().waitFor();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const stem = `${String(index).padStart(2, '0')}-${sample.variant}-${sample.scenario}`;
    const screenshot = output + '/' + stem + '.png';
    await page.screenshot({ path: screenshot, fullPage: true });
    reviews.push({
      scenario: sample.scenario,
      variant: sample.variant,
      text: sample.text,
      passed: sample.passed,
      screenshot,
      viewport: { width: 1000, height: 760 },
      reviewed: false,
    });
    console.log(JSON.stringify({ captured: stem }));
  }
} catch (error) {
  failure = String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(
    output + '/review.json',
    JSON.stringify(
      {
        scope:
          'Actual browser rendering of every captured provider outcome. Saved synthetic report data is replayed through a mocked problem API; no provider calls or student data. Capture alone is not visual review.',
        reportSha256: createHash('sha256').update(raw).digest('hex'),
        reviews,
        failure,
      },
      null,
      2,
    ),
  );
}
