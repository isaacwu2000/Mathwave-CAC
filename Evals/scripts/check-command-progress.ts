import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  type CloudSnapshot,
} from '../../Web/src/modules/problems/index.ts';
import { runCommand } from '../../Web/src/modules/commands/index.ts';

type Fixture = Window & {
  emitEvaluationEvent?: (value: unknown) => void;
  advanceEvaluationProgress?: () => void;
  finishEvaluationSave?: () => void;
  evaluationRevision?: number;
};
const origin = process.argv[2] || 'http://localhost:3033';
const output = new URL('../evaluations/', import.meta.url);
const run = crypto.randomUUID();
const stem = `command-progress-${run}`;
let book = createProblemLibrary();
book = recordStep(
  book,
  runCommand(currentProblem(book).state, 'write 2*x+3=11').state,
  'write 2*x+3=11',
);
const initial: CloudSnapshot = { book, clarification: null, revision: 0 };
const final = {
  book: recordStep(
    book,
    runCommand(currentProblem(book).state, 'write x=5').state,
    'write x=5',
  ),
  clarification: null,
  revision: 1,
  status: 'command',
  message: 'x equals five',
};
const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const checks: string[] = [];
let failure: string | undefined;
let stage = 'setup';
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(15000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(
    ({ initial, final }) => {
      const fixture = window as Fixture;
      let saved = initial;
      fixture.evaluationRevision = saved.revision;
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
        if (!path.includes('/api/problems')) return nativeFetch(input, init);
        if (init?.method !== 'POST') return Response.json(saved);
        return new Response(
          new ReadableStream({
            start(controller) {
              const send = (value: unknown) =>
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify(value) + '\n'),
                );
              const workspace = initial.book.assignments[0].problems[0].state;
              send({
                type: 'progress',
                progress: {
                  phase: 'checking',
                  workspace: { ...workspace, expression: 'x = 4' },
                },
              });
              fixture.advanceEvaluationProgress = () =>
                send({
                  type: 'progress',
                  progress: {
                    phase: 'fixing',
                    workspace: { ...workspace, expression: 'x = 5' },
                  },
                });
              fixture.finishEvaluationSave = () => {
                saved = final;
                fixture.evaluationRevision = saved.revision;
                send({ type: 'result', status: 200, body: final });
                controller.close();
              };
            },
          }),
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        );
      };
      navigator.mediaDevices.getUserMedia = async () => {
        const audio = new AudioContext(),
          destination = audio.createMediaStreamDestination();
        const source = audio.createOscillator(),
          gain = audio.createGain();
        gain.gain.value = 0.02;
        source.connect(gain);
        gain.connect(destination);
        await audio.resume();
        source.start();
        source.stop(audio.currentTime + 3);
        return destination.stream;
      };
      class Peer extends EventTarget {
        iceGatheringState = 'complete';
        localDescription = { sdp: 'synthetic offer' };
        channel = {
          readyState: 'open',
          onmessage: null as ((event: MessageEvent) => void) | null,
          onopen: null as (() => void) | null,
          send() {},
          close() {},
        };
        createDataChannel() {
          fixture.emitEvaluationEvent = (value) =>
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
            () => fixture.emitEvaluationEvent?.({ type: 'session.started' }),
            0,
          );
        }
      }
      window.RTCPeerConnection = Peer as unknown as typeof RTCPeerConnection;
    },
    { initial, final },
  );
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('.app-shell[data-ready="true"]').waitFor();
  await page
    .getByRole('button', { name: 'Start listening', exact: true })
    .click();
  stage = 'microphone wake';
  await page.waitForFunction(
    () =>
      !!(window as Fixture).emitEvaluationEvent ||
      !!document.querySelector('.voice-failure'),
    undefined,
    { timeout: 8000 },
  );
  const voiceFailure = await page.locator('.voice-failure').allTextContents();
  if (voiceFailure.length) throw new Error(voiceFailure.join('; '));
  stage = 'session connected';
  await page.waitForFunction(() =>
    document.querySelector('#voice-status')?.textContent?.includes('connected'),
  );
  stage = 'Pico listening and playback';
  await page
    .locator('.pico[data-listening="true"][data-working="false"]')
    .waitFor();
  const eyes = await page
    .locator('.pico-eyes circle')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        radius: node.getAttribute('r'),
        y: node.getAttribute('cy'),
      })),
    );
  if (
    eyes.length !== 2 ||
    eyes.some((eye) => eye.radius !== '8' || eye.y !== '70')
  )
    throw new Error('Pico does not have matching centered circular eyes.');
  await page.evaluate(() =>
    (window as Fixture).emitEvaluationEvent?.({
      type: 'playback.activity',
      active: true,
    }),
  );
  await page
    .locator('.pico[data-listening="true"][data-speaking="true"]')
    .waitFor();
  if (
    (await page
      .locator('.pico-waves')
      .evaluate((node) => getComputedStyle(node).display)) === 'none'
  )
    throw new Error('Audible playback has no speaking waves.');
  await page.evaluate(() =>
    (window as Fixture).emitEvaluationEvent?.({
      type: 'playback.activity',
      active: false,
    }),
  );
  await page.locator('.pico[data-speaking="false"]').waitFor();
  if (
    (await page
      .locator('.pico-waves')
      .evaluate((node) => getComputedStyle(node).display)) !== 'none'
  )
    throw new Error('Speaking waves survive playback interruption.');
  checks.push(
    'Pico has two matching circular eyes; listening and playback overlap, and interruption immediately removes waves.',
  );
  stage = 'streaming student captions';
  await page.evaluate(() => {
    (window as Fixture).emitEvaluationEvent?.({
      type: 'session.input_transcript.delta',
      delta: 'put x',
    });
  });
  await page
    .locator('.audio-transcript[data-source="student"]')
    .getByText('put x', { exact: true })
    .waitFor();
  if (await page.locator('[data-command-phase]').count())
    throw new Error('A transcript fragment executed before delegation.');
  await page.evaluate(() => {
    (window as Fixture).emitEvaluationEvent?.({
      type: 'session.input_transcript.delta',
      delta: ' equal to',
    });
  });
  await page
    .locator('.audio-transcript[data-source="student"]')
    .getByText('put x equal to', { exact: true })
    .waitFor();
  // The last fragment and dispatch share one task, exposing captions erased before React renders.
  await page.evaluate(() => {
    (window as Fixture).emitEvaluationEvent?.({
      type: 'session.input_transcript.delta',
      delta: ' four',
    });
    (window as Fixture).emitEvaluationEvent?.({
      type: 'session.delegation.created',
      delegation: { id: 'synthetic-progress', target: 'client' },
    });
  });
  stage = 'checking preview';
  await page.locator('[data-command-phase="checking"]').waitFor();
  await page
    .locator('.audio-transcript[data-source="student"]')
    .getByText('put x equal to four', { exact: true })
    .waitFor();
  checks.push(
    'Student captions render incrementally before delegation and remain visible during execution.',
  );
  if ((await page.evaluate(() => (window as Fixture).evaluationRevision)) !== 0)
    throw new Error('Preview changed saved revision.');
  checks.push('Checking status visible before save; revision stays zero.');
  await page
    .locator(
      '.pico[data-working="true"][data-listening="true"][data-speaking="false"]',
    )
    .waitFor();
  checks.push(
    'Request progress animates Pico independently of audible playback.',
  );
  await page
    .getByRole('button', { name: 'Stop listening', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('button', { name: 'Start listening', exact: true })
    .waitFor();
  await page
    .locator('.pico[data-working="true"][data-listening="false"]')
    .waitFor();
  checks.push(
    'Keyboard mic stop releases listening while the delegated save remains pending.',
  );
  await page.evaluate(() =>
    (window as Fixture).emitEvaluationEvent?.({
      type: 'playback.activity',
      active: true,
    }),
  );
  await page
    .locator('.pico[data-working="true"][data-speaking="true"]')
    .waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (
    (await page
      .locator('.pico')
      .evaluate((node) => node.getAnimations({ subtree: true }).length)) !== 0
  )
    throw new Error('Pico still animates with reduced motion.');
  if (
    !(await page.locator('.pico').getAttribute('aria-label'))?.includes(
      'speaking',
    )
  )
    throw new Error('Reduced motion lost playback status.');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.locator('.pico[data-hidden="true"]').waitFor();
  if (
    (await page
      .locator('.pico-waves path')
      .first()
      .evaluate((node) => getComputedStyle(node).animationPlayState)) !==
    'paused'
  )
    throw new Error('Hidden-page speaking animation did not pause.');
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.locator('.pico[data-hidden="false"]').waitFor();
  checks.push(
    'Reduced motion removes animation while preserving status; a simulated hidden-page event pauses and resumes motion.',
  );
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: new URL(`${stem}-desktop.png`, output).pathname,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (window as Fixture).advanceEvaluationProgress?.());
  await page.locator('[data-command-phase="fixing"]').waitFor();
  if ((await page.evaluate(() => (window as Fixture).evaluationRevision)) !== 0)
    throw new Error('Repair changed saved revision.');
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error('Narrow layout overflow.');
  await page.screenshot({
    path: new URL(`${stem}-mobile.png`, output).pathname,
  });
  checks.push(
    'Fixing status visible at 390px with no save or horizontal overflow.',
  );
  await page.evaluate(() => (window as Fixture).finishEvaluationSave?.());
  await page.waitForFunction(
    () => !document.querySelector('[data-command-phase]'),
  );
  await page
    .getByRole('button', { name: 'Focus step 2: x = 5', exact: true })
    .waitFor();
  if ((await page.evaluate(() => (window as Fixture).evaluationRevision)) !== 1)
    throw new Error('Final save missing.');
  checks.push('Final result replaces preview and increments revision once.');
  await page.locator('.pico[data-working="false"]').waitFor();
  await page
    .locator('.pico[data-listening="false"][data-speaking="true"]')
    .waitFor();
  await page.evaluate(() =>
    (window as Fixture).emitEvaluationEvent?.({
      type: 'session.output_transcript.delta',
      delta: 'Saved x equals five.',
    }),
  );
  await page.getByText('Saved x equals five.', { exact: true }).waitFor();
  checks.push(
    'The delegated save and AI reply complete with the microphone off.',
  );
  await page.evaluate(() =>
    (window as Fixture).emitEvaluationEvent?.({
      type: 'playback.activity',
      active: false,
    }),
  );
  await page
    .locator('.pico[data-listening="false"][data-speaking="false"]')
    .waitFor();
  if (pageErrors.length) throw new Error(pageErrors.join('; '));
} catch (error) {
  failure = `${stage}: ${error instanceof Error ? error.message : 'Browser check failed.'}`;
  process.exitCode = 1;
} finally {
  await browser.close();
  await mkdir(output, { recursive: true });
  await writeFile(
    new URL(`${stem}.json`, output),
    JSON.stringify(
      {
        run,
        scope:
          'One mocked browser lifecycle case; no provider or saved-user-data access.',
        checks,
        passed: !failure,
        failure,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      report: `Evals/evaluations/${stem}.json`,
      checks,
      failure,
    }),
  );
}
