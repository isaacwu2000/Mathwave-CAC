import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';
import {
  summarizeJourneys,
  type JourneySample,
} from '../src/journey-evaluation.ts';

// Recompute statistics without repeating paid calls or changing the captured report.
const input = resolve(process.argv[2] ?? '');
const raw = await readFile(input, 'utf8');
const report = JSON.parse(raw) as {
  lane: string;
  samples: (JourneySample & { scenario: string })[];
};
if (report.lane !== 'voice' || !Array.isArray(report.samples))
  throw new Error('Supply a voice journey report.');
const summary = summarizeJourneys(report.samples);
const analysis = {
  sourceReport: basename(input),
  sourceSHA256: createHash('sha256').update(raw).digest('hex'),
  analyzedAt: new Date().toISOString(),
  intervalMethod:
    'Two-sided 80% Wilson score; per scenario. Pooled interval omitted because scenarios share trials.',
  summary: { ...summary, successInterval80: null },
  groups: Object.fromEntries(
    ['cold-equation', 'warm-step', 'reconnected-equation'].map((scenario) => [
      scenario,
      summarizeJourneys(report.samples.filter((s) => s.scenario === scenario)),
    ]),
  ),
};
const output = input.replace(/\.json$/, '') + '-analysis.json';
await writeFile(output, JSON.stringify(analysis, null, 2) + '\n', {
  flag: 'wx',
});
console.log(JSON.stringify({ output, groups: analysis.groups }));
