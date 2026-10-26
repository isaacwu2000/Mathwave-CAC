import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeCurrentContract } from '../src/current-contract-grade.ts';
import type { Case } from '../src/grade.ts';
import type { Interpretation } from '../../Web/src/modules/commands/index.ts';

const path = process.argv[2];
if (!path)
  throw new Error(
    'Pass a saved short-prompt regression report. No provider calls are made.',
  );
const report = JSON.parse(await readFile(path, 'utf8'));
const root = fileURLToPath(new URL('../../', import.meta.url));
const cases = new Map<string, Case>();
for (const [split, expectedHash] of Object.entries(report.datasetHashes)) {
  const data = await readFile(root + 'Evals/inputs/' + split, 'utf8');
  if (createHash('sha256').update(data).digest('hex') !== expectedHash)
    throw new Error('Dataset changed since provider run: ' + split);
  for (const line of data.trim().split('\n')) {
    const item = JSON.parse(line) as Case;
    cases.set(split + ':' + item.id, item);
  }
}
const rows = report.samples.map(
  (sample: {
    split: string;
    id: string;
    variant: string;
    pass: boolean;
    raw?: Interpretation;
    interpretation?: Interpretation;
    error?: string;
    category: string;
  }) => {
    const item = cases.get(sample.split + ':' + sample.id);
    if (!item) throw new Error('Missing authored case.');
    const assessment =
      sample.raw && sample.interpretation
        ? gradeCurrentContract(item, sample.raw)
        : {
            pass: false,
            classification: 'invalid-or-unavailable-proposal',
            reason: sample.error || 'No valid interpretation',
          };
    return {
      split: sample.split,
      id: sample.id,
      category: sample.category,
      variant: sample.variant,
      historicalStrictPass: sample.pass,
      ...assessment,
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
        attempted: group.length,
        historicalStrictPassed: group.filter(
          (r: { historicalStrictPass: boolean }) => r.historicalStrictPass,
        ).length,
        currentContractPassed: group.filter((r: { pass: boolean }) => r.pass)
          .length,
        unresolvedOrFailed: group.filter((r: { pass: boolean }) => !r.pass)
          .length,
        classifications: Object.fromEntries(
          [
            ...new Set<string>(
              group.map((r: { classification: string }) => r.classification),
            ),
          ]
            .sort()
            .map((classification) => [
              classification,
              group.filter(
                (r: { classification: string }) =>
                  r.classification === classification,
              ).length,
            ]),
        ),
      },
    ];
  }),
);
const source = await readFile(
  root + 'Evals/src/current-contract-grade.ts',
  'utf8',
);
const output = resolve(dirname(path), 'current-contract-audit.json');
await writeFile(
  output,
  JSON.stringify(
    {
      sourceReport: resolve(path),
      providerCalls: 0,
      scorerSHA256: createHash('sha256').update(source).digest('hex'),
      scope:
        'Separate conservative offline audit of captured answers. Original historical strict scores and labels are unmodified. Positive adjustments require validated engine execution, preserved unrelated state and authored result/action. Different clarification wording remains unresolved. No general algebraic equivalence is inferred.',
      summary,
      rows,
    },
    null,
    2,
  ) + '\n',
);
await writeFile(resolve(dirname(path), 'current-contract-scorer.txt'), source);
console.log(JSON.stringify({ output, summary }));
