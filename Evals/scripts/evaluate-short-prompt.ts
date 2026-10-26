import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  COMMAND_PROFILES,
  interpretationInstructions,
} from '../../Web/src/modules/ai/index.ts';
import {
  createProblemLibrary,
  updateProblem,
} from '../../Web/src/modules/problems/index.ts';
import { grade, type Case } from '../src/grade.ts';
import {
  interpretWithPrompt,
  type PromptProvider,
} from '../src/prompt-provider.ts';
import { shortInterpretationInstructions } from '../experiments/short-interpreter-prompt.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const variants = {
  baseline: interpretationInstructions,
  short: shortInterpretationInstructions,
};
const entries = (await readdir(root + 'Evals/inputs'))
  .filter((name) => /^test(?:-v\d+)?\.jsonl$/.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const cases: { split: string; item: Case }[] = [];
const datasetHashes: Record<string, string> = {};
for (const name of entries) {
  const content = await readFile(root + 'Evals/inputs/' + name, 'utf8');
  datasetHashes[name] = createHash('sha256').update(content).digest('hex');
  for (const line of content.trim().split('\n'))
    cases.push({ split: name, item: JSON.parse(line) });
}
if (process.argv.includes('--dry-run')) {
  console.log(
    JSON.stringify(
      {
        cases: cases.length,
        variants: Object.keys(variants),
        plannedTurns: cases.length * 2,
        maximumProviderCalls: cases.length * 6,
        concurrency: 4,
        scope:
          'All versioned text test datasets. Separate context campaign follows.',
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (process.env.RUN_LIVE_CHECK !== 'true')
  throw new Error(
    'Set RUN_LIVE_CHECK=true for this bounded paid text evaluation.',
  );
process.loadEnvFile(root + 'Web/.env');
const profile = process.env.MATH_AUDIO_COMMAND_PROFILE || 'luna-default';
if (!Object.hasOwn(COMMAND_PROFILES, profile))
  throw new Error('Unknown command profile.');
const settings = COMMAND_PROFILES[profile as keyof typeof COMMAND_PROFILES];
const key =
  profile === 'luna-default'
    ? process.env.OPENAI_API_KEY
    : process.env.OPENROUTER_API_KEY;
if (!key) throw new Error('Provider credentials unavailable.');
const provider: PromptProvider = {
  ...settings,
  key,
  url:
    profile === 'luna-default'
      ? 'https://api.openai.com/v1/responses'
      : 'https://openrouter.ai/api/v1/responses',
};
const directory = new URL(
  `../evaluations/short-prompt-regression-${randomUUID()}/`,
  import.meta.url,
);
await mkdir(directory, { recursive: true });
const sourcePaths = [
  'Evals/scripts/evaluate-short-prompt.ts',
  'Evals/src/prompt-provider.ts',
  'Evals/experiments/short-interpreter-prompt.ts',
  'Evals/src/grade.ts',
];
const sourceHashes: Record<string, string> = {};
for (const [index, path] of sourcePaths.entries()) {
  const source = await readFile(root + path, 'utf8');
  sourceHashes[path] = createHash('sha256').update(source).digest('hex');
  await writeFile(new URL(`source-${index}.txt`, directory), source);
}
for (const [name, prompt] of Object.entries(variants))
  await writeFile(new URL(name + '-prompt.txt', directory), prompt);
const samples: Record<string, unknown>[] = [];
const startedAt = new Date().toISOString();
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
let providerCalls = 0,
  next = 0,
  fatal: string | undefined;
let writing = Promise.resolve();
function summary() {
  return Object.fromEntries(
    Object.keys(variants).map((variant) => {
      const rows = samples.filter((row) => row.variant === variant);
      const times = rows
        .map((row) => row.elapsedMs as number)
        .sort((a, b) => a - b);
      return [
        variant,
        {
          planned: cases.length,
          attempted: rows.length,
          strictPassed: rows.filter((row) => row.pass === true).length,
          failed: rows.filter((row) => row.pass === false).length,
          medianMs: times.length
            ? times[Math.ceil(times.length / 2) - 1]
            : null,
          categories: Object.fromEntries(
            [...new Set(rows.map((row) => row.category as string))]
              .sort()
              .map((category) => {
                const group = rows.filter((row) => row.category === category);
                return [
                  category,
                  {
                    attempted: group.length,
                    passed: group.filter((row) => row.pass === true).length,
                  },
                ];
              }),
          ),
        },
      ];
    }),
  );
}
function checkpoint() {
  const report = JSON.stringify(
    {
      startedAt,
      revision,
      workingChanges: true,
      model: provider.model,
      profile,
      datasetHashes,
      sourceHashes,
      plannedTurns: cases.length * 2,
      maximumProviderCalls: cases.length * 6,
      providerCalls,
      concurrency: 4,
      fatal,
      scope:
        'Historical text regression: real provider, production context/schema/preview/validation, synthetic caller-owned state, no persistence or voice. Same frozen cases and alternating prompt order. Strict historical labels are preserved; results do not establish student usability or current-contract accuracy.',
      summary: summary(),
      samples,
    },
    null,
    2,
  );
  writing = writing.then(() =>
    writeFile(new URL('report.json', directory), report),
  );
  return writing;
}
await checkpoint();
console.log(
  JSON.stringify({
    output: directory.pathname,
    plannedTurns: cases.length * 2,
  }),
);
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (!fatal) {
      const index = next++;
      if (index >= cases.length) return;
      const { split, item } = cases[index];
      const book = updateProblem(createProblemLibrary(), (problem) => ({
        ...problem,
        state: structuredClone(item.state),
      }));
      const saved = { book, clarification: item.clarification ?? null };
      const order =
        index % 2
          ? (['short', 'baseline'] as const)
          : (['baseline', 'short'] as const);
      for (const variant of order) {
        if (fatal) break;
        const output = await interpretWithPrompt(
          item.utterance,
          saved,
          variants[variant],
          provider,
          () => {
            if (++providerCalls > cases.length * 6)
              throw new Error('Campaign call budget exhausted.');
          },
        );
        let assessment: { pass: boolean; reason: string } = {
          pass: false,
          reason: output.error || 'Missing valid interpretation.',
        };
        if (output.raw && output.interpretation)
          assessment = grade(item, output.raw as Parameters<typeof grade>[1]);
        samples.push({
          split,
          id: item.id,
          family: item.family,
          category: item.category,
          utterance: item.utterance,
          variant,
          ...assessment,
          ...output,
        });
        if (output.providerFailure) fatal = output.error;
        await checkpoint();
        if (samples.length % 10 === 0 || output.providerFailure)
          console.log(
            JSON.stringify({
              completed: samples.length,
              planned: cases.length * 2,
              providerCalls,
              summary: summary(),
              fatal,
            }),
          );
      }
    }
  }),
);
await checkpoint();
console.log(
  JSON.stringify({
    output: directory.pathname,
    summary: summary(),
    providerCalls,
    fatal,
  }),
);
if (fatal) process.exitCode = 1;
