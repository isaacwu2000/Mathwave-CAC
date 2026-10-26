import { waitForSpokenResult } from './spoken-result.ts';
import { inputToDisplayLatency } from './campaign-summary.ts';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  currentProblem,
  type CloudSnapshot,
} from '../../Web/src/modules/problems/index.ts';
import { installVoiceFixture, type FixtureWindow } from './voice-fixture.ts';
import { assessVoiceParity } from './voice-parity.ts';
import {
  assessNaturalVoiceTurn,
  naturalVoiceCases,
} from './natural-voice-conversation.ts';
import type { JourneySample, JourneyTiming } from './journey-evaluation.ts';
import { captureScreenEvidence } from './screen-evidence.ts';

/** Replays a novel multi-turn conversation through real providers and isolated persisted work.
 * Only the input device is synthetic. Expected text and math never enter model context.
 */
export async function captureVoiceConversation(
  origin: string,
  read: () => Promise<CloudSnapshot>,
  record: (sample: JourneySample & Record<string, unknown>) => void,
  voice = 'Daniel',
  evidenceDirectory?: string,
  cookies: { name: string; value: string; url: string }[] = [],
) {
  if (voice !== 'Daniel')
    throw new Error('Natural conversation fixtures currently use Daniel.');
  const clips = JSON.parse(
    await readFile(
      new URL(
        '../../Web/public/demo-voices/natural-conversation/manifest.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { id: string; audio: string; sha256: string }[];
  for (const example of naturalVoiceCases) {
    const clip = clips.find((c) => c.id === example.id);
    if (
      !clip ||
      createHash('sha256')
        .update(
          await readFile(
            new URL(`../../Web/public${clip.audio}`, import.meta.url),
          ),
        )
        .digest('hex') !== clip.sha256
    )
      throw new Error('Missing or changed natural voice fixture.');
  }
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await context.addInitScript(
      installVoiceFixture,
      clips.find((clip) => clip.id === naturalVoiceCases[0].id)!.audio,
    );
    await context.addCookies(cookies);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    await page
      .locator('.app-shell[data-ready="true"]')
      .waitFor({ timeout: 30000 });
    const timings = () =>
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
    let seen: string[] = [];
    for (const [index, example] of naturalVoiceCases.entries()) {
      const clip = clips.find((c) => c.id === example.id)!;
      const before = await read();
      const start = performance.now();
      const offset = await page.evaluate(() => performance.now());
      let rows: JourneyTiming[] = [];
      let details: Record<string, unknown> = {};
      let failure: string | undefined;
      let passed = false;
      let completed = false;
      let stage = 'input';
      try {
        if (index === 0)
          await page
            .getByRole('button', { name: 'Start listening', exact: true })
            .click();
        else
          await page.evaluate(async (audio) => {
            await (window as FixtureWindow).playEvaluationFixture!(audio);
          }, clip.audio);
        stage = 'display';
        await page.waitForFunction(
          (previous) =>
            (
              performance.getEntriesByType('measure') as PerformanceMeasure[]
            ).some(
              (e) =>
                e.detail?.stage === 'display-commit' &&
                !previous.includes(e.detail.id),
            ),
          seen,
          { timeout: 45000 },
        );
        stage = 'spoken reply';
        // Require independently metered reply audio followed by idle before playing another turn.
        await waitForSpokenResult(page, seen);
        completed = true;
      } catch (error) {
        failure = `${stage}: ${error instanceof Error ? error.message : String(error)}`;
      }
      // Collect saved state and audio evidence even when display or audio timed out.
      try {
        const measured = await timings();
        const id = measured.find(
          (e) => e.stage === 'display-commit' && !seen.includes(e.id),
        )?.id;
        rows = measured.filter((e) =>
          id ? e.id === id : !seen.includes(e.id),
        );
        const observations = await page.evaluate(
          (at) =>
            (window as FixtureWindow).voiceObservations?.filter(
              (o) => o.at >= at,
            ) || [],
          offset,
        );
        const parity = assessVoiceParity(observations);
        const after = await read();
        const assessment = assessNaturalVoiceTurn(
          before.book,
          after.book,
          example,
        );
        const screen = evidenceDirectory
          ? await captureScreenEvidence(
              page,
              evidenceDirectory,
              example.id,
              currentProblem(after.book).state,
              currentProblem(after.book).steps.length,
            )
          : undefined;
        details = {
          ...assessment,
          screen,
          parity,
          observations,
          revision: after.revision,
          savedSteps: currentProblem(after.book).steps.length,
        };
        details.providerEvents = await page.evaluate(
          (at) =>
            (window as FixtureWindow).liveEvaluationEvents?.filter(
              (e) => e.at >= at,
            ) || [],
          offset,
        );
        passed =
          completed &&
          assessment.passed &&
          (!screen || screen.matchesSavedWork) &&
          parity.passed &&
          after.revision > before.revision &&
          errors.length === 0;
        if (!passed && !failure)
          failure =
            'Math, conversation, save, audio parity or browser error check failed.';
      } catch (error) {
        failure = `${failure || ''} Diagnostics: ${error instanceof Error ? error.message : String(error)}`;
      }
      record({
        scenario: example.id,
        audio: clip.audio,
        sha256: clip.sha256,
        ...details,
        passed,
        failure,
        expectedExpression: example.expression,
        elapsedMs: performance.now() - start,
        responseLatencyMs: inputToDisplayLatency(rows),
        timings: rows,
        pageErrors: [...errors],
      });
      seen = [...new Set((await timings()).map((e) => e.id))];
      // Later references depend on this result; retain explicit unattempted cases on failure.
      if (!passed) break;
    }
    const stop = page.getByRole('button', {
      name: 'Stop listening',
      exact: true,
    });
    if (await stop.count()) await stop.click();
    await page
      .getByRole('button', { name: 'Start listening', exact: true })
      .waitFor({ timeout: 5000 });
    await context.close();
  } finally {
    await browser.close();
  }
}
