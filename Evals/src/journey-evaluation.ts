export type JourneyTiming = {
  stage: string;
  duration: number;
  kind?: string;
  id?: string;
};
export type JourneySample = {
  passed: boolean;
  elapsedMs: number;
  timings: JourneyTiming[];
};

/** Summarizes observed timings; failed attempts and missing stages never count as fast successes. */
export function summarizeJourneys(samples: JourneySample[]) {
  const percentiles = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (p: number) =>
      sorted.length
        ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]
        : null;
    return { p50: percentile(0.5), p95: percentile(0.95) };
  };
  const passed = samples.filter((s) => s.passed).length;
  const n = samples.length;
  // Two-sided 80% Wilson score interval: z is the normal distribution's 90th percentile.
  const z = 1.2815515655446004;
  const proportion = n ? passed / n : 0;
  const denominator = 1 + (z * z) / n;
  const center = (proportion + (z * z) / (2 * n)) / denominator;
  const halfWidth =
    (z *
      Math.sqrt((proportion * (1 - proportion)) / n + (z * z) / (4 * n * n))) /
    denominator;
  return {
    successInterval80: n
      ? {
          confidence: 0.8,
          lower: passed === 0 ? 0 : Math.max(0, center - halfWidth),
          upper: passed === n ? 1 : Math.min(1, center + halfWidth),
        }
      : null,
    attempted: samples.length,
    passed: samples.filter((s) => s.passed).length,
    failed: samples.filter((s) => !s.passed).length,
    successMs: percentiles(
      samples.filter((s) => s.passed).map((s) => s.elapsedMs),
    ),
    failureMs: percentiles(
      samples.filter((s) => !s.passed).map((s) => s.elapsedMs),
    ),
    stages: Object.fromEntries(
      [...new Set(samples.flatMap((s) => s.timings.map((t) => t.stage)))].map(
        (stage) => {
          const values = samples.flatMap((s) => {
            const observed = s.timings
              .filter((t) => t.stage === stage)
              .map((t) => t.duration);
            return observed.length ? [Math.min(...observed)] : [];
          });
          return [
            stage,
            {
              observed: values.length,
              missing: samples.filter(
                (s) => !s.timings.some((t) => t.stage === stage),
              ).length,
              ...percentiles(values),
            },
          ];
        },
      ),
    ),
  };
}

/** Reads our duration-only Server-Timing metrics, ignoring unsupported or invalid entries. */
export function serverTimings(header: string | null): JourneyTiming[] {
  return (header?.split(',') ?? []).flatMap((metric) => {
    const match = /^\s*([a-z][a-z0-9_]*);dur=(\d+(?:\.\d+)?)\s*$/.exec(metric);
    return match
      ? [{ stage: match[1], duration: Number(match[2]), kind: 'span' }]
      : [];
  });
}
