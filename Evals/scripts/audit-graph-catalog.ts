import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  expectedGraphCurves,
  expectedSegment,
} from '../src/autonomous-oracles.ts';
import type { Workspace } from '../../Web/src/modules/workspace/state.ts';
const directory = process.argv[2];
const raw = await readFile(directory + '/report.json', 'utf8');
const report = JSON.parse(raw) as {
  samples: {
    scenario: string;
    after: { state: Workspace };
    previews: { after: { state: Workspace } }[];
  }[];
};
const results = report.samples.map((s) => ({
  scenario: s.scenario,
  passed:
    s.scenario === 'two-curves'
      ? expectedGraphCurves(s.after.state, 2) &&
        s.previews.length >= 2 &&
        expectedGraphCurves(s.previews[0].after.state, 1)
      : expectedSegment(s.after.state),
}));
await writeFile(
  directory + '/oracle-audit.json',
  JSON.stringify(
    {
      reportSha256: createHash('sha256').update(raw).digest('hex'),
      method:
        'Offline authored-curve/endpoint audit of preserved live outputs; no provider calls. Visual review remains separate.',
      results,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(results));
if (results.some((r) => !r.passed)) process.exitCode = 1;
