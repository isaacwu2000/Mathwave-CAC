import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { responseGuidance } from '../src/prompt-provider.ts';
import { captureRecordedSuite } from '../src/browser-recorded-suite.ts';
import { selectVoiceCampaign } from '../src/voice-catalog.ts';
import {
  voiceInstructions,
  interpretationInstructions,
  LIVE_MODEL,
  COMMAND_PROFILES,
} from '../../Web/src/modules/ai/index.ts';
import { toolCatalog } from '../../Web/src/modules/commands/index.ts';
import type { CloudSnapshot } from '../../Web/src/modules/problems/index.ts';
const origin = process.argv[2];
if (
  process.env.RUN_LIVE_CHECK !== 'true' ||
  !origin ||
  !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)
)
  throw new Error(
    'Supply an owned isolated loopback app and RUN_LIVE_CHECK=true. This runs two paid recorded voice cases.',
  );
const directory = fileURLToPath(
  new URL('../evaluations/warm-voice-' + randomUUID(), import.meta.url),
);
await mkdir(directory, { recursive: true });
const sourceHashes: Record<string, string> = {};
for (const [i, path] of [
  'Evals/scripts/evaluate-warm-voice.ts',
  'Evals/src/browser-recorded-suite.ts',
  'Evals/src/voice-fixture.ts',
  'Web/src/modules/voice/runtime/openai-voice-session.ts',
  'Web/src/modules/voice/runtime/browser-live.ts',
  'Web/src/modules/ai/runtime/interpret.ts',
  'Web/src/modules/ai/config/openai-config.ts',
  'Web/src/modules/ai/config/interpretation.ts',
  'Web/src/modules/commands/config/tool-catalog.ts',
  'Web/src/modules/commands/config/construction-instructions.ts',
  'Web/src/modules/commands/config/graph-scene-instructions.ts',
].entries()) {
  const source = await readFile(
    new URL('../../' + path, import.meta.url),
    'utf8',
  );
  sourceHashes[path] = createHash('sha256').update(source).digest('hex');
  await writeFile(directory + `/source-${i}.txt`, source);
}
await writeFile(
  directory + '/prompts.json',
  JSON.stringify(
    {
      voiceInstructions,
      interpretationInstructions,
      backendDefaultInstructions: interpretationInstructions + responseGuidance,
      toolCatalog,
    },
    null,
    2,
  ),
);
const guest = await fetch(origin + '/api/account', {
  method: 'POST',
  headers: { Origin: origin },
});
if (!guest.ok) throw new Error('Isolated guest setup failed.');
const cookies = guest.headers.getSetCookie().map((cookie) => {
  const pair = cookie.split(';')[0],
    split = pair.indexOf('=');
  return {
    name: pair.slice(0, split),
    value: pair.slice(split + 1),
    url: origin,
  };
});
const read = async () => {
  const response = await fetch(origin + '/api/problems', {
    headers: { Cookie: cookies.map((c) => c.name + '=' + c.value).join('; ') },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Isolated problem read failed.');
  return (await response.json()) as CloudSnapshot;
};
const samples: Record<string, unknown>[] = [];
const report = () =>
  writeFile(
    directory + '/report.json',
    JSON.stringify(
      {
        scope:
          'Two recorded fixtures through an already running caller-owned isolated app, normal fresh guest, GPT Live, backend, persistence and browser rendering. No physical microphone or student-usability evidence.',
        sourceHashes,
        models: {
          live: LIVE_MODEL,
          command: COMMAND_PROFILES['luna-default'].model,
        },
        reasoning: 'provider-default',
        samples,
      },
      null,
      2,
    ),
  );
console.log(JSON.stringify({ directory }));
await captureRecordedSuite(
  origin,
  read,
  selectVoiceCampaign({ cases: ['function', 'rectangle'] }),
  directory,
  (sample) => {
    samples.push(sample);
    console.log(
      JSON.stringify({
        scenario: sample.scenario,
        passed: sample.passed,
        failure: sample.failure,
      }),
    );
  },
  cookies,
);
await report();
