import { chromium, type BrowserContext } from 'playwright';
import { assessVoiceParity } from './voice-parity.ts';
import { installVoiceFixture, type FixtureWindow } from './voice-fixture.ts';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  currentProblem,
  type CloudSnapshot,
} from '../../Web/src/modules/problems/index.ts';
import type { JourneySample, JourneyTiming } from './journey-evaluation.ts';

type Clip = { voice: string; case: string; audio: string; sha256: string };

/** Replays checksum-verified fixtures through the real browser voice path; never opens a microphone.
 * Saves failures and missing observations. Only the supplied isolated app is changed.
 */
export async function captureVoiceJourneys(
  origin: string,
  read: () => Promise<CloudSnapshot>,
  record: (sample: JourneySample & Record<string, unknown>) => void,
  voice = 'Daniel',
  cookies: { name: string; value: string; url: string }[] = [],
) {
  const manifest = JSON.parse(
    await readFile(
      new URL('../../Web/public/demo-voices/manifest.json', import.meta.url),
      'utf8',
    ),
  ) as Clip[];
  const clips = ['equation', 'step'].map((name) =>
    manifest.find((c) => c.voice === voice && c.case === name)!,
  );
  for (const clip of clips) {
    const bytes = await readFile(
      fileURLToPath(new URL(`../../Web/public${clip.audio}`, import.meta.url)),
    );
    if (createHash('sha256').update(bytes).digest('hex') !== clip.sha256)
      throw new Error('Audio checksum mismatch.');
  }
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await context.addCookies(cookies);
    // Inject only the input device. Recognition, WebRTC, models, saves and rendering remain real.
    await context.addInitScript(installVoiceFixture, clips[0].audio);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(origin);
    await page
      .locator('.app-shell[data-ready="true"]')
      .waitFor({ timeout: 30000 });

    const timings = async (): Promise<JourneyTiming[]> =>
      page.evaluate(() =>
        (performance.getEntriesByType('measure') as PerformanceMeasure[])
          .filter((e) => e.name.startsWith('math-audio:journey:'))
          .map((e) => ({
            stage: e.detail.stage,
            id: e.detail.id,
            kind: e.detail.kind,
            duration: e.duration,
          })),
      );
    let seen = new Set<string>();
    for (const [index, scenario] of [
      'cold-equation',
      'warm-step',
      'reconnected-equation',
    ].entries()) {
      const clip = clips[index === 1 ? 1 : 0];
      const start = performance.now();
      const traceStart = await page.evaluate(() => performance.now());
      let passed = false;
      let error: string | undefined;
      let rows: JourneyTiming[] = [];
      let expression: string | null = null;
      let parity: ReturnType<typeof assessVoiceParity> | undefined;
      const before = await read();
      const expected =
        index === 1 ? '2 * x + 3 - 3 = 11 - 3' : '2 * x + 3 = 11';
      try {
        if (index === 0)
          await page
            .getByRole('button', { name: 'Start listening', exact: true })
            .click();
        else {
          if (index === 2)
            await page
              .locator('#voice-status')
              .filter({ hasText: 'monitoring' })
              .waitFor({ timeout: 20000 });
          if (
            index === 1 &&
            !(await page.locator('#voice-status').innerText()).includes(
              'connected',
            )
          ) {
            error = 'Warm connection was not available.';
            throw new Error(error);
          }
          await page.evaluate(async (audio) => {
            await (window as FixtureWindow).playEvaluationFixture!(audio);
          }, clip.audio);
        }
        await page.waitForFunction(
          (previous) => {
            const entries = performance.getEntriesByType(
              'measure',
            ) as PerformanceMeasure[];
            return entries.some(
              (e) =>
                e.detail?.stage === 'commentary-sent' &&
                !previous.includes(e.detail.id),
            );
          },
          [...seen],
          { timeout: 45000 },
        );
        const all = await timings();
        const id = all.find(
          (e) => e.stage === 'commentary-sent' && !seen.has(e.id!),
        )!.id!;
        await page.waitForFunction(
          (requestId) =>
            (
              performance.getEntriesByType('measure') as PerformanceMeasure[]
            ).some(
              (e) =>
                e.detail?.id === requestId &&
                e.detail.stage === 'display-commit',
            ),
          id,
          { timeout: 10000 },
        );
        // Audio has no result ID. Missing audio stays explicit instead of becoming zero latency.
        await page
          .waitForFunction(
            (requestId) =>
              (
                performance.getEntriesByType('measure') as PerformanceMeasure[]
              ).some(
                (e) =>
                  e.detail?.id === requestId &&
                  e.detail.stage === 'next-audio-observed',
              ),
            id,
            { timeout: 1500 },
          )
          .catch(() => {});
        const resultAt = await page.evaluate((requestId) => {
          const result = (
            performance.getEntriesByType('measure') as PerformanceMeasure[]
          ).find(
            (e) =>
              e.detail?.id === requestId &&
              e.detail.stage === 'commentary-sent',
          )!;
          return result.startTime + result.duration;
        }, id);
        // Wait for a real spoken reply and its return to silence, not just a saved equation.
        await page.waitForFunction(
          (offset) => {
            const observations =
              (window as FixtureWindow).voiceObservations?.filter(
                (o) => o.at >= offset,
              ) ?? [];
            const last = observations.at(-1);
            return (
              observations.some((o) => o.audible && o.speaking && o.expected) &&
              last &&
              !last.audible &&
              !last.speaking &&
              last.settled
            );
          },
          resultAt,
          { timeout: 30000 },
        );
        parity = assessVoiceParity(
          await page.evaluate(
            (offset) =>
              (window as FixtureWindow).voiceObservations?.filter(
                (o) => o.at >= offset,
              ) ?? [],
            traceStart,
          ),
        );
        rows = (await timings()).filter((e) => e.id === id);
        const snapshot = await read();
        expression = currentProblem(snapshot.book).state.expression;
        const connectionMatches =
          rows.some((e) => e.stage === 'connection') === (index !== 1);
        passed =
          expression === expected &&
          snapshot.revision > before.revision &&
          connectionMatches &&
          parity.passed &&
          pageErrors.length === 0;
        if (!parity.passed) error = parity.failures.join(' ');
        if (pageErrors.length) error = pageErrors.join(' ');
        if (!connectionMatches)
          error = 'Observed connection did not match the scenario.';
        if (!passed)
          error ??= 'Saved equation did not match the fixture scenario.';
      } catch {
        error ??=
          'Voice, backend, or display milestone did not complete before its deadline.';
        rows = (await timings()).filter((e) => !seen.has(e.id!));
      }
      const point = (stage: string) =>
        rows.find((e) => e.stage === stage && e.kind === 'milestone')?.duration;
      const lastSignal = point('last-input-signal');
      const displayed = point('display-commit');
      const responseLatency =
        lastSignal !== undefined && displayed !== undefined
          ? displayed - lastSignal
          : null;
      record({
        scenario,
        parity,
        pageErrors: [...pageErrors],
        providerEvents: await page.evaluate(
          (offset) =>
            (window as FixtureWindow).liveEvaluationEvents?.filter(
              (event) => event.at >= offset,
            ),
          traceStart,
        ),
        audio: clip.audio,
        sha256: clip.sha256,
        passed,
        expectedExpression: expected,
        expression,
        failure: error,
        elapsedMs: responseLatency ?? performance.now() - start,
        responseLatencyMs: responseLatency,
        harnessElapsedMs: performance.now() - start,
        timings: rows,
        audioObserved: rows.some((e) => e.stage === 'next-audio-observed'),
        connectionObserved: rows.some((e) => e.stage === 'connection'),
      });
      seen = new Set((await timings()).map((e) => e.id!));
      // Reconnection is independent, so a missing warm connection does not hide its result.
    }
    const stop = page.getByRole('button', {
      name: 'Stop listening',
      exact: true,
    });
    const idle = (await page.locator('#voice-status').innerText()).includes(
      'monitoring',
    );
    const closed = (await timings()).filter(
      (e) => e.stage === 'session-closed',
    ).length;
    if (await stop.count()) await stop.click();
    await page
      .getByRole('button', { name: 'Start listening', exact: true })
      .waitFor();
    await page.waitForFunction(
      () => !document.querySelector('.audio-transcript')?.textContent?.trim(),
      undefined,
      { timeout: 1000 },
    );
    if (
      !idle &&
      !(await page.locator('#voice-status').innerText()).includes('monitoring')
    )
      await page.waitForFunction(
        (count) =>
          (
            performance.getEntriesByType('measure') as PerformanceMeasure[]
          ).filter((e) => e.detail?.stage === 'session-closed').length > count,
        closed,
        { timeout: 15000 },
      );
  } finally {
    try {
      await context?.close();
    } finally {
      await browser.close();
    }
  }
}
