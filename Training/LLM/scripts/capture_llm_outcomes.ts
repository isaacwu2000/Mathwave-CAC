import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { captureScreenEvidence } from '../../../Evals/src/screen-evidence.ts';
import {
  currentProblem,
  restoreStep,
  type ProblemLibrary,
} from '../../../Web/src/modules/problems/index.ts';
import {
  workProjection,
  semanticallyEqual,
  type ExperimentRow,
  type PredictionGrade,
} from './grade_predictions.ts';

const mobile = { width: 390, height: 844 };
const desktop = { width: 1280, height: 900 };

type CapturePlan = {
  id: string;
  caseId: string;
  turn: number;
  stage: string;
  category: string;
  request: string;
  pass: boolean;
  reasons: string[];
  message?: string;
  expectedMessage: string;
  expectedState: unknown;
  expectedAssertions: ExperimentRow['expected']['assertions'];
  source: 'generated-outcome' | 'unchanged-prestate-no-executable-outcome';
  snapshots: {
    name: string;
    book: ProblemLibrary;
    viewports: (typeof mobile)[];
  }[];
};

/**
 * Maps every graded row to its visible saved work, without running inference.
 * - Includes newly saved intermediate graph/geometry states for progressive drawing review.
 * - Invalid outputs show the unchanged prestate, clearly labeled as a fallback.
 * - Tool previews and hidden spoken messages are not presented as visible app output.
 */
export function capturePlan(
  row: ExperimentRow,
  grade: PredictionGrade,
): CapturePlan {
  const book = grade.book ?? row.expected.before.book;
  const problem = currentProblem(book);
  const before = currentProblem(row.expected.before.book);
  const snapshots: CapturePlan['snapshots'] = [];
  const visual = (candidate: ProblemLibrary) => {
    const state = currentProblem(candidate).state;
    return (
      state.graph ||
      !!state.graphScene ||
      !!state.construction ||
      state.mode !== 'equation'
    );
  };
  if (grade.book) {
    // Corrections can replace earlier history; count shared states rather than
    // assuming every saved result extends the original number of steps.
    let retained = 0;
    while (
      retained < Math.min(before.steps.length, problem.steps.length) &&
      semanticallyEqual(
        before.steps[retained].state,
        problem.steps[retained].state,
      )
    )
      retained++;
    for (let number = retained + 1; number < problem.steps.length; number++) {
      const intermediate = restoreStep(structuredClone(book), number);
      if (!visual(intermediate)) continue;
      snapshots.push({
        name: `intermediate-step-${number}`,
        book: intermediate,
        viewports: [mobile, desktop],
      });
    }
  }
  snapshots.push({
    name: 'final',
    book,
    viewports: visual(book) ? [mobile, desktop] : [mobile],
  });
  return {
    id: row.id,
    caseId: row.caseId,
    turn: row.turn,
    stage: row.stage,
    category: row.category,
    request: row.request.request,
    pass: grade.pass,
    reasons: grade.reasons,
    message: grade.message,
    expectedMessage: row.expected.after.message,
    expectedState: currentProblem(row.expected.after.book).state,
    expectedAssertions: row.expected.assertions,
    source: grade.book
      ? 'generated-outcome'
      : 'unchanged-prestate-no-executable-outcome',
    snapshots,
  };
}

/** Escapes untrusted requests and model text in the static evidence index. */
function html(value: string | number | undefined | null) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
}

/**
 * Captures actual app pixels from isolated saved-state replay and writes a pending-review index.
 * - Uses one caller-owned loopback app; no inference or audio requests are sent.
 * - Refuses an existing output directory and reuses identical rendered work across rows.
 * - Browser capture and text assertions never mark a screenshot visually reviewed.
 */
export async function captureOutcomes(
  dataPath: string,
  gradesPath: string,
  origin: string,
  outputPath: string,
) {
  const address = new URL(origin);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(address.hostname) ||
    address.username ||
    address.password
  )
    throw new Error('Use an isolated loopback app origin.');
  const rows = (await readFile(dataPath, 'utf8'))
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as ExperimentRow);
  const grades = JSON.parse(await readFile(gradesPath, 'utf8')) as {
    results: PredictionGrade[];
  };
  const byId = new Map(grades.results.map((grade) => [grade.id, grade]));
  if (
    byId.size !== grades.results.length ||
    new Set(rows.map((row) => row.id)).size !== rows.length ||
    byId.size !== rows.length ||
    rows.some((row) => !byId.has(row.id))
  )
    throw new Error('Grades must uniquely cover every dataset row.');
  const directory = resolve(outputPath);
  await mkdir(directory);
  const manifest: {
    lane: string;
    visualReview: string;
    limitations: string[];
    sources: unknown;
    rows: unknown[];
    captureFailures: number;
  } = {
    lane: 'Actual local-app saved-state replay of conditional per-turn model outcomes.',
    visualReview:
      'incomplete: every image and graph must be inspected by a human or agent',
    limitations: [
      'No live microphone, STT, iPhone binary, streaming or latency acceptance.',
      'Normal spoken-only replies are retained as text in this index; this does not claim they appeared on screen.',
      'Invalid generations have no executable outcome; their unchanged prestate is labeled separately.',
      'Repeated identical saved work may share one image, with all row mappings retained.',
    ],
    sources: {
      dataPath: resolve(dataPath),
      gradesPath: resolve(gradesPath),
      dataSha256: createHash('sha256')
        .update(await readFile(dataPath))
        .digest('hex'),
      gradesSha256: createHash('sha256')
        .update(await readFile(gradesPath))
        .digest('hex'),
      origin,
      captureSourceSha256: createHash('sha256')
        .update(
          await readFile(new URL('./capture_llm_outcomes.ts', import.meta.url)),
        )
        .digest('hex'),
      screenEvidenceSourceSha256: createHash('sha256')
        .update(
          await readFile(
            new URL('../../../Evals/src/screen-evidence.ts', import.meta.url),
          ),
        )
        .digest('hex'),
    },
    rows: [],
    captureFailures: 0,
  };
  const save = () =>
    writeFile(
      resolve(directory, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
  await save();
  const browser = await chromium.launch({ headless: true });
  const images = new Map<
    string,
    Awaited<ReturnType<typeof captureScreenEvidence>>
  >();
  try {
    for (const row of rows) {
      const plan = capturePlan(row, byId.get(row.id)!);
      const { snapshots, ...details } = plan;
      const screenshots: unknown[] = [];
      const entry = { ...details, review: 'pending', screenshots };
      manifest.rows.push(entry);
      for (const snapshot of snapshots) {
        for (const viewport of snapshot.viewports) {
          const key = createHash('sha256')
            .update(
              JSON.stringify({ work: workProjection(snapshot.book), viewport }),
            )
            .digest('hex');
          const existing = images.get(key);
          if (existing) {
            screenshots.push({
              snapshot: snapshot.name,
              viewport,
              sharedImage: true,
              ...existing,
            });
            continue;
          }
          const page = await browser.newPage({ viewport });
          try {
            await page.route('**/api/live-token', (route) =>
              route.fulfill({ json: { configured: false } }),
            );
            await page.route('**/api/problems', (route) =>
              route.request().method() === 'GET'
                ? route.fulfill({
                    json: {
                      book: snapshot.book,
                      clarification: null,
                      revision: 1,
                    },
                  })
                : route.fulfill({
                    status: 409,
                    json: { error: 'Read-only screenshot replay.' },
                  }),
            );
            await page.goto(address.origin);
            await page
              .locator('.app-shell[data-ready="true"]')
              .waitFor({ timeout: 30_000 });
            await page.evaluate(() => document.fonts.ready);
            const problem = currentProblem(snapshot.book);
            // Inactive graph metadata can remain after a mode change. Wait only
            // when the rendered workspace actually exposes its graph panel.
            if (
              (await page.locator('.app-shell').getAttribute('data-graph')) ===
              'true'
            )
              await page
                .locator('.graph-card canvas')
                .first()
                .waitFor({ timeout: 15_000 });
            await page.waitForTimeout(300);
            const evidence = await captureScreenEvidence(
              page,
              directory,
              key.slice(0, 20),
              problem.state,
              problem.steps.length,
            );
            images.set(key, evidence);
            screenshots.push({
              snapshot: snapshot.name,
              viewport,
              sharedImage: false,
              ...evidence,
            });
          } catch (error) {
            manifest.captureFailures++;
            screenshots.push({
              snapshot: snapshot.name,
              viewport,
              captureError:
                error instanceof Error ? error.message : String(error),
            });
          } finally {
            await page.close();
          }
        }
      }
      await save();
      console.log(
        JSON.stringify({
          id: row.id,
          rowsCaptured: manifest.rows.length,
          uniqueImages: images.size,
        }),
      );
    }
  } finally {
    await browser.close();
    await save();
  }
  const cards = manifest.rows
    .map((value) => {
      const row = value as {
        id: string;
        caseId: string;
        request: string;
        expectedState: unknown;
        message?: string;
        expectedMessage: string;
        reasons: string[];
        source: CapturePlan['source'];
        pass: boolean;
        screenshots: {
          screenshot?: string;
          captureError?: string;
          snapshot: string;
          viewport: typeof mobile;
        }[];
      };
      return `<article><h2>${html(row.id)}</h2><p>${html(row.request)}</p><p><strong>Automatic grade: ${row.pass ? 'pass' : 'fail'}. Screenshot source: ${row.source === 'generated-outcome' ? 'generated outcome' : 'FALLBACK — unchanged prestate; no executable model outcome'}.</strong></p><p>${html(row.reasons.join(' '))}</p><p>Model reply: ${html(row.message)}</p><p>Reference reply: ${html(row.expectedMessage)}</p><details><summary>Expected math and grading notes</summary><pre>${html(JSON.stringify({ state: row.expectedState, reasons: row.reasons }, null, 2))}</pre></details><div class="images">${row.screenshots.map((image) => `<figure><figcaption>${html(image.snapshot)} · ${image.viewport.width}×${image.viewport.height} · pending review</figcaption>${image.screenshot ? `<a href="${html(image.screenshot.split('/').at(-1))}"><img loading="lazy" src="${html(image.screenshot.split('/').at(-1))}" width="${image.viewport.width}" alt="${html(row.id)} ${html(image.snapshot)}"></a>` : `<p>${html(image.captureError)}</p>`}</figure>`).join('')}</div></article>`;
    })
    .join('\n');
  await writeFile(
    resolve(directory, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Mathwave model outcome visual review</title><style>body{font:16px system-ui;margin:24px;background:#fff}article{padding:24px 0;border-top:1px solid #ddd}h2{overflow-wrap:anywhere}pre{white-space:pre-wrap}.images{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}figure{margin:0}img{max-width:100%;height:auto}figcaption{padding:8px 0;color:#555}</style><h1>Pending visual review</h1><p>Saved-state replay only. Inspect every mapped image and mathematical result before marking any row reviewed.</p>${cards}`,
    { flag: 'wx' },
  );
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [data, grades, origin, output] = process.argv.slice(2);
  if (!data || !grades || !origin || !output)
    throw new Error(
      'Usage: pnpm exec tsx capture_llm_outcomes.ts test.jsonl grades.json http://localhost:PORT NEW_OUTPUT_DIRECTORY',
    );
  const result = await captureOutcomes(data, grades, origin, output);
  if (result.captureFailures) process.exitCode = 1;
}
