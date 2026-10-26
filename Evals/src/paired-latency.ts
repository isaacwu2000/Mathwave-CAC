export type LatencySample = {
  variant: string;
  trial: number;
  scenario: string;
  passed: boolean;
  warmup?: boolean;
  displayMs?: number;
};

/** Returns the median and nearest-rank upper percentile of observed values; missing values stay null. */
function distribution(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    p50Ms: sorted.length
      ? sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2
      : null,
    p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
  };
}

/**
 * Summarizes measured screen latency independently from correctness.
 * - Excludes explicit warm-ups; counts failed and missing observations as attempts.
 * - Compares paired differences only when both versions passed with finite positive timings.
 * - Retains unpaired attempts in each version's correctness denominator.
 */
export function summarizePairedLatency(samples: LatencySample[]) {
  const measured = samples.filter((sample) => !sample.warmup);
  const usable = (sample: LatencySample) =>
    sample.passed &&
    typeof sample.displayMs === 'number' &&
    Number.isFinite(sample.displayMs) &&
    sample.displayMs > 0;
  const summary = (variant: string) => {
    const rows = measured.filter((sample) => sample.variant === variant);
    return {
      attempted: rows.length,
      passed: rows.filter((sample) => sample.passed).length,
      timed: rows.filter(usable).length,
      ...distribution(rows.filter(usable).map((sample) => sample.displayMs!)),
    };
  };
  const differences: number[] = [];
  const percentages: number[] = [];
  for (const before of measured.filter(
    (sample) => sample.variant === 'before' && usable(sample),
  )) {
    const after = measured.find(
      (sample) =>
        sample.variant === 'after' &&
        sample.trial === before.trial &&
        sample.scenario === before.scenario &&
        usable(sample),
    );
    if (!after) continue;
    const saved = before.displayMs! - after.displayMs!;
    differences.push(saved);
    percentages.push((100 * saved) / before.displayMs!);
  }
  return {
    before: summary('before'),
    after: summary('after'),
    paired: {
      count: differences.length,
      faster: differences.filter((value) => value > 0).length,
      slower: differences.filter((value) => value < 0).length,
      medianSavedMs: distribution(differences).p50Ms,
      medianPercentFaster: distribution(percentages).p50Ms,
    },
  };
}
