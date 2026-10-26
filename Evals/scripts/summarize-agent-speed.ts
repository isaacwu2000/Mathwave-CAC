import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  summarizePairedLatency,
  type LatencySample,
} from '../src/paired-latency.ts';

const directory = resolve(process.argv[2]);
const raw = await readFile(directory + '/report.json', 'utf8');
const report = JSON.parse(raw) as {
  samples: (LatencySample & {
    screenshot: string;
    timings?: { stage: string; duration: number }[];
  })[];
};
const review = JSON.parse(
  await readFile(directory + '/visual-review.json', 'utf8'),
) as {
  cases: { screenshot: string; visuallyReviewed: boolean; passed?: boolean }[];
};
const adjudicated = report.samples.map((sample) => {
  const result = review.cases.find(
    (row) => row.screenshot === sample.screenshot,
  );
  if (!result?.visuallyReviewed)
    throw new Error('Missing visual review: ' + sample.screenshot);
  return { ...sample, passed: result.passed ?? sample.passed };
});
const summary = {
  reportSha256: createHash('sha256').update(raw).digest('hex'),
  automated: summarizePairedLatency(report.samples),
  adjudicated: summarizePairedLatency(adjudicated),
  scenarios: [...new Set(adjudicated.map((sample) => sample.scenario))].map(
    (scenario) => ({
      scenario,
      ...summarizePairedLatency(
        adjudicated.filter((sample) => sample.scenario === scenario),
      ),
    }),
  ),
  previewCommit: summarizePairedLatency(
    adjudicated.map((sample) => {
      const preview = sample.timings?.find(
        (entry) => entry.stage === 'preview-display-commit',
      )?.duration;
      const delegated = sample.timings?.find(
        (entry) => entry.stage === 'delegated',
      )?.duration;
      return {
        ...sample,
        displayMs:
          preview !== undefined && delegated !== undefined
            ? preview - delegated
            : undefined,
      };
    }),
  ),
  model: summarizePairedLatency(
    adjudicated.map((sample) => ({
      ...sample,
      displayMs: sample.timings
        ?.filter((entry) => /^problem-server:model_\d+$/.test(entry.stage))
        .reduce((sum, entry) => sum + entry.duration, 0),
    })),
  ),
};
await writeFile(directory + '/summary.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
