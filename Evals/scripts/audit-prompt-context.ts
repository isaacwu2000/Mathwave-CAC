import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { isRadiusTwoCircle } from '../src/prompt-context-oracles.ts';
import type { Workspace } from '../../Web/src/modules/workspace/state.ts';

const path = process.argv[2];
if (!path)
  throw new Error(
    'Pass a captured prompt context report. No provider calls are made.',
  );
const report = JSON.parse(await readFile(path, 'utf8'));
const rows = report.samples.map(
  (sample: {
    scenario: string;
    variant: string;
    text: string;
    attempted: boolean;
    passed?: boolean;
    after?: { state: Workspace };
    aiUnavailable?: boolean;
  }) => {
    const correction =
      sample.scenario === 'implicit-graph' &&
      sample.attempted &&
      !sample.aiUnavailable &&
      sample.after;
    return {
      scenario: sample.scenario,
      variant: sample.variant,
      text: sample.text,
      attempted: sample.attempted,
      originalPassed: sample.passed,
      auditedPassed: correction
        ? isRadiusTwoCircle(sample.after!.state)
        : sample.passed,
      oracleCorrection: correction
        ? 'Original scorer searched readback for true/false; engine readback uses satisfies/does not satisfy. Rechecked saved implicit relation through computed membership, with positive and negative authored points.'
        : undefined,
    };
  },
);
const summary = Object.fromEntries(
  ['baseline', 'short'].map((variant) => {
    const group = rows.filter(
      (r: { variant: string }) => r.variant === variant,
    );
    return [
      variant,
      {
        planned: group.length,
        attempted: group.filter((r: { attempted: boolean }) => r.attempted)
          .length,
        passed: group.filter((r: { auditedPassed: boolean }) => r.auditedPassed)
          .length,
        failed: group.filter(
          (r: { attempted: boolean; auditedPassed: boolean }) =>
            r.attempted && !r.auditedPassed,
        ).length,
        blocked: group.filter((r: { attempted: boolean }) => !r.attempted)
          .length,
      },
    ];
  }),
);
const source = await readFile(
  new URL('../src/prompt-context-oracles.ts', import.meta.url),
  'utf8',
);
const output = resolve(dirname(path), 'context-audit.json');
await writeFile(
  output,
  JSON.stringify(
    {
      providerCalls: 0,
      scope:
        'Offline correction of one faulty graph oracle; original scores unchanged. All other context judgments retained.',
      oracleSHA256: createHash('sha256').update(source).digest('hex'),
      summary,
      rows,
    },
    null,
    2,
  ) + '\n',
);
await writeFile(resolve(dirname(path), 'corrected-graph-oracle.txt'), source);
console.log(JSON.stringify({ output, summary }));
