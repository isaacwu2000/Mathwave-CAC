import type { FixtureWindow } from './voice-fixture.ts';
import type { Page } from 'playwright';

/** Runs in the evaluation browser; requires new reply text and metered audio after the saved result.
 * Earlier acknowledgements cannot complete a turn. Playback and transcript updates must remain idle for one second, including pauses between phrases.
 */
export function spokenResultFinished(resultAt: number) {
  const evidence = window as FixtureWindow;
  const samples =
    evidence.voiceObservations?.filter((o) => o.at >= resultAt) ?? [];
  const last = samples.at(-1);
  const lastActivityAt = Math.max(
    resultAt,
    ...samples.filter((o) => o.audible || o.speaking).map((o) => o.at),
    ...(evidence.liveEvaluationEvents ?? [])
      .filter(
        (e) =>
          e.at >= resultAt &&
          e.type === 'session.output_transcript.delta' &&
          e.delta?.trim(),
      )
      .map((e) => e.at),
  );
  return Boolean(
    evidence.liveEvaluationEvents?.some(
      (e) =>
        e.at >= resultAt &&
        e.type === 'session.output_transcript.delta' &&
        e.delta?.trim(),
    ) &&
    samples.some((o) => o.audible && o.speaking && o.expected) &&
    last &&
    !last.audible &&
    !last.speaking &&
    last.settled &&
    last.at - lastActivityAt >= 1000,
  );
}

/** Waits for the result's own spoken reply after commentary was delivered to Live. */
export async function waitForSpokenResult(page: Page, previous: string[]) {
  // Drawing completion follows the canvas frame, which may arrive after React's display commit.
  await page.waitForFunction(
    (seen) =>
      (performance.getEntriesByType('measure') as PerformanceMeasure[]).some(
        (entry) =>
          entry.detail?.stage === 'commentary-sent' &&
          !seen.includes(entry.detail.id),
      ),
    previous,
    { timeout: 30000 },
  );
  const resultAt = await page.evaluate((seen) => {
    const entry = (
      performance.getEntriesByType('measure') as PerformanceMeasure[]
    ).find(
      (e) =>
        e.detail?.stage === 'commentary-sent' && !seen.includes(e.detail.id),
    );
    return entry ? entry.startTime + entry.duration : null;
  }, previous);
  if (resultAt === null)
    throw new Error('No completed result was sent to the voice session.');
  await page.waitForFunction(spokenResultFinished, resultAt, {
    timeout: 30000,
  });
}
