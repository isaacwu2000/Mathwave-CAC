/** Reports correctness and observed input-to-display latency independently.
 * A slow correct result still passes. Unattempted cases and missing timings remain explicit.
 */
export function summarizeCampaign(
  samples: { passed: boolean; responseLatencyMs?: unknown }[],
  planned: number,
) {
  const times = samples
    .map((s) => s.responseLatencyMs)
    .filter(
      (ms): ms is number =>
        typeof ms === 'number' && Number.isFinite(ms) && ms >= 0,
    )
    .sort((a, b) => a - b);
  return {
    correctness: {
      planned,
      attempted: samples.length,
      passed: samples.filter((s) => s.passed).length,
      failed: samples.filter((s) => !s.passed).length,
      unattempted: planned - samples.length,
    },
    latency: {
      measured: times.length,
      missing: samples.length - times.length,
      p50: times.length ? times[Math.ceil(times.length * 0.5) - 1] : null,
      p95: times.length ? times[Math.ceil(times.length * 0.95) - 1] : null,
    },
  };
}
import type { JourneyTiming } from './journey-evaluation.ts';

/** Returns measured student input-to-display time, retaining missing or invalid evidence as null. */
export function inputToDisplayLatency(rows: JourneyTiming[]) {
  const input = rows.find((e) => e.stage === 'last-input-signal')?.duration;
  const display = rows.find((e) => e.stage === 'display-commit')?.duration;
  return input !== undefined && display !== undefined && display >= input
    ? display - input
    : null;
}
