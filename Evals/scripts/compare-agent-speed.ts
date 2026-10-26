import { chromium, type BrowserContext } from 'playwright';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  currentProblem,
  type CloudSnapshot,
} from '../../Web/src/modules/problems/index.ts';
import { responseGuidance } from '../src/prompt-provider.ts';
import { graphFunction } from '../../Web/src/modules/visuals/index.ts';

const roots = { before: process.argv[2], after: process.argv[3] };
if (process.env.RUN_LIVE_CHECK !== 'true' || !roots.before || !roots.after)
  throw new Error(
    'Set RUN_LIVE_CHECK=true and supply the two immutable checkouts. Budget: 48 measured requests and two warm-ups.',
  );
const directory = resolve('Evals/evaluations/agent-speed-' + randomUUID());
await mkdir(directory, { recursive: true });
const cases = [
  {
    id: 'equation',
    text: 'Please set up the equation: twice x plus three equals eleven.',
    setup: [],
    expression: '2 * x + 3 = 11',
  },
  {
    id: 'both-sides',
    text: 'Take three away from each side of my equation.',
    setup: ['write 2*x+3=11'],
    expression: '2 * x + 3 - 3 = 11 - 3',
  },
  {
    id: 'two-steps',
    text: 'Subtract three from both sides, then divide both sides by two. Keep both steps.',
    setup: ['write 2*x+3=11'],
    expression: '(2 * x + 3 - 3) / 2 = (11 - 3) / 2',
  },
  {
    id: 'explanation',
    text: 'Explain why subtracting three from both sides keeps this equation balanced without changing my work.',
    setup: ['write 2*x+3=11'],
    expression: '2 * x + 3 = 11',
  },
  {
    id: 'parabola',
    text: 'Plot y equals x squared minus four.',
    setup: [],
    expression: 'y = x^2 - 4',
  },
  {
    id: 'rectangle',
    text: 'Draw a rectangle with width six and height four.',
    setup: [],
  },
] as const;
type Variant = keyof typeof roots;
type Sample = {
  variant: Variant;
  trial: number;
  scenario: string;
  warmup: boolean;
  passed: boolean;
  displayMs?: number;
  commitMs?: number;
  responseBytes?: number;
  timings?: { stage: string; duration: number; kind?: string }[];
  error?: string;
  [key: string]: unknown;
};
const samples: Sample[] = [];
const variants: Record<string, unknown> = {};
const instances = new Map<
  Variant,
  {
    origin: string;
    context: BrowserContext;
    api: typeof import('../../Web/src/modules/ai/index.ts');
    commands: typeof import('../../Web/src/modules/commands/index.ts');
  }
>();
const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});

/** Replaces only the spoken frontend with immediate synthetic delegation. All command HTTP, model, database and rendering work remains real. */
function installDelegationFixture() {
  const fixture = window as unknown as {
    emitSpeedEvent?: (value: unknown) => void;
    speedResponse?: Promise<string>;
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const path =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (path.includes('/api/live-token'))
      return Response.json(
        init?.method === 'POST'
          ? { sdp: 'synthetic answer' }
          : { configured: true },
      );
    const response = await nativeFetch(input, init);
    if (
      path.includes('/api/problems') &&
      init?.method === 'POST' &&
      typeof init.body === 'string' &&
      JSON.parse(init.body).operation?.interpret === true
    )
      fixture.speedResponse = response.clone().text();
    return response;
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const audio = new AudioContext();
    const destination = audio.createMediaStreamDestination();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    gain.gain.value = 0.02;
    oscillator.connect(gain);
    gain.connect(destination);
    await audio.resume();
    oscillator.start();
    oscillator.stop(audio.currentTime + 90);
    return destination.stream;
  };
  class Peer extends EventTarget {
    iceGatheringState = 'complete';
    localDescription = { sdp: 'synthetic offer' };
    channel = {
      readyState: 'open',
      onmessage: null as ((event: MessageEvent) => void) | null,
      onopen: null,
      send() {},
      close() {},
    };
    createDataChannel() {
      fixture.emitSpeedEvent = (value) =>
        this.channel.onmessage?.(
          new MessageEvent('message', { data: JSON.stringify(value) }),
        );
      return this.channel;
    }
    addTrack() {}
    close() {}
    async createOffer() {
      return this.localDescription;
    }
    async setLocalDescription() {}
    async setRemoteDescription() {
      setTimeout(
        () => fixture.emitSpeedEvent?.({ type: 'session.started' }),
        0,
      );
    }
  }
  window.RTCPeerConnection = Peer as unknown as typeof RTCPeerConnection;
}

/** Computes the same authored outcome checks for both versions; failures remain in the report. */
function assess(
  example: (typeof cases)[number],
  result: CloudSnapshot & { status?: string; aiUnavailable?: boolean },
) {
  const problem = currentProblem(result.book);
  if (result.aiUnavailable) return false;
  if (example.id === 'explanation')
    return (
      ['explanation', 'reply'].includes(result.status ?? '') &&
      problem.state.expression === example.expression &&
      problem.steps.length === 1
    );
  if (result.status !== 'command') return false;
  if (example.id === 'rectangle')
    return (
      problem.state.geometry?.shape === 'rectangle' &&
      problem.state.geometry.dimensions.width === 6 &&
      problem.state.geometry.dimensions.height === 4
    );
  if (example.id === 'parabola')
    return (
      problem.state.graph === true &&
      graphFunction(problem.state.expression).value(0) === -4 &&
      graphFunction(problem.state.expression).value(2) === 0
    );
  if (problem.state.expression !== example.expression) return false;
  return (
    example.id !== 'two-steps' ||
    (problem.steps.length === 3 &&
      problem.steps[1].state.expression === '2 * x + 3 - 3 = 11 - 3')
  );
}

const checkpoint = () =>
  writeFile(
    directory + '/report.json',
    JSON.stringify(
      {
        scope:
          'Paired local dev app comparison. Synthetic spoken frontend delegates immediately; real browser command queue, HTTP, Luna, database persistence, React commit and two animation frames. Excludes microphone, GPT Live recognition/delegation, production hosting and student usability.',
        warmupRequests: 2,
        measuredRequests: 48,
        repetitions: 4,
        viewport: { width: 1000, height: 760 },
        order:
          'Rotate cases each trial; alternate before/after within each pair. No concurrent provider requests. One unmeasured equation warm-up per variant.',
        variants,
        samples,
      },
      null,
      2,
    ),
  );

try {
  for (const variant of ['before', 'after'] as const) {
    const root = roots[variant]!;
    const paths = await readdir(resolve(root, 'Web/.wrangler/dev'));
    let manifest: { url: string; problemLibraryOwner: string } | undefined;
    for (const path of paths) {
      const candidate = await readFile(
        resolve(root, 'Web/.wrangler/dev', path, 'server.json'),
        'utf8',
      )
        .then(JSON.parse)
        .catch(() => undefined);
      if (!candidate) continue;
      if (
        candidate.problemLibraryOwner ===
        `test:dev:eval-speed-${variant}-20261022`
      )
        manifest = candidate;
    }
    if (
      !manifest ||
      !['localhost', '127.0.0.1'].includes(new URL(manifest.url).hostname)
    )
      throw new Error('Isolated app manifest not found.');
    const api = await import(resolve(root, 'Web/src/modules/ai/index.ts'));
    const commands = await import(
      resolve(root, 'Web/src/modules/commands/index.ts')
    );
    const sourceHashes: Record<string, string> = {};
    for (const path of [
      'Web/src/modules/ai/config/interpretation.ts',
      'Web/src/modules/ai/runtime/interpret.ts',
      'Web/src/modules/commands/config/program-instructions.ts',
      'Web/src/modules/commands/config/tool-catalog.ts',
      'Web/src/modules/commands/services/command-interpreter.ts',
      'Web/src/modules/problems/runtime/cloud-api.ts',
      'Web/src/modules/problems/services/conversation.ts',
    ]) {
      const source = await readFile(resolve(root, path), 'utf8');
      sourceHashes[path] = createHash('sha256').update(source).digest('hex');
      await writeFile(
        directory + '/' + variant + '-' + path.replaceAll('/', '_') + '.txt',
        source,
      );
    }
    variants[variant] = {
      revision: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      model: api.COMMAND_PROFILES['luna-default'],
      sourceHashes,
      syntheticOwner: manifest.problemLibraryOwner,
    };
    await writeFile(
      directory + '/' + variant + '-protocol.json',
      JSON.stringify(
        {
          instructions: api.interpretationInstructions,
          schema: api.interpretationSchema,
          toolContracts: commands.toolCatalog,
        },
        null,
        2,
      ),
    );
    const context = await browser.newContext({
      viewport: { width: 1000, height: 760 },
    });
    await context.addInitScript(installDelegationFixture);
    const account = await context.request.post(manifest.url + '/api/account', {
      headers: { Origin: manifest.url },
    });
    if (!account.ok()) throw new Error('Synthetic account setup failed.');
    instances.set(variant, { origin: manifest.url, context, api, commands });
  }

  const run = async (
    variant: Variant,
    example: (typeof cases)[number],
    trial: number,
    warmup = false,
  ) => {
    const { origin, context, api, commands } = instances.get(variant)!;
    const sample: Sample = {
      variant,
      trial,
      scenario: example.id,
      warmup,
      passed: false,
    };
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    try {
      let snapshot = (await (
        await context.request.get(origin + '/api/problems')
      ).json()) as CloudSnapshot;
      const apply = async (operation: object) => {
        const response = await context.request.post(origin + '/api/problems', {
          headers: { Origin: origin },
          data: { id: randomUUID(), revision: snapshot.revision, operation },
        });
        if (!response.ok())
          throw new Error('Fixture setup failed: ' + response.status());
        snapshot = await response.json();
      };
      await apply({ kind: 'new', title: `Speed ${trial} ${example.id}` });
      for (const text of example.setup)
        await apply({ kind: 'command', text, interpret: false });
      const before = currentProblem(snapshot.book);
      sample.request = example.text;
      sample.instructions =
        api.interpretationInstructions +
        commands.constructionInstructionsFor(example.text, before.state) +
        commands.graphSceneInstructionsFor(example.text, before.state) +
        responseGuidance;
      sample.before = before;
      await page.goto(origin);
      await page.locator('.app-shell[data-ready="true"]').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page
        .getByRole('button', { name: 'Start listening', exact: true })
        .click();
      await page.waitForFunction(() =>
        document
          .querySelector('#voice-status')
          ?.textContent?.includes('connected'),
      );
      const measured = await page.evaluate(async (request) => {
        type Entry = PerformanceMeasure & {
          detail: { id: string; stage: string; kind: string };
        };
        const fixture = window as unknown as {
          emitSpeedEvent: (value: unknown) => void;
        };
        return new Promise<{
          displayMs: number;
          commitMs: number;
          timings: { stage: string; duration: number; kind: string }[];
        }>((resolve, reject) => {
          const started = performance.now();
          const timeout = setTimeout(() => {
            observer.disconnect();
            reject(new Error('No saved display within 45 seconds.'));
          }, 45000);
          const observer = new PerformanceObserver((list) => {
            const display = (list.getEntries() as Entry[]).find(
              (entry) => entry.detail?.stage === 'display-commit',
            );
            if (!display) return;
            observer.disconnect();
            clearTimeout(timeout);
            const committed = performance.now();
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const entries = (
                  performance.getEntriesByType('measure') as Entry[]
                ).filter((entry) => entry.detail?.id === display.detail.id);
                resolve({
                  displayMs: performance.now() - started,
                  commitMs: committed - started,
                  timings: entries.map((entry) => ({
                    stage: entry.detail.stage,
                    kind: entry.detail.kind,
                    duration: entry.duration,
                  })),
                });
              }),
            );
          });
          observer.observe({ type: 'measure' });
          fixture.emitSpeedEvent({
            type: 'session.input_transcript.delta',
            delta: request,
          });
          fixture.emitSpeedEvent({
            type: 'session.delegation.created',
            delegation: { id: crypto.randomUUID(), target: 'client' },
          });
        });
      }, example.text);
      const raw = await page.evaluate(
        () =>
          (window as unknown as { speedResponse: Promise<string> })
            .speedResponse,
      );
      const frame = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .findLast((event) => event.type === 'result');
      if (!frame?.body) throw new Error('Missing durable result.');
      const result = frame.body as CloudSnapshot;
      Object.assign(sample, measured, {
        responseBytes: new TextEncoder().encode(raw).length,
        httpStatus: frame.status,
        passed: frame.status === 200 && assess(example, result),
        after: currentProblem(result.book),
        serverTiming: frame.timing,
      });
      if (example.id === 'parabola')
        await page.locator('.learnunlock-canvas canvas').first().waitFor();
    } catch (error) {
      sample.error = String(error);
    } finally {
      sample.screenshot = `${String(samples.length).padStart(2, '0')}-${variant}-${trial}-${example.id}.png`;
      await page.screenshot({
        path: directory + '/' + sample.screenshot,
        fullPage: true,
      });
      sample.visuallyReviewed = false;
      samples.push(sample);
      await checkpoint();
      await page.close();
      console.log(
        JSON.stringify({
          variant,
          trial,
          scenario: example.id,
          warmup,
          passed: sample.passed,
          displayMs: sample.displayMs,
          error: sample.error,
        }),
      );
    }
  };
  console.log(JSON.stringify({ directory, requests: 50 }));
  await run('before', cases[0], 0, true);
  await run('after', cases[0], 0, true);
  for (let trial = 1; trial <= 4; trial++)
    for (let offset = 0; offset < cases.length; offset++) {
      const index = (offset + trial - 1) % cases.length;
      const order: Variant[] =
        (offset + trial) % 2 ? ['before', 'after'] : ['after', 'before'];
      for (const variant of order) await run(variant, cases[index], trial);
    }
} finally {
  await checkpoint();
  await browser.close();
}
console.log(
  JSON.stringify({
    directory,
    measured: samples.filter((sample) => !sample.warmup).length,
  }),
);
