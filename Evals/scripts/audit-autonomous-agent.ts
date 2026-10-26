import type { Workspace } from '../../Web/src/modules/workspace/state.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  chosenCircle,
  oneNumberToFive,
  divideByCoefficient,
  panDown,
} from '../src/autonomous-oracles.ts';
const directory = process.argv[2];
if (!directory)
  throw new Error('Supply a saved autonomous-agent report directory.');
const raw = await readFile(directory + '/report.json', 'utf8');
type Sample = {
  scenario: string;
  variant: string;
  attempted: boolean;
  passed?: boolean;
  text: string;
  before: { state: Workspace };
  after?: { state: Workspace };
};
const report = JSON.parse(raw) as { samples: Sample[] };
const samples = report.samples.map((sample) => {
  if (!sample.attempted)
    return {
      scenario: sample.scenario,
      variant: sample.variant,
      attempted: false,
    };
  let passed = sample.passed;
  const before = sample.before.state,
    after = sample.after?.state;
  if (passed && after && sample.scenario === 'vague-circle')
    passed = chosenCircle(after);
  if (
    passed &&
    after &&
    sample.scenario === 'vague-edit' &&
    sample.text !== 'Undo that.'
  )
    passed = oneNumberToFive(before, after);
  if (passed && after && sample.scenario === 'missing-divisor')
    passed = divideByCoefficient(before, after);
  if (passed && after && sample.scenario === 'viewport')
    passed = panDown(before, after);
  return {
    scenario: sample.scenario,
    variant: sample.variant,
    attempted: true,
    passed,
    rawPassed: sample.passed,
  };
});
const oracle = await readFile(
  new URL('../src/autonomous-oracles.ts', import.meta.url),
  'utf8',
);
await writeFile(directory + '/assumption-oracles.txt', oracle);
await writeFile(
  directory + '/outcome-audit.json',
  JSON.stringify(
    {
      scope:
        'Offline stricter outcome audit; raw report is unchanged. Circle kind/radius, one exact replacement with unrelated fields preserved, coefficient division, downward viewport. No provider calls.',
      reportSha256: createHash('sha256').update(raw).digest('hex'),
      oracleSha256: createHash('sha256').update(oracle).digest('hex'),
      summary: Object.fromEntries(
        ['baseline', 'short'].map((v) => [
          v,
          {
            passed: samples.filter((s) => s.variant === v && s.passed).length,
            attempted: samples.filter((s) => s.variant === v && s.attempted)
              .length,
            planned: samples.filter((s) => s.variant === v).length,
          },
        ]),
      ),
      samples,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ output: directory + '/outcome-audit.json' }));
